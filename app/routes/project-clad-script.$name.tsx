import type { LoaderFunctionArgs } from "react-router";

import {
  getProjectCladScript,
  isProjectCladScriptName,
} from "../utils/projectCladProxyScripts.server";

/**
 * Serves the vanilla browser scripts that drive app-proxy pages, which used to be inlined into
 * every HTML response. The `src` carries a `?v=<content hash>`, so the response can be cached
 * forever and editing a script simply produces a new URL.
 *
 * Served from the app origin, not through the app proxy, so it is not subject to the `no-store`
 * headers that app-proxy HTML needs. Classic `<script src>` is not CORS-restricted, so the
 * cross-origin load itself needs no preflight.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const name = params.name;
  if (!isProjectCladScriptName(name)) {
    return new Response("Not found", { status: 404 });
  }

  const { js, hash } = getProjectCladScript(name);
  const etag = `W/"${hash}"`;

  const headers = new Headers({
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: etag,
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
    Vary: "Accept-Encoding",
  });

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  headers.set("Content-Length", String(Buffer.byteLength(js, "utf8")));
  return new Response(js, { status: 200, headers });
};
