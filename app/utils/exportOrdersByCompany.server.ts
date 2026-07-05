import type { OrderLifecycleStatus } from "@prisma/client";
import ExcelJS from "exceljs";
import prisma from "../db.server";
import { resolveJobDelivery } from "./jobDelivery";
import {
  computeDeliveredPercent,
  deliveryPhaseHasProgress,
  formatPhaseDeliveredSummary,
  isJobFullyDelivered,
  mapPhasesToViews,
  type DeliveryPhaseView,
} from "./jobDeliveryPhases";
import { orderTaxFromSubtotal } from "./orderDisplayTax";
import { STOREFRONT_ORDER_CONFIRMED_ACTIVITY } from "./projectActivity.shared";
import { getShopDeliveryFee } from "./shopDeliveryFee.server";

const ACTIVE_STATUSES = new Set<OrderLifecycleStatus>([
  "ordered",
  "delivered",
  "paid",
]);

export const DEFAULT_SINCE_YMD = "2026-05-01";

const formatDate = (d: Date | string | null | undefined): string => {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatMoney = (n: number): string | number =>
  Number.isFinite(n) ? Math.round(n * 100) / 100 : "";

export const COMPANY_EXPORT_COLUMNS = [
  "Order Number",
  "Shopify Order",
  "Order Name",
  "Customer PO",
  "Project",
  "Status",
  "Date Ordered",
  "Delivery Drop #",
  "Drop Status",
  "Scheduled Date",
  "Delivered Date",
  "Items Delivered (This Drop)",
  "Qty Delivered (Drop)",
  "Qty Ordered (Order)",
  "Order % Delivered",
  "Drop Subtotal",
  "Drop Delivery Fee",
  "Drop Tax",
  "Drop Total",
  "Order Subtotal",
  "Order Delivery (All Drops)",
  "Order Tax",
  "Order Total",
  "Date Paid",
  "Fulfillment",
] as const;

export type CompanyExportRow = (string | number)[];

export type ExportOrdersByCompanyResult = {
  filename: string;
  buffer: Buffer;
  rowCounts: Record<string, number>;
  totalRows: number;
  sinceDate: string;
};

type LoadedJob = Awaited<ReturnType<typeof loadJobs>>[number];
type LoadedPhase = LoadedJob["deliveryPhases"][number];

function parseSinceDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map((p) => Number.parseInt(p, 10));
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function onOrAfter(date: Date | null | undefined, cutoff: Date): boolean {
  return date != null && !Number.isNaN(date.getTime()) && date >= cutoff;
}

function itemDisplayName(item: LoadedJob["items"][number]): string {
  const capture = item.orderLineCapture;
  if (capture && typeof capture === "object") {
    const label = (capture as Record<string, unknown>).displayLabel;
    if (typeof label === "string" && label.trim()) return label.trim();
  }
  const snap = item.variantSnapshot;
  if (snap && typeof snap === "object") {
    const o = snap as Record<string, unknown>;
    const product = typeof o.productTitle === "string" ? o.productTitle : "";
    const variant = typeof o.variantTitle === "string" ? o.variantTitle : "";
    const parts = [product, variant].filter(Boolean);
    if (parts.length) return parts.join(" — ");
  }
  if (item.catalogSku?.trim()) return item.catalogSku.trim();
  return "Line item";
}

function sheetNameForCompany(name: string, used: Set<string>): string {
  const base = (name.trim() || "No Company")
    .replace(/[\\/*?:\[\]]/g, "")
    .trim()
    .slice(0, 28);
  let candidate = base || "No Company";
  let n = 2;
  while (used.has(candidate)) {
    const suffix = ` ${n}`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

async function loadJobs(shop: string) {
  return prisma.job.findMany({
    where: {
      project: { shop },
      orderLifecycleStatus: { in: [...ACTIVE_STATUSES] },
    },
    orderBy: { createdAt: "asc" },
    include: {
      project: {
        select: {
          name: true,
          companyName: true,
          poNumber: true,
          shop: true,
          shipAddress1: true,
          shipCity: true,
          shipProvince: true,
          shipPostal: true,
          shipCountry: true,
          receiveMode: true,
        },
      },
      orderLink: { select: { orderId: true, orderName: true, createdAt: true } },
      items: { orderBy: { sortOrder: "asc" } },
      deliveryPhases: {
        orderBy: { sequence: "asc" },
        include: { lines: true },
      },
    },
  });
}

async function loadOrderedAtByJob(jobIds: string[]): Promise<Map<string, Date>> {
  const orderedEvents = jobIds.length
    ? await prisma.projectActivityEvent.findMany({
        where: {
          jobId: { in: jobIds },
          type: STOREFRONT_ORDER_CONFIRMED_ACTIVITY,
        },
        orderBy: { createdAt: "asc" },
        select: { jobId: true, createdAt: true },
      })
    : [];

  const orderedAtByJob = new Map<string, Date>();
  for (const event of orderedEvents) {
    if (!event.jobId || orderedAtByJob.has(event.jobId)) continue;
    orderedAtByJob.set(event.jobId, event.createdAt);
  }
  return orderedAtByJob;
}

function orderedAtForJob(
  job: LoadedJob,
  orderedAtByJob: Map<string, Date>,
): Date | null {
  return orderedAtByJob.get(job.id) ?? job.orderLink?.createdAt ?? null;
}

function orderPlacedSinceMay1(
  job: LoadedJob,
  orderedAt: Date | null,
  cutoff: Date,
): boolean {
  if (orderedAt && onOrAfter(orderedAt, cutoff)) return true;
  return onOrAfter(job.createdAt, cutoff);
}

function phaseDeliveredSinceCutoff(phase: LoadedPhase, cutoff: Date): boolean {
  if (phase.deliveredAt && onOrAfter(phase.deliveredAt, cutoff)) return true;
  return false;
}

function dropSubtotal(
  phase: DeliveryPhaseView,
  items: LoadedJob["items"],
): number {
  const priceByItem = new Map(
    items.map((item) => [item.id, Number(item.priceSnapshot)]),
  );
  return phase.lines.reduce((sum, line) => {
    const qty = Math.max(0, line.quantityDelivered);
    const price = priceByItem.get(line.jobItemId) ?? 0;
    return sum + qty * price;
  }, 0);
}

function dropQtyDelivered(phase: DeliveryPhaseView): number {
  return phase.lines.reduce(
    (sum, line) => sum + Math.max(0, line.quantityDelivered),
    0,
  );
}

function dropStatusLabel(
  phase: DeliveryPhaseView,
  job: LoadedJob,
  phaseViews: DeliveryPhaseView[],
): string {
  if (!deliveryPhaseHasProgress(phase)) return "Pending";
  if (phase.hasPhoto) {
    return isJobFullyDelivered(job.items, phaseViews) ? "Complete" : "Partial";
  }
  if (dropQtyDelivered(phase) > 0) return "Partial (in progress)";
  return "Pending";
}

function orderMoney(
  job: LoadedJob,
  phaseViews: DeliveryPhaseView[],
  shopDeliveryFee: number,
) {
  const projectCtx = {
    shipAddress1: job.project.shipAddress1,
    shipCity: job.project.shipCity,
    shipProvince: job.project.shipProvince,
    shipPostal: job.project.shipPostal,
    shipCountry: job.project.shipCountry,
    receiveMode: job.project.receiveMode,
  };
  const resolved = resolveJobDelivery(job, projectCtx, shopDeliveryFee);

  let orderDelivery = 0;
  if (resolved.method === "delivery") {
    orderDelivery = phaseViews
      .filter((p) => p.hasPhoto)
      .reduce((sum, p) => {
        const fee =
          p.deliveryFeeAmount > 0 ? p.deliveryFeeAmount : shopDeliveryFee;
        return sum + fee;
      }, 0);
  }

  const orderSubtotal = job.items.reduce(
    (sum, item) => sum + Number(item.priceSnapshot) * item.quantity,
    0,
  );
  const taxable = orderSubtotal + orderDelivery;
  const orderTax = orderTaxFromSubtotal(taxable, { pricesIncludeTax: false });
  const orderTotal = orderSubtotal + orderDelivery + orderTax;

  return { orderSubtotal, orderDelivery, orderTax, orderTotal, resolved };
}

function buildRowsForJob(
  job: LoadedJob,
  orderedAtByJob: Map<string, Date>,
  shopDeliveryFee: number,
  cutoff: Date,
): CompanyExportRow[] {
  const orderedAt = orderedAtForJob(job, orderedAtByJob);
  const placedSinceCutoff = orderPlacedSinceMay1(job, orderedAt, cutoff);
  const phaseViews = mapPhasesToViews(job.deliveryPhases);
  const { orderSubtotal, orderDelivery, orderTax, orderTotal, resolved } =
    orderMoney(job, phaseViews, shopDeliveryFee);

  const customerPo =
    job.purchaseOrderNumber?.trim() || job.project.poNumber?.trim() || "";
  const itemLabels = job.items.map((item) => ({
    id: item.id,
    displayName: itemDisplayName(item),
  }));
  const qtyOrdered = job.items.reduce((s, i) => s + i.quantity, 0);
  const pctDelivered = computeDeliveredPercent(job.items, phaseViews);

  const base = {
    orderNumber: job.orderNumber ?? "",
    shopifyOrder: job.orderLink?.orderName ?? "",
    orderName: job.name,
    customerPo,
    project: job.project.name,
    status: job.orderLifecycleStatus,
    dateOrdered: formatDate(orderedAt),
    orderSubtotal: formatMoney(orderSubtotal),
    orderDelivery: formatMoney(orderDelivery),
    orderTax: formatMoney(orderTax),
    orderTotal: formatMoney(orderTotal),
    datePaid: formatDate(job.paidAt),
    fulfillment: resolved.method,
    qtyOrdered,
    pctDelivered,
  };

  const rows: CompanyExportRow[] = [];
  const phasesWithProgress = phaseViews.filter((p) =>
    deliveryPhaseHasProgress(p),
  );
  const phasesToShow = phasesWithProgress.filter((phaseView) => {
    if (placedSinceCutoff) return true;
    const entity = job.deliveryPhases.find((p) => p.id === phaseView.id);
    return entity ? phaseDeliveredSinceCutoff(entity, cutoff) : false;
  });

  if (phasesToShow.length > 0) {
    for (const phase of phasesToShow) {
      const dropSub = dropSubtotal(phase, job.items);
      const dropDelivery =
        resolved.method === "delivery" && phase.hasPhoto
          ? phase.deliveryFeeAmount > 0
            ? phase.deliveryFeeAmount
            : shopDeliveryFee
          : 0;
      const dropTax = orderTaxFromSubtotal(dropSub + dropDelivery, {
        pricesIncludeTax: false,
      });
      const dropTotal = dropSub + dropDelivery + dropTax;
      const entity = job.deliveryPhases.find((p) => p.id === phase.id);

      rows.push([
        base.orderNumber,
        base.shopifyOrder,
        base.orderName,
        base.customerPo,
        base.project,
        base.status,
        base.dateOrdered,
        phase.sequence,
        dropStatusLabel(phase, job, phaseViews),
        phase.scheduledDeliveryDate ?? "",
        formatDate(entity?.deliveredAt ?? phase.deliveredAt),
        formatPhaseDeliveredSummary(phase, itemLabels),
        dropQtyDelivered(phase),
        base.qtyOrdered,
        base.pctDelivered,
        formatMoney(dropSub),
        formatMoney(dropDelivery),
        formatMoney(dropTax),
        formatMoney(dropTotal),
        base.orderSubtotal,
        base.orderDelivery,
        base.orderTax,
        base.orderTotal,
        base.datePaid,
        base.fulfillment,
      ]);
    }
    return rows;
  }

  if (!placedSinceCutoff) return rows;

  rows.push([
    base.orderNumber,
    base.shopifyOrder,
    base.orderName,
    base.customerPo,
    base.project,
    base.status,
    base.dateOrdered,
    "",
    "Not yet delivered",
    job.scheduledDeliveryDate ?? "",
    formatDate(job.completedAt),
    "",
    0,
    base.qtyOrdered,
    base.pctDelivered,
    formatMoney(0),
    formatMoney(0),
    formatMoney(0),
    formatMoney(0),
    base.orderSubtotal,
    base.orderDelivery,
    base.orderTax,
    base.orderTotal,
    base.datePaid,
    base.fulfillment,
  ]);

  return rows;
}

function jobQualifies(
  job: LoadedJob,
  orderedAtByJob: Map<string, Date>,
  cutoff: Date,
): boolean {
  const orderedAt = orderedAtForJob(job, orderedAtByJob);
  if (orderPlacedSinceMay1(job, orderedAt, cutoff)) return true;
  return job.deliveryPhases.some((p) => phaseDeliveredSinceCutoff(p, cutoff));
}

export async function buildOrdersByCompanyWorkbook(
  shop: string,
  sinceYmd: string = DEFAULT_SINCE_YMD,
): Promise<ExportOrdersByCompanyResult> {
  const cutoff = parseSinceDate(sinceYmd);
  const jobs = await loadJobs(shop);
  const orderedAtByJob = await loadOrderedAtByJob(jobs.map((j) => j.id));
  const shopDeliveryFee = await getShopDeliveryFee(shop);

  const rowsByCompany = new Map<string, CompanyExportRow[]>();

  for (const job of jobs) {
    if (!jobQualifies(job, orderedAtByJob, cutoff)) continue;

    const company = job.project.companyName?.trim() || "No Company";
    const rows = buildRowsForJob(job, orderedAtByJob, shopDeliveryFee, cutoff);
    if (rows.length === 0) continue;

    const bucket = rowsByCompany.get(company) ?? [];
    bucket.push(...rows);
    rowsByCompany.set(company, bucket);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Project Clad";
  workbook.created = new Date();

  const usedSheetNames = new Set<string>();
  const rowCounts: Record<string, number> = {};
  const companies = [...rowsByCompany.keys()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );

  for (const company of companies) {
    const sheetName = sheetNameForCompany(company, usedSheetNames);
    const sheet = workbook.addWorksheet(sheetName);
    sheet.addRow([...COMPANY_EXPORT_COLUMNS]);
    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: "middle" };

    const rows = rowsByCompany.get(company) ?? [];
    rows.sort((a, b) => {
      const orderA = Number(a[0]) || 0;
      const orderB = Number(b[0]) || 0;
      if (orderA !== orderB) return orderA - orderB;
      const dropA = Number(a[7]) || 0;
      const dropB = Number(b[7]) || 0;
      return dropA - dropB;
    });

    for (const row of rows) {
      sheet.addRow(row);
    }

    sheet.columns.forEach((col) => {
      let max = 12;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value ?? "").length;
        if (len > max) max = len;
      });
      col.width = Math.min(max + 2, 52);
    });

    rowCounts[sheetName] = rows.length;
  }

  if (companies.length === 0) {
    const sheet = workbook.addWorksheet("No Data");
    sheet.addRow([`No orders or deliveries found since ${sinceYmd}`]);
    rowCounts["No Data"] = 0;
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);

  return {
    filename: `projectclad-orders-by-company-${sinceYmd}-to-${stamp}.xlsx`,
    buffer: Buffer.from(arrayBuffer),
    rowCounts,
    totalRows: Object.values(rowCounts).reduce((s, n) => s + n, 0),
    sinceDate: sinceYmd,
  };
}
