import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { getAppProxyContext } from "./appProxy.server";
import {
  createPricingAccessCookie,
  hasPricingAccess,
} from "./pricingAccess.server";

const SECRET = "test-shopify-secret";

function signedProxyRequest(args: {
  timestamp: number;
  method?: string;
  path?: string;
}): Request {
  const params = new URLSearchParams({
    logged_in_customer_id: "123",
    path_prefix: "/apps/project-clad",
    shop: "example-shop.myshopify.com",
    timestamp: String(args.timestamp),
  });
  const message = Array.from(params.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("");
  params.set(
    "signature",
    crypto.createHmac("sha256", SECRET).update(message).digest("hex"),
  );
  return new Request(
    `https://app.example${args.path ?? "/api/test"}?${params.toString()}`,
    { method: args.method ?? "GET" },
  );
}

test.before(() => {
  process.env.SHOPIFY_API_SECRET = SECRET;
});

test("accepts fresh app-proxy signatures and rejects stale ones", () => {
  const now = Math.floor(Date.now() / 1000);
  const context = getAppProxyContext(signedProxyRequest({ timestamp: now }));
  assert.equal(context.shop, "example-shop.myshopify.com");
  assert.equal(new URL(context.formActionUrl).searchParams.has("timestamp"), false);
  assert.equal(new URL(context.formActionUrl).searchParams.has("signature"), false);

  assert.throws(
    () =>
      getAppProxyContext(
        signedProxyRequest({ timestamp: now - 301, path: "/api/stale" }),
      ),
    (error) => error instanceof Response && error.status === 401,
  );
});

test("rejects a repeated unsafe app-proxy request", () => {
  const request = signedProxyRequest({
    timestamp: Math.floor(Date.now() / 1000),
    method: "POST",
    path: "/api/replay",
  });
  getAppProxyContext(request);
  assert.throws(
    () => getAppProxyContext(request.clone()),
    (error) => error instanceof Response && error.status === 409,
  );
});

test("pricing cookie is signed, HttpOnly, and identity-bound", () => {
  const cookie = createPricingAccessCookie({
    shop: "example-shop.myshopify.com",
    customerId: "123",
  });
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);

  const request = new Request("https://app.example/project", {
    headers: { Cookie: cookie.split(";")[0] },
  });
  assert.equal(
    hasPricingAccess(request, {
      shop: "example-shop.myshopify.com",
      customerId: "123",
    }),
    true,
  );
  assert.equal(
    hasPricingAccess(request, {
      shop: "example-shop.myshopify.com",
      customerId: "456",
    }),
    false,
  );

  const tampered = cookie.replace(
    "projectclad_pricing=",
    "projectclad_pricing=A",
  );
  assert.equal(
    hasPricingAccess(
      new Request("https://app.example/project", {
        headers: { Cookie: tampered.split(";")[0] },
      }),
      { shop: "example-shop.myshopify.com", customerId: "123" },
    ),
    false,
  );
});
