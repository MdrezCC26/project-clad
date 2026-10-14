export type CalculatorPriceProperties = Array<{
  name: string;
  value: string;
}>;

/** Cart line that can't be priced server-side; the message is safe to show the customer. */
export class CartPricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CartPricingError";
  }
}

type StandardFormula = {
  coefficients: Partial<
    Record<"L1" | "L2" | "L3" | "L4" | "L5" | "L6", number>
  >;
  girthConstant?: number;
  labor: number;
};

const STANDARD_FORMULAS: Record<string, StandardFormula> = {
  ARCHITECTS_DRIP: {
    coefficients: { L1: 1, L2: 1, L3: 1, L4: 1, L5: 1, L6: 1 },
    labor: 7.5,
  },
  CLIP: { coefficients: { L1: 1, L2: 1, L3: 1, L4: 1 }, labor: 4.5 },
  COLUMN_CAP: {
    coefficients: { L1: 2, L2: 1, L3: 1, L4: 1 },
    labor: 6,
  },
  CORNER_EDGE: {
    coefficients: { L1: 2, L2: 2, L3: 2, L4: 1, L5: 1 },
    labor: 10.5,
  },
  DRIP_EDGE: {
    coefficients: { L1: 1, L2: 1, L3: 1, L4: 1 },
    labor: 4.5,
  },
  DRIP_EDGE_FLAT: {
    coefficients: { L1: 1, L2: 1, L3: 1 },
    labor: 3,
  },
  DRIP_EXPANSION: {
    coefficients: {},
    labor: 9,
  },
  DRIP_FACED: {
    coefficients: { L1: 1, L2: 1, L3: 1, L4: 1, L5: 1 },
    labor: 6,
  },
  DRIP_FACED_2: {
    coefficients: { L1: 1, L2: 1, L3: 1, L4: 2 },
    labor: 6,
  },
  DRIP_FACED_3: {
    coefficients: { L1: 1, L2: 1, L3: 1, L4: 1, L5: 1 },
    labor: 6,
  },
  DRIP_HEADER: {
    coefficients: { L1: 1, L2: 1, L3: 2, L4: 1, L5: 1 },
    labor: 7.5,
  },
  DRIP_JAMB: {
    coefficients: { L1: 1, L2: 1, L3: 2, L4: 1 },
    labor: 6,
  },
  FLAT_EXPANSION: {
    coefficients: {},
    labor: 4.5,
  },
  GARAGE_DOOR_CAP: {
    coefficients: { L1: 1, L2: 1, L3: 1, L4: 1, L5: 1 },
    labor: 6,
  },
  HALF_CORNER: {
    coefficients: { L1: 1, L2: 1, L3: 1, L4: 1, L5: 1 },
    labor: 6,
  },
  INDUSTRIAL_CORNER: {
    coefficients: { L1: 1, L2: 1, L3: 1, L4: 1 },
    labor: 4.5,
  },
  INSIDE_CORNER_EDGE: {
    coefficients: { L1: 2, L2: 2, L3: 2, L4: 1, L5: 1 },
    labor: 10.5,
  },
  J_TRIM: {
    coefficients: { L1: 1, L2: 1, L3: 2 },
    labor: 4.5,
  },
  J_TRIM_FULL: {
    coefficients: { L1: 1, L2: 2, L3: 2, L4: 1 },
    labor: 7.5,
  },
  J_TRIM_JAMB: {
    coefficients: { L1: 1, L2: 1, L3: 2, L4: 1 },
    labor: 6,
  },
  L_ANGLE: { coefficients: { L1: 1, L2: 1 }, labor: 2.5 },
  L_EXPANSION: {
    coefficients: {},
    labor: 6,
  },
  L_SHAPE: { coefficients: { L1: 1, L2: 1 }, labor: 2.5 },
  L_SHAPE_FASCIA: {
    coefficients: { L1: 1, L2: 1, L3: 1 },
    labor: 3,
  },
  L_SHAPE_FASCIA_DOUBLE_HEM: {
    coefficients: { L1: 1, L2: 1, L3: 2 },
    labor: 4.5,
  },
  L_TRIM_DOUBLE_OUTER_HEM: {
    coefficients: { L1: 1, L2: 1, L3: 2 },
    labor: 4.5,
  },
  L_TRIM_HEM_AND_DRIP: {
    coefficients: { L1: 1, L2: 1, L3: 1, L4: 2 },
    labor: 6,
  },
  L_TRIM_SINGLE_OUTER_HEM: {
    coefficients: { L1: 1, L2: 1, L3: 1 },
    labor: 3,
  },
  OMEGA_BAR: {
    coefficients: { L1: 1, L2: 2.3094, L3: 2 },
    labor: 6,
  },
  PARAPET_CAP: {
    coefficients: { L1: 1, L2: 1, L3: 1, L4: 2 },
    labor: 9,
  },
  REVEAL: {
    coefficients: { L1: 2, L2: 1, L3: 4, L4: 4 },
    labor: 15,
  },
  SILL_CLIP: { coefficients: { L1: 1, L2: 1, L3: 1 }, labor: 3 },
  SILL_FACED: {
    coefficients: { L1: 1, L2: 1, L3: 1, L4: 1 },
    labor: 4.5,
  },
  SILL_FACED_DOUBLE_HEM: {
    coefficients: { L1: 1, L2: 1, L3: 1, L4: 2 },
    labor: 6,
  },
  SILL_FLAT: { coefficients: { L1: 1, L2: 1, L3: 1 }, labor: 3 },
  SILL_FULL_FLAT: {
    coefficients: { L1: 1, L2: 2, L3: 1 },
    labor: 4.5,
  },
  SNOW_GUARD_BASE: { coefficients: {}, labor: 4.5 },
  SNOW_GUARD_COVER: { coefficients: {}, labor: 7.5 },
  SNOW_GUARD_KIT: { coefficients: { L1: 1 }, labor: 0 },
  STARTER: { coefficients: { L1: 1, L2: 1, L3: 1 }, labor: 3 },
  STARTER_SLIP: { coefficients: {}, labor: 4.5 },
  T_CLIP: {
    coefficients: { L1: 1, L2: 1, L3: 1, L4: 1 },
    labor: 4.5,
  },
  T_DRIP: {
    coefficients: { L1: 1, L2: 1, L3: 1, L4: 1, L5: 1 },
    labor: 6,
  },
  T_JAMB: { coefficients: { L1: 1, L2: 1, L3: 1 }, labor: 3 },
  U_BAR: { coefficients: { L1: 1, L2: 1, L3: 1 }, labor: 3 },
  U_BAR_TRIM: { coefficients: { L1: 1, L2: 1, L3: 1 }, labor: 3 },
  Z_BAR: { coefficients: { L1: 1, L2: 1, L3: 1 }, labor: 3 },
  Z_BAR_TRIM: { coefficients: { L1: 1, L2: 1, L3: 1 }, labor: 3 },
  Z_TAIL: { coefficients: { L1: 1, L2: 1, L3: 1, L4: 1 }, labor: 4.5 },
};

