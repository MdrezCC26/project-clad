import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { shopifyCustomerIdVariants, shopStringFilter } from "./projectAccess.server";
import {
  cartPropertiesFromProfile,
  DEFAULT_PART_LENGTH_IN,
  DEFAULT_SHAPE_COLOUR,
  girthOf,
  priceCustomPart,
  type ShapeLeg,
} from "./shapeProfile";

/**
 * The builder's staging cart. Prices are computed **here**, never taken from the browser, and use
 * the same catalogue formula as `extensions/projectclad-cart-transform` so the amount saved on a
 * project line matches what checkout charges.
 */
export type ShapeCartLine = {
  id: string;
  legs: ShapeLeg[];
  gauge: string;
  color: string;
  girth: number;
  bends: number;
  lengthIn: number;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type ShapeCartView = {
  lines: ShapeCartLine[];
  itemCount: number;
  subtotal: number;
};

export class ShapeCartError extends Error {}

function asLegs(value: unknown): ShapeLeg[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const angle = Number((row as { angle?: unknown }).angle);
    const length = Number((row as { length?: unknown }).length);
    if (!Number.isFinite(angle) || !Number.isFinite(length) || length <= 0) {
      return [];
    }
    return [{ angle, length }];
  });
}

/** Cart rows are per-customer; ids arrive as GID or numeric depending on the caller. */
function ownerFilter(shop: string, customerId: string) {
  return {
    shop: shopStringFilter(shop),
    customerId: { in: shopifyCustomerIdVariants(customerId) },
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function listShapeCart(
  shop: string,
  customerId: string,
): Promise<ShapeCartView> {
  const rows = await prisma.shapeCartItem.findMany({
    where: ownerFilter(shop, customerId),
    orderBy: { createdAt: "asc" },
  });

  const lines = rows.map((row) => {
    const unitPrice = Number(row.unitPrice);
    const quantity = Math.max(1, row.quantity);
    return {
      id: row.id,
      legs: asLegs(row.segments),
      gauge: row.gauge,
      color: row.color,
      girth: row.girth,
      bends: row.bends,
      lengthIn: row.lengthIn,
      quantity,
      unitPrice,
      lineTotal: round2(unitPrice * quantity),
    };
  });

  return {
    lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotal: round2(lines.reduce((sum, line) => sum + line.lineTotal, 0)),
  };
}

export async function countShapeCart(
  shop: string,
  customerId: string | undefined,
): Promise<number> {
  if (!customerId) return 0;
  try {
    const rows = await prisma.shapeCartItem.findMany({
      where: ownerFilter(shop, customerId),
      select: { quantity: true },
    });
    return rows.reduce((sum, row) => sum + Math.max(1, row.quantity), 0);
  } catch {
    /* the nav badge must never take a page down */
    return 0;
  }
}

export async function addShapeCartItem(args: {
  shop: string;
  customerId: string;
  legs: unknown;
  gauge?: unknown;
  color?: unknown;
  lengthIn?: unknown;
  bends?: unknown;
  quantity?: unknown;
}): Promise<ShapeCartLine> {
  const legs = asLegs(args.legs);
  if (legs.length < 1) {
    throw new ShapeCartError("This profile has no usable segments.");
  }
  const gauge = String(args.gauge ?? "").trim();
  if (!gauge) {
    throw new ShapeCartError("Pick a gauge before adding this profile.");
  }

  const girth = girthOf(legs);
  const lengthInRaw = Number(args.lengthIn);
  const lengthIn =
    Number.isFinite(lengthInRaw) && lengthInRaw > 0
      ? lengthInRaw
      : DEFAULT_PART_LENGTH_IN;
  const bendsRaw = Number(args.bends);
  const bends = Number.isFinite(bendsRaw)
    ? Math.max(0, Math.round(bendsRaw))
    : Math.max(0, legs.length - 1);
  const quantityRaw = Number(args.quantity);
  const quantity =
    Number.isFinite(quantityRaw) && quantityRaw > 0
      ? Math.min(999, Math.round(quantityRaw))
      : 1;

  const { ready, total } = priceCustomPart({ gauge, girth, bends, lengthIn });
  if (!ready || total == null) {
    throw new ShapeCartError(
      `No catalogue rate for ${gauge} gauge at ${girth}" girth.`,
    );
  }

  const row = await prisma.shapeCartItem.create({
    data: {
      shop: args.shop,
      customerId: args.customerId,
      segments: legs as unknown as Prisma.InputJsonValue,
      gauge,
      color: String(args.color ?? "").trim() || DEFAULT_SHAPE_COLOUR,
      girth,
      bends,
      lengthIn,
      quantity,
      unitPrice: new Prisma.Decimal(total.toFixed(2)),
    },
  });

  return {
    id: row.id,
    legs,
    gauge,
    color: row.color,
    girth,
    bends,
    lengthIn,
    quantity,
    unitPrice: total,
    lineTotal: round2(total * quantity),
  };
}

export async function setShapeCartQuantity(args: {
  shop: string;
  customerId: string;
  id: string;
  quantity: number;
}): Promise<void> {
  const quantity = Math.round(Number(args.quantity));
  if (!Number.isFinite(quantity)) {
    throw new ShapeCartError("Invalid quantity.");
  }
  if (quantity <= 0) {
    await removeShapeCartItem(args);
    return;
  }
  await prisma.shapeCartItem.updateMany({
    where: { id: args.id, ...ownerFilter(args.shop, args.customerId) },
    data: { quantity: Math.min(999, quantity) },
  });
}

export async function removeShapeCartItem(args: {
  shop: string;
  customerId: string;
  id: string;
}): Promise<void> {
  await prisma.shapeCartItem.deleteMany({
    where: { id: args.id, ...ownerFilter(args.shop, args.customerId) },
  });
}

export async function clearShapeCart(
  shop: string,
  customerId: string,
): Promise<void> {
  await prisma.shapeCartItem.deleteMany({ where: ownerFilter(shop, customerId) });
}

/** Line properties carried onto the order line (`customData`) and the Shopify order line. */
export function shapeCartLineProperties(
  line: ShapeCartLine,
): Record<string, string> {
  return cartPropertiesFromProfile({
    gauge: line.gauge,
    color: line.color,
    girth: line.girth,
    bends: line.bends,
    lengthIn: line.lengthIn,
    legs: line.legs,
    price: line.unitPrice,
  });
}
