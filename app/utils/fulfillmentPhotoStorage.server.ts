import * as fs from "node:fs/promises";
import * as path from "node:path";
import prisma from "../db.server";

const DISK_ROOT = path.resolve(process.cwd(), "storage", "fulfillment-photos");

export function isSafeFulfillmentPhotoStorageKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed || trimmed.includes("..") || trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    return false;
  }
  const abs = path.resolve(DISK_ROOT, trimmed);
  return abs.startsWith(DISK_ROOT + path.sep) || abs === DISK_ROOT;
}

export function fulfillmentPhotoContentType(storageKey: string): string {
  const ext = path.extname(storageKey).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

export async function saveFulfillmentPhoto(
  storageKey: string,
  buffer: Buffer,
): Promise<void> {
  const contentType = fulfillmentPhotoContentType(storageKey);
  const bytes = new Uint8Array(buffer);
  await prisma.fulfillmentPhoto.upsert({
    where: { storageKey },
    create: { storageKey, contentType, data: bytes },
    update: { contentType, data: bytes },
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

export async function readFulfillmentPhoto(
  storageKey: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const row = await prisma.fulfillmentPhoto.findUnique({
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
    return { buffer, contentType: fulfillmentPhotoContentType(storageKey) };
  } catch {
    return null;
  }
}

export async function deleteFulfillmentPhoto(storageKey: string): Promise<void> {
  await prisma.fulfillmentPhoto.deleteMany({ where: { storageKey } });

  const abs = path.resolve(DISK_ROOT, storageKey);
  if (!abs.startsWith(DISK_ROOT + path.sep)) return;
  try {
    await fs.unlink(abs);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      console.error("[fulfillmentPhotoStorage] unlink:", e);
    }
  }
}
