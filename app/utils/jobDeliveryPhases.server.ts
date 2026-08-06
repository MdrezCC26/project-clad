import type { Job, JobDeliveryPhase, JobDeliveryPhaseLine, JobItem } from "@prisma/client";
import prisma from "../db.server";
import { getShopDeliveryFee } from "./shopDeliveryFee.server";
import {
  deleteFulfillmentPhoto,
  isSafeFulfillmentPhotoStorageKey,
} from "./fulfillmentPhotoStorage.server";
import { resolveJobDelivery, type ResolvedJobDelivery } from "./jobDelivery";
import {
  computeDeliveredPercent,
  isJobFullyDelivered,
  mapPhasesToViews,
  validatePlannedQuantities,
  type PhaseSaveInput,
} from "./jobDeliveryPhases";

export * from "./jobDeliveryPhases";

export type JobWithPhaseGraph = Job & {
  items: JobItem[];
  deliveryPhases: (JobDeliveryPhase & { lines: JobDeliveryPhaseLine[] })[];
};

/** Ensure at least one phase exists; sync phase 1 schedule from job when creating. */
export async function ensureJobDeliveryPhases(
  job: Job & { items: JobItem[] },
  shopDeliveryFee: number,
  resolved: ResolvedJobDelivery,
): Promise<void> {
  const existing = await prisma.jobDeliveryPhase.findMany({
    where: { jobId: job.id },
    select: { id: true },
  });
  if (existing.length > 0) return;

  const feePerPhase =
    resolved.method === "delivery" ? shopDeliveryFee : 0;

  await prisma.$transaction(async (tx) => {
    const phase = await tx.jobDeliveryPhase.create({
      data: {
        jobId: job.id,
        sequence: 1,
        scheduledDeliveryDate: job.scheduledDeliveryDate,
        scheduledDeliveryWindow: job.scheduledDeliveryWindow,
        deliveryFeeAmount: feePerPhase,
      },
    });
    if (job.items.length > 0) {
      await tx.jobDeliveryPhaseLine.createMany({
        data: job.items.map((item) => ({
          phaseId: phase.id,
          jobItemId: item.id,
          quantityPlanned: item.quantity,
          quantityDelivered: 0,
        })),
      });
    }
  });
}

export function jobHasFulfillmentProgress(
  phases: (JobDeliveryPhase & { lines: JobDeliveryPhaseLine[] })[],
): boolean {
  return phases.some(phaseHasDeliveryProgress);
}

export function phaseHasDeliveryProgress(
  phase: JobDeliveryPhase & { lines: JobDeliveryPhaseLine[] },
): boolean {
  return (
    Boolean(phase.fulfillmentPhotoStorageKey) ||
    Boolean(phase.deliveredAt) ||
    phase.lines.some((l) => l.quantityDelivered > 0)
  );
}

/** Block plan changes that remove or shrink drops that already have delivery progress. */
export function validateDeliveryPlanAgainstProgress(
  items: JobItem[],
  phasesInput: PhaseSaveInput[],
  existingPhases: (JobDeliveryPhase & { lines: JobDeliveryPhaseLine[] })[],
): string | null {
  const base = validatePlannedQuantities(items, phasesInput);
  if (base) return base;

  const inputBySeq = new Map(phasesInput.map((p) => [p.sequence, p]));
  for (const existing of existingPhases) {
    if (!phaseHasDeliveryProgress(existing)) continue;
    const input = inputBySeq.get(existing.sequence);
    if (!input) {
      return `Cannot remove delivery ${existing.sequence} — it already has delivered quantities or a photo.`;
    }
    for (const line of existing.lines) {
      if (line.quantityDelivered <= 0) continue;
      const planned = input.lines.find((l) => l.jobItemId === line.jobItemId);
      const plannedQty = planned?.quantityPlanned ?? 0;
      if (plannedQty < line.quantityDelivered) {
        return `Planned quantity cannot be less than already delivered (${line.quantityDelivered}) on delivery ${existing.sequence}.`;
      }
    }
  }

  return null;
}

