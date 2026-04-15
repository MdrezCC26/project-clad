import prisma from "../db.server";
import {
  getCustomersByIds,
  type CustomerInfo,
} from "./adminCustomers.server";
import { customerFacingPropertiesIndentedBlock } from "./customerFacingEmailLines.server";
import { isEmailConfigured } from "./email.server";
import { sendTransactionalEmail } from "./transactionalEmail.server";
import { formatPreferredDeliveryDisplay } from "./preferredDeliveryFormat";
import {
  buildVariantPresentation,
  parseVariantSnapshot,
  resolveVariantDisplayInfo,
  type VariantDisplayInfo,
} from "./variantInfo.server";
import { shopStringFilter } from "./projectAccess.server";

function formatMoney(amount: number): string {
  if (Number.isNaN(amount)) return "$0.00";
  return `$${amount.toFixed(2)}`;
}

const DEFAULT_FINANCE_EMAIL = "michaeldrezin@canadiancladding.ca";

/** Single finance mailbox for delivered / invoice mail (env may override first address only). */
function financeDeliveryInvoiceRecipient(): string {
  const raw = process.env.PROJECTCLAD_FINANCE_EMAIL?.trim();
  if (raw) {
    const first = raw
      .split(/[,;]+/)
      .map((s) => s.trim())
      .find(Boolean);
    if (first) return first;
  }
  return DEFAULT_FINANCE_EMAIL;
}

function shippingBlock(project: {
  shipAddress1: string | null;
  shipCity: string | null;
  shipProvince: string | null;
  shipPostal: string | null;
  shipCountry: string | null;
}): string {
  const lines = [
    project.shipAddress1,
    [
      project.shipCity,
      project.shipProvince,
      project.shipPostal,
    ]
      .filter(Boolean)
      .join(", "),
    project.shipCountry,
  ]
    .filter((l) => l && String(l).trim())
    .map((l) => String(l).trim());
  return lines.length ? ["Ship to:", ...lines.map((l) => `  ${l}`)].join("\n") : "Ship to: (not on file)";
}

