import type { LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";
import { shopStringFilter } from "../utils/projectAccess.server";
import {
  isShopBrandingAssetKind,
  parseImageDataUrl,
} from "../utils/shopBrandingAssets.server";

/**
 * Serves the shop's branding images (nav logo, page background logo) that used to be inlined as
 * multi-megabyte base64 data URLs in every app-proxy HTML response.
 *
 * Unauthenticated on purpose: this is the same branding already shown publicly on the storefront,
 * and the response must be loadable as a plain `<img>`/CSS `url()` from the shop's origin without
 * an app-proxy signature — that is what makes it cacheable.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop")?.trim();
  const kind = url.searchParams.get("kind");

  if (!shop || !isShopBrandingAssetKind(kind)) {
    return new Response("Not found", { status: 404 });
  }

  const settings = await prisma.shopSettings.findFirst({
    where: { shop: shopStringFilter(shop) },
    select: { logoDataUrl: true, backgroundLogoDataUrl: true, updatedAt: true },
  });

  const dataUrl =
    kind === "logo" ? settings?.logoDataUrl : settings?.backgroundLogoDataUrl;
  const image = dataUrl ? parseImageDataUrl(dataUrl) : null;
  if (!image) {
    return new Response("Not found", { status: 404 });
  }

  const etag = `W/"${kind}-${settings?.updatedAt.getTime() ?? 0}-${image.bytes.length}"`;
  const headers = new Headers({
    "Content-Type": image.contentType,
    /* Safe to cache forever: the `?v=` token changes whenever ShopSettings is updated. */
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: etag,
    "Access-Control-Allow-Origin": "*",
  });

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  headers.set("Content-Length", String(image.bytes.length));
  return new Response(new Uint8Array(image.bytes), { status: 200, headers });
};
