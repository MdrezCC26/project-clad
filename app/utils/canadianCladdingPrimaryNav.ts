/** Primary storefront header links (theme extension + app-proxy HTML header). */
export const CANADIAN_CLADDING_PRIMARY_NAV = [
  { key: "siding", label: "Siding", url: "/collections/main-products" },
  { key: "roofing", label: "Roofing", url: "/pages/roofing-shop" },
  { key: "glazing", label: "Glazing", url: "/pages/glazing-shop" },
  { key: "custom", label: "Custom", url: "/pages/custompart" },
  { key: "projects", label: "Projects", url: "/apps/project-clad/projects" },
] as const;

export type CanadianCladdingPrimaryNavKey =
  (typeof CANADIAN_CLADDING_PRIMARY_NAV)[number]["key"];

export const CANADIAN_CLADDING_TOPBAR_LINKS = {
  colours: "/pages/colours",
  contact: "/pages/contact",
} as const;

export function matchCanadianCladdingPrimaryNavActive(
  pathname: string,
  key: CanadianCladdingPrimaryNavKey,
  url: string,
): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (key === "projects") {
    return /\/project-clad\/(projects|project|work-orders)(\/|$)/.test(path);
  }
  if (key === "siding") {
    return path === url || path.startsWith(`${url}/`) || path.startsWith("/products/");
  }
  return path === url || path.startsWith(`${url}/`);
}
