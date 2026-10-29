/**
 * Pure helpers for reordering a whole delivered order into a new draft.
 * Pricing, persistence, and auth live in `reorderDeliveredOrder.server.ts`.
 */

export const REORDER_ORDER_NAME_MAX = 180;
export const REORDER_QTY_MAX = 99_999;
export const REORDER_LINE_MAX = 250;

const QTY_FIELD = /^qty_([A-Za-z0-9_-]{1,80})$/;

export type ReorderLineProperty = { name: string; value: string };

export type ReorderSourceLine = {
  id: string;
  variantId: string;
  quantity: number;
  sortOrder: number;
};

export type ReorderNameResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

export type ReorderLinesResult<T> =
  | { ok: true; lines: T[] }
  | { ok: false; error: string };

export function clampReorderOrderName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= REORDER_ORDER_NAME_MAX) return trimmed;
  return `${trimmed.slice(0, REORDER_ORDER_NAME_MAX - 1)}…`;
}

/** Customer-facing default: `Reorder of <original job name>`. */
export function defaultReorderOrderName(sourceName: string): string {
  const source = sourceName.trim() || "order";
  return clampReorderOrderName(`Reorder of ${source}`);
}

/**
 * Prefer the requested name, otherwise the default. Appends ` (2)`, ` (3)`, …
 * until the name is unique among existing job names (case-insensitive).
 */
export function allocateReorderOrderName(
  requestedName: string,
  sourceName: string,
  existingNames: Iterable<string>,
): ReorderNameResult {
  const base = clampReorderOrderName(
    requestedName.trim() || defaultReorderOrderName(sourceName),
  );
  if (!base) {
    return { ok: false, error: "Order name is required." };
  }
  const taken = new Set(
    [...existingNames].map((name) => name.trim().toLowerCase()),
  );
  let name = base;
  let suffix = 2;
  while (taken.has(name.trim().toLowerCase())) {
    const extra = ` (${suffix})`;
    const room = REORDER_ORDER_NAME_MAX - extra.length;
    if (room < 1) {
      return { ok: false, error: "Could not allocate a unique order name." };
    }
    const stem = base.length > room ? `${base.slice(0, room - 1)}…` : base;
    name = `${stem}${extra}`;
    suffix += 1;
    if (suffix > 500) {
      return { ok: false, error: "Could not allocate a unique order name." };
    }
  }
  return { ok: true, name };
}

/** Line properties stored on `JobItem.customData` (name/value rows). */
export function linePropertiesFromCustomData(
  customData: unknown,
): ReorderLineProperty[] {
  if (!Array.isArray(customData)) return [];
  const out: ReorderLineProperty[] = [];
  for (const row of customData) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name : "";
    if (!name.trim()) continue;
    const value = rec.value == null ? "" : String(rec.value);
    out.push({ name, value });
  }
  return out;
}

/**
 * Shape-builder drawing input. Matches the save-job parser (`shape_type` L/Z/U)
 * so a reorder queues the same shop drawing a fresh save would.
 */
export function customPartDrawingFromProperties(
  properties: ReorderLineProperty[] | null | undefined,
): {
  shapeType: string;
  l1: number;
  l2: number;
  l3?: number;
  a1?: number;
  gauge: number;
} | null {
  if (!properties?.length) return null;
  const get = (name: string) =>
    properties.find((p) => p.name === name)?.value ?? "";
  const shapeType = get("shape_type");
  if (!["L", "Z", "U"].includes(shapeType)) return null;
  const l1 = parseFloat(get("L1")) || 0;
  const l2 = parseFloat(get("L2")) || 0;
  if (!l1 || !l2) return null;
  const gauge = parseInt(get("Gauge") || "0", 10) || 16;
  const l3raw = get("L3");
  const a1raw = get("A1");
  const l3 = l3raw ? parseFloat(l3raw) : undefined;
  const a1 = a1raw ? parseFloat(a1raw) : undefined;
  return { shapeType, l1, l2, l3, a1, gauge };
}

/**
 * New-line audit row. Keeps the original display label and SKU, and stores the
 * current unit price instead of the delivered order's snapshot.
 */
export function orderLineCaptureForReorder(
  raw: unknown,
  variantId: string,
  unitPrice: string,
): Record<string, unknown> {
  const capturedAt = new Date().toISOString();
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if (o.v === 1 && typeof o.displayLabel === "string") {
      return {
        ...o,
        variantId,
        unitPrice,
        capturedAt,
      };
    }
  }
  return {
    v: 1,
    displayLabel: `Variant ${variantId}`,
    variantId,
    sku: null,
    unitPrice,
    capturedAt,
  };
}

export function parseReorderQuantityOverrides(
  entries: Iterable<[string, FormDataEntryValue]>,
): { ok: true; overrides: Map<string, number> } | { ok: false; error: string } {
  const overrides = new Map<string, number>();
  for (const [key, value] of entries) {
    const match = QTY_FIELD.exec(key);
    if (!match) continue;
    if (typeof value !== "string") {
      return { ok: false, error: "Enter a whole-number quantity for each line." };
    }
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) {
      return { ok: false, error: "Enter a whole-number quantity for each line." };
    }
    const qty = Number(trimmed);
    if (!Number.isSafeInteger(qty)) {
      return { ok: false, error: "Enter a whole-number quantity for each line." };
    }
    overrides.set(match[1], qty);
    if (overrides.size > REORDER_LINE_MAX) {
      return {
        ok: false,
        error: "This order has too many lines to reorder at once.",
      };
    }
  }
  return { ok: true, overrides };
}

/**
 * Lines to copy onto the draft. A missing override keeps the original quantity.
 * Quantity 0 leaves that line off the new order. Source rows are not mutated.
 */
export function selectReorderLines<T extends ReorderSourceLine>(
  items: readonly T[],
  overrides: ReadonlyMap<string, number>,
): ReorderLinesResult<T & { quantity: number }> {
  const sorted = [...items].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
  );
  const lines: Array<T & { quantity: number }> = [];
  for (const item of sorted) {
    const qty = overrides.has(item.id) ? overrides.get(item.id)! : item.quantity;
    if (!Number.isInteger(qty) || qty < 0 || qty > REORDER_QTY_MAX) {
      return {
        ok: false,
        error: `Quantity must be a whole number from 0 to ${REORDER_QTY_MAX}.`,
      };
    }
    if (qty === 0) continue;
    if (!String(item.variantId || "").trim()) {
      return { ok: false, error: "A line has no product variant to reorder." };
    }
    lines.push({ ...item, quantity: qty });
    if (lines.length > REORDER_LINE_MAX) {
      return {
        ok: false,
        error: "This order has too many lines to reorder at once.",
      };
    }
  }
  if (!lines.length) {
    return { ok: false, error: "Enter a quantity on at least one line." };
  }
  return { ok: true, lines };
}
