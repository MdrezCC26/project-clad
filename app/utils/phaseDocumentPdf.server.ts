import PDFDocument from "pdfkit";
import type { Job, JobDeliveryPhase, JobDeliveryPhaseLine, JobItem, Project } from "@prisma/client";
import { parseOrderLineCapture, parseVariantSnapshot } from "./variantInfo.server";
import { orderTaxFromSubtotal } from "./orderDisplayTax";

type PhaseGraph = JobDeliveryPhase & { lines: JobDeliveryPhaseLine[] };

function lineLabel(item: JobItem): string {
  const capture = parseOrderLineCapture(item.orderLineCapture);
  if (capture?.displayLabel?.trim()) return capture.displayLabel.trim();
  const snap = parseVariantSnapshot(item.variantSnapshot);
  const parts = [snap?.productTitle, snap?.variantTitle]
    .map((s) => s?.trim())
    .filter(Boolean);
  return parts.length ? parts.join(" — ") : "Line item";
}

function qtyForPhaseLine(
  phase: PhaseGraph,
  jobItemId: string,
  useActual: boolean,
): number {
  const row = phase.lines.find((l) => l.jobItemId === jobItemId);
  if (!row) return 0;
  return useActual ? row.quantityDelivered : row.quantityPlanned;
}

function phaseDeliveryFeeAmount(
  phase: PhaseGraph,
  shopDeliveryFee: number,
  isDelivery: boolean,
): number {
  if (!isDelivery) return 0;
  const stored = Number(phase.deliveryFeeAmount ?? 0);
  return stored > 0 ? stored : shopDeliveryFee;
}

export async function buildPhasePdfBuffer(args: {
  mode: "packing" | "invoice";
  project: Project;
  job: Job & { items: JobItem[] };
  phase: PhaseGraph;
  shopDeliveryFee: number;
}): Promise<Buffer> {
  const { mode, project, job, phase, shopDeliveryFee } = args;
  const useActual = phase.deliveredAt != null || phase.fulfillmentPhotoStorageKey != null;
  const isDelivery =
    String(job.fulfillmentMethod || "").trim().toLowerCase() === "delivery";

  const doc = new PDFDocument({ margin: 48, size: "LETTER" });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  const title =
    mode === "packing"
      ? "Packing slip"
      : "Invoice";
  doc.fontSize(18).text(title, { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10);
  doc.text(`Project: ${project.name}`);
  doc.text(`Order: ${job.name}`);
  if (job.purchaseOrderNumber) {
    doc.text(`PO: ${job.purchaseOrderNumber}`);
  }
  doc.text(
    `Delivery ${phase.sequence} — ${phase.scheduledDeliveryDate || "Date TBD"} ${phase.scheduledDeliveryWindow || ""}`.trim(),
  );
  if (useActual) {
    doc.text("Quantities below reflect this delivery drop only (partial delivery).");
  }
  doc.moveDown();

  let subtotal = 0;
  doc.fontSize(11).text("Lines", { underline: true });
  doc.moveDown(0.25);
  for (const item of job.items) {
    const qty = qtyForPhaseLine(phase, item.id, useActual);
    if (qty <= 0) continue;
    const label = lineLabel(item);
    const unit = Number(item.priceSnapshot);
    const lineTotal = unit * qty;
    subtotal += lineTotal;
    if (mode === "packing") {
      doc.fontSize(10).text(`• ${label} — Qty ${qty}`);
    } else {
      doc
        .fontSize(10)
        .text(
          `• ${label} — Qty ${qty} @ $${unit.toFixed(2)} = $${lineTotal.toFixed(2)}`,
        );
    }
  }

  if (mode === "invoice") {
    const deliveryFee = phaseDeliveryFeeAmount(phase, shopDeliveryFee, isDelivery);
    const taxable = subtotal + deliveryFee;
    const tax = orderTaxFromSubtotal(taxable, { pricesIncludeTax: false });
    const total = Math.round((taxable + tax) * 100) / 100;
    doc.moveDown();
    doc.text(`Subtotal: $${subtotal.toFixed(2)}`);
    if (deliveryFee > 0) {
      doc.text(`Delivery (phase ${phase.sequence}): $${deliveryFee.toFixed(2)}`);
    }
    doc.text(`Tax: $${tax.toFixed(2)}`);
    doc.fontSize(11).text(`Total: $${total.toFixed(2)}`, { underline: true });
  }

  doc.end();
  await new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });
  return Buffer.concat(chunks);
}
