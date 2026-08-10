import fs from "node:fs";
import path from "node:path";

/**
 * The shop slip is a standalone document served from the app origin, so its CSS
 * is inlined rather than linked — one request, no cross-origin font/stylesheet
 * concerns, and nothing shared with the proxy bundle.
 *
 * The file is stat'd per request (microseconds) and only re-read when it
 * actually changes, so print tweaks take effect on refresh without a rebuild.
 */
const SHOP_SLIP_CSS_PATH = path.join(
  process.cwd(),
  "app",
  "styles",
  "project-clad-shop-slip.css",
);

let cached: { css: string; stamp: string } | null = null;

function sourceStamp(): string {
  try {
    const stat = fs.statSync(SHOP_SLIP_CSS_PATH);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return "missing";
  }
}

export function getShopSlipStyles(): string {
  const stamp = sourceStamp();
  if (cached && cached.stamp === stamp) return cached.css;

  let css = "";
  try {
    css = fs.readFileSync(SHOP_SLIP_CSS_PATH, "utf8");
  } catch {
    css = "";
  }

  cached = { css, stamp };
  return css;
}
