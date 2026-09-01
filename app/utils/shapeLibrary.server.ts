import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { shopStringFilter } from "./projectAccess.server";
import {
  DEFAULT_SHAPE_TEMPLATES,
  geometryHash,
  girthOf,
  type ShapeLeg,
} from "./shapeProfile";

function asLegs(value: unknown): ShapeLeg[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const angle = Number((row as { angle?: unknown }).angle);
    const length = Number((row as { length?: unknown }).length);
    if (!Number.isFinite(angle) || !Number.isFinite(length)) return [];
    return [{ angle, length }];
  });
}

export async function ensureShapeTemplates(shop: string) {
  const existing = await prisma.shapeTemplate.findMany({
    where: { shop: shopStringFilter(shop) },
    orderBy: { sortOrder: "asc" },
  });
  if (existing.length > 0) return existing;

  await prisma.shapeTemplate.createMany({
    data: DEFAULT_SHAPE_TEMPLATES.map((t, i) => ({
      shop,
      slug: t.slug,
      name: t.name,
      segments: t.legs as Prisma.InputJsonValue,
      sortOrder: i,
    })),
  });
  return prisma.shapeTemplate.findMany({
    where: { shop: shopStringFilter(shop) },
    orderBy: { sortOrder: "asc" },
  });
}

export async function listShapeTemplates(shop: string) {
  const rows = await ensureShapeTemplates(shop);
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    legs: asLegs(row.segments),
  }));
}

export async function publishShapeLibraryEntry(args: {
  shop: string;
  legs: ShapeLeg[];
  gauge?: string | null;
  color?: string | null;
  girth?: number;
}) {
  const legs = args.legs.filter((l) => Number.isFinite(l.length) && l.length > 0);
  if (legs.length < 1) return null;
  const hash = geometryHash(legs);
  const girth = args.girth && args.girth > 0 ? args.girth : girthOf(legs);
  const gauge = args.gauge?.trim() || null;
  const color = args.color?.trim() || null;

  return prisma.shapeLibraryEntry.upsert({
    where: {
      shop_geometryHash: { shop: args.shop, geometryHash: hash },
    },
    create: {
      shop: args.shop,
      geometryHash: hash,
      segments: legs as Prisma.InputJsonValue,
      girth,
      gauge,
      color,
      useCount: 1,
    },
    update: {
      useCount: { increment: 1 },
      gauge,
      color,
      girth,
      segments: legs as Prisma.InputJsonValue,
    },
  });
}

export async function listShapeLibrary(shop: string, take = 60) {
  const rows = await prisma.shapeLibraryEntry.findMany({
    where: { shop: shopStringFilter(shop) },
    orderBy: { updatedAt: "desc" },
    take,
  });
  return rows.map((row) => ({
    id: row.id,
    legs: asLegs(row.segments),
    girth: row.girth,
    gauge: row.gauge,
    color: row.color,
    useCount: row.useCount,
  }));
}

/** Remove one library entry for this shop. Returns true when a row was deleted. */
export async function deleteShapeLibraryEntry(shop: string, id: string) {
  const trimmed = id.trim();
  if (!trimmed) return false;
  const result = await prisma.shapeLibraryEntry.deleteMany({
    where: { id: trimmed, shop: shopStringFilter(shop) },
  });
  return result.count > 0;
}
