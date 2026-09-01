/**
 * Confirming a delivery, in one place.
 *
 * The single-order flow and the batch flow differ only in where the photo and the quantities
 * come from, so both run through `confirmPhaseDelivery`. Batch exists because one truckload
 * routinely covers several orders: staff were confirming one of them with the photo and
 * leaving the rest looking undelivered.
 *
 * Each order still gets its own copy of the image under its own storage key, and its own
 * customer and finance emails — those go to different people with different invoice totals.
 * Only the photograph is shared.
 */

import prisma from "../db.server";
import {
  saveFulfillmentPhoto,
  isSafeFulfillmentPhotoStorageKey,
} from "./fulfillmentPhotoStorage.server";
import { sendFulfillmentPackageEmails } from "./fulfillmentNotify.server";
import {
  computeDeliveredPercent,
  deliveredQtyForItem,
  findActiveDeliveryPhaseId,
  isJobFullyDelivered,
  mapPhasesToViews,
  recordPhaseDeliveredQuantities,
  spawnNextFulfillmentPhaseIfNeeded,
  ensureOpenFulfillmentPhase,
} from "./jobDeliveryPhases.server";
import { logProjectActivity } from "./projectActivity.server";
import { notifyMissionControl } from "./missionControl.server";

export type FulfillmentPhotoExt = ".png" | ".webp" | ".jpg";

export type FulfillmentPhotoInput = {
  buffer: Buffer;
  ext: FulfillmentPhotoExt;
};

export const MAX_FULFILLMENT_PHOTO_BYTES = 8 * 1024 * 1024;

/** Everything else is stored as `.jpg`; the storage layer keys its content type off this. */
export function fulfillmentPhotoExtFromName(name: string): FulfillmentPhotoExt {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".png")) return ".png";
  if (lower.endsWith(".webp")) return ".webp";
  return ".jpg";
}

export type ConfirmPhaseDeliveryResult =
  | {
      ok: true;
      phaseSequence: number;
      fullyDelivered: boolean;
      deliveredPercent: number;
      message: string;
      /** The delivery is still recorded when this is true; only the email failed. */
      notifyFailed: boolean;
    }
  | { ok: false; error: string };

export type ConfirmPhaseDeliveryArgs = {
  shop: string;
  jobId: string;
  /** Omit to use whichever phase is currently open, which is what the batch flow does. */
  phaseId?: string;
  photo: FulfillmentPhotoInput;
  /**
   * Delivered quantity keyed by job item id. Omit to deliver everything still outstanding —
   * the batch flow has no per-line UI, so "these orders arrived" means all of them.
   */
  quantities?: Record<string, number>;
  /** Storefront callers scope to one project; the admin queue works shop-wide. */
  projectId?: string;
  source: "storefront" | "shopify_admin";
  actorCustomerId?: string | null;
  /** The storefront single-order path has never written an activity row; leave it that way. */
  logActivity?: boolean;
};

