import prisma from "../db.server";
import { getThemeStyles } from "./themeAssets.server";
import { projectCladProxyStylesHref } from "./projectCladProxyStyles.server";
import { buildShopBrandingUrls } from "./shopBrandingAssets.server";
import { getStorefrontAppNav } from "./storefrontAppNav";
import { shopStringFilter } from "./projectAccess.server";
import { getCustomersByIds } from "./adminCustomers.server";
import { normalizeStorefrontCustomerId } from "./customerTags.server";
import { countShapeCart } from "./shapeCart.server";
import { requireShapeCalculatorEnabled } from "./shapeFeature";

export async function loadShapeStorefrontChrome(args: {
  request: Request;
  shop: string;
  customerId?: string;
  customerEmail?: string;
}) {
  requireShapeCalculatorEnabled();
  const { request, shop, customerId, customerEmail } = args;
  const proxyStylesHref = projectCladProxyStylesHref(request);
  const [themeStyles, settings, shapeCartCount] = await Promise.all([
    getThemeStyles(shop),
    prisma.shopSettings.findFirst({ where: { shop: shopStringFilter(shop) } }),
    countShapeCart(shop, customerId),
  ]);
  const storefrontAppNav = getStorefrontAppNav(settings);
  const branding = buildShopBrandingUrls({ request, shop, settings });

  let navAccountInitial: string | null = null;
  let navAccountFirstName: string | null = null;
  if (customerId) {
    try {
      const numericId = normalizeStorefrontCustomerId(customerId);
      const customerInfo = await getCustomersByIds(shop, [numericId]);
      const viewer = customerInfo[numericId] ?? customerInfo[customerId];
      const fn = viewer?.firstName?.trim();
      navAccountFirstName = fn || null;
      navAccountInitial = fn
        ? fn.charAt(0).toUpperCase()
        : customerEmail?.trim()
          ? customerEmail.trim().charAt(0).toUpperCase()
          : null;
    } catch {
      /* public pages still render without account chip */
    }
  }

  return {
    proxyStylesHref,
    themeStyles,
    storefrontAppNav,
    logoUrl: branding.logoUrl,
    backgroundLogoUrl: branding.backgroundLogoUrl,
    navAccountInitial,
    navAccountFirstName,
    shapeCartCount,
  };
}
