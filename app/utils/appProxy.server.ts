import crypto from "node:crypto";
import { redirect } from "react-router";

export type AppProxyContext = {
  shop: string;
  customerId?: string;
  customerEmail?: string;
  returnPath: string;
  formActionUrl: string;
};

/** After {@link requireAppProxyCustomer} succeeds, the logged-in customer id is always set. */
export type AppProxyContextWithCustomer = AppProxyContext & {
  customerId: string;
  /** Present when Shopify sends `logged_in_customer_email` on the signed proxy request. */
  customerEmail?: string;
};

/** Query params Shopify adds to signed app-proxy requests. */
export const APP_PROXY_QUERY_KEYS = [
  "shop",
  "signature",
  "path_prefix",
  "timestamp",
  "logged_in_customer_id",
  "logged_in_customer_email",
] as const;

const APP_PROXY_SIGNATURE_PARAM = "signature";
const APP_PROXY_NONCE_PARAM = "pc_nonce";
const APP_PROXY_MAX_AGE_SECONDS = 5 * 60;
const APP_PROXY_MAX_FUTURE_SKEW_SECONDS = 60;
const replayCache = new Map<string, number>();

/**
 * Shopify sorts the signed params by code point, not by locale. `localeCompare` collates
 * case-insensitively, so a page whose query mixes cases — `?L1=6&color=Galvanized` — produced a
 * different order than Shopify signed and every such request 401'd.
 */
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const buildMessage = (params: URLSearchParams) => {
  const pairs = Array.from(params.entries())
    .filter(([key]) => key !== APP_PROXY_SIGNATURE_PARAM)
    .sort(([a], [b]) => byCodePoint(a, b))
    .map(([key, value]) => `${key}=${value}`);

  return pairs.join("");
};

const safeEqual = (a: string, b: string) => {
  const aBuffer = Buffer.from(a, "hex");
  const bBuffer = Buffer.from(b, "hex");

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
};

const VALID_SHOP_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

function enforceFreshTimestamp(params: URLSearchParams): void {
  const raw = params.get("timestamp") ?? "";
  if (!/^\d{10}$/.test(raw)) {
    throw new Response("Unauthorized", { status: 401 });
  }
  const timestamp = Number(raw);
  const now = Math.floor(Date.now() / 1000);
  if (
    timestamp < now - APP_PROXY_MAX_AGE_SECONDS ||
    timestamp > now + APP_PROXY_MAX_FUTURE_SKEW_SECONDS
  ) {
    throw new Response("Expired app proxy request", { status: 401 });
  }
}

function enforceNoUnsafeReplay(request: Request, signature: string): void {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;

  /*
   * Shopify's timestamp has one-second precision, so two legitimate POSTs to
   * the same proxy URL in one second can have the same signature. Only apply
   * one-time replay enforcement when our client supplies a unique query nonce;
   * Shopify includes that nonce in the signed parameter set.
   */
  const nonce = new URL(request.url).searchParams.get(APP_PROXY_NONCE_PARAM);
  if (!nonce || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) return;

  const now = Date.now();
  for (const [key, expiresAt] of replayCache) {
    if (expiresAt <= now) replayCache.delete(key);
  }
  const key = `${method}:${new URL(request.url).pathname}:${signature}:${nonce}`;
  if (replayCache.has(key)) {
    throw new Response("Replayed app proxy request", { status: 409 });
  }
  replayCache.set(key, now + APP_PROXY_MAX_AGE_SECONDS * 1000);
}

/**
 * Login URL that returns to a storefront path after auth.
 * New customer accounts use `/customer_authentication/login?return_to=` (not
 * legacy `/account/login?return_url=`, which often lands on account/orders).
 */
export const buildStorefrontCustomerLoginUrl = (returnPath: string): string => {
  const pathOnly = returnPath.split("?")[0] || returnPath;
  const normalized = pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;
  return `/customer_authentication/login?return_to=${encodeURIComponent(normalized)}`;
};

export const getAppProxyContext = (request: Request): AppProxyContext => {
  const url = new URL(request.url);
  const params = new URLSearchParams(url.search);
  const signature = params.get(APP_PROXY_SIGNATURE_PARAM);
  const shopRaw = params.get("shop");
  const secret = process.env.SHOPIFY_API_SECRET || "";

  if (!signature || shopRaw == null || !secret) {
    throw new Response("Unauthorized", { status: 401 });
  }

  if (!shopRaw.trim()) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const message = buildMessage(params);
  const digest = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  if (!safeEqual(digest, signature)) {
    throw new Response("Unauthorized", { status: 401 });
  }
  enforceFreshTimestamp(params);
  enforceNoUnsafeReplay(request, signature);

  const shop = shopRaw.trim().toLowerCase();
  if (!VALID_SHOP_REGEX.test(shop)) {
    throw new Response("Invalid shop domain", { status: 400 });
  }

  const customerId = params.get("logged_in_customer_id") || undefined;
  const customerEmail = params.get("logged_in_customer_email") || undefined;
  const returnParams = new URLSearchParams(url.search);
  for (const key of APP_PROXY_QUERY_KEYS) {
    returnParams.delete(key);
  }
  returnParams.delete(APP_PROXY_NONCE_PARAM);
  // Use storefront proxy path (/apps/project-clad/...) so redirects and forms hit the proxy
  const storefrontProxyPath = "/apps/project-clad";
  const storefrontPath = `${storefrontProxyPath}${url.pathname}`;
  const returnPath = `${storefrontPath}${
    returnParams.toString() ? `?${returnParams.toString()}` : ""
  }`;
  const formActionUrl = `https://${shop}${returnPath}`;
  return { shop, customerId, customerEmail, returnPath, formActionUrl };
};

/**
 * Returns a storefront proxy path without copying Shopify's signed transport params.
 * Shopify adds a fresh signature and timestamp when the browser requests the path.
 */
export function mergeAppProxyParamsFromRequest(
  path: string,
  request: Request,
): string {
  void request;
  const target = new URL(path, "https://storefront.local");
  return `${target.pathname}${target.search}`;
}

export const requireAppProxyCustomer = (
  request: Request,
  options: { jsonOnFail?: boolean } = {},
): AppProxyContextWithCustomer => {
  let context: AppProxyContext;
  try {
    context = getAppProxyContext(request);
  } catch (thrown) {
    if (options.jsonOnFail && thrown instanceof Response) {
      const status = thrown.status;
      if (status === 401) {
        throw Response.json(
          {
            error:
              "App proxy session is invalid. Reload the project page and try again.",
          },
          { status: 401 },
        );
      }
      if (status === 400) {
        throw Response.json(
          {
            error:
              "Invalid shop or signed proxy parameters. Reload the project page and try again.",
          },
          { status: 400 },
        );
      }
      throw Response.json({ error: `Request failed (${status}).` }, { status });
    }
    throw thrown;
  }

  if (!context.customerId) {
    const loginUrl = buildStorefrontCustomerLoginUrl(context.returnPath);

    if (options.jsonOnFail) {
      throw Response.json({ redirectTo: loginUrl }, { status: 401 });
    }

    throw redirect(loginUrl);
  }

  return { ...context, customerId: context.customerId };
};
