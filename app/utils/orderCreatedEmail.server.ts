import prisma from "../db.server";
import {
  getCustomerRowFromFetchedMap,
  getCustomersByIds,
  resolvePlacerNotifyEmail,
} from "./adminCustomers.server";
import {
  customerFacingPropertiesIndentedBlock,
  filterCustomerFacingProperties,
} from "./customerFacingEmailLines.server";
import {
  getEmailNotificationPrefs,
  isEmailNotificationEnabled,
} from "./emailNotificationPrefs.server";
import { dedupeEmailAddresses, isEmailConfigured } from "./email.server";
import { buildOrderPlacedEmailHtml } from "./financeDeliveredEmailHtml.server";
import {
  getShopLogoDataUrlForEmail,
  sendTransactionalEmail,
  sendTransactionalEmailToRecipients,
} from "./transactionalEmail.server";
import { shopStringFilter } from "./projectAccess.server";
import { resolveOrderLineImageUrl } from "./orderLineSpecs";
import { orderTaxFromSubtotal } from "./orderDisplayTax";
import { formatOrderDeliveryFootline } from "./preferredDeliveryFormat";
import {
  buildVariantPresentation,
  hydrateJobItemVariantSnapshots,
  parseVariantSnapshot,
  resolveVariantDisplayInfo,
  type VariantDisplayInfo,
} from "./variantInfo.server";

/** Matches storefront `PROJECT_DELIVERY_FEE` when an order is placed for delivery. */
const ORDER_PLACED_DELIVERY_FEE = 15;

const DEFAULT_SHOP_ORDER_NOTIFY_RAW =
  "mike@canadiancladding.ca,michaeldrezin@canadiancladding.ca";

function formatMoney(amount: number): string {
  if (Number.isNaN(amount)) return "$0.00";
  return `$${amount.toFixed(2)}`;
}

function formatOrderPlacedTimestamp(instant: Date): string {
  const tz = "America/Toronto";
  const datePart = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(instant);
  const timePart = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
  return `${datePart} at ${timePart}`;
}

function parseShopOrderPlacedRecipients(): string[] {
  const raw = process.env.PROJECTCLAD_SHOP_ORDER_NOTIFY_EMAIL?.trim();
  if (raw) {
    return dedupeEmailAddresses(
      raw.split(/[,;]+/).map((s) => s.trim()).filter(Boolean),
    );
  }
  return dedupeEmailAddresses(
    DEFAULT_SHOP_ORDER_NOTIFY_RAW.split(/[,;]+/).map((s) => s.trim()),
  );
}

/** Staff snapshot: hide `__*` only; keep `_admin_summary` etc. for internal use. */
function propertiesBlockStaff(
  props?: { name: string; value: string }[] | null,
): string {
  if (!props?.length) return "";
  const lines = props
    .filter((p) => p.name && !String(p.name).startsWith("__"))
    .map((p) => `      · ${p.name}: ${p.value}`);
  return lines.length ? `\n      Properties:\n${lines.join("\n")}` : "";
}

async function collectRecipientEmails(
  shop: string,
  ownerCustomerId: string,
  actorCustomerId: string,
): Promise<string[]> {
  const fromEnv =
    process.env.PROJECTCLAD_ORDER_NOTIFY_EMAIL?.split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const list: string[] = [...fromEnv];
  const ids = Array.from(new Set([ownerCustomerId, actorCustomerId]));
  try {
    const info = await getCustomersByIds(shop, ids);
    for (const id of ids) {
      const e = info[id]?.email?.trim();
      if (e) list.push(e);
    }
  } catch {
    // Owner/actor lookup failed; still notify env addresses if any.
  }
  const out = dedupeEmailAddresses(list);
  if (out.length === 0) {
    console.warn(
      "[orderCreatedEmail] no recipients: set PROJECTCLAD_ORDER_NOTIFY_EMAIL and/or ensure the project owner and actor have emails in Shopify Admin. Customer lookup requires a valid offline session (reinstall app if needed).",
    );
  }
  return out;
}

