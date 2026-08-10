import type { Job, JobItem, Project } from "@prisma/client";

import { CANADIAN_CLADDING_STOREFRONT_LOGO_URL } from "./canadianCladdingStorefrontLogo";
import { resolveColourCatalogueLine } from "./colourCatalogue";
import { resolveJobDelivery } from "./jobDelivery";
import { jobNameForOrderSummary } from "./jobNameDisplay";
import {
  collectOrderLineDimensionRows,
  collectOrderLineSpecMap,
  formatAngleDisplay,
  formatGaugeLabel,
  formatJobCreatedMmDdYyyy,
  orderLineDisplayNameWithGauge,
  titleCaseWords,
} from "./orderLineSpecs";
import { getShopSlipStyles } from "./shopSlipStyles.server";
import {
  formatVariantLineLabel,
  parseOrderLineCapture,
  parseVariantSnapshot,
} from "./variantInfo.server";

/** Every custom part is bent from a fixed 120" run, so 1 unit = 10 linear ft. */
const LINEAR_FT_PER_UNIT = 10;

/** Three part blocks per letter sheet. */
const BLOCKS_PER_SHEET = 3;

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-CA").format(value);
}

type SlipJob = Job & { items: JobItem[] };

type ShopSlipItem = {
  number: number;
  title: string;
  colourDisplay: string | null;
  quantity: number;
  linearFeet: number;
  dimensionRows: Array<{ label: string; value: string; extra?: boolean }>;
  partNumber: string | null;
  gaugeLabel: string | null;
  imageUrl: string | null;
  imageAlt: string;
};

function normalizeHttpUrl(url: string): string | null {
  const t = url.trim();
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

function isReferenceImagePropertyName(name: string): boolean {
  const n = name.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  return (
    (n.includes("reference") && n.includes("image")) ||
    n === "referenceimage" ||
    n === "ref image"
  );
}

function lineProperties(item: JobItem): { name: string; value: string }[] {
  if (!item.customData || !Array.isArray(item.customData)) return [];
  return (item.customData as unknown[]).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const o = entry as Record<string, unknown>;
    if (typeof o.name !== "string") return [];
    return [{ name: o.name, value: typeof o.value === "string" ? o.value : "" }];
  });
}

/** The calculator's reference render beats the catalog photo for a shop drawing. */
function resolveItemImage(
  properties: { name: string; value: string }[],
  snapshotImageUrl: string | null,
): string | null {
  for (const p of properties) {
    if (!isReferenceImagePropertyName(p.name)) continue;
    const href = normalizeHttpUrl(p.value);
    if (href && !isLikelyPdfUrl(href)) return href;
  }
  const snap = snapshotImageUrl ? normalizeHttpUrl(snapshotImageUrl) : null;
  return snap && !isLikelyPdfUrl(snap) ? snap : null;
}

/** Keys already shown elsewhere on the slip (title, colour tag, sku line, dims). */
const SLIP_CONSUMED_SPEC_KEYS = new Set([
  "product_price",
  "reference_image",
  "referenceimage",
  "shape_type",
  "gauge",
  "additional_details",
  "color",
  "colour",
  "finish",
  "paint",
  "coating",
  "color_picker",
  "colour_picker",
  "length_values_used",
  "angle_values_used",
]);

function resolveColourDisplay(map: Map<string, string>): string | null {
  for (const key of [
    "color",
    "colour",
    "finish",
    "paint",
    "coating",
    "color_picker",
    "colour_picker",
  ]) {
    const value = map.get(key);
    if (!value) continue;
    const cat = resolveColourCatalogueLine(value);
    if (cat) return cat.display;
    // Calculator often stores "0000 — GALVANIZED"; prefer the colour word.
    const afterDash = value.split(/[—–-]/).map((s) => s.trim()).filter(Boolean);
    const colourToken = afterDash.length > 1 ? afterDash[afterDash.length - 1]! : value;
    return (
      resolveColourCatalogueLine(colourToken)?.display ?? titleCaseWords(colourToken)
    );
  }

  for (const [key, value] of map) {
    if (SLIP_CONSUMED_SPEC_KEYS.has(key) || /^[la]\d+$/i.test(key)) continue;
    const cat = resolveColourCatalogueLine(value || key.replace(/_/g, " "));
    if (cat) return cat.display;
  }

  return null;
}

function humanizeSlipSpecKey(key: string): string {
  if (/^[la]\d+$/i.test(key)) return key.toUpperCase();
  return titleCaseWords(key.replace(/_/g, " "));
}

