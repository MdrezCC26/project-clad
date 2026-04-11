import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { verifySignedFulfillmentPhotoParams } from "../utils/fulfillmentPhotoSignedUrl.server";

/**
 * Time-limited signed image URL on the app origin (bypasses storefront password wall).
 * Query: jobId, exp (unix sec), sig (hex HMAC).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId") || "";
  const expRaw = url.searchParams.get("exp") || "";
  const sig = url.searchParams.get("sig") || "";

  if (!jobId || !expRaw || !sig) {
    return new Response("Missing jobId, exp, or sig query parameters.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId },
    include: { project: { select: { shop: true } } },
  });

  if (!job?.fulfillmentPhotoStorageKey || !job.project) {
    return new Response(
      "No fulfillment photo is stored for this order in this app’s database (wrong environment, deleted order, or link from an old deployment). Open the project on the storefront and use View delivery photo again.",
      {
        status: 404,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-ProjectClad-Error": "job_or_photo_missing",
        },
      },
    );
  }

  const ok = verifySignedFulfillmentPhotoParams({
    jobId,
    shop: job.project.shop,
    expRaw,
    sig,
  });
  if (!ok) {
    return new Response(
      "Invalid or expired photo link (wrong SHOPIFY_API_SECRET between environments, or link is older than 90 days). Reload the project page and click View delivery photo again.",
      {
        status: 403,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-ProjectClad-Error": "bad_or_expired_sig",
        },
      },
    );
  }

  const key = job.fulfillmentPhotoStorageKey;
  if (!key || key.includes("..") || key.startsWith("/") || key.startsWith("\\")) {
    return new Response("Invalid storage key.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const root = path.resolve(process.cwd(), "storage", "fulfillment-photos");
  const abs = path.resolve(root, key);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    return new Response("Invalid file path.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  let buf: Buffer;
  try {
    buf = await fs.readFile(abs);
  } catch {
    return new Response(
      "The photo file is not on this server’s disk. Common on cloud hosts without a persistent volume: the file was saved on another instance or was lost after a restart. Use a mounted disk or object storage, or re-upload the fulfillment photo.",
      {
        status: 404,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-ProjectClad-Error": "file_missing_on_disk",
        },
      },
    );
  }

  const ext = path.extname(key).toLowerCase();
  const contentType =
    ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : "image/jpeg";

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=300",
    },
  });
};
