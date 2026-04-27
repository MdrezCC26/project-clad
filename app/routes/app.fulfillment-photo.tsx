import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { shopStringFilter } from "../utils/projectAccess.server";

/**
 * Admin-side mirror of `apps.project-clad.fulfillment-photo`. Serves the raw
 * fulfillment photo for a given job, scoped to the authenticated admin
 * session's shop so one merchant can't read another's files. Used by the
 * Work Orders admin page's "View photo" link.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId") || "";
  if (!jobId) {
    return new Response("Missing job", { status: 400 });
  }

  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      project: { shop: shopStringFilter(session.shop) },
    },
    select: { fulfillmentPhotoStorageKey: true },
  });

  if (!job?.fulfillmentPhotoStorageKey) {
    return new Response("Not found", { status: 404 });
  }

  const key = job.fulfillmentPhotoStorageKey;
  /* Defense-in-depth: reject any stored key that could escape the storage dir. */
  if (!key || key.includes("..") || key.startsWith("/") || key.startsWith("\\")) {
    return new Response("Bad key", { status: 400 });
  }

  const root = path.resolve(process.cwd(), "storage", "fulfillment-photos");
  const abs = path.resolve(root, key);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    return new Response("Bad path", { status: 400 });
  }

  let buf: Buffer;
  try {
    buf = await fs.readFile(abs);
  } catch {
    return new Response("Not found", { status: 404 });
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
      "Cache-Control": "private, max-age=3600",
    },
  });
};
