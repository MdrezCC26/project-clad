/**
 * Dump JobItem id → product image URL from variant snapshots.
 * Used by Mission Control to show the same catalog drawings as Project Clad.
 *
 * Usage:
 *   npx tsx scripts/export-mc-line-images.ts
 *   MC_LINE_IMAGES_OUT=./line-images.json npx tsx scripts/export-mc-line-images.ts
 */
import "dotenv/config";
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function normalizeImageUrl(raw: unknown): string | null {
  const t = typeof raw === "string" ? raw.trim() : "";
  if (!t) return null;
  const href = t.startsWith("//") ? `https:${t}` : t;
  if (!/^https?:\/\//i.test(href)) return null;
  if (/\.pdf(\?|$)/i.test(href)) return null;
  return href;
}

function fromCustomData(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const name = String((row as { name?: unknown }).name ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, " ");
    const value = (row as { value?: unknown }).value;
    const named =
      (name.includes("reference") && name.includes("image")) ||
      name === "referenceimage" ||
      name === "image" ||
      name === "product image";
    if (!named) continue;
    const href = normalizeImageUrl(value);
    if (href) return href;
  }
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const href = normalizeImageUrl((row as { value?: unknown }).value);
    if (href && /shopify|cdn\.|vicwest|cloudinary|\.(png|jpe?g|webp|gif)(\?|$)/i.test(href)) {
      return href;
    }
  }
  return null;
}

const items = await prisma.jobItem.findMany({
  select: { id: true, variantSnapshot: true, customData: true },
});

const out: Record<string, string> = {};
for (const item of items) {
  const snap = item.variantSnapshot as { imageUrl?: unknown } | null;
  const href =
    normalizeImageUrl(snap?.imageUrl) ?? fromCustomData(item.customData);
  if (href) out[item.id] = href;
}

const dest = process.env.MC_LINE_IMAGES_OUT?.trim();
const json = JSON.stringify(out);
if (dest) {
  fs.writeFileSync(dest, json, "utf8");
} else {
  process.stdout.write(json);
}

await prisma.$disconnect();
