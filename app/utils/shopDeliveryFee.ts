/** Used when ShopSettings.deliveryFeeAmount is null. */
export const DEFAULT_SHOP_DELIVERY_FEE = 15;

export function parseDeliveryFeeFromForm(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 999_999) return null;
  return Math.round(n * 100) / 100;
}
