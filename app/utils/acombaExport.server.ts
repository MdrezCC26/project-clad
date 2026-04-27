import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import {
  parseOrderLineCapture,
  parseVariantSnapshot,
} from "./variantInfo.server";
import {
  ORDER_DISPLAY_TAX_RATE,
  ORDER_LINE_PRICES_INCLUDE_DISPLAY_TAX,
} from "./orderDisplayTax";

/**
 * Per-order CSV for finance / accounting import:
 *   1. Readable in Excel (friendly headers, slim column set, single-line ship address).
 *   2. Row model: every line is self-contained (one row per line item with invoice
 *      header fields repeated) so imports can map columns without "blank means previous".
 *
 * Encoding: UTF-8 with a BOM so Excel on Windows decodes accents correctly.
 *
 * Tax: mirrors the storefront payment summary (`ORDER_DISPLAY_TAX_RATE` on
 * subtotal + delivery, or 0 when line snapshots are tax-inclusive).
 */

const PROJECT_DELIVERY_FEE = 75;

const COLUMNS: ReadonlyArray<string> = [
  "Type",
  "Invoice #",
  "Date",
  "PO #",
  "Currency",
  "Customer Code",
  "Customer",
  "Ship To",
  "Delivery Method",
  "Delivery Date",
  "Line",
  "Item Code",
  "Description",
  "Qty",
  "Unit Price",
  "Line Total",
  "Tax Code",
  "Tax Rate %",
  "Order Subtotal",
  "Delivery Fee",
  "Order Tax",
  "Order Total",
  "Notes",
];

export type AcombaCsvBuildResult = {
  filename: string;
  contents: string;
  contentType: string;
};

