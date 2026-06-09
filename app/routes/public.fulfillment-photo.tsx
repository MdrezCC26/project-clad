import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { verifySignedFulfillmentPhotoParams } from "../utils/fulfillmentPhotoSignedUrl.server";
import {
  isSafeFulfillmentPhotoStorageKey,
  readFulfillmentPhoto,
} from "../utils/fulfillmentPhotoStorage.server";

/**
 * Time-limited signed image URL on the app origin (bypasses storefront password wall).
 * Query: jobId, exp (unix sec), sig (hex HMAC).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId") || "";
  const phaseId = url.searchParams.get("phaseId") || "";
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

  if (!job?.project) {
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

  let storageKey: string | null = job.fulfillmentPhotoStorageKey ?? null;
  if (phaseId) {
    const phase = await prisma.jobDeliveryPhase.findFirst({
      where: { id: phaseId, jobId },
      select: { fulfillmentPhotoStorageKey: true },
    });
    storageKey = phase?.fulfillmentPhotoStorageKey ?? null;
  }

  if (!storageKey) {
    return new Response(
      "No fulfillment photo is stored for this delivery in this app’s database (wrong environment, deleted order, or link from an old deployment). Open the project on the storefront and use View delivery photo again.",
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
    phaseId: phaseId || undefined,
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

  const key = storageKey;
  if (!isSafeFulfillmentPhotoStorageKey(key)) {
    return new Response("Invalid storage key.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const photo = await readFulfillmentPhoto(key);
  if (!photo) {
    return new Response(
      "The photo file is not available on this server. Re-upload the fulfillment photo if it was saved before durable storage was enabled.",
      {
        status: 404,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-ProjectClad-Error": "file_missing_on_disk",
        },
      },
    );
  }

  return new Response(new Uint8Array(photo.buffer), {
    headers: {
      "Content-Type": photo.contentType,
      "Cache-Control": "private, max-age=300",
    },
  });
};
