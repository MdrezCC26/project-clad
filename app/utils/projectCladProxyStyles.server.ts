import fs from "node:fs";
import path from "node:path";
import proxyStylesRaw from "../styles/project-clad-proxy.css?raw";

/**
 * App proxy HTML is shown on the **storefront** origin. Remaining `url("/fonts/...")` values
 * must use the app host or the browser requests the shop and gets 404.
 *
 * Cross-origin @font-face loads (store page → app URL) require **Access-Control-Allow-Origin**
 * on the font response; our static server does not send that, so fonts were blocked silently.
 * Nulshock is therefore **inlined as a data: URL** when `public/fonts/nulshock/nulshock-bd.woff2`
 * exists — no separate font request, no CORS.
 */
const NULSHOCK_FACE = /url\("\/fonts\/nulshock\/nulshock-bd\.woff2"\)\s*format\("woff2"\),\s*url\("\/fonts\/nulshock\/nulshock-bd\.woff"\)\s*format\("woff"\)/;

function withInlinedNulshock(css: string): string {
  const abs = path.join(
    process.cwd(),
    "public",
    "fonts",
    "nulshock",
    "nulshock-bd.woff2",
  );
  try {
    const buf = fs.readFileSync(abs);
    const dataUrl = `url("data:font/woff2;base64,${buf.toString("base64")}") format("woff2")`;
    return css.replace(NULSHOCK_FACE, dataUrl);
  } catch {
    return css;
  }
}

const proxyStylesBase = withInlinedNulshock(proxyStylesRaw);

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
  return proxyStylesBase.replaceAll('url("/fonts/', `url("${origin}/fonts/`);
}
