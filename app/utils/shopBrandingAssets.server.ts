import { resolvePublicAppOrigin } from "./publicAppOrigin";

/**
 * Shop branding (nav logo + page background logo) is stored in `ShopSettings` as a base64 data
 * URL, up to ~2 MB each. Embedding those in app-proxy HTML cost that much on *every* page view,
 * twice over (once in the markup, once in the serialized loader payload), and could never be
 * cached because proxy HTML is `no-store`.
 *
 * Instead we hand the browser an absolute URL on the app origin, versioned by `ShopSettings
 * .updatedAt`, which `routes/project-clad-shop-asset.tsx` serves with immutable caching.
 */
export const PROJECT_CLAD_SHOP_ASSET_PATHNAME = "/project-clad-shop-asset";

export const SHOP_BRANDING_ASSET_KINDS = ["logo", "background"] as const;
export type ShopBrandingAssetKind = (typeof SHOP_BRANDING_ASSET_KINDS)[number];

export function isShopBrandingAssetKind(
  value: string | null,
): value is ShopBrandingAssetKind {
  return (
    value !== null &&
    (SHOP_BRANDING_ASSET_KINDS as readonly string[]).includes(value)
  );
}

export type ShopBrandingSettings = {
  logoDataUrl: string | null;
  backgroundLogoDataUrl: string | null;
  updatedAt: Date;
};

export function parseImageDataUrl(
  dataUrl: string,
): { bytes: Buffer; contentType: string } | null {
  const trimmed = dataUrl.trim();
  const marker = ";base64,";
  const idx = trimmed.toLowerCase().indexOf(marker);
  if (!trimmed.toLowerCase().startsWith("data:") || idx === -1) return null;

  /* MIME is the first segment before any `;` (e.g. `image/png` vs `image/png;charset=utf-8`). */
  const meta = trimmed.slice("data:".length, idx);
  const contentType = meta.split(";")[0]?.trim() || "image/png";
  if (!contentType.toLowerCase().startsWith("image/")) return null;

  try {
    const bytes = Buffer.from(
      trimmed.slice(idx + marker.length).replace(/\s/g, ""),
      "base64",
    );
    if (!bytes.length) return null;
    return { bytes, contentType };
  } catch {
    return null;
  }
}

function appOrigin(request: Request): string {
  const resolved = resolvePublicAppOrigin();
  if (resolved) return resolved;
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}

export type ShopBrandingUrls = {
  logoUrl: string | null;
  backgroundLogoUrl: string | null;
};

/**
 * Absolute, cache-busted URLs for the shop's branding images. Absolute because the surrounding
 * HTML is served from the shop's origin, where a relative path would hit the storefront.
 */
export function buildShopBrandingUrls(args: {
  request: Request;
  shop: string;
  settings: ShopBrandingSettings | null;
}): ShopBrandingUrls {
  const { request, shop, settings } = args;
  if (!settings) return { logoUrl: null, backgroundLogoUrl: null };

  const origin = appOrigin(request);
  const version = String(settings.updatedAt.getTime());

  const urlFor = (kind: ShopBrandingAssetKind) =>
    `${origin}${PROJECT_CLAD_SHOP_ASSET_PATHNAME}?shop=${encodeURIComponent(
      shop,
    )}&kind=${kind}&v=${version}`;

  return {
    logoUrl: settings.logoDataUrl ? urlFor("logo") : null,
    backgroundLogoUrl: settings.backgroundLogoDataUrl
      ? urlFor("background")
      : null,
  };
}
