import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { shopStringFilter } from "../utils/projectAccess.server";
import {
  isSafeFulfillmentPhotoStorageKey,
  readFulfillmentPhoto,
} from "../utils/fulfillmentPhotoStorage.server";

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
