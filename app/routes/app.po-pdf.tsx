import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { shopStringFilter } from "../utils/projectAccess.server";
import {
  isSafePurchaseOrderPdfStorageKey,
  readPurchaseOrderPdf,
} from "../utils/purchaseOrderPdfStorage.server";

function contentDispositionFilename(name: string): string {
  const safe = name.replace(/[^\w.\- ()[\]]+/g, "_").trim() || "purchase-order.pdf";
  return `inline; filename="${safe}"`;
}

/**
 * Admin-side mirror of `apps.project-clad.po-pdf`. Serves the purchase order
 * PDF for a given job, scoped to the authenticated admin session's shop.
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
    select: {
      purchaseOrderPdfStorageKey: true,
      purchaseOrderPdfFileName: true,
    },
  });

  if (!job?.purchaseOrderPdfStorageKey) {
    return new Response("Not found", { status: 404 });
  }

  const key = job.purchaseOrderPdfStorageKey;
  if (!isSafePurchaseOrderPdfStorageKey(key)) {
    return new Response("Bad key", { status: 400 });
  }

  const pdf = await readPurchaseOrderPdf(key);
  if (!pdf) {
    return new Response("Not found", { status: 404 });
  }

  const downloadName =
    (job.purchaseOrderPdfFileName ?? "").trim() || "purchase-order.pdf";

  return new Response(new Uint8Array(pdf.buffer), {
    headers: {
      "Content-Type": pdf.contentType,
      "Content-Disposition": contentDispositionFilename(downloadName),
      "Cache-Control": "private, max-age=3600",
    },
  });
};
