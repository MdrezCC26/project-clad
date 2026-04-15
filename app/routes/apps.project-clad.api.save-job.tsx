import type { ActionFunctionArgs } from "react-router";
import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import { viewerHasAdminTag } from "../utils/customerTags.server";
import {
  canEditProject,
  projectByIdForCustomerWhere,
  shopifyCustomerIdVariants,
  shopStringFilter,
} from "../utils/projectAccess.server";
import { sendOrderCreatedNotificationEmail } from "../utils/orderCreatedEmail.server";
import { logProjectActivity } from "../utils/projectActivity.server";
import {
  buildOrderLineCapture,
  cartLineMetaToVariantSnapshot,
  hydrateJobItemVariantSnapshots,
  type CartLineMetaInput,
} from "../utils/variantInfo.server";

type SaveJobPayload = {
  mode: "newProject" | "existingProject" | "existingJob";
  poNumber?: string;
  companyName?: string;
  projectName?: string;
  jobName?: string;
  /** Cart "PURCHASE ORDER #" — stored on Job, not appended to `name`. */
  purchaseOrderNumber?: string;
  projectId?: string;
  jobId?: string;
  quantityMode?: "add" | "replace";
  items?: {
    variantId: string;
    quantity: number;
    priceSnapshot: string | number;
    properties?: { name: string; value: string }[];
    /** From storefront `/cart.js` at save time (product titles, image, SKU). */
    lineMeta?: CartLineMetaInput;
  }[];
};

type NormalizedCartItem = {
  variantId: string;
  quantity: number;
  priceSnapshot: Prisma.Decimal;
  properties?: { name: string; value: string }[];
  lineMeta?: CartLineMetaInput;
};

const normalizeItems = (items: SaveJobPayload["items"] = []): NormalizedCartItem[] =>
  items
    .filter((raw) => raw && raw.variantId && raw.quantity > 0)
    .map((raw) => ({
      variantId: String(raw.variantId),
      quantity: Number(raw.quantity),
      priceSnapshot: new Prisma.Decimal(raw.priceSnapshot ?? 0),
      properties:
        raw.properties && raw.properties.length ? raw.properties : undefined,
      lineMeta:
        raw.lineMeta && typeof raw.lineMeta === "object"
          ? raw.lineMeta
          : undefined,
    }));

