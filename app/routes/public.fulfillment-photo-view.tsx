import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { verifySignedFulfillmentPhotoParams } from "../utils/fulfillmentPhotoSignedUrl.server";

function escapeHtmlAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * HTML wrapper around the signed fulfillment photo so email clients open a
 * normal page (not a raw image). Avoids Outlook’s ugly image-load chrome.
 * Query: same as /public/fulfillment-photo (jobId, exp, sig, optional phaseId).
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
    return new Response("Photo not found.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const ok = verifySignedFulfillmentPhotoParams({
    jobId,
    shop: job.project.shop,
    expRaw,
    sig,
    phaseId: phaseId || undefined,
  });
  if (!ok) {
    return new Response("Invalid or expired photo link.", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const imgUrl = new URL("/public/fulfillment-photo", url.origin);
  imgUrl.searchParams.set("jobId", jobId);
  if (phaseId) imgUrl.searchParams.set("phaseId", phaseId);
  imgUrl.searchParams.set("exp", expRaw);
  imgUrl.searchParams.set("sig", sig);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>Delivery photo</title>
<style>
  html, body { margin:0; padding:0; background:#111111; min-height:100%; }
  body { display:flex; align-items:center; justify-content:center; padding:16px; box-sizing:border-box; }
  img { max-width:100%; height:auto; display:block; border:0; }
</style>
</head>
<body>
  <img src="${escapeHtmlAttr(imgUrl.toString())}" alt="Delivery photo" />
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, max-age=300",
    },
  });
};
