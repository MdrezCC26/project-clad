/** Live theme default (Horizon `cc_app_header` section). */
export const CANADIAN_CLADDING_STOREFRONT_LOGO_URL =
  "//canadiancladding.ca/cdn/shop/files/Logo_1_black.png?v=1763687318";

export function buildCanadianCladdingLogoSrcSet(baseUrl: string): string | undefined {
  if (!/\/cdn\/shop\/files\//.test(baseUrl)) return undefined;
  const bare = baseUrl.split("?")[0];
  const versionMatch = baseUrl.match(/[?&]v=([^&]+)/);
  const versionSuffix = versionMatch ? `?v=${versionMatch[1]}` : "";
  const widths = [200, 320, 480, 560, 800] as const;
  return widths
    .map((w) => `${bare}${versionSuffix}${versionSuffix ? "&" : "?"}width=${w} ${w}w`)
    .join(", ");
}
