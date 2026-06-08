import type { Job, JobDeliveryPhase, JobDeliveryPhaseLine, JobItem } from "@prisma/client";
import prisma from "../db.server";
import { getShopDeliveryFee } from "./shopDeliveryFee.server";
import type { ResolvedJobDelivery } from "./jobDelivery";
import { addDaysToCalendarYmd } from "./preferredDeliveryFormat";

export type DeliveryPhaseLineView = {
  jobItemId: string;
  quantityPlanned: number;
  quantityDelivered: number;
};

export type DeliveryPhaseView = {
  id: string;
  sequence: number;
  scheduledDeliveryDate: string | null;
  scheduledDeliveryWindow: string | null;
  deliveryFeeAmount: number;
  hasPhoto: boolean;
  deliveredAt: string | null;
  /** App-proxy URL when the viewer may open the phase fulfillment photo. */
  photoUrl: string | null;
  lines: DeliveryPhaseLineView[];
};

export type JobWithPhaseGraph = Job & {
  items: JobItem[];
  deliveryPhases: (JobDeliveryPhase & { lines: JobDeliveryPhaseLine[] })[];
};

export function mapPhasesToViews(
  phases: (JobDeliveryPhase & { lines: JobDeliveryPhaseLine[] })[],
): DeliveryPhaseView[] {
  return phases
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((p) => ({
      id: p.id,
      sequence: p.sequence,
      scheduledDeliveryDate: p.scheduledDeliveryDate ?? null,
      scheduledDeliveryWindow: p.scheduledDeliveryWindow ?? null,
      deliveryFeeAmount: Number(p.deliveryFeeAmount ?? 0),
      hasPhoto: Boolean(p.fulfillmentPhotoStorageKey),
      deliveredAt: p.deliveredAt?.toISOString() ?? null,
      photoUrl: null,
      lines: p.lines.map((l) => ({
        jobItemId: l.jobItemId,
        quantityPlanned: l.quantityPlanned,
        quantityDelivered: l.quantityDelivered,
      })),
    }));
}

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

export function computeDeliveredPercent(
  items: { id: string; quantity: number }[],
  phases: DeliveryPhaseView[],
): number {
  if (items.length === 0) return 0;
  const orderedTotal = items.reduce((s, i) => s + i.quantity, 0);
  if (orderedTotal <= 0) return 0;

  const deliveredByItem = new Map<string, number>();
  for (const item of items) {
    deliveredByItem.set(item.id, 0);
  }
  for (const phase of phases) {
    for (const line of phase.lines) {
      const prev = deliveredByItem.get(line.jobItemId) ?? 0;
      deliveredByItem.set(
        line.jobItemId,
        prev + Math.max(0, line.quantityDelivered),
      );
    }
  }

  let deliveredUnits = 0;
  for (const item of items) {
    const d = deliveredByItem.get(item.id) ?? 0;
    deliveredUnits += Math.min(d, item.quantity);
  }
  return Math.min(100, Math.round((100 * deliveredUnits) / orderedTotal));
}

export function isJobFullyDelivered(
  items: { id: string; quantity: number }[],
  phases: DeliveryPhaseView[],
): boolean {
  if (items.length === 0) return false;
  const deliveredByItem = new Map<string, number>();
  for (const item of items) {
    deliveredByItem.set(item.id, 0);
  }
  for (const phase of phases) {
    for (const line of phase.lines) {
      const prev = deliveredByItem.get(line.jobItemId) ?? 0;
      deliveredByItem.set(
        line.jobItemId,
        prev + Math.max(0, line.quantityDelivered),
      );
    }
  }
  return items.every((item) => (deliveredByItem.get(item.id) ?? 0) === item.quantity);
}

/** Total delivery fees for display: one shop fee per confirmed delivery. */
export function totalDeliveryFeesFromPhases(
  phases: DeliveryPhaseView[],
  resolved: ResolvedJobDelivery,
  shopDeliveryFee: number,
): number {
  if (resolved.method !== "delivery") return 0;
  return phases
    .filter((p) => p.hasPhoto)
    .reduce((sum, p) => {
      const fee =
        p.deliveryFeeAmount > 0 ? p.deliveryFeeAmount : shopDeliveryFee;
      return sum + fee;
    }, 0);
}

export type PhaseSaveInput = {
  sequence: number;
  scheduledDeliveryDate: string;
  scheduledDeliveryWindow: string;
  lines: { jobItemId: string; quantityPlanned: number }[];
};

export type DeliveryPlanMode = "single" | "at_a_time" | "custom" | "recurring";

