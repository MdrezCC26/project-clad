import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import {
  normalizeStorefrontCustomerId,
  viewerHasAdminTag,
} from "../utils/customerTags.server";
import { isProjectMember } from "../utils/projectAccess.server";
import {
  isSafePurchaseOrderPdfStorageKey,
  readPurchaseOrderPdf,
} from "../utils/purchaseOrderPdfStorage.server";

function contentDispositionFilename(name: string): string {
  const safe = name.replace(/[^\w.\- ()[\]]+/g, "_").trim() || "purchase-order.pdf";
  return `inline; filename="${safe}"`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, customerId, customerEmail } = requireAppProxyCustomer(request);
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId") || "";
  if (!jobId) {
    return new Response("Missing job", { status: 400 });
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId },
    select: {
      purchaseOrderPdfStorageKey: true,
      purchaseOrderPdfFileName: true,
      project: { include: { members: true } },
    },
  });

  const storageKey = job?.purchaseOrderPdfStorageKey ?? null;
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

  const key = storageKey;
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
