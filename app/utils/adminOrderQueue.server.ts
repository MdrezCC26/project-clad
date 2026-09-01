import prisma from "../db.server";
import { getShopDeliveryFee } from "./shopDeliveryFee.server";
import { resolveJobDelivery } from "./jobDelivery";
import {
  computeDeliveredPercent,
  deliveredQtyForItem,
  ensureJobDeliveryPhases,
  ensureOpenFulfillmentPhase,
  findActiveDeliveryPhaseId,
  mapPhasesToViews,
} from "./jobDeliveryPhases.server";
import { shopStringFilter } from "./projectAccess.server";
import {
  getAdminVariantInfo,
  type AdminVariantInfo,
} from "./adminVariants.server";
import {
  buildVariantPresentation,
  parseVariantSnapshot,
} from "./variantInfo.server";
import { formatPhoneNumber } from "./phoneFormat";

export type AdminOrderQueueJobItem = {
  id: string;
  displayName: string;
  quantity: number;
};

export type AdminOrderQueueJobRow = {
  id: string;
  name: string;
  orderNumber: number | null;
  createdAt: string;
  projectId: string;
  projectName: string;
  orderLifecycleStatus: "ordered" | "delivered";
  paidAt: string | null;
  orderName: string | null;
  hasFulfillmentPhoto: boolean;
  hasPhasedDelivery: boolean;
  deliveredPercent: number;
  confirmedPhaseCount: number;
  openPhaseId: string | null;
  openPhaseSequence: number | null;
  /**
   * Where this order is going, and who is meeting the truck. Shown beside the batch
   * checkboxes so confirming several orders off one photo is an informed choice rather than
   * a guess at which ones were on the same drop.
   */
  deliveryAddressLine: string | null;
  deliveryMethod: "pickup" | "delivery";
  siteContactName: string | null;
  siteContactPhone: string | null;
  /** Qty inputs for the open delivery drop (empty when no open phase). */
  deliveryInputs: Array<{
    jobItemId: string;
    displayName: string;
    orderedQuantity: number;
    remaining: number;
  }>;
  items: AdminOrderQueueJobItem[];
};

export async function loadAdminOrderQueueJobs(
  shop: string,
  statuses: Array<"ordered" | "delivered">,
): Promise<AdminOrderQueueJobRow[]> {
  const jobs = await prisma.job.findMany({
    where: {
      project: { shop: shopStringFilter(shop) },
      orderLifecycleStatus: { in: statuses },
    },
    orderBy: { createdAt: "asc" },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          receiveMode: true,
          shipAddress1: true,
          shipCity: true,
          shipProvince: true,
          shipPostal: true,
          shipCountry: true,
        },
      },
      orderLink: { select: { orderName: true } },
      items: { orderBy: { sortOrder: "asc" } },
      deliveryPhases: {
        orderBy: { sequence: "asc" },
        include: { lines: true },
      },
    },
  });

  const shopDeliveryFee = await getShopDeliveryFee(shop);
  const projectDeliveryCtx = (project: (typeof jobs)[number]["project"]) => ({
    receiveMode: project.receiveMode,
    shipAddress1: project.shipAddress1,
    shipCity: project.shipCity,
    shipProvince: project.shipProvince,
    shipPostal: project.shipPostal,
    shipCountry: project.shipCountry,
  });

  for (const job of jobs) {
    const resolved = resolveJobDelivery(
      job,
      projectDeliveryCtx(job.project),
      shopDeliveryFee,
    );
    await ensureJobDeliveryPhases(job, shopDeliveryFee, resolved);
    if (resolved.method === "delivery") {
      await ensureOpenFulfillmentPhase(job.id);
    }
  }

  const refreshed =
    jobs.length === 0
      ? []
      : await prisma.job.findMany({
          where: { id: { in: jobs.map((j) => j.id) } },
          orderBy: { createdAt: "asc" },
          include: {
            project: {
              select: {
                id: true,
                name: true,
                receiveMode: true,
                shipAddress1: true,
                shipCity: true,
                shipProvince: true,
                shipPostal: true,
                shipCountry: true,
              },
            },
            orderLink: { select: { orderName: true } },
            items: { orderBy: { sortOrder: "asc" } },
            deliveryPhases: {
              orderBy: { sequence: "asc" },
              include: { lines: true },
            },
          },
        });

  const variantIds = Array.from(
    new Set(refreshed.flatMap((j) => j.items.map((i) => i.variantId))),
  );
  let variantInfo: Record<string, AdminVariantInfo> = {};
  if (variantIds.length > 0) {
    try {
      variantInfo = await getAdminVariantInfo(shop, variantIds);
    } catch {
      variantInfo = {};
    }
  }

  return refreshed.map((job) => {
    const resolvedDelivery = resolveJobDelivery(
      job,
      projectDeliveryCtx(job.project),
      shopDeliveryFee,
    );
    const phaseViews = mapPhasesToViews(job.deliveryPhases);
    const deliveredPercent = computeDeliveredPercent(job.items, phaseViews);
    const confirmedPhaseCount = phaseViews.filter((p) => p.hasPhoto).length;
    const openPhaseId = findActiveDeliveryPhaseId(phaseViews) || null;
    const openPhase = openPhaseId
      ? phaseViews.find((p) => p.id === openPhaseId)
      : null;

    const items = job.items.map((item) => {
      const live = variantInfo[item.variantId];
      const presentation = buildVariantPresentation({
        shop,
        variantId: item.variantId,
        live: live ?? undefined,
        snapshot: parseVariantSnapshot(item.variantSnapshot),
      });
      return {
        id: item.id,
        displayName: presentation.displayName,
        quantity: item.quantity,
      };
    });

    const deliveryInputs = openPhaseId
      ? items
          .map((item) => {
            const alreadyElsewhere = deliveredQtyForItem(
              phaseViews,
              item.id,
              openPhaseId,
            );
            const remaining = Math.max(0, item.quantity - alreadyElsewhere);
            return {
              jobItemId: item.id,
              displayName: item.displayName,
              orderedQuantity: item.quantity,
              remaining,
            };
          })
          .filter((row) => row.remaining > 0)
      : [];

    return {
      id: job.id,
      name: job.name,
      orderNumber: job.orderNumber ?? null,
      createdAt: job.createdAt.toISOString(),
      projectId: job.project.id,
      projectName: job.project.name,
      orderLifecycleStatus: job.orderLifecycleStatus as "ordered" | "delivered",
      paidAt: job.paidAt?.toISOString() ?? null,
      orderName: job.orderLink?.orderName ?? null,
      hasFulfillmentPhoto: Boolean(job.fulfillmentPhotoStorageKey),
      hasPhasedDelivery: job.deliveryPhases.length > 0,
      deliveredPercent,
      confirmedPhaseCount,
      openPhaseId,
      openPhaseSequence: openPhase?.sequence ?? null,
      deliveryAddressLine: resolvedDelivery.addressLine,
      deliveryMethod: resolvedDelivery.method,
      siteContactName: job.siteContactName?.trim() || null,
      siteContactPhone: formatPhoneNumber(job.siteContactPhone) || null,
      deliveryInputs,
      items,
    };
  });
}
