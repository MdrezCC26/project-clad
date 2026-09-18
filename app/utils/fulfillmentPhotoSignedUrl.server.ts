import crypto from "node:crypto";
import { resolvePublicAppOrigin } from "./publicAppOrigin";

function normalizeShop(shop: string) {
  return shop.trim().toLowerCase();
}

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a.toLowerCase(), "hex");
    const bb = Buffer.from(b.toLowerCase(), "hex");
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * Absolute URL on the app host (not the storefront) so links work when the store is
 * password-protected or opened outside a logged-in storefront session.
 */
function signedPhotoMessage(args: {
  shop: string;
  jobId: string;
  exp?: string;
  phaseId?: string;
}): string {
  const shopNorm = normalizeShop(args.shop);
  const resource = args.phaseId
    ? `${shopNorm}:${args.jobId}:${args.phaseId}`
    : `${shopNorm}:${args.jobId}`;
  if (args.exp) return `${resource}:${args.exp}`;
  if (args.phaseId) {
    return `${shopNorm}:${args.jobId}:${args.phaseId}`;
  }
  return `${shopNorm}:${args.jobId}`;
}

export function buildSignedFulfillmentPhotoUrl(args: {
  jobId: string;
  shop: string;
  phaseId?: string;
  /**
   * `image` — raw bytes (default, for `<img src>`).
   * `view` — HTML page wrapping the image (preferred for email links; avoids
   * Outlook’s raw-image loading chrome).
   */
  mode?: "image" | "view";
}): string | null {
  const origin = resolvePublicAppOrigin();
  const secret = process.env.SHOPIFY_API_SECRET?.trim();
  if (!origin || !secret) {
    return null;
  }

  const message = signedPhotoMessage({
    shop: args.shop,
    jobId: args.jobId,
    phaseId: args.phaseId,
  });
  const sig = crypto.createHmac("sha256", secret).update(message).digest("hex");

  const path =
    args.mode === "view"
      ? "/public/fulfillment-photo-view"
      : "/public/fulfillment-photo";

  let base: URL;
  try {
    base = new URL(path, `${origin}/`);
  } catch {
    return null;
  }
  base.searchParams.set("jobId", args.jobId);
  if (args.phaseId) {
    base.searchParams.set("phaseId", args.phaseId);
  }
  base.searchParams.set("sig", sig);
  return base.toString();
}

export function verifySignedFulfillmentPhotoParams(args: {
  jobId: string;
  shop: string;
  expRaw?: string;
  sig: string;
  phaseId?: string;
}): boolean {
  const secret = process.env.SHOPIFY_API_SECRET?.trim();
  if (!secret) return false;

  if (args.expRaw && !/^\d{10}$/.test(args.expRaw)) {
    return false;
  }

  const message = signedPhotoMessage({
    shop: args.shop,
    jobId: args.jobId,
    exp: args.expRaw || undefined,
    phaseId: args.phaseId,
  });
  const expected = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");
  return timingSafeEqualHex(expected, args.sig);
}
