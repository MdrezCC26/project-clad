import crypto from "node:crypto";
import { redirect } from "react-router";

export type AppProxyContext = {
  shop: string;
  customerId?: string;
  customerEmail?: string;
  returnPath: string;
  formActionUrl: string;
};

const APP_PROXY_SIGNATURE_PARAM = "signature";

const buildMessage = (params: URLSearchParams) => {
  const pairs = Array.from(params.entries())
    .filter(([key]) => key !== APP_PROXY_SIGNATURE_PARAM)
    .sort(([a], [b]) => a.localeCompare(b))
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

export const getAppProxyContext = (request: Request): AppProxyContext => {
  const url = new URL(request.url);
  const params = new URLSearchParams(url.search);
  const signature = params.get(APP_PROXY_SIGNATURE_PARAM);
  const shop = params.get("shop");
  const secret = process.env.SHOPIFY_API_SECRET || "";

  if (!signature || !shop || !secret) {
    throw new Response("Unauthorized", { status: 401 });
  }

  if (!VALID_SHOP_REGEX.test(shop)) {
    throw new Response("Invalid shop domain", { status: 400 });
  }

  const message = buildMessage(params);
  const digest = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  if (!safeEqual(digest, signature)) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const customerId = params.get("logged_in_customer_id") || undefined;
  const customerEmail = params.get("logged_in_customer_email") || undefined;
  const returnParams = new URLSearchParams(url.search);
  returnParams.delete(APP_PROXY_SIGNATURE_PARAM);
  // Use storefront proxy path (/apps/project-clad/...) so redirects and forms hit the proxy
  const storefrontProxyPath = "/apps/project-clad";
  const storefrontPath = `${storefrontProxyPath}${url.pathname}`;
  const returnPath = `${storefrontPath}${
    returnParams.toString() ? `?${returnParams.toString()}` : ""
  }`;
  const formActionUrl = `https://${shop}${returnPath}`;
  return { shop, customerId, customerEmail, returnPath, formActionUrl };
};

export const requireAppProxyCustomer = (
  request: Request,
  options: { jsonOnFail?: boolean } = {},
) => {
  const context = getAppProxyContext(request);

  if (!context.customerId) {
    const loginUrl = `/account/login?return_url=${encodeURIComponent(
      context.returnPath,
    )}`;

    if (options.jsonOnFail) {
      throw Response.json({ redirectTo: loginUrl }, { status: 401 });
    }

    throw redirect(loginUrl);
  }

  return context;
};
