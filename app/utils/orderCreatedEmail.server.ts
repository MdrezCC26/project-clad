import prisma from "../db.server";
import { getCustomersByIds } from "./adminCustomers.server";
import { customerFacingPropertiesIndentedBlock } from "./customerFacingEmailLines.server";
import { dedupeEmailAddresses, isEmailConfigured } from "./email.server";
import {
  sendTransactionalEmail,
  sendTransactionalEmailToRecipients,
} from "./transactionalEmail.server";
import { shopStringFilter } from "./projectAccess.server";
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

function shippingBlockForProject(project: {
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
  return lines.length
    ? ["Ship to:", ...lines.map((l) => `  ${l}`)].join("\n")
    : "Ship to: (not on file)";
}

/**
 * After **Order now**: thank-you to the placing customer (when email on file) + shop operations mail.
 * Does not throw on SMTP failure (logs only); order is already persisted.
 */
export async function sendOrderPlacedEmails(args: {
  shop: string;
  projectId: string;
  jobId: string;
  fulfillmentMethod: "pickup" | "delivery";
  actorCustomerId: string;
}): Promise<void> {
  if (!isEmailConfigured()) return;

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

  if (!project || !job) return;

  const rows = job.items;
  if (rows.length === 0) return;

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
  /** Match storefront order table: HST on line subtotal, then add flat delivery (not taxed here). */
  const tax = orderTaxFromSubtotal(subtotal, { pricesIncludeTax: false });
  const total = Math.round((subtotal + tax + deliveryFee) * 100) / 100;

  const projectUrl = `https://${args.shop}/apps/project-clad/project?id=${encodeURIComponent(args.projectId)}`;

  const headerLines = [
    `Project: ${project.name}`,
    `Order: ${job.name}`,
    formatProjectNumberLine(project.poNumber),
    formatJobPoLine(job.purchaseOrderNumber),
    `Company: ${(project.companyName ?? "").trim() || "—"}`,
  ];

  const addressBlock =
    args.fulfillmentMethod === "delivery"
      ? [shippingBlockForProject(project), ``]
      : [`This order is store pickup (no delivery address).`, ``];

  const customerBody = [
    `Your order has been successfully placed, thank you for choosing Canadian Cladding.`,
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
    `Open project: ${projectUrl}`,
  ].join("\n");

  const placedAt = formatOrderPlacedTimestamp(new Date());
  const actorInfo = await getCustomersByIds(args.shop, [args.actorCustomerId]).catch(
    () => ({} as Awaited<ReturnType<typeof getCustomersByIds>>),
  );
  const ac = actorInfo[args.actorCustomerId];
  const actorName =
    [ac?.firstName, ac?.lastName].filter(Boolean).join(" ").trim() || "—";
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
  const requestedBlock =
    scheduleLine != null && String(scheduleLine).trim()
      ? [`Requested delivery:`, String(scheduleLine).toUpperCase(), ``]
      : [];

  const shopLines = buildShopOrderLinesNoPricingBlock(args.shop, freshItems, live);

  const shopBody = [
    `Order placed on ${placedAt},`,
    ``,
    `Placed by`,
    `Customer name: ${actorName}`,
    `Email: ${actorEmail}`,
    `Phone: ${actorPhone}`,
    ``,
    `Project / order`,
    `Project: ${project.name}`,
    formatProjectNumberLine(project.poNumber),
    `Order: ${job.name}`,
    formatJobPoLine(job.purchaseOrderNumber),
    `Company: ${(project.companyName ?? "").trim() || "—"}`,
    `Fulfillment: ${args.fulfillmentMethod === "delivery" ? "Delivery" : "Pickup"}`,
    ``,
    ...requestedBlock,
    ...(args.fulfillmentMethod === "delivery"
      ? [`${shippingBlockForProject(project)}`, ``]
      : []),
    `Line items:`,
    ``,
    shopLines,
    ``,
    `Open project: ${projectUrl}`,
  ].join("\n");

  const customerTo = ac?.email?.trim();
  if (customerTo) {
    try {
      await sendTransactionalEmail({
        shop: args.shop,
        to: customerTo,
        subject: `ProjectClad: Your order has been placed — ${project.name}`,
        text: customerBody,
      });
    } catch (err) {
      console.error(
        "[orderPlacedEmail] customer send failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const shopRecipients = parseShopOrderPlacedRecipients();
  if (shopRecipients.length === 0) {
    console.warn("[orderPlacedEmail] no shop notify recipients (check PROJECTCLAD_SHOP_ORDER_NOTIFY_EMAIL).");
    return;
  }

  try {
    await sendTransactionalEmailToRecipients({
      shop: args.shop,
      recipients: shopRecipients,
      subject: `ProjectClad [Shop]: Order placed — ${job.name} — ${project.name}`,
      text: shopBody,
    });
  } catch (err) {
    console.error(
      "[orderPlacedEmail] shop send failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