export async function saveJobDeliveryPhases(
  jobId: string,
  items: JobItem[],
  phasesInput: PhaseSaveInput[],
  shopDeliveryFee: number,
  isDelivery: boolean,
): Promise<void> {
  const feePerPhase = isDelivery ? shopDeliveryFee : 0;

  await prisma.$transaction(async (tx) => {
    const existing = await tx.jobDeliveryPhase.findMany({
      where: { jobId },
      include: { lines: true, draftOrderLink: true },
      orderBy: { sequence: "asc" },
    });

    const existingBySeq = new Map(existing.map((p) => [p.sequence, p]));

    for (const input of phasesInput.sort((a, b) => a.sequence - b.sequence)) {
      const prev = existingBySeq.get(input.sequence);
      if (prev) {
        await tx.jobDeliveryPhase.update({
          where: { id: prev.id },
          data: {
            scheduledDeliveryDate: input.scheduledDeliveryDate || null,
            scheduledDeliveryWindow: input.scheduledDeliveryWindow || null,
            deliveryFeeAmount: feePerPhase,
          },
        });
        for (const line of input.lines) {
          const existingLine = prev.lines.find((l) => l.jobItemId === line.jobItemId);
          if (existingLine) {
            await tx.jobDeliveryPhaseLine.update({
              where: { id: existingLine.id },
              data: { quantityPlanned: line.quantityPlanned },
            });
          } else {
            await tx.jobDeliveryPhaseLine.create({
              data: {
                phaseId: prev.id,
                jobItemId: line.jobItemId,
                quantityPlanned: line.quantityPlanned,
                quantityDelivered: 0,
              },
            });
          }
        }
      } else {
        const created = await tx.jobDeliveryPhase.create({
          data: {
            jobId,
            sequence: input.sequence,
            scheduledDeliveryDate: input.scheduledDeliveryDate || null,
            scheduledDeliveryWindow: input.scheduledDeliveryWindow || null,
            deliveryFeeAmount: feePerPhase,
          },
        });
        if (input.lines.length > 0) {
          await tx.jobDeliveryPhaseLine.createMany({
            data: input.lines.map((line) => ({
              phaseId: created.id,
              jobItemId: line.jobItemId,
              quantityPlanned: line.quantityPlanned,
              quantityDelivered: 0,
            })),
          });
        }
      }
    }

    const keepSeq = new Set(phasesInput.map((p) => p.sequence));
    for (const phase of existing) {
      if (!keepSeq.has(phase.sequence)) {
        if (phase.draftOrderLink || phaseHasDeliveryProgress(phase)) {
          throw new Error(
            "Cannot remove a delivery phase that already has delivered quantities, a photo, or an invoice.",
          );
        }
        await tx.jobDeliveryPhase.delete({ where: { id: phase.id } });
      }
    }
  });

  const first = phasesInput.find((p) => p.sequence === 1) ?? phasesInput[0];
  if (first) {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        scheduledDeliveryDate: first.scheduledDeliveryDate || null,
        scheduledDeliveryWindow: first.scheduledDeliveryWindow || null,
      },
    });
  }
}

export async function recordPhaseDeliveredQuantities(args: {
  phaseId: string;
  jobId: string;
  lines: { jobItemId: string; quantityDelivered: number }[];
}): Promise<{ percent: number; fullyDelivered: boolean }> {
  const job = await prisma.job.findUnique({
    where: { id: args.jobId },
    include: {
      items: true,
      deliveryPhases: { include: { lines: true }, orderBy: { sequence: "asc" } },
    },
  });
  if (!job) throw new Error("Order not found");

  const phase = job.deliveryPhases.find((p) => p.id === args.phaseId);
  if (!phase) throw new Error("Delivery phase not found");

  const itemIds = new Set(job.items.map((i) => i.id));
  const cumulativeBefore = new Map<string, number>();
  for (const item of job.items) {
    let sum = 0;
    for (const p of job.deliveryPhases) {
      if (p.id === phase.id) continue;
      for (const l of p.lines) {
        if (l.jobItemId === item.id) sum += l.quantityDelivered;
      }
    }
    cumulativeBefore.set(item.id, sum);
  }

  for (const line of args.lines) {
    if (!itemIds.has(line.jobItemId)) {
      throw new Error("Invalid line item.");
    }
    const item = job.items.find((i) => i.id === line.jobItemId)!;
    const already = cumulativeBefore.get(line.jobItemId) ?? 0;
    const qty = Math.floor(line.quantityDelivered);
    if (qty < 0 || already + qty > item.quantity) {
      throw new Error(
        `Delivered quantity cannot exceed remaining (${item.quantity - already}) for a line.`,
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const line of args.lines) {
      const existing = phase.lines.find((l) => l.jobItemId === line.jobItemId);
      const qty = Math.floor(line.quantityDelivered);
      if (existing) {
        await tx.jobDeliveryPhaseLine.update({
          where: { id: existing.id },
          data: { quantityDelivered: qty },
        });
      } else {
        await tx.jobDeliveryPhaseLine.create({
          data: {
            phaseId: phase.id,
            jobItemId: line.jobItemId,
            quantityPlanned: 0,
            quantityDelivered: qty,
          },
        });
      }
    }
  });

  const refreshed = await prisma.job.findUnique({
    where: { id: args.jobId },
    include: {
      items: true,
      deliveryPhases: { include: { lines: true }, orderBy: { sequence: "asc" } },
    },
  });
  if (!refreshed) throw new Error("Order not found");

  const phaseViews = mapPhasesToViews(refreshed.deliveryPhases);
  const percent = computeDeliveredPercent(refreshed.items, phaseViews);
  const fullyDelivered = isJobFullyDelivered(refreshed.items, phaseViews);

  /* Do not flip orderLifecycleStatus to delivered here — phased fulfillment
     requires a photo confirm (`upload-phase-fulfillment-photo`) first. */

  return { percent, fullyDelivered };
}

