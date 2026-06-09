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
import {
  isSafeFulfillmentPhotoStorageKey,
  readFulfillmentPhoto,
} from "../utils/fulfillmentPhotoStorage.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, customerId, customerEmail } = requireAppProxyCustomer(request);
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId") || "";
  const phaseId = url.searchParams.get("phaseId") || "";
  if (!jobId) {
    return new Response("Missing job", { status: 400 });
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId },
    include: { project: { include: { members: true } } },
  });

  let storageKey: string | null = job?.fulfillmentPhotoStorageKey ?? null;
  if (phaseId) {
    const phase = await prisma.jobDeliveryPhase.findFirst({
      where: { id: phaseId, jobId },
      select: { fulfillmentPhotoStorageKey: true },
    });
    storageKey = phase?.fulfillmentPhotoStorageKey ?? null;
  }

  if (!job || !storageKey) {
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

  const key = storageKey;
  if (!isSafeFulfillmentPhotoStorageKey(key)) {
    return new Response("Bad key", { status: 400 });
  }

  const photo = await readFulfillmentPhoto(key);
  if (!photo) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(photo.buffer), {
    headers: {
      "Content-Type": photo.contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
};
