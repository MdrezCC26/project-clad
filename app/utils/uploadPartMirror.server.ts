import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { buildSignedUploadPartFileUrl } from "./uploadPartFileSignedUrl.server";

const UPLOAD_PART_SUBDIR = "upload-part-files";
const MAX_BYTES = 30 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;
const SHOPIFY_STAGED_UPLOAD_HOST =
  "shopify-staged-uploads.storage.googleapis.com";

type DetectedUpload = {
  buf: Buffer;
  extension: ".pdf" | ".png" | ".jpg" | ".gif" | ".webp";
};

function validatedShopifyStagedUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== SHOPIFY_STAGED_UPLOAD_HOST ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

/** Shopify line-item uploads land in a temporary bucket; URLs must not be stored as-is. */
export function isShopifyStagedLineItemFileUrl(value: string): boolean {
  return validatedShopifyStagedUrl(value) !== null;
}

function shopDirFromShop(shop: string) {
  return shop.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function uploadPartFilesRoot(): string {
  return path.resolve(process.cwd(), "storage", UPLOAD_PART_SUBDIR);
}

export function parseUploadPartMirrorKeysJson(
  raw: string | null | undefined,
): Record<string, string> | null {
  if (!raw?.trim()) return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === "string" && v.length > 0 && !v.includes("..")) {
        out[String(k)] = v;
      }
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

function detectUpload(buf: Buffer): DetectedUpload {
  if (buf.subarray(0, 5).toString("ascii") === "%PDF-") {
    return { buf, extension: ".pdf" };
  }
  if (
    buf.length >= 8 &&
    buf
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { buf, extension: ".png" };
  }
  if (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return { buf, extension: ".jpg" };
  }
  const gifHeader = buf.subarray(0, 6).toString("ascii");
  if (gifHeader === "GIF87a" || gifHeader === "GIF89a") {
    return { buf, extension: ".gif" };
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { buf, extension: ".webp" };
  }
  throw new Error("Unsupported file type");
}

export async function fetchValidatedShopifyStagedFile(
  value: string,
): Promise<DetectedUpload> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const initialUrl = validatedShopifyStagedUrl(value);
    if (!initialUrl) throw new Error("Invalid upload file URL");
    let url: URL = initialUrl;

    for (
      let redirectCount = 0;
      redirectCount <= MAX_REDIRECTS;
      redirectCount++
    ) {
      const res: Response = await fetch(url, {
        redirect: "manual",
        signal: ac.signal,
      });
      if (res.status >= 300 && res.status < 400) {
        if (redirectCount === MAX_REDIRECTS) {
          throw new Error("Too many redirects");
        }
        const location: string | null = res.headers.get("location");
        const nextUrl: URL | null = location
          ? validatedShopifyStagedUrl(new URL(location, url).toString())
          : null;
        if (!nextUrl) throw new Error("Unsafe upload redirect");
        url = nextUrl;
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const len = res.headers.get("content-length");
      if (len) {
        const n = parseInt(len, 10);
        if (Number.isFinite(n) && n > MAX_BYTES) {
          throw new Error("File too large");
        }
      }
      if (!res.body) throw new Error("Empty upload response");

      const reader = res.body.getReader();
      const chunks: Buffer[] = [];
      let received = 0;
      let readDone = false;
      while (!readDone) {
        const read = await reader.read();
        if (read.done) {
          readDone = true;
          break;
        }
        const chunk = read.value;
        received += chunk.byteLength;
        if (received > MAX_BYTES) {
          await reader.cancel();
          throw new Error("File too large");
        }
        chunks.push(Buffer.from(chunk));
      }
      return detectUpload(Buffer.concat(chunks, received));
    }
    throw new Error("Could not fetch uploaded file");
  } finally {
    clearTimeout(t);
  }
}

/**
 * Downloads Shopify staged-upload URLs into app storage and replaces those property values
 * with signed app URLs. Persists `customData` + `uploadPartMirrorKeysJson` on the row.
 */
