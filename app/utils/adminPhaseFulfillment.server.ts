import {
  confirmPhaseDelivery,
  fulfillmentPhotoExtFromName,
  MAX_FULFILLMENT_PHOTO_BYTES,
} from "./batchDelivery.server";
import { readFormUploadedImage } from "./uploadedImageFile.server";

export type AdminPhaseFulfillmentResult =
  | { ok: true; message: string; fullyDelivered: boolean; deliveredPercent: number }
  | { ok: false; error: string };

/**
 * Admin-queue wrapper: pull the photo and the per-line quantities out of the posted form, then
 * hand off to the shared confirm in `batchDelivery.server.ts`, which is the same code the
 * storefront batch flow runs.
 */
export async function confirmAdminPhaseFulfillment(args: {
  shop: string;
  jobId: string;
  phaseId: string;
  form: FormData;
}): Promise<AdminPhaseFulfillmentResult> {
  const { shop, jobId, phaseId, form } = args;

  const uploaded = await readFormUploadedImage(form, "photo");
  if (!uploaded) {
    return { ok: false, error: "Photo file is required." };
  }
  if (uploaded.size > MAX_FULFILLMENT_PHOTO_BYTES) {
    return { ok: false, error: "Photo must be 8MB or smaller." };
  }

  /* Every `qty_*` the form carried. Passing an explicit map keeps the admin table's
     per-line edits authoritative rather than falling back to "deliver everything". */
  const quantities: Record<string, number> = {};
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("qty_")) continue;
    quantities[key.slice(4)] = Math.floor(Number(value) || 0);
  }

  const result = await confirmPhaseDelivery({
    shop,
    jobId,
    phaseId,
    photo: {
      buffer: uploaded.buffer,
      ext: fulfillmentPhotoExtFromName(uploaded.name),
    },
    quantities,
    source: "shopify_admin",
    logActivity: true,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return {
    ok: true,
    fullyDelivered: result.fullyDelivered,
    deliveredPercent: result.deliveredPercent,
    message: result.message,
  };
}

export function jobHasFulfillmentEvidence(
  fulfillmentPhotoStorageKey: string | null | undefined,
  phases: { fulfillmentPhotoStorageKey?: string | null }[],
): boolean {
  if (phases.length > 0) {
    return phases.some((p) => Boolean(p.fulfillmentPhotoStorageKey));
  }
  return Boolean(fulfillmentPhotoStorageKey);
}
