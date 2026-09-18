import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  buildSignedFulfillmentPhotoUrl,
  verifySignedFulfillmentPhotoParams,
} from "./fulfillmentPhotoSignedUrl.server";
import {
  buildSignedUploadPartFileUrl,
  verifySignedUploadPartFileParams,
} from "./uploadPartFileSignedUrl.server";

const SECRET = "signed-url-test-secret";
const SHOP = "example.myshopify.com";

test.before(() => {
  process.env.SHOPIFY_API_SECRET = SECRET;
  process.env.SHOPIFY_APP_URL = "https://app.example";
});

test("new photo and upload links are signed without expiries", () => {
  const photoUrl = new URL(
    buildSignedFulfillmentPhotoUrl({ jobId: "job-1", shop: SHOP }) ?? "",
  );
  const uploadUrl = new URL(
    buildSignedUploadPartFileUrl({
      jobItemId: "item-1",
      shop: SHOP,
      propIndex: 2,
    }) ?? "",
  );
  assert.equal(photoUrl.searchParams.has("exp"), false);
  assert.equal(uploadUrl.searchParams.has("exp"), false);
  assert.equal(
    verifySignedFulfillmentPhotoParams({
      jobId: "job-1",
      shop: SHOP,
      sig: photoUrl.searchParams.get("sig") ?? "",
    }),
    true,
  );
  assert.equal(
    verifySignedUploadPartFileParams({
      jobItemId: "item-1",
      shop: SHOP,
      propIndexRaw: "2",
      sig: uploadUrl.searchParams.get("sig") ?? "",
    }),
    true,
  );
});

test("legacy expiring links remain valid after their former expiry", () => {
  const expRaw = String(Math.floor(Date.now() / 1000) - 24 * 60 * 60);
  const photoSig = crypto
    .createHmac("sha256", SECRET)
    .update(`${SHOP}:job-1:${expRaw}`)
    .digest("hex");
  assert.equal(
    verifySignedFulfillmentPhotoParams({
      jobId: "job-1",
      shop: SHOP,
      expRaw,
      sig: photoSig,
    }),
    true,
  );

  const uploadSig = crypto
    .createHmac("sha256", SECRET)
    .update(`${SHOP}:item-1:2:${expRaw}`)
    .digest("hex");
  assert.equal(
    verifySignedUploadPartFileParams({
      jobItemId: "item-1",
      shop: SHOP,
      propIndexRaw: "2",
      expRaw,
      sig: uploadSig,
    }),
    true,
  );
});
