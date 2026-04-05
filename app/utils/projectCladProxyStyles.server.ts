import proxyStylesRaw from "../styles/project-clad-proxy.css?raw";

/**
 * App proxy HTML is shown on the storefront origin; `url("/fonts/...")` in inlined
 * `<style>` would request the shop, not the app. Point @font-face at the app host.
 */
export function rewriteProjectCladProxyFontUrls(request: Request): string {
  let origin: string;
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (appUrl) {
    try {
      origin = new URL(appUrl).origin;
    } catch {
      origin = new URL(request.url).origin;
    }
  } else {
    origin = new URL(request.url).origin;
  }
  return proxyStylesRaw.replaceAll('url("/fonts/', `url("${origin}/fonts/`);
}