function buildDeliveredLineItemsAndSubtotal(args: {
  shop: string;
  items: Array<{
    variantId: string;
    quantity: number;
    priceSnapshot: { toString(): string } | number | string;
    customData: unknown;
    variantSnapshot: unknown;
  }>;
  live: Record<string, VariantDisplayInfo>;
}): { blocks: string[]; subtotal: number } {
  let subtotal = 0;
  const blocks: string[] = [];
  args.items.forEach((row, index) => {
    const unit = Number(row.priceSnapshot?.toString?.() ?? row.priceSnapshot ?? 0);
    const lineTotal = unit * row.quantity;
    subtotal += lineTotal;
    const props =
      row.customData && Array.isArray(row.customData)
        ? (row.customData as { name: string; value: string }[])
        : null;
    const snap = parseVariantSnapshot(row.variantSnapshot);
    const pres = buildVariantPresentation({
      shop: args.shop,
      variantId: row.variantId,
      live: args.live[row.variantId],
      snapshot: snap,
    });
    const propBlock = customerFacingPropertiesIndentedBlock(props);
    blocks.push(
      [
        `${index + 1}. ${pres.displayName}`,
        `   Qty ${row.quantity} × ${formatMoney(unit)} = ${formatMoney(lineTotal)}`,
        propBlock || null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  });
  return { blocks, subtotal };
}

function formatProjectNumberLine(poNumber?: string | null): string {
  const v = (poNumber ?? "").trim();
  return `Project # ${v || "—"}`;
}

function formatJobPoLine(jobPurchaseOrderNumber?: string | null): string {
  const v = (jobPurchaseOrderNumber ?? "").trim();
  return `PO Number: ${v || "—"}`;
}

/**
 * After fulfillment photo: owner gets customer-facing delivered copy; finance gets invoice-oriented copy.
 * Idempotent caller should set fulfillmentNotifiedAt only after success.
 */
export async function sendFulfillmentPackageEmails(args: {
  shop: string;
  projectId: string;
  jobId: string;
}): Promise<void> {
  if (!isEmailConfigured()) {
    console.warn("[fulfillmentNotify] email not configured; skip send");
    return;
  }

  const project = await prisma.project.findFirst({
    where: { id: args.projectId, shop: shopStringFilter(args.shop) },
    include: {
      jobs: {
        where: { id: args.jobId },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });

  if (!project?.jobs.length) return;
  const job = project.jobs[0];

  const variantIds = job.items.map((i) => i.variantId);
  let live: Record<string, VariantDisplayInfo> = {};
  if (variantIds.length > 0) {
    try {
      const { info } = await resolveVariantDisplayInfo(args.shop, variantIds);
      live = info;
    } catch {
      /* snapshot only */
    }
  }

  const { blocks: lineBlocks, subtotal } = buildDeliveredLineItemsAndSubtotal({
    shop: args.shop,
    items: job.items,
    live,
  });

  const delivery = 0;
  const tax = 0;
  const total = subtotal + delivery + tax;

  const prefLine = formatPreferredDeliveryDisplay(
    job.scheduledDeliveryDate,
    job.scheduledDeliveryWindow,
  );
  const scheduleParts = prefLine ? [prefLine, ``] : [];

  const projectUrl = `https://${args.shop}/apps/project-clad/project?id=${encodeURIComponent(args.projectId)}`;

  const isDelivery =
    String(job.fulfillmentMethod || "").trim().toLowerCase() === "delivery";
  const locationBlock = isDelivery
    ? [shippingBlock(project), ``]
    : [`Fulfillment: Store pickup`, ``];

  const headerBlock = [
    `Your order has been delivered!`,
    ``,
    `Project: ${project.name}`,
    `Order: ${job.name}`,
    formatProjectNumberLine(project.poNumber),
    formatJobPoLine(job.purchaseOrderNumber),
    `Company: ${(project.companyName ?? "").trim() || "—"}`,
    ``,
    ...scheduleParts,
    ...locationBlock,
    `Line items:`,
    ``,
    lineBlocks.join("\n\n") || "(none)",
    ``,
    `Subtotal: ${formatMoney(subtotal)}`,
    `Delivery: ${formatMoney(delivery)}`,
    `Tax: ${formatMoney(tax)}`,
    `Total: ${formatMoney(total)}`,
    ``,
    `View in Projects: ${projectUrl}`,
    ``,
  ];

  const ownerBody = headerBlock.join("\n");

  const ownerId = project.ownerCustomerId;
  let ownerEmail: string | null = null;
  let ownerCustomerRow: CustomerInfo | undefined;
  try {
    const info = await getCustomersByIds(args.shop, [ownerId]);
    ownerCustomerRow = info[ownerId];
    ownerEmail = ownerCustomerRow?.email?.trim() || null;
  } catch {
    ownerEmail = null;
  }

  const ownerName =
    [ownerCustomerRow?.firstName, ownerCustomerRow?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() || "—";
  const ownerCustEmail = ownerCustomerRow?.email?.trim() || "—";
  const ownerPhone = (ownerCustomerRow?.phone ?? "").trim() || "—";

  const financeBody = [
    `This order has been delivered. Please proceed with the invoice for this order.`,
    ``,
    `Customer details`,
    `Customer name: ${ownerName}`,
    `Email: ${ownerCustEmail}`,
    `Phone: ${ownerPhone}`,
    `Company on project: ${(project.companyName ?? "").trim() || "—"}`,
    ``,
    `Project / order`,
    `Project: ${project.name}`,
    formatProjectNumberLine(project.poNumber),
    `Order: ${job.name}`,
    formatJobPoLine(job.purchaseOrderNumber),
    ``,
    isDelivery ? `${shippingBlock(project)}` : `Fulfillment: Store pickup`,
    ``,
    `Line items:`,
    ``,
    lineBlocks.join("\n\n") || "(none)",
    ``,
    `Subtotal: ${formatMoney(subtotal)}`,
    `Delivery: ${formatMoney(delivery)}`,
    `Tax: ${formatMoney(tax)}`,
    `Total: ${formatMoney(total)}`,
    ``,
    `View project (ProjectClad): ${projectUrl}`,
    ``,
  ].join("\n");

  const subject = `ProjectClad: Order delivered — ${project.name} · ${job.name}`;

  const ownerNorm = ownerEmail?.trim().toLowerCase() ?? "";
  const financeTo = financeDeliveryInvoiceRecipient().trim();
  const financeNorm = financeTo.toLowerCase();

  if (ownerEmail) {
    try {
      await sendTransactionalEmail({
        shop: args.shop,
        to: ownerEmail,
        subject,
        text: ownerBody,
      });
    } catch (err) {
      console.error(
        "[fulfillmentNotify] owner send failed:",
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  }

  if (financeTo && financeNorm !== ownerNorm) {
    try {
      await sendTransactionalEmail({
        shop: args.shop,
        to: financeTo,
        subject: `ProjectClad: Finance — Order delivered — ${project.name} · ${job.name}`,
        text: financeBody,
      });
    } catch (err) {
      console.error(
        "[fulfillmentNotify] finance send failed:",
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  }
}
