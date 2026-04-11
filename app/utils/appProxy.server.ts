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

  const shop = shopRaw.trim().toLowerCase();
  if (!VALID_SHOP_REGEX.test(shop)) {
    throw new Response("Invalid shop domain", { status: 400 });
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
      throw Response.json(
        { error: `Request failed (${status}).` },
        { status },
      );
    }
    throw thrown;
  }

  if (!context.customerId) {
    const loginUrl = `/account/login?return_url=${encodeURIComponent(
      context.returnPath,
    )}`;

    if (options.jsonOnFail) {
      throw Response.json({ redirectTo: loginUrl }, { status: 401 });
    }

    throw redirect(loginUrl);
  }

  return { ...context, customerId: context.customerId };
};
