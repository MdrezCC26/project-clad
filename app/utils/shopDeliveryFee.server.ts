import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { shopStringFilter } from "./projectAccess.server";

/** Used when ShopSettings.deliveryFeeAmount is null. */
export const DEFAULT_SHOP_DELIVERY_FEE = 15;

export async function getShopDeliveryFee(shop: string): Promise<number> {
  const row = await prisma.shopSettings.findFirst({
    where: { shop: shopStringFilter(shop) },
    select: { deliveryFeeAmount: true },
  });
  if (row?.deliveryFeeAmount != null) {
    const n = Number(row.deliveryFeeAmount);
    if (Number.isFinite(n) && n >= 0) return Math.round(n * 100) / 100;
  }
  return DEFAULT_SHOP_DELIVERY_FEE;
}

export function parseDeliveryFeeFromForm(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 999_999) return null;
  return Math.round(n * 100) / 100;
}

export function deliveryFeeToDecimal(amount: number): Prisma.Decimal {
  return new Prisma.Decimal(amount.toFixed(2));
}