const GAUGE_RATES: Record<number, number> = {
  16: 0.0202674,
  18: 0.0162813,
  20: 0.0129688,
  22: 0.0116441,
  24: 0.0125868,
  26: 0.0107969,
};
const ALLOWED_LENGTHS = new Set([36, 48, 60, 96, 120]);
const CALCULATOR_NAME_ALIASES: Record<string, string> = {
  ARCHITECTS_DRIP_EDGE: "ARCHITECTS_DRIP",
  DRIP_EDGE_EXPANSION: "DRIP_EXPANSION",
  DRIP_EDGE_FACED: "DRIP_FACED",
  DRIP_EDGE_HEADER: "DRIP_HEADER",
  DRIP_EDGE_JAMB: "DRIP_JAMB",
  INSIDE_CORNER: "INSIDE_CORNER_EDGE",
  L_TRIM: "L_SHAPE",
  L_TRIM_DOUBLE_INNER_HEM: "L_SHAPE_FASCIA_DOUBLE_HEM",
  L_TRIM_SINGLE_INNER_HEM: "L_SHAPE_FASCIA",
  L_SHAPE_SINGLE_OUTER_HEM: "L_TRIM_SINGLE_OUTER_HEM",
  L_SHAPE_FASICA: "L_SHAPE_FASCIA",
  OUTSIDE_CORNER: "CORNER_EDGE",
  OUTSIDE_CORNER_EDGE: "CORNER_EDGE",
  U_BAR_CUSTOM: "U_BAR",
  U_TRIM: "U_BAR_TRIM",
  Z_BAR_CUSTOM: "Z_BAR",
  Z_TRIM: "Z_BAR_TRIM",
};

function normalizedCalculatorName(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\bCUSTOM\b/g, "")
    .replace(/\bAUG\d{4}\b/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function propertyMap(
  properties: CalculatorPriceProperties,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const property of properties) {
    result.set(property.name.trim().toUpperCase(), property.value.trim());
  }
  const packed = result.get("__OOCALCPAYLOAD");
  if (packed) {
    try {
      const parsed = JSON.parse(packed) as Record<string, unknown>;
      for (const [name, value] of Object.entries(parsed)) {
        if (!result.has(name.trim().toUpperCase())) {
          result.set(name.trim().toUpperCase(), String(value).trim());
        }
      }
    } catch {
      throw new CartPricingError("Calculator details are invalid.");
    }
  }
  return result;
}

function numericValue(map: Map<string, string>, name: string): number {
  const value = Number.parseFloat(map.get(name) ?? "");
  if (!Number.isFinite(value) || value <= 0 || value > 1_000) {
    throw new CartPricingError(`Calculator ${name} is invalid.`);
  }
  return value;
}

function angleValue(
  map: Map<string, string>,
  name: string,
  fallback: number,
  upperBound = 180,
): number {
  const value = Number.parseFloat(map.get(name) ?? "");
  return Number.isFinite(value) && value > 0 && value < upperBound
    ? value
    : fallback;
}