/** UI exposes single | recurring; legacy saves may store custom or at_a_time. */
export function normalizeDeliveryPlanMode(
  raw: string | null | undefined,
): DeliveryPlanMode {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (s === "custom") return "single";
  if (s === "at_a_time" || s === "recurring") return "recurring";
  return "single";
}

export type AtATimeScheduleOptions = {
  scheduledDeliveryDate: string;
  scheduledDeliveryWindow: string;
  /** When set with a start date, later drops are scheduled every N calendar days. */
  repeatIntervalDays?: number | null;
  /** Optional YYYY-MM-DD cap; drops after this date stay unscheduled. */
  repeatEndDate?: string | null;
};

export type AtATimeDeliveryPayload = {
  batchByItem: Record<string, number>;
  repeatIntervalDays: number | null;
  repeatEndDate: string | null;
};

function applyRecurringPhaseDates(
  phases: PhaseSaveInput[],
  schedule: AtATimeScheduleOptions,
): PhaseSaveInput[] {
  const interval = schedule.repeatIntervalDays;
  const start = schedule.scheduledDeliveryDate?.trim() || "";
  if (!interval || interval < 1 || !start) {
    return phases.map((ph) =>
      ph.sequence === 1
        ? {
            ...ph,
            scheduledDeliveryDate: start,
            scheduledDeliveryWindow: schedule.scheduledDeliveryWindow,
          }
        : ph,
    );
  }

  const endCap = schedule.repeatEndDate?.trim() || "";
  return phases.map((ph) => {
    if (ph.sequence === 1) {
      return {
        ...ph,
        scheduledDeliveryDate: start,
        scheduledDeliveryWindow: schedule.scheduledDeliveryWindow,
      };
    }
    const date = addDaysToCalendarYmd(start, interval * (ph.sequence - 1));
    if (!date) {
      return { ...ph, scheduledDeliveryDate: "", scheduledDeliveryWindow: "" };
    }
    if (endCap && date > endCap) {
      return { ...ph, scheduledDeliveryDate: "", scheduledDeliveryWindow: "" };
    }
    return {
      ...ph,
      scheduledDeliveryDate: date,
      scheduledDeliveryWindow: schedule.scheduledDeliveryWindow,
    };
  });
}

/** Split each line into phases of up to N units; schedule first drop + optional recurring dates. */
export function buildPhasesFromAtATime(
  items: { id: string; quantity: number }[],
  batchByItemId: Record<string, number>,
  schedule: AtATimeScheduleOptions,
): PhaseSaveInput[] {
  if (items.length === 0) {
    return [
      {
        sequence: 1,
        scheduledDeliveryDate: schedule.scheduledDeliveryDate,
        scheduledDeliveryWindow: schedule.scheduledDeliveryWindow,
        lines: [],
      },
    ];
  }

  const remaining = new Map(items.map((it) => [it.id, it.quantity]));
  const phases: PhaseSaveInput[] = [];
  let seq = 0;

  while ([...remaining.values()].some((n) => n > 0)) {
    const lines: { jobItemId: string; quantityPlanned: number }[] = [];
    for (const it of items) {
      const rem = remaining.get(it.id) ?? 0;
      if (rem <= 0) continue;
      const batch = Math.max(1, Math.floor(batchByItemId[it.id] ?? rem));
      const planned = Math.min(rem, batch);
      remaining.set(it.id, rem - planned);
      if (planned > 0) {
        lines.push({ jobItemId: it.id, quantityPlanned: planned });
      }
    }
    if (lines.length === 0) break;
    seq += 1;
    phases.push({
      sequence: seq,
      scheduledDeliveryDate:
        seq === 1 ? schedule.scheduledDeliveryDate : "",
      scheduledDeliveryWindow:
        seq === 1 ? schedule.scheduledDeliveryWindow : "",
      lines,
    });
  }

  if (phases.length === 0) {
    return applyRecurringPhaseDates(
      [
        {
          sequence: 1,
          scheduledDeliveryDate: schedule.scheduledDeliveryDate,
          scheduledDeliveryWindow: schedule.scheduledDeliveryWindow,
          lines: items.map((it) => ({
            jobItemId: it.id,
            quantityPlanned: it.quantity,
          })),
        },
      ],
      schedule,
    );
  }
  return applyRecurringPhaseDates(phases, schedule);
}

