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
  totalDeliveryFeesFromPhases,
  type DeliveryPhaseView,
} from "./jobDeliveryPhases";
import { orderTaxFromSubtotal } from "./orderDisplayTax";
import { STOREFRONT_ORDER_CONFIRMED_ACTIVITY } from "./projectActivity.shared";
import { getShopDeliveryFee } from "./shopDeliveryFee.server";

/* Phase views carry ISO strings while Prisma rows carry Date, and both reach this helper. */
const formatDate = (d: Date | string | null | undefined): string => {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatMoney = (n: number): string | number =>
  Number.isFinite(n) ? Math.round(n * 100) / 100 : "";

type ReceiptSnapshot = {
  orderName?: string | null;
  currency?: string | null;
  subtotal?: string | null;
  total?: string | null;
};

function parseReceiptSnapshot(raw: unknown): ReceiptSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as ReceiptSnapshot;
}

export const ORDER_EXPORT_COLUMNS = [
  "Order Number",
  "Shopify Order",
  "Order Name",
  "Customer PO",
  "Project",
  "Company",
  "Status",
  "Date Created",
  "Date Ordered",
  "Date Delivered",
  "Date Paid",
  "Subtotal",
  "Delivery",
  "Tax",
  "Total",
  "Paid Total (Shopify)",
  "Currency",
  "Fulfillment",
] as const;

/** Delivered sheet adds one row per confirmed delivery drop. */
export const DELIVERED_EXPORT_COLUMNS = [
  ...ORDER_EXPORT_COLUMNS,
  "Delivery Drop #",
  "Drop Status",
  "Items Delivered (This Drop)",
  "Qty Delivered (Drop)",
  "Order % Delivered",
  "Order Subtotal",
  "Order Total",
] as const;

export type OrderExportRow = (string | number)[];

export const ORDER_EXPORT_SHEETS: ReadonlyArray<{
  sheetName: string;
  statuses: readonly OrderLifecycleStatus[];
}> = [
  { sheetName: "In Progress", statuses: ["draft", "pending_review", "ready_to_order"] },
  { sheetName: "Ordered", statuses: ["ordered"] },
  { sheetName: "Delivered", statuses: ["delivered"] },
  { sheetName: "Paid", statuses: ["paid"] },
];

export type ExportAllOrdersResult = {
  filename: string;
  buffer: Buffer;
  rowCounts: Record<string, number>;
  totalCount: number;
};

type LoadedJob = Awaited<ReturnType<typeof loadJobs>>[number];

