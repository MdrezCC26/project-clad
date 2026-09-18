import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchValidatedShopifyStagedFile,
  isShopifyStagedLineItemFileUrl,
} from "./uploadPartMirror.server";

const validUrl =
  "https://shopify-staged-uploads.storage.googleapis.com/tmp/reference.pdf";

test("accepts only the exact Shopify staged-upload HTTPS host", () => {
  assert.equal(isShopifyStagedLineItemFileUrl(validUrl), true);
  assert.equal(
    isShopifyStagedLineItemFileUrl(
      "https://shopify-staged-uploads.storage.googleapis.com.evil.test/file.pdf",
    ),
    false,
  );
  assert.equal(
    isShopifyStagedLineItemFileUrl(
      "https://shopify-staged-uploads.storage.googleapis.com@127.0.0.1/file.pdf",
    ),
    false,
  );
  assert.equal(
    isShopifyStagedLineItemFileUrl(
      "http://shopify-staged-uploads.storage.googleapis.com/file.pdf",
    ),
    false,
  );
  assert.equal(
    isShopifyStagedLineItemFileUrl(
      "https://shopify-staged-uploads.storage.googleapis.com:444/file.pdf",
    ),
    false,
  );
});

test("streams and identifies a valid staged PDF", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(Buffer.from("%PDF-1.7\nexample"), {
      status: 200,
      headers: { "content-type": "application/pdf" },
    });

  const result = await fetchValidatedShopifyStagedFile(validUrl);
  assert.equal(result.extension, ".pdf");
  assert.equal(result.buf.subarray(0, 5).toString("ascii"), "%PDF-");
});

test("rejects redirects away from the Shopify upload host", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    });

  await assert.rejects(
    fetchValidatedShopifyStagedFile(validUrl),
    /unsafe upload redirect/i,
  );
});

test("rejects oversized and unrecognized responses", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response("<html>not an upload</html>", {
      status: 200,
      headers: { "content-length": String(30 * 1024 * 1024 + 1) },
    });

  await assert.rejects(
    fetchValidatedShopifyStagedFile(validUrl),
    /file too large/i,
  );

  globalThis.fetch = async () =>
    new Response("<html>not an upload</html>", { status: 200 });
  await assert.rejects(
    fetchValidatedShopifyStagedFile(validUrl),
    /unsupported file type/i,
  );
});
