import type { LoaderFunctionArgs } from "react-router";

import { getProjectCladProxyStyles } from "../utils/projectCladProxyStyles.server";

/**
 * Storefront (app proxy) pages link to this stylesheet instead of inlining ~665KB of CSS into
 * every HTML response. The href carries a `?v=<content hash>`, so the response can be cached
 * forever and a CSS edit simply produces a new URL.
 *
 * Served from the app origin, not through the app proxy, so it is not subject to the `no-store`
 * headers that app-proxy HTML needs. Stylesheets are not CORS-restricted, so no preflight is
 * involved in the `<link>` load itself.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { css, hash } = getProjectCladProxyStyles();
  const etag = `W/"${hash}"`;

  const headers = new Headers({
    "Content-Type": "text/css; charset=utf-8",
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: etag,
    /* Harmless for <link>, but lets the CSS also be fetched from JS if ever needed. */
    "Access-Control-Allow-Origin": "*",
    Vary: "Accept-Encoding",
  });

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  headers.set("Content-Length", String(Buffer.byteLength(css, "utf8")));
  return new Response(css, { status: 200, headers });
};