/** L/A rows + Additional Details, then leftover calculator chips (Length, Profile, …). */
function buildSlipDimensionRows(
  map: Map<string, string>,
): Array<{ label: string; value: string; extra?: boolean }> {
  const rows = collectOrderLineDimensionRows(map).map((row) =>
    /^A\d+$/i.test(row.label)
      ? { ...row, value: formatAngleDisplay(row.value) }
      : row,
  );

  const length = map.get("length")?.trim();
  if (length) {
    rows.push({
      label: "Length",
      value: /["']|in\b/i.test(length) ? length : `${length}"`,
    });
  }

  for (const [key, value] of map) {
    if (!value?.trim()) continue;
    if (SLIP_CONSUMED_SPEC_KEYS.has(key)) continue;
    if (key === "length") continue;
    if (/^[la]\d+$/i.test(key)) continue;
    if (isReferenceImagePropertyName(key.replace(/_/g, " "))) continue;
    if (/^https?:\/\//i.test(value) || value.startsWith("//")) continue;
    rows.push({
      label: humanizeSlipSpecKey(key),
      value: value.trim(),
      extra: true,
    });
  }

  return rows;
}

function toShopSlipItem(item: JobItem, index: number): ShopSlipItem {
  const properties = lineProperties(item);
  const capture = parseOrderLineCapture(item.orderLineCapture);
  const snapshot = parseVariantSnapshot(item.variantSnapshot);

  const displayName =
    capture?.displayLabel?.trim() ||
    (snapshot
      ? formatVariantLineLabel(snapshot.productTitle, snapshot.variantTitle)
      : "") ||
    "Line item";

  const { map } = collectOrderLineSpecMap(properties);
  const gaugeLabel = formatGaugeLabel(map.get("gauge") ?? "");

  return {
    number: item.sortOrder > 0 ? item.sortOrder : index + 1,
    title: orderLineDisplayNameWithGauge({ displayName, properties }),
    colourDisplay: resolveColourDisplay(map),
    quantity: item.quantity,
    linearFeet: item.quantity * LINEAR_FT_PER_UNIT,
    dimensionRows: buildSlipDimensionRows(map),
    partNumber: capture?.sku?.trim() || item.catalogSku?.trim() || null,
    gaugeLabel: gaugeLabel || null,
    imageUrl: resolveItemImage(properties, snapshot?.imageUrl ?? null),
    imageAlt: displayName,
  };
}

/**
 * Single seam for the part drawing. Today this is the stored product / reference
 * raster; once the shape calculator can emit geometry, swap the body for an
 * inline `<svg>` built from `shape_type` + L1..Ln + A1..An and nothing else in
 * this file has to change.
 */
function renderDiagramPanel(item: ShopSlipItem): string {
  if (!item.imageUrl) {
    return `<div class="diagram-panel diagram-panel--empty"></div>`;
  }
  return `<div class="diagram-panel"><img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.imageAlt)}"></div>`;
}

function renderDimsTable(item: ShopSlipItem): string {
  if (!item.dimensionRows.length) return "";
  const rows = item.dimensionRows
    .map(
      (row) =>
        `<tr${row.extra ? ' class="dims-row--extra"' : ""}><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.value)}</td></tr>`,
    )
    .join("");
  return `<table class="dims-table"><tr><th>Dimension</th><th>Value</th></tr>${rows}</table>`;
}

function renderSkuLine(item: ShopSlipItem): string {
  const parts: string[] = [];
  if (item.partNumber) parts.push(`Part #: ${escapeHtml(item.partNumber)}`);
  if (item.gaugeLabel) parts.push(`Gauge: ${escapeHtml(item.gaugeLabel)}`);
  if (!parts.length) return "";
  return `<div class="sku">${parts.join(" &nbsp;|&nbsp; ")}</div>`;
}

function renderPartBlock(item: ShopSlipItem): string {
  const colourTag = item.colourDisplay
    ? `<div class="color-tag">Colour: ${escapeHtml(item.colourDisplay)}</div>`
    : "";
  const colourBadge = item.colourDisplay
    ? `<span class="part-colour">${escapeHtml(item.colourDisplay.toUpperCase())}</span>`
    : `<span class="part-colour"></span>`;

  return `
  <div class="part-block">
    <div class="part-title-bar">
      <span class="part-title"><span class="item-num">${escapeHtml(item.number)}</span><span class="part-title__text">${escapeHtml(item.title)}</span></span>
      ${colourBadge}
    </div>
    <div class="part-body">
      ${renderDiagramPanel(item)}
      <div class="info-panel">
        <div class="qty-strip">
          <div class="qty-box"><div class="qlabel">Qty</div><div class="qval">${escapeHtml(formatCount(item.quantity))}</div></div>
          <div class="qty-box"><div class="qlabel">Linear ft</div><div class="qval">${escapeHtml(formatCount(item.linearFeet))}</div></div>
        </div>
        ${renderDimsTable(item)}
        ${colourTag}
        ${renderSkuLine(item)}
      </div>
    </div>
  </div>`;
}

function shopSlipLogoSrc(): string {
  const raw = CANADIAN_CLADDING_STOREFRONT_LOGO_URL.trim();
  if (raw.startsWith("//")) return `https:${raw}`;
  return raw;
}

function renderHeader(projectLine: string): string {
  return `
  <div class="doc-header">
    <div>
      <h1>Shop cut sheet / packing slip</h1>
      <div class="proj-num">${escapeHtml(projectLine)}</div>
    </div>
    <div class="logo">
      <img src="${escapeHtml(shopSlipLogoSrc())}" alt="Canadian Cladding">
    </div>
  </div>`;
}

function renderMetaRow(
  meta: Array<{ label: string; value: string }>,
): string {
  const cells = meta
    .map(
      (entry) =>
        `<div><div class="label">${escapeHtml(entry.label)}</div><div class="value">${escapeHtml(entry.value)}</div></div>`,
    )
    .join("");
  return `<div class="meta-row">${cells}</div>`;
}

function renderFooter(args: {
  addressLine: string;
  totalQuantity: number;
  totalLinearFeet: number;
}): string {
  return `
  <div class="doc-footer">
    <div class="col">
      <div class="label">Delivery address</div>
      <div class="value">${escapeHtml(args.addressLine)}</div>
      <div class="check-row"><span class="checkbox"></span> Operator confirms shape/qty match order</div>
      <div class="check-row"><span class="checkbox"></span> Packed &amp; staged for pickup</div>
    </div>
    <div class="col col--right">
      <div class="label">Total order qty</div>
      <div class="value">${escapeHtml(formatCount(args.totalQuantity))} units — ${escapeHtml(formatCount(args.totalLinearFeet))} linear ft</div>
      <div class="label">Operator</div>
      <div class="value signature-line">________________________</div>
    </div>
  </div>`;
}

function chunk<T>(items: T[], size: number): T[][] {
  if (!items.length) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function buildShopSlipHtml(args: {
  project: Project;
  job: SlipJob;
}): string {
  const { project, job } = args;

  const items = [...job.items]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(toShopSlipItem);

  const delivery = resolveJobDelivery(job, project);
  const orderLabel = job.orderNumber
    ? `#${job.orderNumber}`
    : jobNameForOrderSummary(job.name, null);

  const projectLine = project.poNumber?.trim()
    ? `${project.name} — PO ${project.poNumber.trim()}`
    : project.name;

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalLinearFeet = totalQuantity * LINEAR_FT_PER_UNIT;

  const sheets = chunk(items, BLOCKS_PER_SHEET);
  const sheetCount = sheets.length;

  const documentTitle = `Shop cut sheet — ${project.name} ${orderLabel}`.trim();

  const body = sheets
    .map((sheetItems, sheetIndex) => {
      const isLast = sheetIndex === sheetCount - 1;
      const blocks = sheetItems.length
        ? sheetItems.map(renderPartBlock).join("")
        : `<div class="slip-empty">This order has no line items.</div>`;

      const footer = isLast
        ? renderFooter({
            addressLine:
              delivery.method === "delivery"
                ? (delivery.addressLine ?? "Delivery address not set")
                : "Store pickup",
            totalQuantity,
            totalLinearFeet,
          })
        : "";

      return `
<div class="sheet">
  <div class="sheet__body">
    ${renderHeader(projectLine)}
    ${renderMetaRow([
      { label: "Company", value: project.companyName?.trim() || "—" },
      { label: "Order", value: orderLabel || "—" },
      {
        label: "Delivery",
        value: delivery.method === "delivery" ? "Delivery" : "Store pickup",
      },
      {
        label: "Order date",
        value: formatJobCreatedMmDdYyyy(job.createdAt) || "—",
      },
      { label: "Page", value: `${sheetIndex + 1} of ${sheetCount}` },
    ])}
    ${blocks}
  </div>
  ${footer}
</div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(documentTitle)}</title>
<style>
${getShopSlipStyles()}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}