/** After a delivery is confirmed with photo, open the next phase for any remaining qty. */
export async function spawnNextFulfillmentPhaseIfNeeded(
  jobId: string,
): Promise<void> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      items: true,
      deliveryPhases: { include: { lines: true }, orderBy: { sequence: "asc" } },
    },
  });
  if (!job || job.items.length === 0) return;

  const phaseViews = mapPhasesToViews(job.deliveryPhases);
  if (isJobFullyDelivered(job.items, phaseViews)) return;

  const openPhase = job.deliveryPhases.find(
    (p) => !p.fulfillmentPhotoStorageKey && !p.deliveredAt,
  );
  if (openPhase) return;

  const deliveredByItem = new Map<string, number>();
  for (const item of job.items) {
    deliveredByItem.set(item.id, 0);
  }
  for (const phase of job.deliveryPhases) {
    for (const line of phase.lines) {
      deliveredByItem.set(
        line.jobItemId,
        (deliveredByItem.get(line.jobItemId) ?? 0) + line.quantityDelivered,
      );
    }
  }

  const remainingLines = job.items
    .map((item) => ({
      jobItemId: item.id,
      quantityPlanned: item.quantity - (deliveredByItem.get(item.id) ?? 0),
      quantityDelivered: 0,
    }))
    .filter((l) => l.quantityPlanned > 0);

  if (remainingLines.length === 0) return;

  const lastSeq = Math.max(...job.deliveryPhases.map((p) => p.sequence), 0);
  const lastPhase = job.deliveryPhases.find((p) => p.sequence === lastSeq);
  const feeAmount = lastPhase?.deliveryFeeAmount ?? 0;

  await prisma.$transaction(async (tx) => {
    const created = await tx.jobDeliveryPhase.create({
      data: {
        jobId,
        sequence: lastSeq + 1,
        deliveryFeeAmount: feeAmount,
      },
    });
    await tx.jobDeliveryPhaseLine.createMany({
      data: remainingLines.map((l) => ({
        phaseId: created.id,
        jobItemId: l.jobItemId,
        quantityPlanned: l.quantityPlanned,
        quantityDelivered: 0,
      })),
    });
  });
}

/**
 * Whether `ensureOpenFulfillmentPhase` would actually change anything, decided from an
 * already-loaded phase graph. Callers that render a whole project use this first, so the normal
 * case (nothing to repair) costs zero queries instead of two reads plus a line-update
 * transaction for every order on the page.
 */
export function jobNeedsOpenFulfillmentPhaseSync(
  job: Pick<JobWithPhaseGraph, "items" | "deliveryPhases">,
): boolean {
  if (job.items.length === 0) return false;

  const phaseViews = mapPhasesToViews(job.deliveryPhases);
  if (isJobFullyDelivered(job.items, phaseViews)) return false;

  const deliveredByItem = new Map<string, number>();
  for (const item of job.items) {
    deliveredByItem.set(item.id, 0);
  }
  for (const phase of job.deliveryPhases) {
    for (const line of phase.lines) {
      deliveredByItem.set(
        line.jobItemId,
        (deliveredByItem.get(line.jobItemId) ?? 0) + line.quantityDelivered,
      );
    }
  }

  const remainingFor = (item: { id: string; quantity: number }) =>
    Math.max(0, item.quantity - (deliveredByItem.get(item.id) ?? 0));

  const openPhase = job.deliveryPhases.find(
    (p) => !p.fulfillmentPhotoStorageKey && !p.deliveredAt,
  );

  /* No open phase: one gets spawned when any quantity is still outstanding. */
  if (!openPhase) {
    return job.items.some((item) => remainingFor(item) > 0);
  }

  /* Open phase exists: its planned quantities get re-synced to what is still outstanding. */
  return job.items.some((item) => {
    const existing = openPhase.lines.find((l) => l.jobItemId === item.id);
    const remaining = remainingFor(item);
    return existing ? existing.quantityPlanned !== remaining : remaining > 0;
  });
}

