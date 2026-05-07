import prisma from "../db.server";
import {
  getCustomerRowFromFetchedMap,
  getCustomersByIds,
  type CustomerInfo,
} from "./adminCustomers.server";
import { customerFacingPropertiesIndentedBlock } from "./customerFacingEmailLines.server";
import {
  getEmailNotificationPrefs,
  isEmailNotificationEnabled,
} from "./emailNotificationPrefs.server";
import { dedupeEmailAddresses, isEmailConfigured } from "./email.server";
import { sendTransactionalEmailToRecipients } from "./transactionalEmail.server";
import { formatPreferredDeliveryDisplay } from "./preferredDeliveryFormat";
import {
  buildVariantPresentation,
  parseVariantSnapshot,
  resolveVariantDisplayInfo,
  type VariantDisplayInfo,
} from "./variantInfo.server";
import {
  customerNumericIdsForAdminApi,
  shopStringFilter,
} from "./projectAccess.server";
import { STOREFRONT_ORDER_CONFIRMED_ACTIVITY } from "./projectActivity.server";
import { orderTaxFromSubtotal } from "./orderDisplayTax";

function formatMoney(amount: number): string {
  if (Number.isNaN(amount)) return "$0.00";
  return `$${amount.toFixed(2)}`;
}

const DEFAULT_FINANCE_EMAIL = "michaeldrezin@canadiancladding.ca";

/** Same flat fee as storefront `PROJECT_DELIVERY_FEE` / order-placed email. */
const ORDER_DELIVERY_FEE = 15;

function dedupeCustomerIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function notifyEmailFromActivityPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const raw = (payload as Record<string, unknown>).notifyEmail;
  if (typeof raw !== "string") {
    return null;
  }
  const t = raw.trim();
  return t || null;
}

/**
 * Who gets the customer-facing delivered email: project owner plus whoever confirmed Order now /
 * reorder (`STOREFRONT_ORDER_CONFIRMED_ACTIVITY`). Payload may carry `notifyEmail` when Shopify’s
 * customer record has no email but the storefront session supplies one.
 */
async function resolveDeliveredCustomerNotifyContext(args: {
  projectId: string;
  jobId: string;
  ownerCustomerId: string;
}): Promise<{
  customerIds: string[];
  placerCustomerId: string | null;
  placerNotifyEmail: string | null;
}> {
  const placerRow = await prisma.projectActivityEvent.findFirst({
    where: {
      projectId: args.projectId,
      jobId: args.jobId,
      type: STOREFRONT_ORDER_CONFIRMED_ACTIVITY,
    },
    orderBy: { createdAt: "desc" },
    select: { actorCustomerId: true, payload: true },
  });
  const placerCustomerId = placerRow?.actorCustomerId?.trim() || null;
  return {
    customerIds: dedupeCustomerIds(
      placerCustomerId
        ? [args.ownerCustomerId, placerCustomerId]
        : [args.ownerCustomerId],
    ),
    placerCustomerId,
    placerNotifyEmail: notifyEmailFromActivityPayload(placerRow?.payload),
  };
}

