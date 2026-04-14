import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import { fetchCustomerTagsRest } from "../utils/adminCustomers.server";
import {
  hasStaffStorefrontTag,
  hasTag,
  normalizeStorefrontCustomerId,
  viewerHasAdminTag,
} from "../utils/customerTags.server";
import { isProjectMember } from "../utils/projectAccess.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, customerId, customerEmail } = requireAppProxyCustomer(request);
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId") || "";
  if (!jobId) {
    return new Response("Missing job", { status: 400 });
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId },
    include: { project: { include: { members: true } } },
  });

  if (!job?.fulfillmentPhotoStorageKey) {
    return new Response("Not found", { status: 404 });
  }

  const shopNorm = shop.trim().toLowerCase();
  if (job.project.shop.trim().toLowerCase() !== shopNorm) {
    return new Response("Not found", { status: 404 });
  }

  const viewerIsAppAdmin = await viewerHasAdminTag(
    shop,
    customerId,
    customerEmail,
  );
  const member = isProjectMember(job.project, customerId, viewerIsAppAdmin);
  if (!member) {
    return new Response("Forbidden", { status: 403 });
  }

  const vid = normalizeStorefrontCustomerId(customerId);
  const tags = await fetchCustomerTagsRest(shop, vid);
  const hasNA = hasTag(tags, "NA");
  const isStaff = viewerIsAppAdmin || hasStaffStorefrontTag(tags);
  const naMayViewPhoto =
    job.orderLifecycleStatus === "delivered" ||
    job.orderLifecycleStatus === "paid";
  if (hasNA && !isStaff && !naMayViewPhoto) {
    return new Response("Forbidden", { status: 403 });
  }

  const key = job.fulfillmentPhotoStorageKey;
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
