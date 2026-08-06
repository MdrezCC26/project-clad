import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { shopStringFilter } from "./projectAccess.server";
import { DEFAULT_SHOP_DELIVERY_FEE } from "./shopDeliveryFee";

export { DEFAULT_SHOP_DELIVERY_FEE, parseDeliveryFeeFromForm } from "./shopDeliveryFee";

/**
 * `prefetchedSettings` lets a caller that already loaded `ShopSettings` skip a repeat query —
 * pass `null` to mean "there is no row". Rendering a project used to read the table three times.
 */
export async function getShopDeliveryFee(
  shop: string,
  prefetchedSettings?: { deliveryFeeAmount: Prisma.Decimal | null } | null,
): Promise<number> {
  const row =
    prefetchedSettings !== undefined
      ? prefetchedSettings
      : await prisma.shopSettings.findFirst({
          where: { shop: shopStringFilter(shop) },
          select: { deliveryFeeAmount: true },
        });
  if (row?.deliveryFeeAmount != null) {
    const n = Number(row.deliveryFeeAmount);
    if (Number.isFinite(n) && n >= 0) return Math.round(n * 100) / 100;
  }
  return DEFAULT_SHOP_DELIVERY_FEE;
}

export function deliveryFeeToDecimal(amount: number): Prisma.Decimal {
  return new Prisma.Decimal(amount.toFixed(2));
}