export async function confirmPhaseDelivery(
  args: ConfirmPhaseDeliveryArgs,
): Promise<ConfirmPhaseDeliveryResult> {
  const {
    shop,
    jobId,
    photo,
    quantities,
    projectId,
    source,
    actorCustomerId = null,
    logActivity = false,
  } = args;

  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      ...(projectId ? { projectId } : { project: { shop } }),
    },
    include: {
      project: { select: { id: true } },
      items: true,
      deliveryPhases: { include: { lines: true }, orderBy: { sequence: "asc" } },
    },
  });
  if (!job) {
    return { ok: false, error: "Order not found." };
  }
  if (job.paidAt) {
    return { ok: false, error: "Order is Paid — delivery cannot be recorded." };
  }

  const blockedPreOrderStatuses = [
    "draft",
    "pending_review",
    "ready_to_order",
  ] as const;
  if (
    (blockedPreOrderStatuses as readonly string[]).includes(
      job.orderLifecycleStatus,
    )
  ) {
    return {
      ok: false,
      error: "This order cannot be delivered until it is in Ordered status.",
    };
  }

  const phaseViewsBefore = mapPhasesToViews(job.deliveryPhases);
  const phaseId = args.phaseId || findActiveDeliveryPhaseId(phaseViewsBefore);
  const phase = phaseId
    ? job.deliveryPhases.find((p) => p.id === phaseId)
    : undefined;
  if (!phase) {
    return { ok: false, error: "No delivery is open on this order." };
  }
  if (phase.fulfillmentPhotoStorageKey || phase.deliveredAt) {
    return {
      ok: false,
      error:
        "This delivery was already confirmed. Reload the page to record the next delivery.",
    };
  }

  /* No explicit quantities means "everything still outstanding on this order", which is the
     whole point of the batch flow — there is no per-line UI to read. */
  const lines = job.items.map((item) => {
    const outstanding = Math.max(
      0,
      item.quantity - deliveredQtyForItem(phaseViewsBefore, item.id, phase.id),
    );
    return {
      jobItemId: item.id,
      quantityDelivered: quantities
        ? Math.floor(Number(quantities[item.id]) || 0)
        : outstanding,
    };
  });
  const totalDelivered = lines.reduce(
    (sum, line) => sum + Math.max(0, line.quantityDelivered),
    0,
  );
  if (totalDelivered <= 0) {
    return {
      ok: false,
      error: quantities
        ? "Enter at least one quantity for this delivery."
        : "Nothing is outstanding on this order.",
    };
  }

  try {
    await recordPhaseDeliveredQuantities({ phaseId: phase.id, jobId, lines });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Invalid delivered quantities.",
    };
  }

  const shopDir = shop.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const storageKey = `${shopDir}/${jobId}-phase-${phase.sequence}-${Date.now()}${photo.ext}`;
  if (!isSafeFulfillmentPhotoStorageKey(storageKey)) {
    return { ok: false, error: "Invalid storage path." };
  }
  try {
    await saveFulfillmentPhoto(storageKey, photo.buffer);
  } catch (err) {
    console.error(
      `[confirm delivery] photo save failed (shop=${shop} job=${jobId}):`,
      err instanceof Error ? err.message : err,
    );
    return { ok: false, error: "Could not save the delivery photo. Try again." };
  }

  await prisma.jobDeliveryPhase.update({
    where: { id: phase.id },
    data: {
      fulfillmentPhotoStorageKey: storageKey,
      deliveredAt: new Date(),
    },
  });

  const refreshedJob = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      items: true,
      deliveryPhases: { include: { lines: true }, orderBy: { sequence: "asc" } },
    },
  });
  const phaseViews = mapPhasesToViews(refreshedJob?.deliveryPhases ?? []);
  const fullyDelivered = refreshedJob
    ? isJobFullyDelivered(refreshedJob.items, phaseViews)
    : false;
  const deliveredPercent = refreshedJob
    ? computeDeliveredPercent(refreshedJob.items, phaseViews)
    : 0;

  await prisma.job.update({
    where: { id: jobId },
    data: {
      fulfillmentPhotoStorageKey: storageKey,
      ...(fullyDelivered && refreshedJob
        ? {
            orderLifecycleStatus: "delivered" as const,
            ...(job.completedAt ? {} : { completedAt: new Date() }),
          }
        : {}),
    },
  });

  /* The delivery is recorded either way — a notification that did not go out must not undo it
     — but staff need to know nobody was told, because they are the ones who get asked "why
     didn't I get an email?". */
  let notifyFailed = false;
  if (!phase.fulfillmentNotifiedAt) {
    try {
      await sendFulfillmentPackageEmails({
        shop,
        projectId: job.project.id,
        jobId,
        phaseId: phase.id,
      });
      await prisma.jobDeliveryPhase.update({
        where: { id: phase.id },
        data: { fulfillmentNotifiedAt: new Date() },
      });
    } catch (err) {
      notifyFailed = true;
      console.error(
        `[confirm delivery] notify failed (shop=${shop} job=${jobId} phase=${phase.id}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (!fullyDelivered) {
    await spawnNextFulfillmentPhaseIfNeeded(jobId);
    await ensureOpenFulfillmentPhase(jobId);
  }

  if (logActivity) {
    await logProjectActivity({
      projectId: job.project.id,
      jobId: job.id,
      type: "order_lifecycle_status",
      visibility: "member",
      actorCustomerId,
      payload: {
        jobName: job.name,
        from: job.orderLifecycleStatus,
        to: fullyDelivered ? "delivered" : job.orderLifecycleStatus,
        source,
        viaPhaseFulfillment: true,
        phaseSequence: phase.sequence,
        deliveredPercent,
      },
    });
  }

  notifyMissionControl(jobId);

  return {
    ok: true,
    phaseSequence: phase.sequence,
    fullyDelivered,
    deliveredPercent,
    notifyFailed,
    message: fullyDelivered
      ? `Delivery ${phase.sequence} confirmed — order is fully delivered (${deliveredPercent}%).`
      : `Delivery ${phase.sequence} confirmed — ${deliveredPercent}% delivered overall.`,
  };
}

export type BatchDeliveryOutcome = {
  jobId: string;
  /** Order label as staff know it, so a failure names something they can find. */
  label: string;
  message: string;
};

export type BatchDeliveryResult = {
  confirmed: BatchDeliveryOutcome[];
  failed: BatchDeliveryOutcome[];
  /** True when at least one order was recorded but its email did not go out. */
  notifyFailed: boolean;
};

export async function confirmBatchDelivery(args: {
  shop: string;
  jobIds: string[];
  photo: FulfillmentPhotoInput;
  projectId?: string;
  source: "storefront" | "shopify_admin";
  actorCustomerId?: string | null;
  logActivity?: boolean;
}): Promise<BatchDeliveryResult> {
  const { shop, jobIds, photo, projectId, source, actorCustomerId, logActivity } =
    args;

  const unique = Array.from(new Set(jobIds.filter(Boolean)));
  const labels = await jobLabels(shop, unique, projectId);

  const confirmed: BatchDeliveryOutcome[] = [];
  const failed: BatchDeliveryOutcome[] = [];
  let notifyFailed = false;

  /* Sequential on purpose: every order sends two emails, and firing a dozen SMTP
     conversations at once is how this starts getting rate-limited. A batch is a handful of
     orders, so the wall-clock cost is small. */
  for (const jobId of unique) {
    const label = labels[jobId] || "Order";
    let result: ConfirmPhaseDeliveryResult;
    try {
      result = await confirmPhaseDelivery({
        shop,
        jobId,
        photo,
        projectId,
        source,
        actorCustomerId,
        logActivity,
      });
    } catch (err) {
      console.error(
        `[batch delivery] unexpected failure (shop=${shop} job=${jobId}):`,
        err instanceof Error ? err.message : err,
      );
      /* One bad order must not strand the rest of the truckload as undelivered. */
      failed.push({ jobId, label, message: "Unexpected error." });
      continue;
    }
    if (result.ok) {
      if (result.notifyFailed) notifyFailed = true;
      confirmed.push({ jobId, label, message: result.message });
    } else {
      failed.push({ jobId, label, message: result.error });
    }
  }

  return { confirmed, failed, notifyFailed };
}

async function jobLabels(
  shop: string,
  jobIds: string[],
  projectId?: string,
): Promise<Record<string, string>> {
  if (jobIds.length === 0) return {};
  const rows = await prisma.job.findMany({
    where: {
      id: { in: jobIds },
      ...(projectId ? { projectId } : { project: { shop } }),
    },
    select: { id: true, name: true, orderNumber: true },
  });
  const out: Record<string, string> = {};
  for (const row of rows) {
    out[row.id] =
      row.orderNumber != null ? `#${row.orderNumber} ${row.name}` : row.name;
  }
  return out;
}

/** One line staff can read in a banner without opening each order. */
export function summarizeBatchDelivery(result: BatchDeliveryResult): string {
  const parts: string[] = [];
  if (result.confirmed.length > 0) {
    parts.push(
      `${result.confirmed.length} order${result.confirmed.length === 1 ? "" : "s"} marked delivered.`,
    );
  }
  if (result.failed.length > 0) {
    parts.push(
      `${result.failed.length} could not be confirmed: ${result.failed
        .map((f) => `${f.label} (${f.message})`)
        .join("; ")}`,
    );
  }
  if (result.notifyFailed) {
    parts.push(
      "Some notification emails could not be sent — let those customers know another way.",
    );
  }
  return parts.join(" ") || "Nothing to confirm.";
}
