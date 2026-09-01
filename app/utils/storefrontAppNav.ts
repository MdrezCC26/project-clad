/**
 * Storefront-style nav for app-proxy pages: same relative URLs as the Shopify storefront
 * (e.g. /, /cart, /search, /account). Shared module (not .server) so admin settings UI can import it.
 */

import type { StorefrontAppNavLink } from "../types/storefrontAppNav";
import { filterShapeLinksFromNav } from "./shapeFeature";
export type { StorefrontAppNavLink };
export type ShopSettingsNavSlice = {
  navButton1Label: string | null;
  navButton1Url: string | null;
  navButton2Label: string | null;
  navButton2Url: string | null;
  navButton3Label: string | null;
  navButton3Url: string | null;
  storefrontNavLinksJson: string | null;
};

/** Example for admin placeholder — Canadian Cladding storefront paths (same host as app proxy). */
export const STOREFRONT_APP_NAV_JSON_PLACEHOLDER = `[
  { "label": "SIDING", "url": "/collections/main-products" },
  { "label": "ROOFING", "url": "/pages/roofing-shop" },
  { "label": "GLAZING", "url": "/pages/glazing-shop" },
  { "label": "CUSTOM", "url": "/pages/custompart" },
  { "label": "PROJECTS", "url": "/apps/project-clad/projects" },
  { "label": "COLOURS", "url": "/pages/colours" },
  { "label": "CONTACT", "url": "/pages/contact" }
]`;

export function parseStorefrontNavLinksJson(
  raw: string | null | undefined,
): StorefrontAppNavLink[] | null {
  if (!raw?.trim()) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v) || v.length === 0) return null;
    const out: StorefrontAppNavLink[] = [];
    for (const item of v) {
      if (!item || typeof item !== "object") continue;
      const label = String(
        (item as { label?: unknown }).label ?? "",
      ).trim();
      const url = String((item as { url?: unknown }).url ?? "").trim();
      if (!label || !url) continue;
      out.push({ label, url });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * When no JSON override: full menu like the storefront header, using nav button 1–3 where they fit
 * (Projects / Shop / Cart) and sensible defaults for other links. Edit URLs in Admin → JSON override
 * if paths differ from your theme.
 */
export function defaultStorefrontAppNavLinks(
  settings: ShopSettingsNavSlice,
): StorefrontAppNavLink[] {
  const projectsLabel = (settings.navButton1Label || "PROJECTS").trim();
  const projectsUrl =
    settings.navButton1Url?.trim() || "/apps/project-clad/projects";
  const sidingLabel = (settings.navButton2Label || "SIDING").trim();
  const sidingUrl =
    settings.navButton2Url?.trim() || "/collections/main-products";

  return [
    { label: sidingLabel.toUpperCase(), url: sidingUrl },
    { label: "ROOFING", url: "/pages/roofing-shop" },
    { label: "GLAZING", url: "/pages/glazing-shop" },
    { label: "CUSTOM", url: "/pages/custompart" },
    { label: projectsLabel.toUpperCase(), url: projectsUrl },
    { label: "COLOURS", url: "/pages/colours" },
    { label: "CONTACT", url: "/pages/contact" },
  ];
}

export function getStorefrontAppNav(settings: ShopSettingsNavSlice | null): {
  links: StorefrontAppNavLink[];
  cartUrl: string;
  searchUrl: string;
  accountUrl: string;
} {
  const slice: ShopSettingsNavSlice = settings ?? {
    navButton1Label: null,
    navButton1Url: null,
    navButton2Label: null,
    navButton2Url: null,
    navButton3Label: null,
    navButton3Url: null,
    storefrontNavLinksJson: null,
  };
  const parsed = parseStorefrontNavLinksJson(slice.storefrontNavLinksJson);
  const links = filterShapeLinksFromNav(
    parsed ?? defaultStorefrontAppNavLinks(slice),
  );
  const cartUrl = slice.navButton3Url?.trim() || "/cart";
  return {
    links,
    cartUrl,
    searchUrl: "/search",
    accountUrl: "/account",
  };
}