/** Keep a single open fulfillment phase; sync lines to remaining order qty. */
export async function ensureOpenFulfillmentPhase(
  jobId: string,
): Promise<void> {
  await spawnNextFulfillmentPhaseIfNeeded(jobId);

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      items: true,
      deliveryPhases: { include: { lines: true }, orderBy: { sequence: "asc" } },
    },
  });
  if (!job || job.items.length === 0) return;

  const phaseViews = mapPhasesToViews(job.deliveryPhases);
  if (isJobFullyDelivered(job.items, phaseViews)) return;

  const openPhase = job.deliveryPhases.find(
    (p) => !p.fulfillmentPhotoStorageKey && !p.deliveredAt,
  );
  if (!openPhase) return;

  const deliveredByItem = new Map<string, number>();
  for (const item of job.items) {
    deliveredByItem.set(item.id, 0);
  }
  for (const phase of job.deliveryPhases) {
    for (const line of phase.lines) {
      deliveredByItem.set(
        line.jobItemId,
        (deliveredByItem.get(line.jobItemId) ?? 0) + line.quantityDelivered,
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const item of job.items) {
      const remaining = Math.max(
        0,
        item.quantity - (deliveredByItem.get(item.id) ?? 0),
      );
      const existing = openPhase.lines.find((l) => l.jobItemId === item.id);
      if (existing) {
        /* Skip rows that already match, so a no-op sync writes nothing. */
        if (existing.quantityPlanned === remaining) continue;
        await tx.jobDeliveryPhaseLine.update({
          where: { id: existing.id },
          data: { quantityPlanned: remaining },
        });
      } else if (remaining > 0) {
        await tx.jobDeliveryPhaseLine.create({
          data: {
            phaseId: openPhase.id,
            jobItemId: item.id,
            quantityPlanned: remaining,
            quantityDelivered: 0,
          },
        });
      }
    }
  });
}

/** Staff recovery: wipe phased delivery progress, photos, and recreate an open phase 1. */
export async function resetJobDeliveryPhasesProgress(args: {
  jobId: string;
  shop: string;
}): Promise<void> {
  const job = await prisma.job.findUnique({
    where: { id: args.jobId },
    include: {
      items: true,
      project: {
        select: {
          receiveMode: true,
          shipAddress1: true,
          shipCity: true,
          shipProvince: true,
          shipPostal: true,
          shipCountry: true,
        },
      },
      deliveryPhases: { include: { lines: true }, orderBy: { sequence: "asc" } },
    },
  });
  if (!job?.project) {
    throw new Error("Order not found");
  }

  const storageKeys = new Set<string>();
  if (job.fulfillmentPhotoStorageKey?.trim()) {
    storageKeys.add(job.fulfillmentPhotoStorageKey.trim());
  }
  for (const phase of job.deliveryPhases) {
    const key = phase.fulfillmentPhotoStorageKey?.trim();
    if (key) storageKeys.add(key);
  }
  for (const key of storageKeys) {
    if (isSafeFulfillmentPhotoStorageKey(key)) {
      await deleteFulfillmentPhoto(key);
    }
  }

  await prisma.$transaction([
    prisma.jobDeliveryPhase.deleteMany({ where: { jobId: args.jobId } }),
    prisma.job.update({
      where: { id: args.jobId },
      data: {
        fulfillmentPhotoStorageKey: null,
        fulfillmentNotifiedAt: null,
      },
    }),
  ]);

  const shopDeliveryFee = await getShopDeliveryFee(args.shop);
  const resolved = resolveJobDelivery(
    job,
    {
      receiveMode: job.project.receiveMode,
      shipAddress1: job.project.shipAddress1,
      shipCity: job.project.shipCity,
      shipProvince: job.project.shipProvince,
      shipPostal: job.project.shipPostal,
      shipCountry: job.project.shipCountry,
    },
    shopDeliveryFee,
  );
  await ensureJobDeliveryPhases(job, shopDeliveryFee, resolved);
  if (resolved.method === "delivery") {
    await ensureOpenFulfillmentPhase(args.jobId);
  }
}

export async function ensurePhasesForProjectJobs(
  shop: string,
  jobs: (Job & { items: JobItem[] })[],
  resolveDelivery: (
    job: Job & { items: JobItem[] },
  ) => ResolvedJobDelivery,
): Promise<void> {
  const fee = await getShopDeliveryFee(shop);
  for (const job of jobs) {
    const resolved = resolveDelivery(job);
    await ensureJobDeliveryPhases(job, fee, resolved);
  }
}
