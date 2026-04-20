import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import {
  parseUploadPartMirrorKeysJson,
  uploadPartFilesRoot,
} from "../utils/uploadPartMirror.server";
import { verifySignedUploadPartFileParams } from "../utils/uploadPartFileSignedUrl.server";

function contentTypeForKey(key: string): string {
  const ext = path.extname(key).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".zip") return "application/zip";
  return "application/octet-stream";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const jobItemId = url.searchParams.get("jobItemId") || "";
  const propIndexRaw = url.searchParams.get("propIndex") || "";
  const expRaw = url.searchParams.get("exp") || "";
  const sig = url.searchParams.get("sig") || "";

  if (!jobItemId || !propIndexRaw || !expRaw || !sig) {
    return new Response("Missing jobItemId, propIndex, exp, or sig.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const item = await prisma.jobItem.findFirst({
    where: { id: jobItemId },
    include: { job: { include: { project: { select: { shop: true } } } } },
  });

  if (!item?.job?.project) {
    return new Response(
      "This upload is not available (unknown line item or wrong environment).",
      {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      },
    );
  }

  const shop = item.job.project.shop;
  const ok = verifySignedUploadPartFileParams({
    jobItemId,
    shop,
    propIndexRaw,
    expRaw,
    sig,
  });
  if (!ok) {
    return new Response(
      "Invalid or expired link. Open the project from your account and download the file again.",
      {
        status: 403,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      },
    );
  }

  const keyMap = parseUploadPartMirrorKeysJson(item.uploadPartMirrorKeysJson);
  const storageKey = keyMap?.[propIndexRaw];
  if (!storageKey || storageKey.includes("..") || storageKey.startsWith("/") || storageKey.startsWith("\\")) {
    return new Response("No mirrored file for this property.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const root = uploadPartFilesRoot();
  const abs = path.resolve(root, storageKey);
  if (!abs.startsWith(root + path.sep)) {
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
      "The file is not on this server’s disk. If you use cloud hosting, ensure the storage directory is on a persistent volume.",
      {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      },
    );
  }

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": contentTypeForKey(storageKey),
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": `inline; filename="upload${path.extname(storageKey) || ""}"`,
    },
  });
};
