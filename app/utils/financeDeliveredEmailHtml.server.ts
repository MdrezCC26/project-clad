import {
  buildBrandedEmailHtml,
  escapeEmailHtml,
  formatEmailDateTime,
  type BrandedEmailDetailRow,
} from "./brandedEmailHtml.server";

function formatMoney(amount: number): string {
  if (Number.isNaN(amount)) return "$0.00";
  return `$${amount.toFixed(2)}`;
}

export type BuildDeliveredConfirmationEmailHtmlArgs = {
  hasLogo: boolean;
  isDelivery: boolean;
  completedAt?: Date | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  companyName: string;
  projectName: string;
  orderName: string;
  orderNumber: number | null | undefined;
  projectNumber: string;
  poNumber: string;
  shipToLines: string[];
  /** Only when more than one delivery has been made on this order. */
  orderDeliveredPercent?: number | null;
  showOrderProgress?: boolean;
  /** Finance only — subtotal / delivery / tax / total box. */
  includePriceBox?: boolean;
  subtotal?: number;
  deliveryLabel?: string;
  deliveryFee?: number;
  tax?: number;
  total?: number;
  projectOrderUrl: string;
  /** Signed absolute URL that serves the delivery photo bytes (not the documents tab). */
  deliveryPhotoUrl?: string | null;
  packingSlipUrl?: string | null;
  title?: string;
  preheader?: string;
};

function totalsRow(label: string, value: string, emphasize = false): string {
  return `
    <tr>
      <td style="padding:6px 0; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:${emphasize ? "15px" : "14px"}; color:${emphasize ? "#1E2124" : "#5A5F66"}; font-weight:${emphasize ? "700" : "400"};">
        ${escapeEmailHtml(label)}
      </td>
      <td align="right" style="padding:6px 0; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:${emphasize ? "15px" : "14px"}; color:#1E2124; font-weight:${emphasize ? "700" : "600"};">
        ${escapeEmailHtml(value)}
      </td>
    </tr>`;
}

/**
 * Delivered confirmation — branded shell shared by customer + finance.
 * Finance sets `includePriceBox: true`; customer omits the totals box.
 */