export function parseAtATimeDeliveryPayload(
  raw: string,
  itemIds: Set<string>,
): AtATimeDeliveryPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;

    let batchSource: Record<string, unknown> | null = null;
    let repeatIntervalDays: number | null = null;
    let repeatEndDate: string | null = null;

    if (obj.batchByItem && typeof obj.batchByItem === "object" && !Array.isArray(obj.batchByItem)) {
      batchSource = obj.batchByItem as Record<string, unknown>;
      const intervalRaw = obj.repeatIntervalDays;
      if (intervalRaw != null && intervalRaw !== "") {
        const n = Math.floor(Number(intervalRaw));
        repeatIntervalDays = Number.isFinite(n) && n >= 1 ? n : null;
      }
      const endRaw = obj.repeatEndDate;
      if (typeof endRaw === "string" && endRaw.trim()) {
        repeatEndDate = endRaw.trim();
      }
    } else {
      batchSource = obj;
    }

    if (!batchSource) return null;

    const batchByItem: Record<string, number> = {};
    for (const [key, val] of Object.entries(batchSource)) {
      if (!itemIds.has(key)) return null;
      const n = Math.floor(Number(val));
      if (!Number.isFinite(n) || n < 1) return null;
      batchByItem[key] = n;
    }
    if (itemIds.size > 0) {
      for (const id of itemIds) {
        if (!(id in batchByItem)) return null;
      }
    }
    return { batchByItem, repeatIntervalDays, repeatEndDate };
  } catch {
    return null;
  }
}

/** @deprecated Use parseAtATimeDeliveryPayload — kept for callers that only need batch map. */
export function parseDeliveryBatchJson(
  raw: string,
  itemIds: Set<string>,
): Record<string, number> | null {
  const payload = parseAtATimeDeliveryPayload(raw, itemIds);
  return payload?.batchByItem ?? null;
}

export function serializeAtATimeDeliveryPayload(payload: AtATimeDeliveryPayload): string {
  return JSON.stringify({
    batchByItem: payload.batchByItem,
    repeatIntervalDays: payload.repeatIntervalDays,
    repeatEndDate: payload.repeatEndDate,
  });
}

/** Plan tab reference (v2) — not applied to fulfillment phases. */
export type DeliveryPlanReference = {
  v: 2;
  planMode: DeliveryPlanMode;
  referencePhases: PhaseSaveInput[];
  batchByItem?: Record<string, number>;
  repeatIntervalDays?: number | null;
  repeatEndDate?: string | null;
};

export function serializeDeliveryPlanReference(args: {
  planMode: DeliveryPlanMode;
  referencePhases: PhaseSaveInput[];
  batchPayload?: AtATimeDeliveryPayload | null;
}): string {
  const body: DeliveryPlanReference = {
    v: 2,
    planMode: args.planMode,
    referencePhases: args.referencePhases,
  };
  if (args.batchPayload) {
    body.batchByItem = args.batchPayload.batchByItem;
    body.repeatIntervalDays = args.batchPayload.repeatIntervalDays;
    body.repeatEndDate = args.batchPayload.repeatEndDate;
  }
  return JSON.stringify(body);
}

function phaseSaveInputFromViews(phases: DeliveryPhaseView[]): PhaseSaveInput[] {
  return phases
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((p) => ({
      sequence: p.sequence,
      scheduledDeliveryDate: p.scheduledDeliveryDate ?? "",
      scheduledDeliveryWindow: p.scheduledDeliveryWindow ?? "",
      lines: p.lines.map((l) => ({
        jobItemId: l.jobItemId,
        quantityPlanned: l.quantityPlanned,
      })),
    }));
}