export async function mirrorShopifyStagedUploadsForJobItem(args: {
  shop: string;
  jobItemId: string;
  properties: { name: string; value: string }[] | null | undefined;
}): Promise<void> {
  const raw = args.properties;
  if (!raw?.length) return;

  const props = raw.map((p) => ({ name: p.name, value: p.value }));
  const indicesToMirror: number[] = [];
  for (let i = 0; i < props.length; i++) {
    if (isShopifyStagedLineItemFileUrl(props[i].value)) {
      indicesToMirror.push(i);
    }
  }
  if (indicesToMirror.length === 0) return;

  const shopDir = shopDirFromShop(args.shop);
  const root = uploadPartFilesRoot();
  const keys: Record<string, string> = {};

  for (const i of indicesToMirror) {
    const urlStr = props[i].value.trim();
    let fileUrl: URL;
    try {
      fileUrl = new URL(urlStr);
    } catch {
      throw new Error("Invalid upload file URL.");
    }
    if (!validatedShopifyStagedUrl(fileUrl.toString())) {
      throw new Error("Invalid upload file URL.");
    }

    const { buf, extension } = await fetchValidatedShopifyStagedFile(
      urlStr,
    ).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Could not copy an uploaded file from Shopify (${msg}). The upload link may have expired — remove the line from your cart, re-upload the file, and save the order again.`,
      );
    });

    const storageKey = `${shopDir}/${args.jobItemId}-${i}-${Date.now()}${extension}`;
    const abs = path.resolve(root, storageKey);
    if (!abs.startsWith(root + path.sep)) {
      throw new Error("Invalid storage path.");
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buf);
    keys[String(i)] = storageKey;

    const signed = buildSignedUploadPartFileUrl({
      jobItemId: args.jobItemId,
      shop: args.shop,
      propIndex: i,
    });
    if (!signed) {
      throw new Error(
        "Server is not configured to store upload files (missing app URL or SHOPIFY_API_SECRET).",
      );
    }
    props[i] = { ...props[i], value: signed };
  }

  await prisma.jobItem.update({
    where: { id: args.jobItemId },
    data: {
      customData: props as unknown as Prisma.InputJsonValue,
      uploadPartMirrorKeysJson: JSON.stringify(keys),
    },
  });
}

/**
 * When copying a job, duplicate mirrored files onto the new job item and rewrite signed URLs.
 */
export async function duplicateUploadPartMirrorsForCopiedJobItem(args: {
  shop: string;
  oldItem: {
    id: string;
    customData: unknown;
    uploadPartMirrorKeysJson: string | null;
  };
  newJobItemId: string;
}): Promise<void> {
  const keyMap = parseUploadPartMirrorKeysJson(
    args.oldItem.uploadPartMirrorKeysJson,
  );
  if (!keyMap) return;

  const root = uploadPartFilesRoot();
  const shopDir = shopDirFromShop(args.shop);
  const newKeys: Record<string, string> = {};
  const oldCustom = args.oldItem.customData;
  if (!Array.isArray(oldCustom)) return;

  const props = oldCustom.map((p) =>
    p && typeof p === "object" && "name" in p && "value" in p
      ? {
          name: String((p as { name: unknown }).name),
          value: String((p as { value: unknown }).value),
        }
      : { name: "", value: "" },
  );

  for (const [idxStr, oldKey] of Object.entries(keyMap)) {
    const propIndex = parseInt(idxStr, 10);
    if (
      !Number.isFinite(propIndex) ||
      propIndex < 0 ||
      propIndex >= props.length
    ) {
      continue;
    }

    const oldAbs = path.resolve(root, oldKey);
    if (!oldAbs.startsWith(root + path.sep)) continue;

    let buf: Buffer;
    try {
      buf = await fs.readFile(oldAbs);
    } catch {
      continue;
    }

    const ext = path.extname(oldKey).toLowerCase() || ".bin";
    const newStorageKey = `${shopDir}/${args.newJobItemId}-${idxStr}-${Date.now()}${ext}`;
    const newAbs = path.resolve(root, newStorageKey);
    if (!newAbs.startsWith(root + path.sep)) continue;
    await fs.mkdir(path.dirname(newAbs), { recursive: true });
    await fs.writeFile(newAbs, buf);
    newKeys[idxStr] = newStorageKey;

    const signed = buildSignedUploadPartFileUrl({
      jobItemId: args.newJobItemId,
      shop: args.shop,
      propIndex,
    });
    if (signed) {
      props[propIndex] = { ...props[propIndex], value: signed };
    }
  }

  if (Object.keys(newKeys).length === 0) return;

  await prisma.jobItem.update({
    where: { id: args.newJobItemId },
    data: {
      customData: props as unknown as Prisma.InputJsonValue,
      uploadPartMirrorKeysJson: JSON.stringify(newKeys),
    },
  });
}
