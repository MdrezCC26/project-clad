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
