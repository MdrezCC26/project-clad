import prisma from "../db.server";
import {
  saveFulfillmentPhoto,
  isSafeFulfillmentPhotoStorageKey,
} from "./fulfillmentPhotoStorage.server";
import { sendFulfillmentPackageEmails } from "./fulfillmentNotify.server";
import {
  computeDeliveredPercent,
  isJobFullyDelivered,
  mapPhasesToViews,
  recordPhaseDeliveredQuantities,
  spawnNextFulfillmentPhaseIfNeeded,
  ensureOpenFulfillmentPhase,
} from "./jobDeliveryPhases.server";
import { logProjectActivity } from "./projectActivity.server";
import { notifyMissionControl } from "./missionControl.server";
import { readFormUploadedImage } from "./uploadedImageFile.server";

export type AdminPhaseFulfillmentResult =
  | { ok: true; message: string; fullyDelivered: boolean; deliveredPercent: number }
  | { ok: false; error: string };

export async function confirmAdminPhaseFulfillment(args: {
  shop: string;
  jobId: string;
  phaseId: string;
  form: FormData;
}): Promise<AdminPhaseFulfillmentResult> {
  const { shop, jobId, phaseId, form } = args;

  const job = await prisma.job.findFirst({
    where: { id: jobId, project: { shop } },
    include: {
      project: { select: { id: true } },
      items: true,
      deliveryPhases: { include: { lines: true }, orderBy: { sequence: "asc" } },
    },
  });
  if (!job) {
    return { ok: false, error: "Job not found." };
  }
  if (job.paidAt) {
    return { ok: false, error: "Order is Paid — delivery cannot be recorded." };
  }

  const phase = job.deliveryPhases.find((p) => p.id === phaseId);
  if (!phase) {
    return { ok: false, error: "Delivery phase not found." };
  }
  if (phase.fulfillmentPhotoStorageKey || phase.deliveredAt) {
    return {
      ok: false,
      error:
        "This delivery was already confirmed. Reload the page to record the next delivery.",
    };
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

  const lines = job.items.map((item) => ({
    jobItemId: item.id,
    quantityDelivered: Math.floor(Number(form.get(`qty_${item.id}`)) || 0),
  }));
  const totalDelivered = lines.reduce(
    (sum, line) => sum + Math.max(0, line.quantityDelivered),
    0,
  );
  if (totalDelivered <= 0) {
    return { ok: false, error: "Enter at least one quantity for this delivery." };
  }

  try {
    await recordPhaseDeliveredQuantities({ phaseId, jobId, lines });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Invalid delivered quantities.",
    };
  }

  const uploaded = await readFormUploadedImage(form, "photo");
  if (!uploaded) {
    return { ok: false, error: "Photo file is required." };
  }
  if (uploaded.size > 8 * 1024 * 1024) {
    return { ok: false, error: "Photo must be 8MB or smaller." };
  }

  const orig = uploaded.name.toLowerCase();
  const ext = orig.endsWith(".png")
    ? ".png"
    : orig.endsWith(".webp")
      ? ".webp"
      : ".jpg";
  const shopDir = shop.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const storageKey = `${shopDir}/${jobId}-phase-${phase.sequence}-${Date.now()}${ext}`;
  if (!isSafeFulfillmentPhotoStorageKey(storageKey)) {
    return { ok: false, error: "Invalid storage path." };
  }

  try {
    await saveFulfillmentPhoto(storageKey, uploaded.buffer);
  } catch (err) {
    console.error(
      "[admin phase fulfillment] photo save failed:",
      err instanceof Error ? err.message : err,
    );
    return {
      ok: false,
      error: "Could not save the delivery photo. Try again.",
    };
  }

  await prisma.jobDeliveryPhase.update({
    where: { id: phaseId },
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

  if (!phase.fulfillmentNotifiedAt) {
    try {
      await sendFulfillmentPackageEmails({
        shop,
        projectId: job.project.id,
        jobId,
        phaseId,
      });
      await prisma.jobDeliveryPhase.update({
        where: { id: phaseId },
        data: { fulfillmentNotifiedAt: new Date() },
      });
    } catch (err) {
      console.error(
        "[admin phase fulfillment] notify failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (!fullyDelivered) {
    await spawnNextFulfillmentPhaseIfNeeded(jobId);
    await ensureOpenFulfillmentPhase(jobId);
  }

  await logProjectActivity({
    projectId: job.project.id,
    jobId: job.id,
    type: "order_lifecycle_status",
    visibility: "member",
    actorCustomerId: null,
    payload: {
      jobName: job.name,
      from: job.orderLifecycleStatus,
      to: fullyDelivered ? "delivered" : job.orderLifecycleStatus,
      source: "shopify_admin",
      viaPhaseFulfillment: true,
      phaseSequence: phase.sequence,
      deliveredPercent,
    },
  });

  notifyMissionControl(jobId);

  return {
    ok: true,
    fullyDelivered,
    deliveredPercent,
    message: fullyDelivered
      ? `Delivery ${phase.sequence} confirmed — order is fully delivered (${deliveredPercent}%).`
      : `Delivery ${phase.sequence} confirmed — ${deliveredPercent}% delivered overall.`,
  };
}

export function jobHasFulfillmentEvidence(
  fulfillmentPhotoStorageKey: string | null | undefined,
  phases: { fulfillmentPhotoStorageKey?: string | null }[],
): boolean {
  if (phases.length > 0) {
    return phases.some((p) => Boolean(p.fulfillmentPhotoStorageKey));
  }
  return Boolean(fulfillmentPhotoStorageKey);
}
