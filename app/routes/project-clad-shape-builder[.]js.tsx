import type { LoaderFunctionArgs } from "react-router";
import { getShapeBuilderIsland } from "../utils/shapeBuilderIsland.server";
import { requireShapeCalculatorEnabled } from "../utils/shapeFeature";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  requireShapeCalculatorEnabled();
  const { js, hash } = getShapeBuilderIsland();
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