export function buildDeliveredConfirmationEmailHtml(
  args: BuildDeliveredConfirmationEmailHtmlArgs,
): string {
  const completed =
    args.completedAt != null
      ? formatEmailDateTime(args.completedAt)
      : formatEmailDateTime(new Date());

  const orderValue =
    args.orderNumber != null
      ? `${escapeEmailHtml(args.orderName)} &nbsp;<span style="color:#9A968D; font-weight:400;">#${escapeEmailHtml(String(args.orderNumber))}</span>`
      : escapeEmailHtml(args.orderName);

  const shipValue = args.isDelivery
    ? args.shipToLines.length
      ? args.shipToLines.map((l) => escapeEmailHtml(l)).join("<br>")
      : "(not on file)"
    : "Store pickup";

  const detailRows: BrandedEmailDetailRow[] = [
    { label: "Customer", value: args.customerName },
    { label: "Email", value: args.customerEmail },
    { label: "Phone", value: args.customerPhone },
  ];

  const company = args.companyName.trim();
  if (company && company !== "—") {
    detailRows.push({ label: "Company", value: company });
  }

  detailRows.push(
    { label: "Project", value: args.projectName },
    { label: "Order", value: orderValue, html: true },
    { label: "Project #", value: args.projectNumber || "—" },
    { label: "PO Number", value: args.poNumber || "—" },
    {
      label: args.isDelivery ? "Ship to" : "Fulfillment",
      value: shipValue,
      html: true,
    },
    {
      label: args.isDelivery ? "Delivered" : "Picked up",
      value: completed,
    },
  );

  const showProgress =
    Boolean(args.showOrderProgress) &&
    args.orderDeliveredPercent != null;

  const progressHtml = showProgress
    ? `<p style="margin:0 0 ${args.includePriceBox ? "16px" : "0"} 0; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:13px; color:#5A5F66;">Order progress: ${args.orderDeliveredPercent}% delivered overall.</p>`
    : "";

  const priceBoxHtml = args.includePriceBox
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E4E1DA; border-radius:4px;">
              <tr>
                <td style="padding:16px 24px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    ${totalsRow("Subtotal", formatMoney(args.subtotal ?? 0))}
                    ${totalsRow(args.deliveryLabel ?? "Delivery", formatMoney(args.deliveryFee ?? 0))}
                    ${totalsRow("Tax", formatMoney(args.tax ?? 0))}
                    ${totalsRow("Total", formatMoney(args.total ?? 0), true)}
                  </table>
                </td>
              </tr>
            </table>`
    : "";

  const bodyHtml =
    progressHtml || priceBoxHtml
      ? `${progressHtml}${priceBoxHtml}`
      : undefined;

  const ctas: { href: string; label: string }[] = [
    { href: args.projectOrderUrl, label: "Open order" },
  ];
  if (args.deliveryPhotoUrl?.trim()) {
    ctas.push({
      href: args.deliveryPhotoUrl.trim(),
      label: "View delivery photo",
    });
  }
  if (args.packingSlipUrl?.trim()) {
    ctas.push({ href: args.packingSlipUrl.trim(), label: "View packing slip" });
  }

  const headline = `${args.orderName} has been delivered!`;
  const subcopy = args.includePriceBox
    ? `${args.orderName} has been delivered. Click Open order to view your order details. Thank you for using Canadian Cladding!`
    : `${args.orderName} has been delivered. An invoice will be sent shortly. Click Open order to view your order details. Thank you for using Canadian Cladding!`;

  return buildBrandedEmailHtml({
    title: args.title ?? "Order complete",
    preheader:
      args.preheader ??
      `${args.orderName} has been delivered — ${args.projectName}`,
    headline,
    subcopy,
    detailRows,
    bodyHtml,
    ctas,
    hasLogo: args.hasLogo,
  });
}

/** @deprecated Prefer `buildDeliveredConfirmationEmailHtml` with `includePriceBox: true`. */
export function buildFinanceDeliveredEmailHtml(
  args: Omit<BuildDeliveredConfirmationEmailHtmlArgs, "includePriceBox">,
): string {
  return buildDeliveredConfirmationEmailHtml({
    ...args,
    includePriceBox: true,
    title: args.title ?? "Finance — order complete",
    preheader:
      args.preheader ?? `Invoice for ${args.projectName} · ${args.orderName}`,
  });
}

export function buildCustomerDeliveredEmailHtml(
  args: Omit<
    BuildDeliveredConfirmationEmailHtmlArgs,
    | "includePriceBox"
    | "subtotal"
    | "deliveryLabel"
    | "deliveryFee"
    | "tax"
    | "total"
  >,
): string {
  return buildDeliveredConfirmationEmailHtml({
    ...args,
    includePriceBox: false,
    title: args.title ?? "Your order is complete",
  });
}

export type OrderPlacedLineItem = {
  displayName: string;
  quantity: number;
  unit?: number;
  lineTotal?: number;
  properties?: { name: string; value: string }[];
  /** Hosted http(s) product / profile diagram — never a data URI. */
  imageUrl?: string | null;
};

export type BuildOrderPlacedEmailHtmlArgs = {
  hasLogo: boolean;
  isDelivery: boolean;
  placedAt?: Date | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  companyName: string;
  projectName: string;
  orderName: string;
  orderNumber: number | null | undefined;
  projectNumber: string;
  poNumber: string;
  shipToLines: string[];
  requestedDelivery?: string | null;
  /** Shop only — shown when staff placed on the customer's behalf. */
  placedByName?: string | null;
  placedByEmail?: string | null;
  placedByPhone?: string | null;
  includePriceBox?: boolean;
  subtotal?: number;
  deliveryLabel?: string;
  deliveryFee?: number;
  tax?: number;
  total?: number;
  /** Shop copy lists production lines without prices. */
  lineItems?: OrderPlacedLineItem[];
  showLineItemPrices?: boolean;
  projectOrderUrl: string;
  title?: string;
  preheader?: string;
  headline?: string;
  subcopy?: string;
};

function emailSafeImageUrl(url: string | null | undefined): string | null {
  const t = (url || "").trim();
  if (!t || t.startsWith("data:")) return null;
  const href = t.startsWith("//") ? `https:${t}` : t;
  if (!/^https?:\/\//i.test(href)) return null;
  try {
    const parsed = new URL(href);
    if (
      parsed.hostname.includes("cdn.shopify.com") ||
      parsed.hostname.endsWith(".myshopify.com") ||
      parsed.pathname.includes("/cdn/shop/")
    ) {
      parsed.searchParams.set("width", "160");
    }
    return parsed.toString();
  } catch {
    return href;
  }
}

function isEmailSpecProperty(name: string, value: string): boolean {
  const n = name.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (
    (n.includes("reference") && n.includes("image")) ||
    n === "referenceimage" ||
    n === "file" ||
    n === "image" ||
    n === "upload"
  ) {
    return false;
  }
  if (/^https?:\/\//i.test(value) || value.startsWith("//")) return false;
  return true;
}

function lineItemSpecRows(
  properties: { name: string; value: string }[],
): string {
  const rows = properties.filter((p) => isEmailSpecProperty(p.name, p.value));
  if (!rows.length) return "";
  return rows
    .map(
      (p, i) => `
                      <tr>
                        <td style="padding:${i === 0 ? "10px" : "3px"} 12px 0 0; font-family:'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size:11px; letter-spacing:0.4px; text-transform:uppercase; color:#9A968D; white-space:nowrap; vertical-align:top;">${escapeEmailHtml(p.name)}</td>
                        <td class="email-muted" style="padding:${i === 0 ? "10px" : "3px"} 0 0 0; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:13px; color:#5A5F66; vertical-align:top;">${escapeEmailHtml(p.value)}</td>
                      </tr>`,
    )
    .join("");
}

function lineItemsHtml(
  items: OrderPlacedLineItem[],
  showPrices: boolean,
): string {
  if (!items.length) return "";
  const cards = items
    .map((item, i) => {
      const thumb = emailSafeImageUrl(item.imageUrl);
      const thumbBlock = thumb
        ? `<img src="${escapeEmailHtml(thumb)}" width="64" height="64" alt="" style="display:block; width:64px; height:64px; object-fit:contain; background-color:#FFFFFF; border:1px solid #E4E1DA; border-radius:4px;">`
        : `<div style="width:64px; height:64px; border:1px solid #E4E1DA; border-radius:4px; background-color:#FFFFFF;">&nbsp;</div>`;
      const qtyLabel = `Qty ${item.quantity}`;
      const unitLabel = showPrices ? `${formatMoney(item.unit ?? 0)} each` : "";
      const totalLabel = showPrices ? formatMoney(item.lineTotal ?? 0) : "";
      const specRows = lineItemSpecRows(item.properties ?? []);
      return `
            <table role="presentation" class="email-line-card email-card-bg" width="100%" cellpadding="0" cellspacing="0" bgcolor="#EEECE7" style="${i > 0 ? "margin-top:12px;" : ""} border:1px solid #E4E1DA; border-radius:4px; background-color:#EEECE7;">
              <tr>
                <td bgcolor="#EEECE7" style="padding:16px 16px 14px 16px; background-color:#EEECE7;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td valign="top" width="76" style="width:76px; padding-right:12px;">
                        ${thumbBlock}
                      </td>
                      <td valign="top" class="email-text" style="font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">
                        <p class="email-text" style="margin:0; font-size:15px; line-height:20px; font-weight:700; color:#1E2124;">${escapeEmailHtml(item.displayName)}</p>
                        <p class="email-muted" style="margin:6px 0 0 0; font-size:13px; color:#5A5F66;">${escapeEmailHtml(qtyLabel)}${unitLabel ? ` &nbsp;·&nbsp; ${escapeEmailHtml(unitLabel)}` : ""}</p>
                      </td>
                      ${
                        totalLabel
                          ? `<td valign="top" align="right" class="email-text" style="padding-left:12px; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:15px; font-weight:700; color:#1E2124; white-space:nowrap;">${escapeEmailHtml(totalLabel)}</td>`
                          : ""
                      }
                    </tr>
                    ${
                      specRows
                        ? `<tr>
                      <td colspan="${totalLabel ? "3" : "2"}">
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                          ${specRows}
                        </table>
                      </td>
                    </tr>`
                        : ""
                    }
                  </table>
                </td>
              </tr>
            </table>`;
    })
    .join("");
  return cards;
}

/**
 * Order-placed confirmation — same cream/card/CTA shell as delivered.
 * Customer includes the totals box; shop lists line items without prices.
 */
export function buildOrderPlacedEmailHtml(
  args: BuildOrderPlacedEmailHtmlArgs,
): string {
  const placed =
    args.placedAt != null
      ? formatEmailDateTime(args.placedAt)
      : formatEmailDateTime(new Date());

  const orderValue =
    args.orderNumber != null
      ? `${escapeEmailHtml(args.orderName)} &nbsp;<span style="color:#9A968D; font-weight:400;">#${escapeEmailHtml(String(args.orderNumber))}</span>`
      : escapeEmailHtml(args.orderName);

  const shipValue = args.isDelivery
    ? args.shipToLines.length
      ? args.shipToLines.map((l) => escapeEmailHtml(l)).join("<br>")
      : "(not on file)"
    : "Store pickup";

  const detailRows: BrandedEmailDetailRow[] = [
    { label: "Customer", value: args.customerName },
    { label: "Email", value: args.customerEmail },
    { label: "Phone", value: args.customerPhone },
  ];

  const company = args.companyName.trim();
  if (company && company !== "—") {
    detailRows.push({ label: "Company", value: company });
  }

  const placerName = (args.placedByName ?? "").trim();
  if (placerName && placerName !== args.customerName.trim()) {
    const placerBits = [
      placerName,
      (args.placedByEmail ?? "").trim(),
      (args.placedByPhone ?? "").trim(),
    ].filter((v) => v && v !== "—");
    detailRows.push({
      label: "Placed by",
      value: placerBits.map((v) => escapeEmailHtml(v)).join("<br>"),
      html: true,
    });
  }

  detailRows.push(
    { label: "Project", value: args.projectName },
    { label: "Order", value: orderValue, html: true },
    { label: "Project #", value: args.projectNumber || "—" },
    { label: "PO Number", value: args.poNumber || "—" },
    {
      label: args.isDelivery ? "Ship to" : "Fulfillment",
      value: shipValue,
      html: true,
    },
    { label: "Placed", value: placed },
  );

  const requested = (args.requestedDelivery ?? "").trim();
  if (requested) {
    detailRows.push({ label: "Requested", value: requested });
  }

  const priceBoxHtml = args.includePriceBox
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E4E1DA; border-radius:4px;">
              <tr>
                <td style="padding:16px 24px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    ${totalsRow("Subtotal", formatMoney(args.subtotal ?? 0))}
                    ${totalsRow(args.deliveryLabel ?? "Delivery", formatMoney(args.deliveryFee ?? 0))}
                    ${totalsRow("Tax", formatMoney(args.tax ?? 0))}
                    ${totalsRow("Total", formatMoney(args.total ?? 0), true)}
                  </table>
                </td>
              </tr>
            </table>`
    : "";

  const itemsHtml =
    args.lineItems?.length
      ? `<p class="email-label" style="margin:0 0 10px 0; font-family:'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size:11px; letter-spacing:0.5px; text-transform:uppercase; color:#9A968D;">Items</p>${lineItemsHtml(args.lineItems, Boolean(args.showLineItemPrices))}`
      : "";

  const bodyHtml =
    itemsHtml || priceBoxHtml
      ? `${itemsHtml}${itemsHtml && priceBoxHtml ? `<div style="height:16px;font-size:0;line-height:0;">&nbsp;</div>` : ""}${priceBoxHtml}`
      : undefined;

  const headline = args.headline ?? `${args.orderName} has been placed!`;
  const subcopy =
    args.subcopy ??
    `${args.orderName} has been placed. Click Open order to view your order details. Thank you for using Canadian Cladding!`;

  return buildBrandedEmailHtml({
    title: args.title ?? "Order placed",
    preheader:
      args.preheader ?? `${args.orderName} has been placed — ${args.projectName}`,
    headline,
    subcopy,
    detailRows,
    bodyHtml,
    ctas: [{ href: args.projectOrderUrl, label: "Open order" }],
    hasLogo: args.hasLogo,
  });
}
