import * as fs from "node:fs/promises";
import * as path from "node:path";
import prisma from "../db.server";

const DISK_ROOT = path.resolve(process.cwd(), "storage", "purchase-order-pdfs");
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const PDF_CONTENT_TYPE = "application/pdf";

export function isSafePurchaseOrderPdfStorageKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed || trimmed.includes("..") || trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    return false;
  }
  const abs = path.resolve(DISK_ROOT, trimmed);
  return abs.startsWith(DISK_ROOT + path.sep) || abs === DISK_ROOT;
}

export function validateUploadedPurchaseOrderPdf(args: {
  buffer: Buffer;
  size: number;
  name: string;
  contentType?: string | null;
}): string | null {
  if (args.size <= 0 || args.buffer.length === 0) {
    return "PDF file is empty.";
  }
  if (args.size > MAX_PDF_BYTES || args.buffer.length > MAX_PDF_BYTES) {
    return "PDF must be 15MB or smaller.";
  }
  const name = args.name.trim().toLowerCase();
  const type = (args.contentType ?? "").trim().toLowerCase();
  const looksPdf =
    type === PDF_CONTENT_TYPE ||
    type === "application/x-pdf" ||
    name.endsWith(".pdf");
  if (!looksPdf) {
    return "Only PDF files are allowed.";
  }
  return null;
}

/** Read a PDF upload from multipart FormData (Node File/Blob — not always `instanceof File`). */
export async function readFormUploadedPdf(
  formData: FormData,
  fieldName: string,
): Promise<{ buffer: Buffer; name: string; size: number; contentType: string } | null> {
  const entry = formData.get(fieldName);
  if (!entry || typeof entry !== "object") return null;

  const fileLike = entry as {
    size?: number;
    name?: string;
    type?: string;
    arrayBuffer?: () => Promise<ArrayBuffer>;
  };

  if (typeof fileLike.arrayBuffer !== "function") return null;

  const size = typeof fileLike.size === "number" ? fileLike.size : 0;
  if (size <= 0) return null;

  const buffer = Buffer.from(await fileLike.arrayBuffer());
  if (buffer.length === 0) return null;

  return {
    buffer,
    name: typeof fileLike.name === "string" ? fileLike.name : "purchase-order.pdf",
    size,
    contentType: typeof fileLike.type === "string" ? fileLike.type : "",
  };
}

export async function savePurchaseOrderPdf(
  storageKey: string,
  buffer: Buffer,
): Promise<void> {
  const bytes = new Uint8Array(buffer);
  await prisma.purchaseOrderPdf.upsert({
    where: { storageKey },
    create: { storageKey, contentType: PDF_CONTENT_TYPE, data: bytes },
    update: { contentType: PDF_CONTENT_TYPE, data: bytes },
  });

  const abs = path.resolve(DISK_ROOT, storageKey);
  if (!abs.startsWith(DISK_ROOT + path.sep)) return;
  try {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buffer);
  } catch {
    // Ephemeral disk is optional; Postgres is source of truth.
  }
}

export async function readPurchaseOrderPdf(
  storageKey: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const row = await prisma.purchaseOrderPdf.findUnique({
    where: { storageKey },
    select: { data: true, contentType: true },
  });
  if (row) {
    return {
      buffer: Buffer.from(row.data),
      contentType: row.contentType,
    };
  }

  const abs = path.resolve(DISK_ROOT, storageKey);
  if (!abs.startsWith(DISK_ROOT + path.sep) && abs !== DISK_ROOT) {
    return null;
  }
  try {
    const buffer = await fs.readFile(abs);
    return { buffer, contentType: PDF_CONTENT_TYPE };
  } catch {
    return null;
  }
}

export async function deletePurchaseOrderPdf(storageKey: string): Promise<void> {
  await prisma.purchaseOrderPdf.deleteMany({ where: { storageKey } });

  const abs = path.resolve(DISK_ROOT, storageKey);
  if (!abs.startsWith(DISK_ROOT + path.sep)) return;
  try {
    await fs.unlink(abs);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      console.error("[purchaseOrderPdfStorage] unlink:", e);
    }
  }
}