/** Full project: every order and line (staff / backup tooling). Not included in customer-facing status emails. */
export async function buildFullProjectSnapshotText(
  shop: string,
  projectId: string,
): Promise<string> {
  const project = await prisma.project.findFirst({
    where: { id: projectId },
    include: {
      jobs: {
        orderBy: { sortOrder: "asc" },
        include: {
          items: { orderBy: { sortOrder: "asc" } },
          orderLink: true,
        },
      },
    },
  });

  if (!project) {
    return "(Project not found in database.)";
  }

  const variantIds = project.jobs.flatMap((j) =>
    j.items.map((i) => i.variantId),
  );
  let live: Record<string, VariantDisplayInfo> = {};
  if (variantIds.length > 0) {
    try {
      const { info } = await resolveVariantDisplayInfo(shop, variantIds);
      live = info;
    } catch {
      /* use snapshots only */
    }
  }

  const lines: string[] = [
    `── Full project snapshot: ${project.name} ──`,
    `Project ID: ${project.id}`,
    `Project #: ${project.poNumber ?? "—"} · Company: ${project.companyName ?? "—"}`,
    `Orders: ${project.jobs.length}`,
    "",
  ];

  for (const job of project.jobs) {
    const locked = job.isLocked || Boolean(job.orderLink);
    lines.push(
      `▸ ${job.name}  [order id: ${job.id}]${locked ? " 🔒 locked / linked to Shopify order" : ""}`,
    );
    if (job.items.length === 0) {
      lines.push(`   (no line items)`);
      lines.push("");
      continue;
    }
    for (let i = 0; i < job.items.length; i++) {
      const row = job.items[i];
      const props =
        row.customData && Array.isArray(row.customData)
          ? (row.customData as { name: string; value: string }[])
          : null;
      const snap = parseVariantSnapshot(row.variantSnapshot);
      const pres = buildVariantPresentation({
        shop,
        variantId: row.variantId,
        live: live[row.variantId],
        snapshot: snap,
      });
      const unit = Number(row.priceSnapshot);
      const sku = snap?.sku ? ` · SKU ${snap.sku}` : "";
      const vendor = snap?.vendor ? ` · Vendor ${snap.vendor}` : "";
      lines.push(`   ${i + 1}. ${pres.displayName}${sku}${vendor}`);
      lines.push(
        `      Line id: ${row.id} · Variant id: ${row.variantId} · Qty ${row.quantity} · $${formatMoney(unit)} ea · Line $${formatMoney(unit * row.quantity)} · label source: ${pres.source}`,
      );
      const pb = propertiesBlockStaff(props);
      if (pb) {
        for (const pl of pb.trim().split("\n")) {
          lines.push(pl);
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Project status change: headline + optional intro + link (no full snapshot).
 * Recipients: PROJECTCLAD_ORDER_NOTIFY_EMAIL + owner + actor (when known).
 */
export async function sendProjectStatusNotificationEmail(args: {
  headline: string;
  shop: string;
  projectId: string;
  projectName: string;
  ownerCustomerId: string;
  actorCustomerId: string;
  introLines?: string[];
}): Promise<void> {
  if (!isEmailConfigured()) return;
  const notifyPrefs = await getEmailNotificationPrefs(args.shop);
  if (!isEmailNotificationEnabled(notifyPrefs, "projectStatus")) return;

  const recipients = await collectRecipientEmails(
    args.shop,
    args.ownerCustomerId,
    args.actorCustomerId,
  );
  if (recipients.length === 0) return;

  const projectUrl = `https://${args.shop}/apps/project-clad/project?id=${args.projectId}`;
  const intro =
    args.introLines?.filter(Boolean).join("\n") ||
    `Project update: ${args.headline}`;

  const text = [intro, ``, `Open project: ${projectUrl}`].join("\n");

  try {
    await sendTransactionalEmailToRecipients({
      shop: args.shop,
      recipients,
      subject: `ProjectClad: ${args.headline} — ${args.projectName}`,
      text,
    });
  } catch (err) {
    console.error(
      "[projectStatusEmail] send failed:",
      err instanceof Error ? err.message : err,
    );
  }
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
 * Cart save: lines for the affected order only (no shop/project/order IDs, no full snapshot).
 */
export async function sendOrderCreatedNotificationEmail(args: {
  shop: string;
  projectId: string;
  projectName: string;
  jobId: string;
  jobName: string;
  headline?: string;
  poNumber?: string | null;
  jobPurchaseOrderNumber?: string | null;
  companyName?: string | null;
  ownerCustomerId: string;
  actorCustomerId: string;
  jobItems: Array<{
    id: string;
    variantId: string;
    quantity: number;
    priceSnapshot: { toString(): string } | number | string;
    customData: unknown;
    variantSnapshot: unknown;
  }>;
}): Promise<void> {
  if (!isEmailConfigured()) return;
  const notifyPrefs = await getEmailNotificationPrefs(args.shop);
  if (!isEmailNotificationEnabled(notifyPrefs, "cartSave")) return;

  const recipients = await collectRecipientEmails(
    args.shop,
    args.ownerCustomerId,
    args.actorCustomerId,
  );
  if (recipients.length === 0) return;

  const headline = args.headline ?? "Your order has been saved!";

  const variantIds = args.jobItems.map((i) => i.variantId);
  let live: Record<string, VariantDisplayInfo> = {};
  try {
    const { info } = await resolveVariantDisplayInfo(args.shop, variantIds);
    live = info;
  } catch {
    // Labels fall back to snapshots only.
  }

  const lines = args.jobItems.map((row, index) => {
    const props =
      row.customData && Array.isArray(row.customData)
        ? (row.customData as { name: string; value: string }[])
        : null;
    const snap = parseVariantSnapshot(row.variantSnapshot);
    const pres = buildVariantPresentation({
      shop: args.shop,
      variantId: row.variantId,
      live: live[row.variantId],
      snapshot: snap,
    });
    const unit = Number(row.priceSnapshot?.toString?.() ?? row.priceSnapshot ?? 0);
    const lineTotal = unit * row.quantity;
    const propBlock = customerFacingPropertiesIndentedBlock(props);
    return [
      `${index + 1}. ${pres.displayName}`,
      `   Qty ${row.quantity} · Unit Price ${formatMoney(unit)} · Total ${formatMoney(lineTotal)}`,
      propBlock || null,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const projectUrl = `https://${args.shop}/apps/project-clad/project?id=${args.projectId}`;

  const headerBlock = [
    headline,
    ``,
    `Project: ${args.projectName}`,
    `Order: ${args.jobName}`,
    formatProjectNumberLine(args.poNumber),
    formatJobPoLine(args.jobPurchaseOrderNumber),
    args.companyName?.trim()
      ? `Company: ${args.companyName.trim()}`
      : `Company: —`,
    ``,
    `Lines saved in this cart action:`,
    lines.join("\n\n"),
    ``,
    `Open project: ${projectUrl}`,
  ];

  const text = headerBlock.join("\n");

  try {
    await sendTransactionalEmailToRecipients({
      shop: args.shop,
      recipients,
      subject: `ProjectClad: ${headline} — ${args.projectName}`,
      text,
    });
  } catch (err) {
    console.error(
      "[orderCreatedEmail] send failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

type JobItemRow = {
  id: string;
  variantId: string;
  quantity: number;
  priceSnapshot: { toString(): string } | number | string;
  customData: unknown;
  variantSnapshot: unknown;
};

function buildCustomerOrderLinesBlock(
  shop: string,
  jobItems: JobItemRow[],
  live: Record<string, VariantDisplayInfo>,
): { text: string; subtotal: number } {
  let subtotal = 0;
  const lines = jobItems.map((row, index) => {
    const props =
      row.customData && Array.isArray(row.customData)
        ? (row.customData as { name: string; value: string }[])
        : null;
    const snap = parseVariantSnapshot(row.variantSnapshot);
    const pres = buildVariantPresentation({
      shop,
      variantId: row.variantId,
      live: live[row.variantId],
      snapshot: snap,
    });
    const unit = Number(row.priceSnapshot?.toString?.() ?? row.priceSnapshot ?? 0);
    const lineTotal = unit * row.quantity;
    subtotal += lineTotal;
    const propBlock = customerFacingPropertiesIndentedBlock(props);
    return [
      `${index + 1}. ${pres.displayName}`,
      `   Qty ${row.quantity} · Unit Price ${formatMoney(unit)} · Total ${formatMoney(lineTotal)}`,
      propBlock || null,
    ]
      .filter(Boolean)
      .join("\n");
  });
  return { text: lines.join("\n\n"), subtotal };
}

function buildShopOrderLinesNoPricingBlock(
  shop: string,
  jobItems: JobItemRow[],
  live: Record<string, VariantDisplayInfo>,
): string {
  return jobItems
    .map((row, index) => {
      const props =
        row.customData && Array.isArray(row.customData)
          ? (row.customData as { name: string; value: string }[])
          : null;
      const snap = parseVariantSnapshot(row.variantSnapshot);
      const pres = buildVariantPresentation({
        shop,
        variantId: row.variantId,
        live: live[row.variantId],
        snapshot: snap,
      });
      const propBlock = customerFacingPropertiesIndentedBlock(props);
      return [
        `${index + 1}. ${pres.displayName} · Qty ${row.quantity}`,
        propBlock || null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function shippingLinesForProject(project: {
  shipAddress1: string | null;
  shipCity: string | null;
  shipProvince: string | null;
  shipPostal: string | null;
  shipCountry: string | null;
}): string[] {
  return [
    project.shipAddress1,
    [project.shipCity, project.shipProvince, project.shipPostal]
      .filter(Boolean)
      .join(", "),
    project.shipCountry,
  ]
    .filter((l) => l && String(l).trim())
    .map((l) => String(l).trim());
}

function shippingBlockForProject(project: {
  shipAddress1: string | null;
  shipCity: string | null;
  shipProvince: string | null;
  shipPostal: string | null;
  shipCountry: string | null;
}): string {
  const lines = shippingLinesForProject(project);
  return lines.length
    ? ["Ship to:", ...lines.map((l) => `  ${l}`)].join("\n")
    : "Ship to: (not on file)";
}

function customerNameFromRow(row?: {
  firstName?: string | null;
  lastName?: string | null;
} | null): string {
  return (
    [row?.firstName, row?.lastName].filter(Boolean).join(" ").trim() || "—"
  );
}

/**
 * What actually went out, so the caller can tell the user "the order is placed but the mail
 * was not sent" instead of leaving a failed notification invisible to both parties.
 * A leg that was never attempted (SMTP unconfigured, notification switched off, no address
 * on file) is not a failure — only a send that threw is.
 */
export type OrderPlacedEmailOutcome = {
  customerFailed: boolean;
  shopFailed: boolean;
};

const ORDER_PLACED_EMAILS_OK: OrderPlacedEmailOutcome = {
  customerFailed: false,
  shopFailed: false,
};

/**
 * After **Order now**: thank-you to the project customer (owner when staff
 * placed on their behalf) + shop operations mail.
 * Does not throw on SMTP failure (logs, and reports it in the returned outcome); the order is
 * already persisted and must not be rolled back because a notification failed.
 */
export async function sendOrderPlacedEmails(args: {
  shop: string;
  projectId: string;
  jobId: string;
  fulfillmentMethod: "pickup" | "delivery";
  actorCustomerId: string;
  /** Who receives the customer thank-you; defaults to the actor. */
  customerCustomerId?: string;
}): Promise<OrderPlacedEmailOutcome> {
  if (!isEmailConfigured()) return ORDER_PLACED_EMAILS_OK;
  const notifyPrefs = await getEmailNotificationPrefs(args.shop);
  const sendCustomer = isEmailNotificationEnabled(
    notifyPrefs,
    "orderPlacedCustomer",
  );
  const sendShop = isEmailNotificationEnabled(notifyPrefs, "orderPlacedShop");
  if (!sendCustomer && !sendShop) return ORDER_PLACED_EMAILS_OK;

  const project = await prisma.project.findFirst({
    where: { id: args.projectId, shop: shopStringFilter(args.shop) },
    select: {
      name: true,
      poNumber: true,
      companyName: true,
      shipAddress1: true,
      shipCity: true,
      shipProvince: true,
      shipPostal: true,
      shipCountry: true,
      ownerCustomerId: true,
    },
  });
  const job = await prisma.job.findFirst({
    where: { id: args.jobId, projectId: args.projectId },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });

  if (!project || !job) return ORDER_PLACED_EMAILS_OK;

  const rows = job.items;
  if (rows.length === 0) return ORDER_PLACED_EMAILS_OK;

  await hydrateJobItemVariantSnapshots(
    args.shop,
    rows.map((r) => ({
      id: r.id,
      variantId: r.variantId,
      variantSnapshot: r.variantSnapshot,
    })),
  );
  const freshItems = await prisma.jobItem.findMany({
    where: { jobId: args.jobId },
    orderBy: { sortOrder: "asc" },
  });

  const variantIds = freshItems.map((i) => i.variantId);
  let live: Record<string, VariantDisplayInfo> = {};
  try {
    const { info } = await resolveVariantDisplayInfo(args.shop, variantIds);
    live = info;
  } catch {
    /* snapshot labels */
  }

  const { text: orderLinesText, subtotal } = buildCustomerOrderLinesBlock(
    args.shop,
    freshItems,
    live,
  );
  const deliveryFee =
    args.fulfillmentMethod === "delivery" ? ORDER_PLACED_DELIVERY_FEE : 0;
  /** Match storefront order table: HST on subtotal + delivery. */
  const taxableBase = subtotal + deliveryFee;
  const tax = orderTaxFromSubtotal(taxableBase, { pricesIncludeTax: false });
  const total = Math.round((subtotal + tax + deliveryFee) * 100) / 100;

  const projectUrl = `https://${args.shop}/apps/project-clad/project?id=${encodeURIComponent(args.projectId)}`;
  const projectOrderUrl = `${projectUrl}&job=${encodeURIComponent(args.jobId)}`;
  const isDelivery = args.fulfillmentMethod === "delivery";

  const headerLines = [
    `Project: ${project.name}`,
    `Order: ${job.name}`,
    formatProjectNumberLine(project.poNumber),
    formatJobPoLine(job.purchaseOrderNumber),
    `Company: ${(project.companyName ?? "").trim() || "—"}`,
  ];

  const addressBlock = isDelivery
    ? [shippingBlockForProject(project), ``]
    : [`Fulfillment: Store pickup`, ``];

  const placedAtInstant = new Date();
  const placedAt = formatOrderPlacedTimestamp(placedAtInstant);
  const customerCustomerId =
    args.customerCustomerId?.trim() || args.actorCustomerId;
  const lookupIds = Array.from(
    new Set([
      customerCustomerId,
      args.actorCustomerId,
      project.ownerCustomerId,
    ]),
  );
  const customerInfo = await getCustomersByIds(args.shop, lookupIds).catch(
    () => ({} as Awaited<ReturnType<typeof getCustomersByIds>>),
  );
  const customerRow = getCustomerRowFromFetchedMap(
    customerCustomerId,
    customerInfo,
  );
  const ownerRow = getCustomerRowFromFetchedMap(
    project.ownerCustomerId,
    customerInfo,
  );
  const ac = getCustomerRowFromFetchedMap(args.actorCustomerId, customerInfo);
  const customerName = customerNameFromRow(customerRow);
  const customerEmailDisplay = customerRow?.email?.trim() || "—";
  const customerPhone = (customerRow?.phone ?? "").trim() || "—";
  const ownerName = customerNameFromRow(ownerRow);
  const ownerEmail = ownerRow?.email?.trim() || "—";
  const ownerPhone = (ownerRow?.phone ?? "").trim() || "—";
  const actorName = customerNameFromRow(ac);
  const actorEmail = ac?.email?.trim() || "—";
  const actorPhone = (ac?.phone ?? "").trim() || "—";

  const scheduleLine = formatOrderDeliveryFootline({
    orderLifecycleStatus: "ordered",
    paidAt: null,
    completedAt: null,
    scheduledDeliveryDate: job.scheduledDeliveryDate,
    scheduledDeliveryWindow: job.scheduledDeliveryWindow,
    fulfillmentMethod: args.fulfillmentMethod,
  });
  const requestedDelivery =
    scheduleLine != null && String(scheduleLine).trim()
      ? String(scheduleLine).toUpperCase()
      : null;
  const requestedBlock = requestedDelivery
    ? [`Requested delivery:`, requestedDelivery, ``]
    : [];

  const shopLines = buildShopOrderLinesNoPricingBlock(args.shop, freshItems, live);

  const customerIntro = `${job.name} has been placed. Click Open order to view your order details. Thank you for using Canadian Cladding!`;
  const customerBody = [
    customerIntro,
    ``,
    `Customer: ${customerName}`,
    `Email: ${customerEmailDisplay}`,
    `Phone: ${customerPhone}`,
    ``,
    ...headerLines,
    ``,
    ...addressBlock,
    `Order lines:`,
    ``,
    orderLinesText,
    ``,
    `Subtotal: ${formatMoney(subtotal)}`,
    `Delivery: ${formatMoney(deliveryFee)}`,
    `Tax: ${formatMoney(tax)}`,
    `Total: ${formatMoney(total)}`,
    ``,
    `Open order: ${projectOrderUrl}`,
  ].join("\n");

  const shopBody = [
    `Order placed on ${placedAt}.`,
    ``,
    `Customer`,
    `Customer name: ${ownerName}`,
    `Email: ${ownerEmail}`,
    `Phone: ${ownerPhone}`,
    ...(actorName !== ownerName
      ? [
          ``,
          `Placed by`,
          `Name: ${actorName}`,
          `Email: ${actorEmail}`,
          `Phone: ${actorPhone}`,
        ]
      : []),
    ``,
    `Project / order`,
    ...headerLines,
    `Fulfillment: ${isDelivery ? "Delivery" : "Pickup"}`,
    ``,
    ...requestedBlock,
    ...(isDelivery ? [`${shippingBlockForProject(project)}`, ``] : []),
    `Line items:`,
    ``,
    shopLines,
    ``,
    `Open order: ${projectOrderUrl}`,
  ].join("\n");

  const logoDataUrl = await getShopLogoDataUrlForEmail(args.shop);
  const hasLogo = Boolean(logoDataUrl?.trim());
  const companyName = (project.companyName ?? "").trim() || "—";
  const shipToLines = shippingLinesForProject(project);
  const htmlLineItems = freshItems.map((row) => {
    const props =
      row.customData && Array.isArray(row.customData)
        ? (row.customData as { name: string; value: string }[])
        : null;
    const snap = parseVariantSnapshot(row.variantSnapshot);
    const pres = buildVariantPresentation({
      shop: args.shop,
      variantId: row.variantId,
      live: live[row.variantId],
      snapshot: snap,
    });
    const unit = Number(row.priceSnapshot?.toString?.() ?? row.priceSnapshot ?? 0);
    return {
      displayName: pres.displayName,
      quantity: row.quantity,
      unit,
      lineTotal: unit * row.quantity,
      properties: filterCustomerFacingProperties(props),
      imageUrl: resolveOrderLineImageUrl({
        displayName: pres.displayName,
        properties: props,
        storefrontImageUrl: pres.imageUrl,
        snapshotImageUrl: snap?.imageUrl ?? null,
      }),
    };
  });

  const sharedPlacedHtml = {
    hasLogo,
    isDelivery,
    placedAt: placedAtInstant,
    companyName,
    projectName: project.name,
    orderName: job.name,
    orderNumber: job.orderNumber,
    projectNumber: (project.poNumber ?? "").trim() || "—",
    poNumber: (job.purchaseOrderNumber ?? "").trim() || "—",
    shipToLines,
    requestedDelivery,
    projectOrderUrl,
  };

  const customerHtml = buildOrderPlacedEmailHtml({
    ...sharedPlacedHtml,
    customerName,
    customerEmail: customerEmailDisplay,
    customerPhone,
    includePriceBox: true,
    subtotal,
    deliveryFee,
    tax,
    total,
    lineItems: htmlLineItems,
    showLineItemPrices: true,
    title: "Your order has been placed",
    preheader: `${job.name} has been placed — ${project.name}`,
  });

  const shopHtml = buildOrderPlacedEmailHtml({
    ...sharedPlacedHtml,
    customerName: ownerName,
    customerEmail: ownerEmail,
    customerPhone: ownerPhone,
    placedByName: actorName,
    placedByEmail: actorEmail,
    placedByPhone: actorPhone,
    includePriceBox: false,
    lineItems: htmlLineItems,
    showLineItemPrices: false,
    title: "Shop — order placed",
    preheader: `Shop: ${job.name} placed — ${project.name}`,
    subcopy: `Order placed on ${placedAt}. Click Open order to view the project.`,
  });

  let customerFailed = false;
  let shopFailed = false;

  let customerTo = customerRow?.email?.trim();
  if (!customerTo && customerCustomerId !== args.actorCustomerId) {
    customerTo =
      (await resolvePlacerNotifyEmail(args.shop, customerCustomerId, null)) ||
      undefined;
  }
  if (sendCustomer && customerTo) {
    try {
      await sendTransactionalEmail({
        shop: args.shop,
        to: customerTo,
        subject: `ProjectClad: Order placed — ${project.name} · ${job.name}`,
        text: customerBody,
        html: customerHtml,
      });
    } catch (err) {
      customerFailed = true;
      console.error(
        `[orderPlacedEmail] customer send failed (shop=${args.shop} project=${args.projectId} job=${args.jobId}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (!sendShop) return { customerFailed, shopFailed };

  const shopRecipients = parseShopOrderPlacedRecipients();
  if (shopRecipients.length === 0) {
    console.warn("[orderPlacedEmail] no shop notify recipients (check PROJECTCLAD_SHOP_ORDER_NOTIFY_EMAIL).");
    return { customerFailed, shopFailed };
  }

  try {
    /* Per-recipient sends are caught inside the helper, which reports a count rather than
       throwing — same treatment as `fulfillmentNotify`: none accepted means it failed. */
    const accepted = await sendTransactionalEmailToRecipients({
      shop: args.shop,
      recipients: shopRecipients,
      subject: `ProjectClad [Shop]: Order placed — ${project.name} · ${job.name}`,
      text: shopBody,
      html: shopHtml,
    });
    if (accepted === 0) {
      shopFailed = true;
      console.error(
        `[orderPlacedEmail] shop send failed for all ${shopRecipients.length} recipient(s) (shop=${args.shop} project=${args.projectId} job=${args.jobId})`,
      );
    } else if (accepted < shopRecipients.length) {
      console.warn(
        `[orderPlacedEmail] shop send partial success: ${accepted}/${shopRecipients.length} (job=${args.jobId})`,
      );
    }
  } catch (err) {
    shopFailed = true;
    console.error(
      `[orderPlacedEmail] shop send failed (shop=${args.shop} project=${args.projectId} job=${args.jobId}):`,
      err instanceof Error ? err.message : err,
    );
  }

  return { customerFailed, shopFailed };
}
