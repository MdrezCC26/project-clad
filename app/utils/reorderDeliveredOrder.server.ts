import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { CartPricingError } from "./calculatorPricing.server";
import {
  isJobDeliverySchemaError,
  isReorderEligibleOrderLifecycle,
  jobDeliveryPrismaData,
  normalizeJobDeliveryMode,
} from "./jobDelivery";
import { logProjectActivity } from "./projectActivity.server";
import {
  allocateReorderOrderName,
  customPartDrawingFromProperties,
  linePropertiesFromCustomData,
  orderLineCaptureForReorder,
  selectReorderLines,
} from "./reorderDeliveredOrder";
import { getAuthoritativeSavedCartPrices } from "./savedCartPricing.server";
import { duplicateUploadPartMirrorsForCopiedJobItem } from "./uploadPartMirror.server";

export type CreateDeliveredOrderReorderResult =
  | { ok: true; jobId: string; jobName: string; lineCount: number; sourceJobName: string }
  | { ok: false; status: number; error: string };

/**
 * Copy a delivered (or paid) order into a new draft in the same project.
 * The source job is only read. Prices are current catalog / shape rates.
 * The draft is not placed: Order now still applies approval, APPROVED-tag,
 * delivery, and site-contact rules.
 */
export async function createDeliveredOrderReorder(args: {
  shop: string;
  projectId: string;
  sourceJobId: string;
  requestedName: string;
  quantityOverrides: Map<string, number>;
  actorCustomerId: string;
}): Promise<CreateDeliveredOrderReorderResult> {
  const sourceJobId = args.sourceJobId.trim();
  if (!sourceJobId) {
    return { ok: false, status: 400, error: "Order is required." };
  }

  const job = await prisma.job.findFirst({
    where: { id: sourceJobId, projectId: args.projectId },
    include: { items: true },
  });
  if (!job) {
    return { ok: false, status: 404, error: "Order not found." };
  }
  if (!isReorderEligibleOrderLifecycle(job.orderLifecycleStatus)) {
    return {
      ok: false,
      status: 403,
      error: "Reorder is only available once an order is delivered or paid.",
    };
  }

  const selected = selectReorderLines(job.items, args.quantityOverrides);
  if (!selected.ok) {
    return { ok: false, status: 400, error: selected.error };
  }

  let prices: string[];
  try {
    prices = await getAuthoritativeSavedCartPrices(
      args.shop,
      selected.lines.map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        properties: linePropertiesFromCustomData(line.customData),
      })),
    );
  } catch (error) {
    console.error(
      "[project-clad] reorder-delivered-order pricing failed:",
      error instanceof Error ? error.message : error,
    );
    if (error instanceof CartPricingError) {
      return {
        ok: false,
        status: 422,
        error: `Current prices could not be verified: ${error.message}`,
      };
    }
    return {
      ok: false,
      status: 503,
      error: "Shopify could not verify current prices. Try again in a moment.",
    };
  }
  if (prices.length !== selected.lines.length) {
    return {
      ok: false,
      status: 422,
      error: "Current prices could not be verified: line count did not match.",
    };
  }

  const existingNames = await prisma.job.findMany({
    where: { projectId: args.projectId },
    select: { name: true },
  });
  const named = allocateReorderOrderName(
    args.requestedName,
    job.name,
    existingNames.map((row) => row.name),
  );
  if (!named.ok) {
    return { ok: false, status: 400, error: named.error };
  }

  const maxOrder = await prisma.job.aggregate({
    where: { projectId: args.projectId },
    _max: { sortOrder: true },
  });
  const nextSortOrder = (maxOrder._max.sortOrder ?? 0) + 1;
  const deliveryMode = normalizeJobDeliveryMode(job.deliveryMode);
  const deliveryData = jobDeliveryPrismaData(deliveryMode, {
    shipAddress1: job.shipAddress1,
    shipCity: job.shipCity,
    shipProvince: job.shipProvince,
    shipPostal: job.shipPostal,
    shipCountry: job.shipCountry ?? "Canada",
  });

  const itemData = selected.lines.map((line, index) => ({
    variantId: line.variantId,
    quantity: line.quantity,
    priceSnapshot: prices[index],
    sortOrder: index + 1,
    variantSnapshot: line.variantSnapshot ?? undefined,
    customData: line.customData ?? undefined,
    orderLineCapture: orderLineCaptureForReorder(
      line.orderLineCapture,
      line.variantId,
      prices[index],
    ) as Prisma.InputJsonValue,
    catalogProductId: line.catalogProductId ?? undefined,
    catalogSku: line.catalogSku ?? undefined,
  }));

  const baseData = {
    projectId: args.projectId,
    name: named.name,
    sortOrder: nextSortOrder,
    orderLifecycleStatus: "draft" as const,
    isLocked: false,
    siteContactName: job.siteContactName ?? null,
    siteContactPhone: job.siteContactPhone ?? null,
    purchaseOrderNumber: job.purchaseOrderNumber ?? undefined,
    items: { create: itemData },
  };

  let created: { id: string; name: string; items: { id: string; sortOrder: number }[] };
  try {
    created = await prisma.job.create({
      data: { ...baseData, ...deliveryData },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
  } catch (error) {
    if (!isJobDeliverySchemaError(error)) throw error;
    console.warn(
      "[project-clad] reorder-delivered-order retrying without delivery columns:",
      error instanceof Error ? error.message : error,
    );
    created = await prisma.job.create({
      data: baseData,
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
  }

  const newItems = [...created.items].sort((a, b) => a.sortOrder - b.sortOrder);
  const pairCount = Math.min(selected.lines.length, newItems.length);
  for (let i = 0; i < pairCount; i++) {
    const source = selected.lines[i];
    const dest = newItems[i];
    try {
      await duplicateUploadPartMirrorsForCopiedJobItem({
        shop: args.shop,
        oldItem: {
          id: source.id,
          customData: source.customData,
          uploadPartMirrorKeysJson: source.uploadPartMirrorKeysJson,
        },
        newJobItemId: dest.id,
      });
    } catch (mirrorErr) {
      console.error(
        "[project-clad] reorder-delivered-order upload mirror failed:",
        mirrorErr instanceof Error ? mirrorErr.message : mirrorErr,
      );
    }
    const drawing = customPartDrawingFromProperties(
      linePropertiesFromCustomData(source.customData),
    );
    if (!drawing) continue;
    try {
      await prisma.drawingJob.create({
        data: {
          jobItemId: dest.id,
          shop: args.shop,
          status: "pending",
          shapeType: drawing.shapeType,
          l1: drawing.l1,
          l2: drawing.l2,
          l3: drawing.l3,
          a1: drawing.a1,
          gauge: drawing.gauge,
        },
      });
    } catch (drawErr) {
      console.error(
        "[project-clad] reorder-delivered-order drawing enqueue failed:",
        drawErr instanceof Error ? drawErr.message : drawErr,
      );
    }
  }

  await logProjectActivity({
    projectId: args.projectId,
    jobId: created.id,
    type: "order_created",
    visibility: "member",
    actorCustomerId: args.actorCustomerId,
    payload: {
      jobName: created.name,
      reorderedFromJobName: job.name,
      sourceJobId: job.id,
      draft: true,
      lineCount: selected.lines.length,
    },
  }).catch((err: unknown) => {
    console.error(
      `[project-clad] reorder-delivered-order activity log failed (project=${args.projectId} job=${created.id}):`,
      err instanceof Error ? err.message : err,
    );
  });

  return {
    ok: true,
    jobId: created.id,
    jobName: created.name,
    lineCount: selected.lines.length,
    sourceJobName: job.name,
  };
}