async function loadJobs(shop: string) {
  return prisma.job.findMany({
    where: { project: { shop } },
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

function jobMoney(
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

  let deliveryFee = 0;
  if (resolved.method === "delivery") {
    deliveryFee = totalDeliveryFeesFromPhases(phaseViews, resolved, shopDeliveryFee);
  }

  const subtotal = job.items.reduce(
    (sum, item) => sum + Number(item.priceSnapshot) * item.quantity,
    0,
  );
  const taxable = subtotal + deliveryFee;
  const tax = orderTaxFromSubtotal(taxable, { pricesIncludeTax: false });
  const total = subtotal + deliveryFee + tax;

  return { subtotal, deliveryFee, tax, total, resolved };
}

function hasDeliveryProgress(job: LoadedJob): boolean {
  return mapPhasesToViews(job.deliveryPhases).some((p) =>
    deliveryPhaseHasProgress(p),
  );
}

function routeJobToSheet(job: LoadedJob): string | null {
  if (job.orderLifecycleStatus === "delivered") return "Delivered";
  if (
    job.orderLifecycleStatus === "ordered" &&
    hasDeliveryProgress(job)
  ) {
    return "Delivered";
  }
  if (job.orderLifecycleStatus === "ordered") return "Ordered";
  if (
    job.orderLifecycleStatus === "draft" ||
    job.orderLifecycleStatus === "pending_review" ||
    job.orderLifecycleStatus === "ready_to_order"
  ) {
    return "In Progress";
  }
  if (job.orderLifecycleStatus === "paid") return "Paid";
  return null;
}

function jobToRow(
  job: LoadedJob,
  orderedAtByJob: Map<string, Date>,
  shopDeliveryFee: number,
): OrderExportRow {
  const phaseViews = mapPhasesToViews(job.deliveryPhases);
  const { subtotal, deliveryFee, tax, total, resolved } = jobMoney(
    job,
    phaseViews,
    shopDeliveryFee,
  );

  const receipt = parseReceiptSnapshot(job.receiptSnapshot);
  const paidTotal = receipt?.total ? Number.parseFloat(receipt.total) : NaN;
  const currency = receipt?.currency?.trim() || "CAD";
  const customerPo =
    job.purchaseOrderNumber?.trim() || job.project.poNumber?.trim() || "";

  return [
    job.orderNumber ?? "",
    job.orderLink?.orderName ?? "",
    job.name,
    customerPo,
    job.project.name,
    job.project.companyName ?? "",
    job.orderLifecycleStatus,
    formatDate(job.createdAt),
    formatDate(orderedAtByJob.get(job.id) ?? job.orderLink?.createdAt),
    formatDate(job.completedAt),
    formatDate(job.paidAt),
    formatMoney(subtotal),
    formatMoney(deliveryFee),
    formatMoney(tax),
    formatMoney(total),
    Number.isFinite(paidTotal) ? formatMoney(paidTotal) : "",
    currency,
    resolved.method,
  ];
}

function jobToDeliveredRows(
  job: LoadedJob,
  orderedAtByJob: Map<string, Date>,
  shopDeliveryFee: number,
): OrderExportRow[] {
  const phaseViews = mapPhasesToViews(job.deliveryPhases);
  const { subtotal, deliveryFee, tax, total, resolved } = jobMoney(
    job,
    phaseViews,
    shopDeliveryFee,
  );

  const receipt = parseReceiptSnapshot(job.receiptSnapshot);
  const paidTotal = receipt?.total ? Number.parseFloat(receipt.total) : NaN;
  const currency = receipt?.currency?.trim() || "CAD";
  const customerPo =
    job.purchaseOrderNumber?.trim() || job.project.poNumber?.trim() || "";
  const itemLabels = job.items.map((item) => ({
    id: item.id,
    displayName: itemDisplayName(item),
  }));
  const pctDelivered = computeDeliveredPercent(job.items, phaseViews);

  const basePrefix = [
    job.orderNumber ?? "",
    job.orderLink?.orderName ?? "",
    job.name,
    customerPo,
    job.project.name,
    job.project.companyName ?? "",
    job.orderLifecycleStatus,
    formatDate(job.createdAt),
    formatDate(orderedAtByJob.get(job.id) ?? job.orderLink?.createdAt),
  ];

  const phasesWithProgress = phaseViews.filter((p) =>
    deliveryPhaseHasProgress(p),
  );

  if (phasesWithProgress.length === 0) {
    return [
      [
        ...basePrefix,
        formatDate(job.completedAt),
        formatDate(job.paidAt),
        formatMoney(subtotal),
        formatMoney(deliveryFee),
        formatMoney(tax),
        formatMoney(total),
        Number.isFinite(paidTotal) ? formatMoney(paidTotal) : "",
        currency,
        resolved.method,
        "",
        "",
        "",
        0,
        pctDelivered,
        formatMoney(subtotal),
        formatMoney(total),
      ],
    ];
  }

  const rows: OrderExportRow[] = [];
  for (const phase of phasesWithProgress) {
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
      ...basePrefix,
      formatDate(entity?.deliveredAt ?? phase.deliveredAt),
      formatDate(job.paidAt),
      formatMoney(dropSub),
      formatMoney(dropDelivery),
      formatMoney(dropTax),
      formatMoney(dropTotal),
      Number.isFinite(paidTotal) ? formatMoney(paidTotal) : "",
      currency,
      resolved.method,
      phase.sequence,
      dropStatusLabel(phase, job, phaseViews),
      formatPhaseDeliveredSummary(phase, itemLabels),
      dropQtyDelivered(phase),
      pctDelivered,
      formatMoney(subtotal),
      formatMoney(total),
    ]);
  }

  return rows;
}

export async function buildAllOrdersWorkbook(
  shop: string,
): Promise<ExportAllOrdersResult> {
  const jobs = await loadJobs(shop);
  const orderedAtByJob = await loadOrderedAtByJob(jobs.map((j) => j.id));
  const shopDeliveryFee = await getShopDeliveryFee(shop);

  const rowsBySheet = new Map<string, OrderExportRow[]>();
  for (const { sheetName } of ORDER_EXPORT_SHEETS) {
    rowsBySheet.set(sheetName, []);
  }

  for (const job of jobs) {
    const sheetName = routeJobToSheet(job);
    if (!sheetName) continue;
    if (sheetName === "Delivered") {
      rowsBySheet
        .get("Delivered")!
        .push(...jobToDeliveredRows(job, orderedAtByJob, shopDeliveryFee));
    } else {
      rowsBySheet
        .get(sheetName)!
        .push(jobToRow(job, orderedAtByJob, shopDeliveryFee));
    }
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Project Clad";
  workbook.created = new Date();

  const rowCounts: Record<string, number> = {};
  for (const { sheetName } of ORDER_EXPORT_SHEETS) {
    const sheet = workbook.addWorksheet(sheetName);
    const columns =
      sheetName === "Delivered"
        ? [...DELIVERED_EXPORT_COLUMNS]
        : [...ORDER_EXPORT_COLUMNS];
    sheet.addRow(columns);
    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: "middle" };

    const rows = rowsBySheet.get(sheetName) ?? [];
    for (const row of rows) {
      sheet.addRow(row);
    }

    sheet.columns.forEach((col) => {
      let max = 10;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value ?? "").length;
        if (len > max) max = len;
      });
      col.width = Math.min(max + 2, 52);
    });

    rowCounts[sheetName] = rows.length;
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);

  return {
    filename: `projectclad-orders-${stamp}.xlsx`,
    buffer: Buffer.from(arrayBuffer),
    rowCounts,
    totalCount: jobs.length,
  };
}
