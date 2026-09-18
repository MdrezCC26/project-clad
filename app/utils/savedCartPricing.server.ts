import prisma from "../db.server";
import { getAdminVariantInfo } from "./adminVariants.server";
import {
  calculateOpcUnitPrice,
  type CalculatorPriceProperties,
} from "./calculatorPricing.server";

export type SavedCartPricingLine = {
  variantId: string;
  quantity: number;
  properties?: CalculatorPriceProperties;
};

const FREEFORM_GAUGE_RATES: Record<number, number> = {
  16: 0.0153819,
  18: 0.0112875,
  20: 0.0094479,
  22: 0.0077833,
  24: 0.0104167,
  26: 0.0082458,
};

function propertiesMap(
  properties: CalculatorPriceProperties | undefined,
): Map<string, string> {
  return new Map(
    (properties ?? []).map((property) => [
      property.name.trim().toLowerCase(),
      property.value.trim(),
    ]),
  );
}

function positiveNumber(
  properties: Map<string, string>,
  name: string,
  fallback?: number,
): number {
  const raw = properties.get(name.toLowerCase());
  if (!raw && fallback !== undefined) return fallback;
  const value = Number.parseFloat(raw ?? "");
  if (!Number.isFinite(value) || value <= 0 || value > 10_000) {
    throw new Error(`Cart ${name} is invalid.`);
  }
  return value;
}

function calculateFreeformPrice(properties: Map<string, string>): string {
  const gauge = Math.trunc(positiveNumber(properties, "Gauge"));
  const rate = FREEFORM_GAUGE_RATES[gauge];
  if (!rate) throw new Error("Cart gauge is not supported.");
  const girth = positiveNumber(properties, "Girth");
  const length = positiveNumber(properties, "Length", 120);
  const bendsRaw = Number.parseFloat(properties.get("bends") ?? "0");
  if (!Number.isFinite(bendsRaw) || bendsRaw < 0 || bendsRaw > 100) {
    throw new Error("Cart bends are invalid.");
  }
  return (rate * girth * length * 1.5 + bendsRaw * 2.5).toFixed(2);
}

export async function getAuthoritativeSavedCartPrices(
  shop: string,
  lines: SavedCartPricingLine[],
): Promise<string[]> {
  if (!lines.length || lines.length > 250) {
    throw new Error("Cart pricing could not be verified.");
  }

  const variants = await getAdminVariantInfo(
    shop,
    lines.map((line) => line.variantId),
  );
  if (
    Object.keys(variants).length !==
    new Set(lines.map((line) => line.variantId)).size
  ) {
    throw new Error("One or more cart products no longer exist.");
  }

  const customGaugeValues = new Map(
    (
      await prisma.gaugeConfig.findMany({
        where: { shop },
        select: { gauge: true, value: true },
      })
    ).map((config) => [config.gauge, Number(config.value)]),
  );

  return lines.map((line) => {
    const variant = variants[line.variantId];
    const properties = propertiesMap(line.properties);
    if (
      properties.has("__oocalcpayload") ||
      properties.has("__oocustomprice")
    ) {
      return calculateOpcUnitPrice({
        productTitle: variant.productTitle,
        properties: line.properties ?? [],
      });
    }

    const shapeType = properties.get("shape_type")?.toLowerCase();
    if (shapeType === "custom") {
      return calculateFreeformPrice(properties);
    }
    if (shapeType && ["l", "z", "u"].includes(shapeType)) {
      const gauge = Math.trunc(positiveNumber(properties, "Gauge"));
      const rate = customGaugeValues.get(gauge);
      if (!rate || !Number.isFinite(rate) || rate <= 0) {
        throw new Error("Cart gauge pricing is not configured.");
      }
      const girth =
        positiveNumber(properties, "L1") +
        positiveNumber(properties, "L2") +
        (shapeType === "l" ? 0 : positiveNumber(properties, "L3"));
      return (rate * girth * 10).toFixed(2);
    }

    if (!/^\d+(?:\.\d+)?$/.test(variant.price)) {
      throw new Error("Shopify returned an invalid product price.");
    }
    return Number(variant.price).toFixed(2);
  });
}
