import crypto from "node:crypto";

const COOKIE_NAME = "projectclad_pricing";
const MAX_AGE_SECONDS = 60 * 60;

type PricingAccessPayload = {
  shop: string;
  customerId: string;
  expiresAt: number;
};

function secret(): string {
  const value = process.env.SHOPIFY_API_SECRET?.trim();
  if (!value) throw new Error("Pricing access signing is not configured.");
  return value;
}

function signature(payload: string): string {
  return crypto
    .createHmac("sha256", secret())
    .update(payload)
    .digest("base64url");
}

function cookieValue(request: Request): string | null {
  const cookie = request.headers.get("Cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === COOKIE_NAME) return valueParts.join("=") || null;
  }
  return null;
}

export function createPricingAccessCookie(args: {
  shop: string;
  customerId: string;
}): string {
  const payload: PricingAccessPayload = {
    shop: args.shop.trim().toLowerCase(),
    customerId: args.customerId,
    expiresAt: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${COOKIE_NAME}=${encoded}.${signature(encoded)}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

export function hasPricingAccess(
  request: Request,
  args: { shop: string; customerId: string },
): boolean {
  try {
    const value = cookieValue(request);
    if (!value) return false;
    const separator = value.lastIndexOf(".");
    if (separator <= 0) return false;
    const encoded = value.slice(0, separator);
    const suppliedSignature = value.slice(separator + 1);
    const expectedSignature = signature(encoded);
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (
      supplied.length !== expected.length ||
      !crypto.timingSafeEqual(supplied, expected)
    ) {
      return false;
    }

    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<PricingAccessPayload>;
    return (
      payload.shop === args.shop.trim().toLowerCase() &&
      payload.customerId === args.customerId &&
      typeof payload.expiresAt === "number" &&
      payload.expiresAt >= Math.floor(Date.now() / 1000)
    );
  } catch {
    return false;
  }
}
