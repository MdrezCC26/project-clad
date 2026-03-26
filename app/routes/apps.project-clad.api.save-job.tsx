import type { ActionFunctionArgs } from "react-router";
import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";

type SaveJobPayload = {
  mode: "newProject" | "existingProject" | "existingJob";
  poNumber?: string;
  companyName?: string;
  projectName?: string;
  jobName?: string;
  projectId?: string;
  jobId?: string;
  quantityMode?: "add" | "replace";
  items?: {
    variantId: string;
    quantity: number;
    priceSnapshot: string | number;
    properties?: { name: string; value: string }[];
  }[];
};

const normalizeItems = (items: SaveJobPayload["items"] = []) =>
  items
    .filter((raw) => raw && raw.variantId && raw.quantity > 0)
    .map((raw) => ({
      variantId: String(raw.variantId),
      quantity: Number(raw.quantity),
      priceSnapshot: new Prisma.Decimal(raw.priceSnapshot ?? 0),
      properties:
        raw.properties && raw.properties.length ? raw.properties : undefined,
    }));

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
  const { shop, customerId } = requireAppProxyCustomer(request, {
    jsonOnFail: true,
  });
  const payload = (await request.json()) as SaveJobPayload;
  const items = normalizeItems(payload.items);
  const poNumber = (payload.poNumber || "").trim();
  const companyName = (payload.companyName || "").trim();

  if (!items.length) {
    return Response.json({ error: "Cart has no items." }, { status: 400 });
  }

  if (!companyName) {
    return Response.json(
      { error: "Company name is required." },
      { status: 400 },
    );
  }

  if (payload.mode === "newProject") {
    if (!payload.projectName || !payload.jobName) {
      return Response.json(
        { error: "Project name and order name are required." },
        { status: 400 },
      );
    }

    const project = await prisma.project.create({
      data: {
        shop,
        name: payload.projectName,
        ownerCustomerId: customerId,
        poNumber,
        companyName,
        members: {
          create: { customerId, role: "edit" },
        },
        jobs: {
          create: {
            name: payload.jobName,
            sortOrder: 1,
            items: {
              create: items.map((item, index) => ({
                variantId: item.variantId,
                quantity: item.quantity,
                priceSnapshot: item.priceSnapshot,
                sortOrder: index + 1,
                customData:
                  item.properties && item.properties.length
                    ? (item.properties as unknown as Prisma.JsonValue)
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

    return Response.json({
      projectId: project.id,
      jobId: project.jobs[0]?.id,
    });
  }

  if (payload.mode === "existingProject") {
    if (!payload.projectId || !payload.jobName) {
      return Response.json(
        { error: "Select a project and order name." },
        { status: 400 },
      );
    }

    const project = await prisma.project.findFirst({
      where: {
        id: payload.projectId,
        shop,
        OR: [
          { ownerCustomerId: customerId },
          { members: { some: { customerId } } },
        ],
      },
      include: { members: true },
    });

    if (!project) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }

    const memberRole = project.members.find(
      (member) => member.customerId === customerId,
    )?.role;
    const canEdit =
      project.ownerCustomerId === customerId || memberRole === "edit";

    if (!canEdit) {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }

    const nextJobSortOrder = await getNextJobSortOrder(project.id);
    const job = await prisma.job.create({
      data: {
        projectId: project.id,
        name: payload.jobName,
        sortOrder: nextJobSortOrder,
        items: {
          create: items.map((item, index) => ({
            variantId: item.variantId,
            quantity: item.quantity,
            priceSnapshot: item.priceSnapshot,
            sortOrder: index + 1,
            customData:
              item.properties && item.properties.length
                ? (item.properties as unknown as Prisma.JsonValue)
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
      where: {
        id: payload.projectId,
        shop,
        OR: [
          { ownerCustomerId: customerId },
          { members: { some: { customerId } } },
        ],
      },
      include: { members: true },
    });

    if (!project) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }

    const memberRole = project.members.find(
      (member) => member.customerId === customerId,
    )?.role;
    const canEdit =
      project.ownerCustomerId === customerId || memberRole === "edit";

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
          isLocked: false,
          sortOrder: nextJobSortOrder,
          items: {
            create: job.items.map((item) => ({
              variantId: item.variantId,
              quantity: item.quantity,
              priceSnapshot: item.priceSnapshot,
              sortOrder: item.sortOrder,
            })),
          },
        },
      });

      targetJobId = copy.id;
      copied = true;
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
            customData:
              item.properties && item.properties.length
                ? (item.properties as unknown as Prisma.JsonValue)
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
            customData:
              item.properties && item.properties.length
                ? (item.properties as unknown as Prisma.JsonValue)
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

    return Response.json({
      projectId: project.id,
      jobId: targetJobId,
      copied,
    });
  }

  return Response.json({ error: "Unsupported mode." }, { status: 400 });
};
