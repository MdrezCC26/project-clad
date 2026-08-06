import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { resolvePublicAppOrigin } from "./publicAppOrigin";

/**
 * App proxy HTML is shown on the **storefront** origin, but this stylesheet is served from the
 * **app** origin (see `routes/project-clad-proxy[.]css.tsx`). Relative `url("/fonts/...")` values
 * therefore resolve against the app host automatically — no rewriting needed.
 *
 * Cross-origin @font-face loads still use the *document* origin (the shop) for CORS, and our
 * static server does not send `Access-Control-Allow-Origin`, so Nulshock is **inlined as a
 * data: URL** when `public/fonts/nulshock/nulshock-bd.woff2` exists — no font request, no CORS.
 *
 * The bundle is built once and reused. Sources are stat'd per request (microseconds) so editing
 * CSS in dev produces a new hash, a new URL, and an immediate refetch without a Vite restart.
 */
const NULSHOCK_FACE =
  /url\("\/fonts\/nulshock\/nulshock-bd\.woff2"\)\s*format\("woff2"\),\s*url\("\/fonts\/nulshock\/nulshock-bd\.woff"\)\s*format\("woff"\)/;

export const PROJECT_CLAD_PROXY_STYLES_PATHNAME = "/project-clad-proxy.css";

const STYLE_FILES = ["project-clad-proxy.css", "cc-storefront-header.css"];

const styleFilePath = (relFromApp: string) =>
  path.join(process.cwd(), "app", "styles", relFromApp);

const NULSHOCK_WOFF2_PATH = path.join(
  process.cwd(),
  "public",
  "fonts",
  "nulshock",
  "nulshock-bd.woff2",
);

function withInlinedNulshock(css: string): string {
  try {
    const buf = fs.readFileSync(NULSHOCK_WOFF2_PATH);
    const dataUrl = `url("data:font/woff2;base64,${buf.toString("base64")}") format("woff2")`;
    return css.replace(NULSHOCK_FACE, dataUrl);
  } catch {
    return css;
  }
}

/** Cheap change detector so a rebuild only happens when a source file actually changed. */
function sourceStamp(): string {
  const parts: string[] = [];
  for (const file of [...STYLE_FILES.map(styleFilePath), NULSHOCK_WOFF2_PATH]) {
    try {
      const stat = fs.statSync(file);
      parts.push(`${stat.size}:${stat.mtimeMs}`);
    } catch {
      parts.push("missing");
    }
  }
  return parts.join("|");
}

export type ProjectCladProxyStyles = {
  css: string;
  /** Content hash, used as the `?v=` cache buster so the URL can be cached immutably. */
  hash: string;
};

let cached: (ProjectCladProxyStyles & { stamp: string }) | null = null;

export function getProjectCladProxyStyles(): ProjectCladProxyStyles {
  const stamp = sourceStamp();
  if (cached && cached.stamp === stamp) {
    return { css: cached.css, hash: cached.hash };
  }

  const css = withInlinedNulshock(
    STYLE_FILES.map((file) => fs.readFileSync(styleFilePath(file), "utf8")).join(
      "\n",
    ),
  );
  const hash = crypto
    .createHash("sha256")
    .update(css)
    .digest("hex")
    .slice(0, 16);

  cached = { css, hash, stamp };
  return { css, hash };
}

/**
 * Absolute URL to the proxy stylesheet on the app origin. Absolute because the surrounding HTML
 * is served from the shop's origin, where a relative path would 404.
 */
export function projectCladProxyStylesHref(request: Request): string {
  const { hash } = getProjectCladProxyStyles();

  let origin = resolvePublicAppOrigin();
  if (!origin) {
    try {
      origin = new URL(request.url).origin;
    } catch {
      origin = "";
    }
  }

  return `${origin}${PROJECT_CLAD_PROXY_STYLES_PATHNAME}?v=${hash}`;
}
