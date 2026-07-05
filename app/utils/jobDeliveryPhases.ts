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
  /** Signed or app-proxy URL when the viewer may open the phase fulfillment photo. */
  photoUrl: string | null;
  /** App-proxy URL for the phase packing slip PDF. */
  packingSlipUrl: string | null;
  /** App-proxy URL for the phase invoice PDF. */
  invoiceUrl: string | null;
  lines: DeliveryPhaseLineView[];
};

export type DeliveryPhaseEntity = {
  id: string;
  sequence: number;
  scheduledDeliveryDate: string | null;
  scheduledDeliveryWindow: string | null;
  deliveryFeeAmount: unknown;
  fulfillmentPhotoStorageKey?: string | null;
  deliveredAt?: Date | null;
  lines: {
    jobItemId: string;
    quantityPlanned: number;
    quantityDelivered: number;
  }[];
};

export function findActiveDeliveryPhaseId(phases: DeliveryPhaseView[]): string {
  return phases.find((p) => !p.hasPhoto)?.id ?? "";
}

export function deliveredQtyForItem(
  phases: DeliveryPhaseView[],
  itemId: string,
  excludePhaseId?: string,
): number {
  let sum = 0;
  for (const phase of phases) {
    if (excludePhaseId && phase.id === excludePhaseId) continue;
    for (const line of phase.lines) {
      if (line.jobItemId === itemId) {
        sum += Math.max(0, line.quantityDelivered);
      }
    }
  }
  return sum;
}

export function mapPhasesToViews(
  phases: DeliveryPhaseEntity[],
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
      packingSlipUrl: null,
      invoiceUrl: null,
      lines: p.lines.map((l) => ({
        jobItemId: l.jobItemId,
        quantityPlanned: l.quantityPlanned,
        quantityDelivered: l.quantityDelivered,
      })),
    }));
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

/** True when a phase has recorded delivery qty and/or a confirmation photo. */
export function deliveryPhaseHasProgress(phase: DeliveryPhaseView): boolean {
  return phase.hasPhoto || phaseDeliveredUnitsTotal(phase) > 0;
}

/** Units delivered on a single confirmed drop (sum of phase line qty). */
export function phaseDeliveredUnitsTotal(
  phase: Pick<DeliveryPhaseView, "lines">,
): number {
  return phase.lines.reduce(
    (sum, line) => sum + Math.max(0, line.quantityDelivered),
    0,
  );
}

/** Compact label for qty delivered on one drop (e.g. "2 items"). */
export function formatPhaseDeliveredUnitsLabel(
  phase: Pick<DeliveryPhaseView, "lines">,
): string {
  const total = phaseDeliveredUnitsTotal(phase);
  if (total <= 0) return "—";
  return `${total} item${total === 1 ? "" : "s"}`;
}

/** Human-readable summary of quantities delivered on one drop. */
export function formatPhaseDeliveredSummary(
  phase: Pick<DeliveryPhaseView, "lines">,
  items: { id: string; displayName: string }[],
): string {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const parts: string[] = [];
  for (const line of phase.lines) {
    const qty = Math.max(0, line.quantityDelivered);
    if (qty <= 0) continue;
    const item = itemById.get(line.jobItemId);
    const name = item?.displayName?.trim() || "Line item";
    parts.push(`${qty} × ${name}`);
  }
  return parts.length > 0 ? parts.join("; ") : "—";
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

export function validatePlannedQuantities(
  items: { id: string; quantity: number }[],
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