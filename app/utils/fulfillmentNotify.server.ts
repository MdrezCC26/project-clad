import prisma from "../db.server";
import {
  isSafeFulfillmentPhotoStorageKey,
  readFulfillmentPhoto,
} from "./fulfillmentPhotoStorage.server";
import {
  isSafePurchaseOrderPdfStorageKey,
  readPurchaseOrderPdf,
} from "./purchaseOrderPdfStorage.server";
import {
  getCustomerRowFromFetchedMap,
  getCustomersByIds,
  type CustomerInfo,
} from "./adminCustomers.server";
import { customerFacingPropertiesIndentedBlock, filterCustomerFacingProperties } from "./customerFacingEmailLines.server";
import {
  getEmailNotificationPrefs,
  isEmailNotificationEnabled,
} from "./emailNotificationPrefs.server";
import { dedupeEmailAddresses, isEmailConfigured } from "./email.server";
import {
  buildCustomerDeliveredEmailHtml,
  buildFinanceDeliveredEmailHtml,
} from "./financeDeliveredEmailHtml.server";
import { resolveFinanceDeliveryRecipients } from "./financeEmailRecipients.server";
import { buildSignedFulfillmentPhotoUrl } from "./fulfillmentPhotoSignedUrl.server";
import {
  getShopLogoDataUrlForEmail,
  sendTransactionalEmailToRecipients,
} from "./transactionalEmail.server";
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
import { resolveOrderLifecycleCustomerRecipients } from "./orderCustomerNotify.server";
import { orderTaxFromSubtotal } from "./orderDisplayTax";
import { getShopDeliveryFee } from "./shopDeliveryFee.server";
import {
  computeDeliveredPercent,
  mapPhasesToViews,
} from "./jobDeliveryPhases";

function formatMoney(amount: number): string {
  if (Number.isNaN(amount)) return "$0.00";
  return `$${amount.toFixed(2)}`;
}

/** Same flat fee as storefront `PROJECT_DELIVERY_FEE` / order-placed email. */
const ORDER_DELIVERY_FEE = 15;

/** All finance mailboxes from PROJECTCLAD_FINANCE_EMAIL, minus shop mutes. */
async function financeDeliveryInvoiceRecipients(
  shop: string,
): Promise<string[]> {
  return resolveFinanceDeliveryRecipients(shop);
}