/** All finance mailboxes from PROJECTCLAD_FINANCE_EMAIL (`a@x;b@y`). Fallback when unset. */
function financeDeliveryInvoiceRecipients(): string[] {
  const raw = process.env.PROJECTCLAD_FINANCE_EMAIL?.trim();
  if (raw) {
    const list = dedupeEmailAddresses(
      raw.split(/[,;]+/).map((s) => s.trim()).filter(Boolean),
    );
    if (list.length > 0) return list;
  }
  return [DEFAULT_FINANCE_EMAIL];
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

function formatOrderNumberLine(orderNumber?: number | null): string {
  return `Order number: ${orderNumber ?? "—"}`;
}

function adminAppHomeUrl(shopDomain: string): string {
  const storeSlug = shopDomain
    .replace(/\.myshopify\.com$/i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `https://admin.shopify.com/store/${storeSlug}/apps/projectclad/app/active-orders`;
}

/**
 * After fulfillment photo: project owner and the customer who placed the order get the delivered copy
 * (when we have a `storefront_order_confirmed` activity); finance gets invoice-oriented copy.
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

  const notifyPrefs = await getEmailNotificationPrefs(args.shop);
  const sendOwner = isEmailNotificationEnabled(notifyPrefs, "fulfillmentOwner");
  const sendFinance = isEmailNotificationEnabled(
    notifyPrefs,
    "fulfillmentFinance",
  );
  if (!sendOwner && !sendFinance) {
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

  const projectUrl = `https://${args.shop}/apps/project-clad/project?id=${encodeURIComponent(args.projectId)}`;
  const adminHomeUrl = adminAppHomeUrl(args.shop);

  const isDelivery =
    String(job.fulfillmentMethod || "").trim().toLowerCase() === "delivery";
  const deliveryFee = isDelivery ? ORDER_DELIVERY_FEE : 0;
  const taxableBase = subtotal + deliveryFee;
  const tax = orderTaxFromSubtotal(taxableBase, { pricesIncludeTax: false });
  const total = Math.round((subtotal + tax + deliveryFee) * 100) / 100;

  const prefLine = formatPreferredDeliveryDisplay(
    job.scheduledDeliveryDate,
    job.scheduledDeliveryWindow,
  );
  const scheduleParts = prefLine ? [prefLine, ``] : [];

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
    `Delivery: ${formatMoney(deliveryFee)}`,
    `Tax: ${formatMoney(tax)}`,
    `Total: ${formatMoney(total)}`,
    ``,
    `View in Projects: ${projectUrl}`,
    ``,
  ];

  const ownerBody = headerBlock.join("\n");

  const ownerId = project.ownerCustomerId;
  const {
    customerIds: deliveredNotifyIds,
    placerCustomerId,
    placerNotifyEmail,
  } = await resolveDeliveredCustomerNotifyContext({
    projectId: args.projectId,
    jobId: args.jobId,
    ownerCustomerId: ownerId,
  });

  const fetchKeys = Array.from(
    new Set(
      deliveredNotifyIds.flatMap((id) =>
        customerNumericIdsForAdminApi(id),
      ),
    ),
  );

  let ownerCustomerRow: CustomerInfo | undefined;
  let customerDeliveryEmails: string[] = [];
  let customerInfoMap: Record<string, CustomerInfo> = {};
  try {
    customerInfoMap = await getCustomersByIds(
      args.shop,
      fetchKeys.length > 0 ? fetchKeys : deliveredNotifyIds,
    );
    ownerCustomerRow = getCustomerRowFromFetchedMap(ownerId, customerInfoMap);
    customerDeliveryEmails = dedupeEmailAddresses(
      deliveredNotifyIds
        .map((id) =>
          getCustomerRowFromFetchedMap(id, customerInfoMap)?.email?.trim(),
        )
        .filter((e): e is string => Boolean(e)),
    );
  } catch {
    ownerCustomerRow = undefined;
    customerDeliveryEmails = [];
    customerInfoMap = {};
  }

  if (
    placerCustomerId &&
    placerNotifyEmail &&
    placerNotifyEmail.includes("@")
  ) {
    const placerHadProfileEmail = Boolean(
      getCustomerRowFromFetchedMap(placerCustomerId, customerInfoMap)?.email?.trim(),
    );
    if (!placerHadProfileEmail) {
      customerDeliveryEmails = dedupeEmailAddresses([
        ...customerDeliveryEmails,
        placerNotifyEmail,
      ]);
    }
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
    formatJobPoLine(job.purchaseOrderNumber),
    `Order: ${job.name}`,
    formatOrderNumberLine(job.orderNumber),
    ``,
    isDelivery ? `${shippingBlock(project)}` : `Fulfillment: Store pickup`,
    ``,
    `Line items:`,
    ``,
    lineBlocks.join("\n\n") || "(none)",
    ``,
    `Subtotal: ${formatMoney(subtotal)}`,
    `Delivery: ${formatMoney(deliveryFee)}`,
    `Tax: ${formatMoney(tax)}`,
    `Total: ${formatMoney(total)}`,
    ``,
    `Open app home: ${adminHomeUrl}`,
    ``,
  ].join("\n");

  const subject = `ProjectClad: Order delivered — ${project.name} · ${job.name}`;

  const financeRecipients = financeDeliveryInvoiceRecipients();

  if (sendOwner && customerDeliveryEmails.length > 0) {
    try {
      const ok = await sendTransactionalEmailToRecipients({
        shop: args.shop,
        recipients: customerDeliveryEmails,
        subject,
        text: ownerBody,
      });
      if (ok === 0) {
        throw new Error(
          `[fulfillmentNotify] customer delivered-mail failed for all ${customerDeliveryEmails.length} recipient(s)`,
        );
      }
      if (ok < customerDeliveryEmails.length) {
        console.warn(
          `[fulfillmentNotify] customer delivered-mail partial success: ${ok}/${customerDeliveryEmails.length}`,
        );
      }
    } catch (err) {
      console.error(
        "[fulfillmentNotify] customer delivered-mail send failed:",
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  } else if (sendOwner && customerDeliveryEmails.length === 0) {
    console.warn(
      "[fulfillmentNotify] fulfillmentOwner is on but no customer emails (check Shopify customer email on file and Admin API session).",
    );
  }

  /** Always send finance copy when enabled (each list address gets its own message; subject/body differ from owner). */
  if (sendFinance && financeRecipients.length > 0) {
    try {
      const financeSubject = `ProjectClad: Finance — Order delivered — ${project.name} · ${job.name}`;
      const ok = await sendTransactionalEmailToRecipients({
        shop: args.shop,
        recipients: financeRecipients,
        subject: financeSubject,
        text: financeBody,
      });
      if (ok === 0) {
        throw new Error(
          `[fulfillmentNotify] finance send failed for all ${financeRecipients.length} recipient(s)`,
        );
      }
      if (ok < financeRecipients.length) {
        console.warn(
          `[fulfillmentNotify] finance send partial success: ${ok}/${financeRecipients.length}`,
        );
      }
    } catch (err) {
      console.error(
        "[fulfillmentNotify] finance send failed:",
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  }
}
