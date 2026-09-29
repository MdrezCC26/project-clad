import type { Config } from "@react-router/dev/config";

function hostFromUrl(raw: string | undefined): string | null {
  const v = raw?.trim();
  if (!v) return null;
  try {
    return new URL(v.includes("://") ? v : `https://${v}`).host;
  } catch {
    return null;
  }
}

const envHosts = [
  hostFromUrl(process.env.SHOPIFY_APP_URL),
  hostFromUrl(process.env.HOST),
].filter((h): h is string => Boolean(h));

export default {
  /**
   * React Router 7 CSRF: Origin must match `request.url` or this list.
   * Storefront app-proxy POSTs come from the shop domain while the app
   * serves from Render. Admin photo uploads POST from the app origin
   * (`project-clad.onrender.com`); omitting that host 400s `/app/work-orders.data`.
   */
  allowedActionOrigins: [
    "canadiancladding.ca",
    "www.canadiancladding.ca",
    "rnc2a0-d3.myshopify.com",
    "project-clad.onrender.com",
    "*.onrender.com",
    ...envHosts,
  ],
} satisfies Config;