function shippingLines(project: {
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

function shippingBlock(project: {
  shipAddress1: string | null;
  shipCity: string | null;
  shipProvince: string | null;
  shipPostal: string | null;
  shipCountry: string | null;
}): string {
  const lines = shippingLines(project);
  return lines.length
    ? ["Ship to:", ...lines.map((l) => `  ${l}`)].join("\n")
    : "Ship to: (not on file)";
}

function buildDeliveredLineItemsAndSubtotal(args: {
  shop: string;
  items: Array<{
    id: string;
    variantId: string;
    quantity: number;
    priceSnapshot: { toString(): string } | number | string;
    customData: unknown;
    variantSnapshot: unknown;
  }>;
  live: Record<string, VariantDisplayInfo>;
  /** When set, only these delivered quantities are invoiced (phased partial delivery). */
  quantityByItemId?: Map<string, number>;
}): {
  blocks: string[];
  lines: Array<{
    displayName: string;
    qty: number;
    unit: number;
    lineTotal: number;
    properties: { name: string; value: string }[];
  }>;
  subtotal: number;
} {
  let subtotal = 0;
  const blocks: string[] = [];
  const lines: Array<{
    displayName: string;
    qty: number;
    unit: number;
    lineTotal: number;
    properties: { name: string; value: string }[];
  }> = [];
  let lineIndex = 0;
  args.items.forEach((row) => {
    const qty =
      args.quantityByItemId?.get(row.id) ??
      (args.quantityByItemId ? 0 : row.quantity);
    if (qty <= 0) return;
    const unit = Number(row.priceSnapshot?.toString?.() ?? row.priceSnapshot ?? 0);
    const lineTotal = unit * qty;
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
    const properties = filterCustomerFacingProperties(props);
    const propBlock = customerFacingPropertiesIndentedBlock(props);
    lineIndex += 1;
    lines.push({
      displayName: pres.displayName,
      qty,
      unit,
      lineTotal,
      properties,
    });
    blocks.push(
      [
        `${lineIndex}. ${pres.displayName}`,
        `   Qty ${qty} × ${formatMoney(unit)} = ${formatMoney(lineTotal)}`,
        propBlock || null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  });
  return { blocks, lines, subtotal };
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

async function buildFinanceFulfillmentPhotoAttachment(
  storageKey: string | null | undefined,
): Promise<
  | {
      filename: string;
      content: Buffer;
      contentType: string;
    }
  | null
> {
  const key = (storageKey ?? "").trim();
  if (!key) return null;
  if (!isSafeFulfillmentPhotoStorageKey(key)) {
    return null;
  }

  const photo = await readFulfillmentPhoto(key);
  if (!photo) return null;

  const filename = `delivery-photo-${key.split(/[\\/]/).pop() || "image.jpg"}`;
  return {
    filename,
    content: photo.buffer,
    contentType: photo.contentType,
  };
}

async function buildFinancePurchaseOrderPdfAttachment(
  storageKey: string | null | undefined,
  fileName: string | null | undefined,
): Promise<
  | {
      filename: string;
      content: Buffer;
      contentType: string;
    }
  | null
> {
  const key = (storageKey ?? "").trim();
  if (!key) return null;
  if (!isSafePurchaseOrderPdfStorageKey(key)) {
    return null;
  }

  const pdf = await readPurchaseOrderPdf(key);
  if (!pdf) return null;

  const storedName = (fileName ?? "").trim();
  const filename =
    storedName ||
    `purchase-order-${key.split(/[\\/]/).pop() || "document.pdf"}`;
  return {
    filename,
    content: pdf.buffer,
    contentType: pdf.contentType,
  };
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
  /** When set, emails and invoice totals reflect only this delivery phase. */
  phaseId?: string;
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
        include: {
          items: { orderBy: { sortOrder: "asc" } },
          deliveryPhases: {
            include: { lines: true },
            orderBy: { sequence: "asc" },
          },
        },
      },
    },
  });

  if (!project?.jobs.length) return;
  const job = project.jobs[0];
  const phase = args.phaseId
    ? job.deliveryPhases.find((p) => p.id === args.phaseId)
    : undefined;
  const quantityByItemId = phase
    ? new Map(
        phase.lines.map((l) => [l.jobItemId, Math.max(0, l.quantityDelivered)]),
      )
    : undefined;

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

  const { subtotal } = buildDeliveredLineItemsAndSubtotal({
      shop: args.shop,
      items: job.items,
      live,
      quantityByItemId,
    });

  const projectUrl = `https://${args.shop}/apps/project-clad/project?id=${encodeURIComponent(args.projectId)}`;
  const projectOrderUrl = `${projectUrl}&job=${encodeURIComponent(args.jobId)}`;
  const packingSlipUrl = `https://${args.shop}/apps/project-clad/shop-slip?id=${encodeURIComponent(args.projectId)}&jobId=${encodeURIComponent(args.jobId)}`;
  const photoStorageKey =
    phase?.fulfillmentPhotoStorageKey ?? job.fulfillmentPhotoStorageKey;
  const deliveryPhotoUrl = photoStorageKey
    ? buildSignedFulfillmentPhotoUrl({
        jobId: args.jobId,
        shop: args.shop,
        phaseId: phase?.id,
        mode: "view",
      })
    : null;

  const orderDeliveredPercent = phase
    ? computeDeliveredPercent(job.items, mapPhasesToViews(job.deliveryPhases))
    : null;

  const isDelivery =
    String(job.fulfillmentMethod || "").trim().toLowerCase() === "delivery";
  const shopDeliveryFee = await getShopDeliveryFee(args.shop);
  const deliveryFee = isDelivery
    ? phase
      ? Number(phase.deliveryFeeAmount ?? 0) > 0
        ? Number(phase.deliveryFeeAmount)
        : shopDeliveryFee
      : ORDER_DELIVERY_FEE
    : 0;
  const deliveryLabel =
    phase && job.deliveryPhases.length > 1
      ? `Delivery (drop ${phase.sequence})`
      : "Delivery";
  const taxableBase = subtotal + deliveryFee;
  const tax = orderTaxFromSubtotal(taxableBase, { pricesIncludeTax: false });
  const total = Math.round((subtotal + tax + deliveryFee) * 100) / 100;

  /** Progress only when more than one drop has actually been delivered (legacy multi-drop). */
  const deliveredPhaseCount = job.deliveryPhases.filter(
    (p) =>
      p.id === phase?.id ||
      Boolean(p.deliveredAt) ||
      Boolean(p.fulfillmentNotifiedAt),
  ).length;
  const showOrderProgress =
    deliveredPhaseCount > 1 && orderDeliveredPercent != null;

  const ownerId = project.ownerCustomerId;
  const { customerIds: deliveredNotifyIds, extraNotifyEmails } =
    await resolveOrderLifecycleCustomerRecipients({
      shop: args.shop,
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
    customerDeliveryEmails = dedupeEmailAddresses([
      ...deliveredNotifyIds
        .map((id) =>
          getCustomerRowFromFetchedMap(id, customerInfoMap)?.email?.trim(),
        )
        .filter((e): e is string => Boolean(e)),
      ...extraNotifyEmails,
    ]);
  } catch {
    ownerCustomerRow = undefined;
    customerDeliveryEmails = [];
    customerInfoMap = {};
  }

  const ownerName =
    [ownerCustomerRow?.firstName, ownerCustomerRow?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() || "—";
  const ownerCustEmail = ownerCustomerRow?.email?.trim() || "—";
  const ownerPhone = (ownerCustomerRow?.phone ?? "").trim() || "—";

  const customerIntro = `${job.name} has been delivered. An invoice will be sent shortly. Click Open order to view your order details. Thank you for using Canadian Cladding!`;
  const financeIntro = `${job.name} has been delivered. Click Open order to view your order details. Thank you for using Canadian Cladding!`;

  const ownerBody = [
    customerIntro,
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
    ...(showOrderProgress
      ? [`Order progress: ${orderDeliveredPercent}% delivered overall.`, ``]
      : []),
    `Open order: ${projectOrderUrl}`,
    ...(deliveryPhotoUrl
      ? [`View delivery photo: ${deliveryPhotoUrl}`]
      : []),
    `View packing slip: ${packingSlipUrl}`,
  ].join("\n");

  const financeBody = [
    financeIntro,
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
    ...(showOrderProgress
      ? [`Order progress: ${orderDeliveredPercent}% delivered overall.`, ``]
      : []),
    `Subtotal: ${formatMoney(subtotal)}`,
    `${deliveryLabel}: ${formatMoney(deliveryFee)}`,
    `Tax: ${formatMoney(tax)}`,
    `Total: ${formatMoney(total)}`,
    ``,
    `Open order: ${projectOrderUrl}`,
    ...(deliveryPhotoUrl
      ? [`View delivery photo: ${deliveryPhotoUrl}`]
      : []),
    `View packing slip: ${packingSlipUrl}`,
  ].join("\n");

  const logoDataUrl = await getShopLogoDataUrlForEmail(args.shop);
  const hasLogo = Boolean(logoDataUrl?.trim());
  const completedAt = phase?.deliveredAt ?? job.completedAt ?? new Date();
  const sharedDeliveredHtmlArgs = {
    hasLogo,
    isDelivery,
    completedAt,
    customerName: ownerName,
    customerEmail: ownerCustEmail,
    customerPhone: ownerPhone,
    companyName: (project.companyName ?? "").trim() || "—",
    projectName: project.name,
    orderName: job.name,
    orderNumber: job.orderNumber,
    projectNumber: (project.poNumber ?? "").trim() || "—",
    poNumber: (job.purchaseOrderNumber ?? "").trim() || "—",
    shipToLines: shippingLines(project),
    orderDeliveredPercent,
    showOrderProgress,
    projectOrderUrl,
    deliveryPhotoUrl,
    packingSlipUrl,
  };

  const customerHtml = buildCustomerDeliveredEmailHtml(sharedDeliveredHtmlArgs);
  const financeHtml = buildFinanceDeliveredEmailHtml({
    ...sharedDeliveredHtmlArgs,
    subtotal,
    deliveryLabel,
    deliveryFee,
    tax,
    total,
  });

  const subject = phase
    ? `ProjectClad: Delivery ${phase.sequence} confirmed — ${project.name} · ${job.name}`
    : `ProjectClad: Order delivered — ${project.name} · ${job.name}`;

  const financeRecipients = await financeDeliveryInvoiceRecipients(args.shop);
  const deliveryPhotoAttachment = await buildFinanceFulfillmentPhotoAttachment(
    photoStorageKey,
  );
  const financePoPdfAttachment = await buildFinancePurchaseOrderPdfAttachment(
    job.purchaseOrderPdfStorageKey,
    job.purchaseOrderPdfFileName,
  );

  const financeAttachments: {
    filename: string;
    content: Buffer;
    contentType: string;
  }[] = [];
  if (deliveryPhotoAttachment) {
    financeAttachments.push(deliveryPhotoAttachment);
  }
  if (financePoPdfAttachment) {
    financeAttachments.push(financePoPdfAttachment);
  }

  if (sendOwner && customerDeliveryEmails.length > 0) {
    try {
      const ok = await sendTransactionalEmailToRecipients({
        shop: args.shop,
        recipients: customerDeliveryEmails,
        subject,
        text: ownerBody,
        html: customerHtml,
        ...(deliveryPhotoAttachment
          ? { extraAttachments: [deliveryPhotoAttachment] }
          : {}),
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
      const financeSubject = phase
        ? `ProjectClad: Finance — Delivery ${phase.sequence} — ${project.name} · ${job.name}`
        : `ProjectClad: Finance — Order delivered — ${project.name} · ${job.name}`;
      const ok = await sendTransactionalEmailToRecipients({
        shop: args.shop,
        recipients: financeRecipients,
        subject: financeSubject,
        text: financeBody,
        html: financeHtml,
        ...(financeAttachments.length > 0
          ? { extraAttachments: financeAttachments }
          : {}),
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
