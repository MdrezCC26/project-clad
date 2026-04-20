import crypto from "node:crypto";
import { resolvePublicAppOrigin } from "./publicAppOrigin";

const DEFAULT_TTL_SEC = 60 * 60 * 24 * 90; // 90 days

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
 * Signed URL for a mirrored line-item upload file (Shopify staged uploads are ephemeral).
 * Query: jobItemId, propIndex (stringified array index), exp, sig.
 */
export function buildSignedUploadPartFileUrl(args: {
  jobItemId: string;
  shop: string;
  propIndex: number;
}): string | null {
  const origin = resolvePublicAppOrigin();
  const secret = process.env.SHOPIFY_API_SECRET?.trim();
  if (!origin || !secret) {
    return null;
  }

  const exp = Math.floor(Date.now() / 1000) + DEFAULT_TTL_SEC;
  const shopNorm = normalizeShop(args.shop);
  const propKey = String(args.propIndex);
  const message = `${shopNorm}:${args.jobItemId}:${propKey}:${exp}`;
  const sig = crypto.createHmac("sha256", secret).update(message).digest("hex");

  let base: URL;
  try {
    base = new URL("/public/upload-part-file", `${origin}/`);
  } catch {
    return null;
  }
  base.searchParams.set("jobItemId", args.jobItemId);
  base.searchParams.set("propIndex", propKey);
  base.searchParams.set("exp", String(exp));
  base.searchParams.set("sig", sig);
  return base.toString();
}

export function verifySignedUploadPartFileParams(args: {
  jobItemId: string;
  shop: string;
  propIndexRaw: string;
  expRaw: string;
  sig: string;
}): boolean {
  const secret = process.env.SHOPIFY_API_SECRET?.trim();
  if (!secret) return false;

  const exp = parseInt(args.expRaw, 10);
  if (!Number.isFinite(exp) || Date.now() / 1000 > exp) {
    return false;
  }

  const shopNorm = normalizeShop(args.shop);
  const propKey = String(args.propIndexRaw);
  const message = `${shopNorm}:${args.jobItemId}:${propKey}:${args.expRaw}`;
  const expected = crypto.createHmac("sha256", secret).update(message).digest("hex");
  return timingSafeEqualHex(expected, args.sig);
}