export function parseDeliveryPlanReference(
  raw: string | null | undefined,
  planModeRaw: string | null | undefined,
  items: { id: string; quantity: number }[],
  fulfillmentPhases: DeliveryPhaseView[],
  jobSchedule?: {
    scheduledDeliveryDate?: string | null;
    scheduledDeliveryWindow?: string | null;
  },
): {
  planMode: DeliveryPlanMode;
  referencePhases: PhaseSaveInput[];
  batchPayload: AtATimeDeliveryPayload | null;
} {
  const itemIds = new Set(items.map((i) => i.id));
  const storedMode = normalizeDeliveryPlanMode(planModeRaw);

  if (raw?.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        if (obj.v === 2 && Array.isArray(obj.referencePhases)) {
          const phases = parsePhasesJson(JSON.stringify(obj.referencePhases));
          if (phases) {
            const batchPayload =
              obj.batchByItem &&
              typeof obj.batchByItem === "object" &&
              !Array.isArray(obj.batchByItem)
                ? parseAtATimeDeliveryPayload(raw, itemIds)
                : null;
            return {
              planMode: normalizeDeliveryPlanMode(
                String(obj.planMode || planModeRaw || storedMode),
              ),
              referencePhases: phases,
              batchPayload,
            };
          }
        }
        const legacyBatch = parseAtATimeDeliveryPayload(raw, itemIds);
        if (legacyBatch) {
          const schedule = {
            scheduledDeliveryDate: jobSchedule?.scheduledDeliveryDate ?? "",
            scheduledDeliveryWindow: jobSchedule?.scheduledDeliveryWindow ?? "",
            repeatIntervalDays: legacyBatch.repeatIntervalDays,
            repeatEndDate: legacyBatch.repeatEndDate,
          };
          return {
            planMode:
              legacyBatch.repeatIntervalDays != null &&
              legacyBatch.repeatIntervalDays >= 1
                ? "recurring"
                : storedMode,
            referencePhases: buildPhasesFromAtATime(
              items,
              legacyBatch.batchByItem,
              schedule,
            ),
            batchPayload: legacyBatch,
          };
        }
      }
    } catch {
      /* fall through */
    }
  }

  const schedule = {
    scheduledDeliveryDate: jobSchedule?.scheduledDeliveryDate ?? "",
    scheduledDeliveryWindow: jobSchedule?.scheduledDeliveryWindow ?? "",
  };
  return {
    planMode: storedMode,
    referencePhases: buildPhasesFromAtATime(
      items,
      Object.fromEntries(items.map((i) => [i.id, i.quantity])),
      schedule,
    ),
    batchPayload: null,
  };
}

export function jobHasFulfillmentProgress(
  phases: (JobDeliveryPhase & { lines: JobDeliveryPhaseLine[] })[],
): boolean {
  return phases.some(phaseHasDeliveryProgress);
}

export function inferDeliveryPlanMode(phases: DeliveryPhaseView[]): DeliveryPlanMode {
  if (phases.length <= 1) return "single";
  const laterScheduled = phases.some(
    (p) =>
      p.sequence > 1 &&
      Boolean(p.scheduledDeliveryDate?.trim() || p.scheduledDeliveryWindow?.trim()),
  );
  return laterScheduled ? "single" : "recurring";
}

export function inferBatchByItemFromPhases(
  items: { id: string; quantity: number }[],
  phases: DeliveryPhaseView[],
): Record<string, number> {
  const sorted = phases.slice().sort((a, b) => a.sequence - b.sequence);
  const out: Record<string, number> = {};
  for (const item of items) {
    let batch = item.quantity;
    for (const p of sorted) {
      const line = p.lines.find((l) => l.jobItemId === item.id);
      if (line && line.quantityPlanned > 0) {
        batch = line.quantityPlanned;
        break;
      }
    }
    out[item.id] = batch;
  }
  return out;
}

export function parsePhasesJson(raw: string): PhaseSaveInput[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const out: PhaseSaveInput[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      const sequence = Number(r.sequence);
      if (!Number.isFinite(sequence) || sequence < 1) return null;
      const linesRaw = r.lines;
      if (!Array.isArray(linesRaw)) return null;
      const lines: { jobItemId: string; quantityPlanned: number }[] = [];
      for (const lr of linesRaw) {
        if (!lr || typeof lr !== "object") return null;
        const l = lr as Record<string, unknown>;
        const jobItemId = String(l.jobItemId || "").trim();
        const quantityPlanned = Math.floor(Number(l.quantityPlanned));
        if (!jobItemId || quantityPlanned < 0) return null;
        lines.push({ jobItemId, quantityPlanned });
      }
      out.push({
        sequence,
        scheduledDeliveryDate: String(r.scheduledDeliveryDate || "").trim(),
        scheduledDeliveryWindow: String(r.scheduledDeliveryWindow || "").trim(),
        lines,
      });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
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

export function validatePlannedQuantities(
  items: JobItem[],
  phases: PhaseSaveInput[],
): string | null {
  const planned = new Map<string, number>();
  for (const item of items) {
    planned.set(item.id, 0);
  }
  for (const phase of phases) {
    for (const line of phase.lines) {
      if (!planned.has(line.jobItemId)) {
        return "Invalid line in delivery plan.";
      }
      planned.set(
        line.jobItemId,
        (planned.get(line.jobItemId) ?? 0) + line.quantityPlanned,
      );
    }
  }
  for (const item of items) {
    const total = planned.get(item.id) ?? 0;
    if (total !== item.quantity) {
      return `Planned quantities must total ordered qty (${item.quantity}) for each line.`;
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

  if (fullyDelivered && refreshed.orderLifecycleStatus === "ordered") {
    await prisma.job.update({
      where: { id: args.jobId },
      data: {
        orderLifecycleStatus: "delivered",
        completedAt: refreshed.completedAt ?? new Date(),
      },
    });
  }

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
