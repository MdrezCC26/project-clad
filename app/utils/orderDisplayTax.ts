/**
 * Display-only tax rate for storefront order summaries (not persisted).
 * Matches typical Ontario HST; used only when {@link ORDER_LINE_PRICES_INCLUDE_DISPLAY_TAX} is false.
 */
export const ORDER_DISPLAY_TAX_RATE = 0.13;

/**
 * Line `priceSnapshot` values come from `/cart.js` and are tax-inclusive. The **project** footer
 * uses this so we do not add another HST line on subtotal + delivery. Per-order tables can still
 * pass `{ pricesIncludeTax: false }` to show the classic subtotal + tax + total breakdown.
 */
export const ORDER_LINE_PRICES_INCLUDE_DISPLAY_TAX = true;

export type OrderDisplayTaxOptions = {
  /**
   * `true` — subtotal already includes tax; display tax as $0.
   * `false` — apply {@link ORDER_DISPLAY_TAX_RATE} on top of subtotal (per-order line summary).
   * omitted — use {@link ORDER_LINE_PRICES_INCLUDE_DISPLAY_TAX} (project-level default).
   */
  pricesIncludeTax?: boolean;
};

export function orderTaxFromSubtotal(
  subtotal: number,
  options?: OrderDisplayTaxOptions,
): number {
  const inclusive =
    options?.pricesIncludeTax !== undefined
      ? options.pricesIncludeTax
      : ORDER_LINE_PRICES_INCLUDE_DISPLAY_TAX;
  if (inclusive) return 0;
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;
  return Math.round(subtotal * ORDER_DISPLAY_TAX_RATE * 100) / 100;
}

export function orderTotalWithTax(
  subtotal: number,
  options?: OrderDisplayTaxOptions,
): number {
  const tax = orderTaxFromSubtotal(subtotal, options);
  return Math.round((subtotal + tax) * 100) / 100;
}
