/** Numeric ID from a Shopify Admin / Storefront GID (e.g. `gid://shopify/Product/123`). */
export function shopifyGidToLegacyNumericId(
  gid: string | null | undefined,
): string | null {
  if (!gid || typeof gid !== "string") return null;
  const m = gid.match(/\/(\d+)\s*$/);
  return m ? m[1] : null;
}
