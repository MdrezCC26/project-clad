/** Primary storefront header links (theme extension + app-proxy HTML header). */
import { SHAPE_CALCULATOR_ENABLED } from "./shapeFeature";

export const CANADIAN_CLADDING_SHAPE_NAV = [
  {
    key: "templates",
    label: "Templates",
    url: "/apps/project-clad/shape-templates",
  },
  {
    key: "builder",
    label: "Builder",
    url: "/apps/project-clad/shape-builder",
  },
  {
    key: "profiles",
    label: "Profiles",
    url: "/apps/project-clad/shape-library",
  },
  {
    key: "shapeCart",
    label: "Parts cart",
    url: "/apps/project-clad/shape-cart",
  },
] as const;

export type CanadianCladdingShapeNavKey =
  (typeof CANADIAN_CLADDING_SHAPE_NAV)[number]["key"];

/**
 * Main bar order: calculator pages, optional shape destinations, then Projects.
 */
export const CANADIAN_CLADDING_PRIMARY_NAV = [
  { key: "siding", label: "Siding", url: "/pages/siding-calculators" },
  { key: "roofing", label: "Roofing", url: "/pages/roofing-calculators" },
  { key: "glazing", label: "Glazing", url: "/pages/glazing-calculators" },
  ...(SHAPE_CALCULATOR_ENABLED ? CANADIAN_CLADDING_SHAPE_NAV : []),
  { key: "projects", label: "Projects", url: "/apps/project-clad/projects" },
] as const;

export type CanadianCladdingPrimaryNavKey =
  (typeof CANADIAN_CLADDING_PRIMARY_NAV)[number]["key"];

export const CANADIAN_CLADDING_TOPBAR_LINKS = {
  colours: "/pages/colours",
  contact: "/pages/contact",
} as const;

/** Legacy customer accounts logout (matches Shopify storefront). */
export const CANADIAN_CLADDING_ACCOUNT_LOGOUT_URL = "/account/logout";

export function matchCanadianCladdingShapeNavActive(
  pathname: string,
  key: CanadianCladdingShapeNavKey,
): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (key === "templates") {
    return /\/project-clad\/shape-templates(\/|$)/.test(path);
  }
  if (key === "builder") {
    return /\/project-clad\/shape-builder(\/|$)/.test(path);
  }
  if (key === "profiles") {
    return /\/project-clad\/shape-library(\/|$)/.test(path);
  }
  return /\/project-clad\/shape-cart(\/|$)/.test(path);
}

export function matchCanadianCladdingPrimaryNavActive(
  pathname: string,
  key: CanadianCladdingPrimaryNavKey,
  url: string,
): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (key === "projects") {
    return /\/project-clad\/(projects|project|work-orders)(\/|$)/.test(path);
  }
  if (
    key === "templates" ||
    key === "builder" ||
    key === "profiles" ||
    key === "shapeCart"
  ) {
    return matchCanadianCladdingShapeNavActive(pathname, key);
  }
  return path === url || path.startsWith(`${url}/`);
}