/** Plain order name + optional PO; supports legacy `name` ending in ` (#…)`. */
function normalizeJobNameAndPo(
  jobNameRaw: string | undefined,
  purchaseOrderRaw: string | undefined,
): { name: string; purchaseOrderNumber: string | undefined } {
  let name = (jobNameRaw ?? "").trim();
  let po = (purchaseOrderRaw ?? "").trim();
  if (!po && name) {
    const legacy = name.match(/^(.*)\s+\(#([^)]+)\)\s*$/);
    if (legacy) {
      name = legacy[1].trim();
      po = legacy[2].trim();
    }
  }
  return { name, purchaseOrderNumber: po || undefined };
}

function variantSnapshotFromCartItem(
  item: NormalizedCartItem,
): Prisma.InputJsonValue | undefined {
  if (!item.lineMeta) return undefined;
  return cartLineMetaToVariantSnapshot(
    item.lineMeta,
  ) as unknown as Prisma.InputJsonValue;
}

function orderLineCaptureJson(item: NormalizedCartItem): Prisma.InputJsonValue {
  return buildOrderLineCapture({
    variantId: item.variantId,
    unitPrice: item.priceSnapshot.toString(),
    lineMeta: item.lineMeta,
  }) as unknown as Prisma.InputJsonValue;
}

/** Stable catalog keys from cart line meta (product id + SKU). */
function catalogFromLineMeta(
  lineMeta?: CartLineMetaInput | null,
): Pick<Prisma.JobItemCreateInput, "catalogProductId" | "catalogSku"> {
  const pid = lineMeta?.productId?.trim();
  const sku = lineMeta?.sku?.trim();
  return {
    ...(pid ? { catalogProductId: pid } : {}),
    ...(sku ? { catalogSku: sku } : {}),
  };
}

async function finalizeCartOrderSaved(args: {
  shop: string;
  projectId: string;
  projectName: string;
  jobId: string;
  jobName: string;
  headline: string;
  poNumber?: string | null;
  jobPurchaseOrderNumber?: string | null;
  companyName?: string | null;
  ownerCustomerId: string;
  actorCustomerId: string;
}) {
  const rows = await prisma.jobItem.findMany({
    where: { jobId: args.jobId },
    orderBy: { sortOrder: "asc" },
  });
  if (rows.length === 0) return;

  await hydrateJobItemVariantSnapshots(
    args.shop,
    rows.map((r) => ({
      id: r.id,
      variantId: r.variantId,
      variantSnapshot: r.variantSnapshot,
    })),
  );

  const fresh = await prisma.jobItem.findMany({
    where: { jobId: args.jobId },
    orderBy: { sortOrder: "asc" },
  });

  await sendOrderCreatedNotificationEmail({
    shop: args.shop,
    projectId: args.projectId,
    projectName: args.projectName,
    jobId: args.jobId,
    jobName: args.jobName,
    headline: args.headline,
    poNumber: args.poNumber,
    jobPurchaseOrderNumber: args.jobPurchaseOrderNumber,
    companyName: args.companyName,
    ownerCustomerId: args.ownerCustomerId,
    actorCustomerId: args.actorCustomerId,
    jobItems: fresh,
  });
}

const getNextSortOrder = async (jobId: string) => {
  const result = await prisma.jobItem.aggregate({
    where: { jobId },
    _max: { sortOrder: true },
  });
  return (result._max.sortOrder ?? 0) + 1;
};

const getNextJobSortOrder = async (projectId: string) => {
  const result = await prisma.job.aggregate({
    where: { projectId },
    _max: { sortOrder: true },
  });
  return (result._max.sortOrder ?? 0) + 1;
};

type CustomPartParsed = {
  shapeType: string;
  l1: number;
  l2: number;
  l3?: number;
  a1?: number;
  gauge: number;
};

function parseCustomPart(
  properties?: { name: string; value: string }[] | null,
): CustomPartParsed | null {
  if (!properties?.length) return null;
  const get = (name: string) =>
    properties.find((p) => p.name === name)?.value ?? "";
  const shapeType = get("shape_type");
  if (!["L", "Z", "U"].includes(shapeType)) return null;
  const l1 = parseFloat(get("L1")) || 0;
  const l2 = parseFloat(get("L2")) || 0;
  if (!l1 || !l2) return null;
  const gauge = parseInt(get("Gauge") || "0", 10) || 16;
  const l3 = get("L3") ? parseFloat(get("L3")) : undefined;
  const a1 = get("A1") ? parseFloat(get("A1")) : undefined;
  return { shapeType, l1, l2, l3, a1, gauge };
}

async function enqueueDrawingJob(
  jobItemId: string,
  shop: string,
  properties?: { name: string; value: string }[] | null,
) {
  const part = parseCustomPart(properties);
  if (!part) return;
  await prisma.drawingJob.create({
    data: {
      jobItemId,
      shop,
      status: "pending",
      shapeType: part.shapeType,
      l1: part.l1,
      l2: part.l2,
      l3: part.l3,
      a1: part.a1,
      gauge: part.gauge,
    },
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, customerId, customerEmail } = requireAppProxyCustomer(request, {
    jsonOnFail: true,
  });
  const payload = (await request.json()) as SaveJobPayload;
  const items = normalizeItems(payload.items);
  const { name: saveJobName, purchaseOrderNumber: saveJobPurchaseOrderNumber } =
    normalizeJobNameAndPo(payload.jobName, payload.purchaseOrderNumber);
  const poNumber = (payload.poNumber || "").trim();
  const companyName = (payload.companyName || "").trim();
  const viewerIsAppAdmin = await viewerHasAdminTag(
    shop,
    customerId,
    customerEmail,
  );

  if (!items.length) {
    return Response.json({ error: "Cart has no items." }, { status: 400 });
  }

  if (payload.mode === "newProject") {
    if (!payload.projectName || !saveJobName) {
      return Response.json(
        { error: "Project name and order name are required." },
        { status: 400 },
      );
    }

    const projectName = payload.projectName.trim();
    const norm = (s: string | null | undefined) => (s ?? "").trim();
    const recentCutoff = new Date(Date.now() - 60_000);
    const ownerVariants = shopifyCustomerIdVariants(customerId);
    const recentCandidates = await prisma.project.findMany({
      where: {
        shop: shopStringFilter(shop),
        ownerCustomerId: { in: ownerVariants },
        createdAt: { gte: recentCutoff },
      },
      orderBy: { createdAt: "desc" },
      take: 15,
      include: {
        jobs: { orderBy: { sortOrder: "asc" }, take: 1 },
      },
    });
    const accidentalDuplicate = recentCandidates.find(
      (p) =>
        norm(p.name) === norm(projectName) &&
        norm(p.poNumber) === norm(poNumber) &&
        norm(p.companyName) === norm(companyName),
    );
    if (accidentalDuplicate?.jobs[0]) {
      return Response.json({
        projectId: accidentalDuplicate.id,
        jobId: accidentalDuplicate.jobs[0].id,
        reusedExistingProject: true,
      });
    }

    const project = await prisma.project.create({
      data: {
        shop,
        name: projectName,
        ownerCustomerId: customerId,
        poNumber,
        companyName,
        members: {
          create: { customerId, role: "edit" },
        },
        jobs: {
          create: {
            name: saveJobName,
            ...(saveJobPurchaseOrderNumber
              ? { purchaseOrderNumber: saveJobPurchaseOrderNumber }
              : {}),
            sortOrder: 1,
            items: {
              create: items.map((item, index) => ({
                variantId: item.variantId,
                quantity: item.quantity,
                priceSnapshot: item.priceSnapshot,
                sortOrder: index + 1,
                variantSnapshot: variantSnapshotFromCartItem(item) ?? undefined,
                orderLineCapture: orderLineCaptureJson(item),
                ...catalogFromLineMeta(item.lineMeta),
                customData:
                  item.properties && item.properties.length
                    ? (item.properties as Prisma.InputJsonValue)
                    : undefined,
              })),
            },
          },
        },
      },
      include: { jobs: { include: { items: true } } },
    });

    const jobItems = project.jobs[0]?.items ?? [];
    for (let i = 0; i < jobItems.length; i++) {
      await enqueueDrawingJob(
        jobItems[i].id,
        shop,
        items[i]?.properties,
      );
    }

    const firstJob = project.jobs[0];
    if (firstJob) {
      await logProjectActivity({
        projectId: project.id,
        jobId: firstJob.id,
        type: "order_created",
        visibility: "member",
        actorCustomerId: customerId,
        payload: { jobName: firstJob.name },
      });
      await finalizeCartOrderSaved({
        shop,
        projectId: project.id,
        projectName: project.name,
        jobId: firstJob.id,
        jobName: firstJob.name,
        headline: "Your order has been saved!",
        poNumber: project.poNumber,
        jobPurchaseOrderNumber: firstJob.purchaseOrderNumber,
        companyName: project.companyName,
        ownerCustomerId: project.ownerCustomerId,
        actorCustomerId: customerId,
      });
    }

    return Response.json({
      projectId: project.id,
      jobId: project.jobs[0]?.id,
    });
  }

  if (payload.mode === "existingProject") {
    if (!payload.projectId || !saveJobName) {
      return Response.json(
        { error: "Select a project and order name." },
        { status: 400 },
      );
    }

    const project = await prisma.project.findFirst({
      where: projectByIdForCustomerWhere(
        payload.projectId,
        shop,
        customerId,
        viewerIsAppAdmin,
      ),
      include: { members: true },
    });

    if (!project) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }

    const canEdit = canEditProject(project, customerId, viewerIsAppAdmin);

    if (!canEdit) {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }

    const nextJobSortOrder = await getNextJobSortOrder(project.id);
    const job = await prisma.job.create({
      data: {
        projectId: project.id,
        name: saveJobName,
        ...(saveJobPurchaseOrderNumber
          ? { purchaseOrderNumber: saveJobPurchaseOrderNumber }
          : {}),
        sortOrder: nextJobSortOrder,
        items: {
          create: items.map((item, index) => ({
            variantId: item.variantId,
            quantity: item.quantity,
            priceSnapshot: item.priceSnapshot,
            sortOrder: index + 1,
            variantSnapshot: variantSnapshotFromCartItem(item) ?? undefined,
            orderLineCapture: orderLineCaptureJson(item),
            ...catalogFromLineMeta(item.lineMeta),
            customData:
              item.properties && item.properties.length
                ? (item.properties as Prisma.InputJsonValue)
                : undefined,
          })),
        },
      },
      include: { items: true },
    });

    for (let i = 0; i < job.items.length; i++) {
      await enqueueDrawingJob(job.items[i].id, shop, items[i]?.properties);
    }

    await prisma.project.update({
      where: { id: project.id },
      data: { poNumber, companyName },
    });

    await logProjectActivity({
      projectId: project.id,
      jobId: job.id,
      type: "order_created",
      visibility: "member",
      actorCustomerId: customerId,
      payload: { jobName: job.name },
    });

    await finalizeCartOrderSaved({
      shop,
      projectId: project.id,
      projectName: project.name,
      jobId: job.id,
      jobName: job.name,
      headline: "Your order has been saved!",
      poNumber,
      jobPurchaseOrderNumber: job.purchaseOrderNumber,
      companyName,
      ownerCustomerId: project.ownerCustomerId,
      actorCustomerId: customerId,
    });

    return Response.json({ projectId: project.id, jobId: job.id });
  }

  if (payload.mode === "existingJob") {
    if (!payload.projectId || !payload.jobId) {
      return Response.json(
        { error: "Select a project and order." },
        { status: 400 },
      );
    }

    const project = await prisma.project.findFirst({
      where: projectByIdForCustomerWhere(
        payload.projectId,
        shop,
        customerId,
        viewerIsAppAdmin,
      ),
      include: { members: true },
    });

    if (!project) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }

    const canEdit = canEditProject(project, customerId, viewerIsAppAdmin);

    if (!canEdit) {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }

    const job = await prisma.job.findFirst({
      where: { id: payload.jobId, projectId: project.id },
      include: { items: true, orderLink: true },
    });

    if (!job) {
      return Response.json({ error: "Order not found." }, { status: 404 });
    }

    await prisma.project.update({
      where: { id: project.id },
      data: { poNumber, companyName },
    });

    const isLocked = job.isLocked || Boolean(job.orderLink);
    let targetJobId = job.id;
    let copied = false;

    if (isLocked) {
      const nextJobSortOrder = await getNextJobSortOrder(project.id);
      const copy = await prisma.job.create({
        data: {
          projectId: project.id,
          name: `${job.name} (Copy)`,
          purchaseOrderNumber: job.purchaseOrderNumber ?? undefined,
          isLocked: false,
          sortOrder: nextJobSortOrder,
          items: {
            create: job.items.map((item) => ({
              variantId: item.variantId,
              quantity: item.quantity,
              priceSnapshot: item.priceSnapshot,
              sortOrder: item.sortOrder,
              variantSnapshot: item.variantSnapshot ?? undefined,
              customData: item.customData ?? undefined,
              orderLineCapture: item.orderLineCapture ?? undefined,
              catalogProductId: item.catalogProductId ?? undefined,
              catalogSku: item.catalogSku ?? undefined,
            })),
          },
        },
      });

      targetJobId = copy.id;
      copied = true;
      await logProjectActivity({
        projectId: project.id,
        jobId: copy.id,
        type: "order_created",
        visibility: "member",
        actorCustomerId: customerId,
        payload: { jobName: copy.name, copiedFrom: job.name },
      });
    }

    if (payload.quantityMode === "replace") {
      await prisma.$transaction([
        prisma.jobItem.deleteMany({ where: { jobId: targetJobId } }),
        prisma.jobItem.createMany({
          data: items.map((item, index) => ({
            jobId: targetJobId,
            variantId: item.variantId,
            quantity: item.quantity,
            priceSnapshot: item.priceSnapshot,
            sortOrder: index + 1,
            variantSnapshot: variantSnapshotFromCartItem(item) ?? undefined,
            orderLineCapture: orderLineCaptureJson(item),
            ...catalogFromLineMeta(item.lineMeta),
            customData:
              item.properties && item.properties.length
                ? (item.properties as Prisma.InputJsonValue)
                : undefined,
          })),
        }),
      ]);
      const createdItems = await prisma.jobItem.findMany({
        where: { jobId: targetJobId },
        orderBy: { sortOrder: "asc" },
      });
      for (let i = 0; i < createdItems.length; i++) {
        await enqueueDrawingJob(
          createdItems[i].id,
          shop,
          items[i]?.properties,
        );
      }
    } else {
      // In "add" mode, always create a new JobItem per cart line,
      // so multiple uploads for the same variant become separate rows.
      let nextSortOrder = await getNextSortOrder(targetJobId);
      for (const item of items) {
        const created = await prisma.jobItem.create({
          data: {
            jobId: targetJobId,
            variantId: item.variantId,
            quantity: item.quantity,
            priceSnapshot: item.priceSnapshot,
            sortOrder: nextSortOrder,
            variantSnapshot: variantSnapshotFromCartItem(item) ?? undefined,
            orderLineCapture: orderLineCaptureJson(item),
            ...catalogFromLineMeta(item.lineMeta),
            customData:
              item.properties && item.properties.length
                ? (item.properties as Prisma.InputJsonValue)
                : undefined,
          },
        });
        await enqueueDrawingJob(created.id, shop, item.properties);
        nextSortOrder += 1;
      }
    }

    await prisma.approvalRequest.deleteMany({
      where: {
        projectId: project.id,
        jobId: targetJobId,
        itemId: "",
      },
    });

    const jobForNotify = await prisma.job.findFirst({
      where: { id: targetJobId, projectId: project.id },
      select: { name: true, purchaseOrderNumber: true },
    });
    if (jobForNotify) {
      await finalizeCartOrderSaved({
        shop,
        projectId: project.id,
        projectName: project.name,
        jobId: targetJobId,
        jobName: jobForNotify.name,
        headline: "Your order has been saved!",
        poNumber,
        jobPurchaseOrderNumber: jobForNotify.purchaseOrderNumber,
        companyName,
        ownerCustomerId: project.ownerCustomerId,
        actorCustomerId: customerId,
      });
    }

    return Response.json({
      projectId: project.id,
      jobId: targetJobId,
      copied,
    });
  }

  return Response.json({ error: "Unsupported mode." }, { status: 400 });
};
