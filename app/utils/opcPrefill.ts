/**
 * Build a product-page URL that carries saved Options Price Calculator specs.
 * The theme script (`project-clad-opc-prefill.js`) reads `pc_opc` and fills
 * the OPC widget by field key and visible label.
 */

import {
  collectOrderLineSpecMap,
  isCustomDimensionLineSpec,
  isOpcCalculatorLine,
  isReferenceImagePropertyName,
  normalizeOrderSpecKey,
  type OrderLineProperty,
} from "./orderLineSpecs";

export const OPC_PREFILL_QUERY_KEY = "pc_opc";

/** Query-string budget before falling back to the URL hash. */
const QUERY_BUDGET = 1600;

const SKIP_KEYS = new Set([
  "product_price",
  "reference_image",
  "referenceimage",
  "girth",
  "bends",
  "shape_type",
]);

/**
 * OPC TEMPLATE V3 keyName ↔ storefront label keys.
 * Cart lines often store L1 / Gauge / Color; the widget still uses field_N.
 */
const FIELD_ALIASES: Array<[string, string]> = [
  ["l1", "field_1"],
  ["l2", "field_2"],
  ["l3", "field_3"],
  ["l4", "field_7"],
  ["a1", "field_6"],
  ["a2", "field_8"],
  ["gauge", "field_4"],
  ["color", "field_9"],
  ["colour", "color"],
  ["color_picker", "color"],
  ["length", "field_10"],
  ["additional_details", "field_5"],
];

export type OpcPrefillPayload = {
  fields: Record<string, string>;
  qty?: number;
};

function looksLikeUrl(value: string): boolean {
  return /^(https?:)?\/\//i.test(value.trim());
}

/** OPC JSON defaults unset selects/colour to `"0"`; that is not a real gauge/colour. */
function isOpcUnsetSentinel(normalizedKey: string, value: string): boolean {
  if (value !== "0" && value !== "0.0") return false;
  return /^(field_4|field_9|gauge|color|colour|color_picker|colour_picker|length|field_10)$/.test(
    normalizedKey,
  );
}

function inferGaugeFromDisplayName(displayName?: string | null): string | null {
  const match = (displayName || "").match(/(\d+)\s*gauge/i);
  return match ? `${match[1]} Gauge` : null;
}

function isSkipKey(normalized: string): boolean {
  if (SKIP_KEYS.has(normalized)) return true;
  if (isReferenceImagePropertyName(normalized.replace(/_/g, " "))) return true;
  return false;
}

function applyAliases(fields: Record<string, string>): void {
  for (const [a, b] of FIELD_ALIASES) {
    if (fields[a] && !fields[b]) fields[b] = fields[a];
    if (fields[b] && !fields[a]) fields[a] = fields[b];
  }
}

export function collectOpcPrefillFields(
  properties: OrderLineProperty[] | null | undefined,
  displayName?: string | null,
): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!properties?.length && !displayName?.trim()) return fields;

  const { map } = collectOrderLineSpecMap(properties ?? []);
  for (const [key, value] of map) {
    const nk = normalizeOrderSpecKey(key);
    const v = value.trim();
    if (!nk || !v || isSkipKey(nk) || looksLikeUrl(v)) continue;
    if (isOpcUnsetSentinel(nk, v)) continue;
    fields[nk] = v;
  }

  if (!fields.gauge) {
    const inferred = inferGaugeFromDisplayName(displayName);
    if (inferred) fields.gauge = inferred;
  }

  applyAliases(fields);
  applyAliases(fields);
  return fields;
}

function isShapeBuilderCustomLine(
  properties: OrderLineProperty[] | null | undefined,
): boolean {
  if (!properties?.length) return false;
  const { map } = collectOrderLineSpecMap(properties);
  return (map.get("shape_type") || "").toLowerCase() === "custom";
}

export function canPrefillOpcCalculator(args: {
  productUrl?: string | null;
  displayName?: string | null;
  properties?: OrderLineProperty[] | null;
}): boolean {
  if (!args.productUrl?.trim()) return false;
  if ((args.displayName || "").toLowerCase().includes("upload part")) {
    return false;
  }
  if (isShapeBuilderCustomLine(args.properties)) return false;
  if (isOpcCalculatorLine(args.properties)) return true;
  const { map } = collectOrderLineSpecMap(args.properties ?? []);
  return (
    isCustomDimensionLineSpec(map) ||
    map.has("gauge") ||
    map.has("field_1") ||
    map.has("color") ||
    map.has("colour")
  );
}

export function buildOpcPrefillHref(
  productUrl: string | null | undefined,
  properties: OrderLineProperty[] | null | undefined,
  qty?: number,
  displayName?: string | null,
): string | null {
  const base = (productUrl || "").trim();
  if (!base) return null;
  if (!canPrefillOpcCalculator({ productUrl: base, displayName, properties })) {
    return null;
  }

  const fields = collectOpcPrefillFields(properties, displayName);
  if (!Object.keys(fields).length) return null;

  const payload: OpcPrefillPayload = { fields };
  if (qty != null && Number.isFinite(qty) && qty > 0) {
    payload.qty = Math.round(qty);
  }

  const packed = JSON.stringify(payload);

  try {
    const url = new URL(base);
    if (url.search.length + packed.length > QUERY_BUDGET) {
      url.hash = `${OPC_PREFILL_QUERY_KEY}=${encodeURIComponent(packed)}`;
      return url.toString();
    }
    url.searchParams.set(OPC_PREFILL_QUERY_KEY, packed);
    return url.toString();
  } catch {
    const withoutHash = base.split("#")[0];
    if (withoutHash.length + packed.length > QUERY_BUDGET) {
      return `${withoutHash}#${OPC_PREFILL_QUERY_KEY}=${encodeURIComponent(packed)}`;
    }
    const sep = withoutHash.includes("?") ? "&" : "?";
    return `${withoutHash}${sep}${OPC_PREFILL_QUERY_KEY}=${encodeURIComponent(packed)}`;
  }
}