function angledFoldAllowance(length: number, angleDegrees: number): number {
  const halfAngleRadians = (angleDegrees * Math.PI) / 360;
  return (
    2 *
    length *
    (1 / Math.cos(halfAngleRadians) - Math.tan(halfAngleRadians))
  );
}

function calculateGirth(
  key: string,
  values: Map<string, string>,
  formula: StandardFormula,
): number {
  if (key === "DRIP_EXPANSION") {
    return (
      numericValue(values, "L1") +
      numericValue(values, "L2") +
      numericValue(values, "L3") +
      numericValue(values, "L4") +
      angledFoldAllowance(
        numericValue(values, "L6"),
        angleValue(values, "A3", 90),
      )
    );
  }
  if (key === "FLAT_EXPANSION") {
    return (
      numericValue(values, "L1") +
      angledFoldAllowance(
        numericValue(values, "L3"),
        angleValue(values, "A1", 90),
      )
    );
  }
  if (key === "L_EXPANSION") {
    return (
      numericValue(values, "L1") +
      numericValue(values, "L2") +
      angledFoldAllowance(
        numericValue(values, "L4"),
        angleValue(values, "A2", 90),
      )
    );
  }
  if (key === "SNOW_GUARD_BASE" || key === "SNOW_GUARD_COVER") {
    const l1 = numericValue(values, "L1");
    const l2 = numericValue(values, "L2");
    const l3 = numericValue(values, "L3");
    const angleRadians =
      (angleValue(values, "A1", 45, 90) * Math.PI) / 180;
    const sideMultiplier = key === "SNOW_GUARD_COVER" ? 2 : 1;
    return (
      l1 +
      l1 / Math.cos(angleRadians) +
      sideMultiplier * l2 +
      sideMultiplier * l3
    );
  }
  if (key === "STARTER_SLIP") {
    const l1 = numericValue(values, "L1");
    const l2 = numericValue(values, "L2");
    const l3 = numericValue(values, "L3");
    const l4 = numericValue(values, "L4");
    const angleRadians =
      ((180 - angleValue(values, "A1", 165)) * Math.PI) / 180;
    return l2 + (l1 - l2 - l3) / Math.cos(angleRadians) + l3 + l4;
  }

  let girth = formula.girthConstant ?? 0;
  for (const [dimension, coefficient] of Object.entries(
    formula.coefficients,
  )) {
    girth += numericValue(values, dimension) * (coefficient as number);
  }
  return girth;
}

/** Calculators whose price isn't girth × rate × length × 1.5 + labor. */
const SPECIAL_FORMULA_KEYS = ["FLAT_STOCK"];

function calculatorKey(productTitle: string): string {
  const rawNormalized = normalizedCalculatorName(productTitle);
  const normalized = CALCULATOR_NAME_ALIASES[rawNormalized] ?? rawNormalized;
  if (
    STANDARD_FORMULAS[normalized] ||
    SPECIAL_FORMULA_KEYS.includes(normalized)
  ) {
    return normalized;
  }
  const keys = Object.keys(STANDARD_FORMULAS).concat(SPECIAL_FORMULA_KEYS);
  /* "J TRIM JAMB 0.5" contains both J_TRIM and J_TRIM_JAMB — the longest key is the real profile. */
  const contained = keys
    .filter((key) => normalized.includes(key))
    .sort((a, b) => b.length - a.length);
  if (contained.length === 1) return contained[0];
  if (contained.length > 1 && contained[0].length > contained[1].length) {
    return contained[0];
  }
  const containing = keys.filter((key) => key.includes(normalized));
  if (!contained.length && containing.length === 1) return containing[0];
  throw new CartPricingError(
    `"${productTitle.trim()}" does not have server-side pricing configured yet. Remove it from the cart or contact us for a quote.`,
  );
}

/** Recomputes the canonical OPC formula exports supplied in September 2026. */
export function calculateOpcUnitPrice(args: {
  productTitle: string;
  properties: CalculatorPriceProperties;
}): string {
  const values = propertyMap(args.properties);
  if (!values.has("__OOCALCPAYLOAD") && !values.has("__OOCUSTOMPRICE")) {
    throw new CartPricingError("Calculator pricing metadata is missing.");
  }

  const key = calculatorKey(args.productTitle);

  const gauge = Math.trunc(numericValue(values, "GAUGE"));
  const rate = GAUGE_RATES[gauge];
  if (!rate) throw new CartPricingError("Calculator gauge is not supported.");

  if (key === "FLAT_STOCK") {
    /* No Length dropdown: L1 × L2 is the sheet area in square inches. */
    return finalPrice(
      numericValue(values, "L1") * numericValue(values, "L2") * rate * 1.5,
    );
  }

  const length = numericValue(values, "LENGTH");
  if (!ALLOWED_LENGTHS.has(length)) {
    throw new CartPricingError("Calculator length is not supported.");
  }

  const formula = STANDARD_FORMULAS[key];
  const girth = calculateGirth(key, values, formula);
  const price = girth * rate * length * 1.5 + formula.labor;

  return finalPrice(price);
}

function finalPrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0 || price > 99_999_999) {
    throw new CartPricingError("Calculator price is invalid.");
  }
  return price.toFixed(2);
}