export async function buildAcombaCsvForJob(args: {
  jobId: string;
  shop: string;
}): Promise<AcombaCsvBuildResult | null> {
  const job = await prisma.job.findFirst({
    where: { id: args.jobId, project: { shop: args.shop } },
    include: {
      project: true,
      items: { orderBy: { sortOrder: "asc" } },
      orderLink: true,
    },
  });

  if (!job || !job.project) return null;

  const project = job.project;

  const subtotal = job.items.reduce((sum, item) => {
    const price = Number(new Prisma.Decimal(item.priceSnapshot).toString());
    return sum + price * item.quantity;
  }, 0);

  const isDelivery = job.fulfillmentMethod === "delivery";
  const deliveryFee = isDelivery ? PROJECT_DELIVERY_FEE : 0;

  /* If line snapshots are already tax-inclusive, display tax is $0 (so the
     merchant can re-derive it via line tax codes in their accounting app). */
  const taxableBase = ORDER_LINE_PRICES_INCLUDE_DISPLAY_TAX
    ? 0
    : subtotal + deliveryFee;
  const tax = round2(taxableBase * ORDER_DISPLAY_TAX_RATE);
  const total = round2(subtotal + deliveryFee + tax);

  const invoiceNumber = job.orderLink?.orderName?.trim()
    ? job.orderLink.orderName.trim()
    : `PC-${job.id.slice(-8).toUpperCase()}`;

  const invoiceDate = (job.paidAt ?? job.createdAt).toISOString().slice(0, 10);

  const customerCode =
    slugifyForCode(project.companyName) ||
    `CUST-${(project.ownerCustomerId || "").replace(/\D/g, "").slice(-8) || "GUEST"}`;

  const customerLabel =
    project.companyName?.trim() || project.name?.trim() || "Customer";

  const shipTo = buildShipToLine({
    contactName: job.siteContactName ?? project.defaultSiteContactName,
    contactPhone: job.siteContactPhone ?? project.defaultSiteContactPhone,
    address1: project.shipAddress1,
    address2: project.shipAddress2,
    city: project.shipCity,
    province: project.shipProvince,
    postal: project.shipPostal,
    country: project.shipCountry,
    isDelivery,
  });

  const deliveryMethod = isDelivery
    ? "Delivery"
    : job.fulfillmentMethod === "pickup"
      ? "Pickup"
      : (job.fulfillmentMethod ?? "");

  const deliveryDate = isDelivery ? (job.scheduledDeliveryDate ?? "") : "";

  const taxRatePct = ORDER_LINE_PRICES_INCLUDE_DISPLAY_TAX
    ? 0
    : Math.round(ORDER_DISPLAY_TAX_RATE * 10000) / 100;

  /* Default to Ontario HST. Other provinces / split tax codes can be remapped
     in the import step or via a per-shop setting later. */
  const taxCode = ORDER_LINE_PRICES_INCLUDE_DISPLAY_TAX ? "TAX-INCL" : "HST-ON";

  type Row = Record<(typeof COLUMNS)[number], string>;
  const baseRow: Omit<
    Row,
    "Line" | "Item Code" | "Description" | "Qty" | "Unit Price" | "Line Total" | "Notes"
  > = {
    Type: "FA",
    "Invoice #": invoiceNumber,
    Date: invoiceDate,
    "PO #": job.purchaseOrderNumber ?? project.poNumber ?? "",
    Currency: "CAD",
    "Customer Code": customerCode,
    Customer: customerLabel,
    "Ship To": shipTo,
    "Delivery Method": deliveryMethod,
    "Delivery Date": deliveryDate,
    "Tax Code": taxCode,
    "Tax Rate %": taxRatePct.toFixed(2),
    "Order Subtotal": round2(subtotal).toFixed(2),
    "Delivery Fee": round2(deliveryFee).toFixed(2),
    "Order Tax": tax.toFixed(2),
    "Order Total": total.toFixed(2),
  };

  const rows: Row[] = [];

  job.items.forEach((item, idx) => {
    const capture = parseOrderLineCapture(item.orderLineCapture);
    const snapshot = parseVariantSnapshot(item.variantSnapshot);
    const itemCode =
      item.catalogSku?.trim() ||
      capture?.sku?.trim() ||
      snapshot?.sku?.trim() ||
      (item.variantId ? `SHOPIFY-VARIANT-${digits(item.variantId)}` : "CUSTOM");

    const description =
      capture?.displayLabel?.trim() ||
      [snapshot?.productTitle, snapshot?.variantTitle]
        .map((s) => s?.trim())
        .filter(Boolean)
        .join(" - ") ||
      "Project Clad line";

    const unitPrice = Number(new Prisma.Decimal(item.priceSnapshot).toString());
    const lineSubtotal = round2(unitPrice * item.quantity);

    rows.push({
      ...baseRow,
      Line: String(idx + 1),
      "Item Code": itemCode,
      Description: description,
      Qty: String(item.quantity),
      "Unit Price": unitPrice.toFixed(2),
      "Line Total": lineSubtotal.toFixed(2),
      Notes: serializeCustomData(item.customData),
    } as Row);
  });

  if (deliveryFee > 0) {
    rows.push({
      ...baseRow,
      Line: String(rows.length + 1),
      "Item Code": "DELIVERY",
      Description: "Delivery / shipping",
      Qty: "1",
      "Unit Price": deliveryFee.toFixed(2),
      "Line Total": deliveryFee.toFixed(2),
      Notes: "",
    } as Row);
  }

  const headerRow = COLUMNS.map(csvField).join(",");
  const dataRows = rows.map((r) =>
    COLUMNS.map((c) => csvField(r[c] ?? "")).join(","),
  );

  /* CRLF line endings: friendly for Windows / Excel. */
  const body = [headerRow, ...dataRows].join("\r\n") + "\r\n";

  /* UTF-8 BOM so Excel on Windows decodes accents without manual gymnastics. */
  const contents = "\uFEFF" + body;

  const filename = `${slugifyForFilename(project.name) || "project"}-${slugifyForFilename(job.name) || "order"}-${invoiceNumber.replace(/[^A-Za-z0-9-]/g, "")}.csv`;

  return {
    filename,
    contents,
    contentType: "text/csv; charset=utf-8",
  };
}

function buildShipToLine(args: {
  contactName?: string | null;
  contactPhone?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  postal?: string | null;
  country?: string | null;
  isDelivery: boolean;
}): string {
  if (!args.isDelivery) {
    /* Pickup orders skip ship address; surface site contact only. */
    const contact = [args.contactName, args.contactPhone]
      .map((s) => s?.trim())
      .filter(Boolean)
      .join(" - ");
    return contact || "Pickup";
  }

  const street = [args.address1, args.address2]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(", ");
  const cityProvPostal = [
    args.city?.trim(),
    [args.province?.trim(), args.postal?.trim()]
      .filter(Boolean)
      .join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  const contact = [args.contactName?.trim(), args.contactPhone?.trim()]
    .filter(Boolean)
    .join(" / ");

  return [contact, street, cityProvPostal, args.country?.trim()]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" • ");
}

function csvField(raw: string): string {
  const value = raw == null ? "" : String(raw);
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function slugifyForCode(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

function slugifyForFilename(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function digits(s: string): string {
  return String(s).replace(/\D/g, "");
}

function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function serializeCustomData(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  const parts: string[] = [];
  for (const entry of raw) {
    if (
      entry &&
      typeof entry === "object" &&
      "name" in entry &&
      "value" in entry
    ) {
      const k = String((entry as { name: unknown }).name ?? "").trim();
      const v = String((entry as { value: unknown }).value ?? "").trim();
      if (k && v) parts.push(`${k}: ${v}`);
    }
  }
  return parts.join(" | ");
}
