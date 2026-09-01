/**
 * Order line spec parsing shared by the storefront project page and the shop
 * cut sheet document. Line properties arrive either as plain cart properties
 * or packed into a `__ooCalcPayload` JSON blob from the external calculator.
 */

export type OrderLineProperty = { name: string; value: string };

/** Minimal shape needed to resolve a display name; `JobItemView` satisfies it. */
export type OrderLineSpecSource = {
  displayName: string;
  properties?: OrderLineProperty[] | null;
};

export type OrderLineDimensionRow = {
  label: string;
  value: string;
  /** Free-text row (Additional Details) rendered with muted styling. */
  extra?: boolean;
};

export function normalizeOrderSpecKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s_-]+/g, "_");
}

export function titleCaseWords(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function formatGirthDisplay(value: string): string {
  const t = value.trim();
  if (/["']|in\b/i.test(t)) return t;
  return `${t}"`;
}

export function formatValuesUsedDisplay(
  lengthUsed?: string,
  angleUsed?: string,
): string | null {
  const l = lengthUsed?.trim();
  const a = angleUsed?.trim();
  if (!l && !a) return null;
  const lengthLabel = l ? (/l$/i.test(l) ? l.toUpperCase() : `${l}L`) : null;
  const angleLabel = a ? (/a$/i.test(a) ? a.toUpperCase() : `${a}A`) : null;
  if (lengthLabel && angleLabel) return `${lengthLabel} - ${angleLabel}`;
  return lengthLabel || angleLabel;
}

export function collectOrderLineSpecMap(properties: OrderLineProperty[]): {
  map: Map<string, string>;
  calcParseError: string | null;
} {
  const map = new Map<string, string>();
  let calcParseError: string | null = null;

  const calcPayload = properties.find((p) => p.name === "__ooCalcPayload");
  if (calcPayload?.value) {
    try {
      const parsed = JSON.parse(calcPayload.value) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) {
        if (value == null) continue;
        const v = String(value).trim();
        if (!v) continue;
        const nk = normalizeOrderSpecKey(key);
        if (nk === "product_price") continue;
        map.set(nk, v);
      }
    } catch {
      calcParseError = calcPayload.value;
    }
  }

  for (const p of properties) {
    const rawName = p.name.trim();
    const v = (p.value || "").trim();
    if (!rawName || rawName.startsWith("__oo") || rawName.startsWith("_")) continue;
    const nk = normalizeOrderSpecKey(rawName);
    if (!map.has(nk)) map.set(nk, v || rawName);
  }

  return { map, calcParseError };
}

export function getOrderLineSpecValue(
  item: OrderLineSpecSource,
  key: string,
): string {
  if (!item.properties?.length) return "";
  const normalized = normalizeOrderSpecKey(key);
  for (const prop of item.properties) {
    if (normalizeOrderSpecKey(prop.name) === normalized) {
      return (prop.value || "").trim();
    }
  }
  return "";
}

export function formatGaugeLabel(value: string): string {
  const t = value.trim();
  if (!t) return "";
  return /\bgauge\b/i.test(t) ? t : `${t} Gauge`;
}

export function orderLineDisplayNameWithGauge(item: OrderLineSpecSource): string {
  const base = item.displayName.trim();
  const gaugeLabel = formatGaugeLabel(getOrderLineSpecValue(item, "gauge"));
  if (!gaugeLabel) return base;
  if (base.toLowerCase().includes(gaugeLabel.toLowerCase())) return base;
  return `${base} - ${gaugeLabel}`;
}

export function isCustomDimensionLineSpec(map: Map<string, string>): boolean {
  return (
    map.has("shape_type") ||
    (map.has("l1") && map.has("l2")) ||
    map.has("a1") ||
    map.has("a2")
  );
}

export function isReferenceImagePropertyName(name: string): boolean {
  const n = name.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  return (
    (n.includes("reference") && n.includes("image")) ||
    n === "referenceimage" ||
    n === "ref image"
  );
}

export function normalizeOrderImageUrl(
  url: string | null | undefined,
): string | null {
  const t = (url || "").trim();
  if (!t) return null;
  if (t.startsWith("//")) return `https:${t}`;
  if (/^https?:\/\//i.test(t)) return t;
  return null;
}

function isLikelyPdfUrl(url: string): boolean {
  try {
    return /\.pdf(\?|$)/i.test(new URL(url).pathname);
  } catch {
    return /\.pdf(\?|$)/i.test(url);
  }
}

/** OPC / sheet-custom calculator lines (custompart storefront profiles). */
export function isOpcCalculatorLine(
  properties: OrderLineProperty[] | null | undefined,
): boolean {
  if (!properties?.length) return false;
  if (properties.some((p) => p.name === "__ooCalcPayload")) return true;
  const { map } = collectOrderLineSpecMap(properties);
  return map.has("profile") || map.has("reference_image");
}

export function extractReferenceImageFromLineProperties(
  properties: OrderLineProperty[] | null | undefined,
): string | null {
  if (!properties?.length) return null;
  for (const p of properties) {
    if (!isReferenceImagePropertyName(p.name)) continue;
    const href = normalizeOrderImageUrl(p.value);
    if (href && !isLikelyPdfUrl(href)) return href;
  }
  return null;
}

/**
 * Order-line diagram priority: OPC reference art → live Shopify product image
 * (same as /pages/custompart tiles) → optional shape-builder thumb → snapshot.
 */
export function resolveOrderLineImageUrl(args: {
  displayName: string;
  properties: OrderLineProperty[] | null | undefined;
  /** Current storefront catalog image for this variant on the active shop. */
  storefrontImageUrl: string | null;
  snapshotImageUrl?: string | null;
  shapeBuilderThumbUrl?: string | null;
}): string | null {
  const properties = args.properties ?? [];
  const isUploadPart = args.displayName.toLowerCase().includes("upload part");

  if (isUploadPart) {
    for (const p of properties) {
      const href = normalizeOrderImageUrl(p.value);
      if (href && !isLikelyPdfUrl(href)) return href;
    }
    return null;
  }

  const reference = extractReferenceImageFromLineProperties(properties);
  if (reference) return reference;

  const storefront = normalizeOrderImageUrl(args.storefrontImageUrl);
  if (storefront) return storefront;

  const shapeThumb = normalizeOrderImageUrl(args.shapeBuilderThumbUrl);
  if (shapeThumb) return shapeThumb;

  const snap = normalizeOrderImageUrl(args.snapshotImageUrl);
  if (snap && !isLikelyPdfUrl(snap) && !snap.startsWith("data:image/")) {
    return snap;
  }

  return null;
}

/** L1..L24 then A1..A24 then Additional Details, skipping unset keys. */
export function collectOrderLineDimensionRows(
  map: Map<string, string>,
): OrderLineDimensionRow[] {
  const rows: OrderLineDimensionRow[] = [];

  for (let i = 1; i <= 24; i += 1) {
    const value = map.get(`l${i}`);
    if (!value) continue;
    rows.push({ label: `L${i}`, value });
  }
  for (let i = 1; i <= 24; i += 1) {
    const value = map.get(`a${i}`);
    if (!value) continue;
    rows.push({ label: `A${i}`, value });
  }

  // Include even "0" / other short values — shop notes are often numeric placeholders.
  if (map.has("additional_details")) {
    rows.push({
      label: "Additional Details",
      value: map.get("additional_details") ?? "",
      extra: true,
    });
  }

  return rows;
}

/** Angles are stored bare (`90`); the degree sign is presentational. */
export function formatAngleDisplay(value: string): string {
  const t = value.trim();
  if (!t) return t;
  return /°/.test(t) ? t : `${t}°`;
}

/** Order created timestamp rendered as YYYY.MM.DD. */
export function formatJobCreatedMmDdYyyy(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}.${mm}.${dd}`;
}
