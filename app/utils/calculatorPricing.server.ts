export type CalculatorPriceProperties = Array<{
  name: string;
  value: string;
}>;

type StandardFormula = {
  coefficients: Partial<Record<"L1" | "L2" | "L3" | "L4" | "L5", number>>;
  girthConstant?: number;
  labor: number;
};

const STANDARD_FORMULAS: Record<string, StandardFormula> = {
  ARCHITECTS_DRIP: {
    coefficients: { L1: 1, L2: 1, L3: 1, L4: 1 },
    girthConstant: 1.5,
    labor: 10,
  },
  CLIP: { coefficients: { L1: 1, L2: 1, L3: 1, L4: 1 }, labor: 7.5 },
  CORNER_EDGE: {
    coefficients: { L1: 2, L2: 2, L3: 2, L4: 2 },
    labor: 17.5,
  },
  DRIP_EDGE: { coefficients: { L1: 1, L2: 1, L3: 2 }, labor: 7.5 },
  DRIP_EXPANSION: {
    coefficients: { L1: 1, L2: 1, L3: 1 },
    girthConstant: 3.5,
    labor: 7.5,
  },
  DRIP_FACED: {
    coefficients: { L1: 1, L2: 1, L3: 1 },
    girthConstant: 1.5,
    labor: 7.5,
  },
  DRIP_FACED_2: {
    coefficients: { L1: 1, L2: 1, L3: 1, L4: 2 },
    labor: 10,
  },
  DRIP_HEADER: {
    coefficients: { L1: 1, L2: 2, L3: 2, L4: 1 },
    labor: 12.5,
  },
  DRIP_JAMB: {
    coefficients: { L1: 1, L2: 1, L3: 1 },
    girthConstant: 1.5,
    labor: 7.5,
  },
  FLAT_EXPANSION: {
    coefficients: { L1: 1, L2: 1 },
    girthConstant: 2,
    labor: 5,
  },
  GARAGE_DOOR_CAP: {
    coefficients: { L1: 1, L2: 1, L3: 1, L4: 1, L5: 1 },
    labor: 10,
  },
  INSIDE_CORNER_EDGE: {
    coefficients: { L1: 2, L2: 2, L3: 2, L4: 2 },
    labor: 17.5,
  },
  J_TRIM: { coefficients: { L1: 1, L2: 1, L3: 1 }, labor: 5 },
  J_TRIM_FULL: {
    coefficients: { L1: 1, L2: 2, L3: 2, L4: 1 },
    labor: 12.5,
  },
  J_TRIM_JAMB: {
    coefficients: { L1: 1, L2: 1, L3: 1, L4: 1 },
    labor: 7.5,
  },
  L_ANGLE: { coefficients: { L1: 1, L2: 1 }, labor: 2.5 },
  L_EXPANSION: {
    coefficients: { L1: 1, L2: 1, L3: 1 },
    girthConstant: 2,
    labor: 7.5,
  },
  L_SHAPE: { coefficients: { L1: 1, L2: 1 }, labor: 2.5 },
  L_SHAPE_FASCIA: {
    coefficients: { L1: 1, L2: 1, L3: 1 },
    labor: 5,
  },
  L_SHAPE_FASCIA_DOUBLE_HEM: {
    coefficients: { L1: 1, L2: 1, L3: 2 },
    labor: 7.5,
  },
  PARAPET_CAP: {
    coefficients: { L1: 1, L2: 1, L3: 1 },
    girthConstant: 3,
    labor: 7.5,
  },
  SILL_CLIP: { coefficients: { L1: 1, L2: 1, L3: 1 }, labor: 5 },
  SILL_FACED: {
    coefficients: { L1: 1, L2: 1, L3: 2 },
    labor: 7.5,
  },
  SILL_FLAT: { coefficients: { L1: 1, L2: 2 }, labor: 5 },
  SILL_FULL_FLAT: {
    coefficients: { L1: 1, L2: 2, L3: 1 },
    labor: 7.5,
  },
  SNOW_GUARD_BASE: { coefficients: { L1: 1 }, labor: 0 },
  SNOW_GUARD_COVER: { coefficients: { L1: 1 }, labor: 0 },
  STARTER: { coefficients: { L1: 1, L2: 1, L3: 1 }, labor: 5 },
  T_JAMB: { coefficients: { L1: 1, L2: 1, L3: 1 }, labor: 5 },
  U_BAR: { coefficients: { L1: 1, L2: 1, L3: 1 }, labor: 5 },
  U_BAR_TRIM: { coefficients: { L1: 1, L2: 1, L3: 1 }, labor: 5 },
  Z_BAR: { coefficients: { L1: 1, L2: 1, L3: 1 }, labor: 5 },
  Z_BAR_TRIM: { coefficients: { L1: 1, L2: 1, L3: 1 }, labor: 5 },
};

const GAUGE_RATES: Record<number, number> = {
  16: 0.0153819,
  18: 0.0112875,
  20: 0.0094479,
  22: 0.0077833,
  24: 0.0104167,
  26: 0.0082458,
};
const ALLOWED_LENGTHS = new Set([36, 48, 60, 96, 120]);
const CALCULATOR_NAME_ALIASES: Record<string, string> = {
  ARCHITECTS_DRIP_EDGE: "ARCHITECTS_DRIP",
  DRIP_EDGE_FACED: "DRIP_FACED",
  DRIP_EDGE_HEADER: "DRIP_HEADER",
  DRIP_EDGE_JAMB: "DRIP_JAMB",
  L_SHAPE_FASICA: "L_SHAPE_FASCIA",
  U_BAR_CUSTOM: "U_BAR",
  Z_BAR_CUSTOM: "Z_BAR",
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
      throw new Error("Calculator details are invalid.");
    }
  }
  return result;
}

function numericValue(map: Map<string, string>, name: string): number {
  const value = Number.parseFloat(map.get(name) ?? "");
  if (!Number.isFinite(value) || value <= 0 || value > 1_000) {
    throw new Error(`Calculator ${name} is invalid.`);
  }
  return value;
}

function calculatorKey(productTitle: string): string {
  const rawNormalized = normalizedCalculatorName(productTitle);
  const normalized = CALCULATOR_NAME_ALIASES[rawNormalized] ?? rawNormalized;
  if (STANDARD_FORMULAS[normalized] || normalized === "OMEGA_BAR") {
    return normalized;
  }
  const candidates = Object.keys(STANDARD_FORMULAS)
    .concat("OMEGA_BAR")
    .filter((key) => normalized.includes(key) || key.includes(normalized));
  if (candidates.length === 1) return candidates[0];
  throw new Error(
    "This calculator does not have server-side pricing configured.",
  );
}

/** Recomputes the canonical OPC formula exports supplied in September 2026. */
export function calculateOpcUnitPrice(args: {
  productTitle: string;
  properties: CalculatorPriceProperties;
}): string {
  const values = propertyMap(args.properties);
  if (!values.has("__OOCALCPAYLOAD") && !values.has("__OOCUSTOMPRICE")) {
    throw new Error("Calculator pricing metadata is missing.");
  }

  const gauge = Math.trunc(numericValue(values, "GAUGE"));
  const rate = GAUGE_RATES[gauge];
  if (!rate) throw new Error("Calculator gauge is not supported.");

  const length = numericValue(values, "LENGTH");
  if (!ALLOWED_LENGTHS.has(length)) {
    throw new Error("Calculator length is not supported.");
  }

  const key = calculatorKey(args.productTitle);
  let price: number;
  if (key === "OMEGA_BAR") {
    const girth =
      numericValue(values, "L1") +
      numericValue(values, "L2") * 2 +
      numericValue(values, "L3") * 2;
    const piecesPerSheet = Math.floor(48 / girth);
    if (piecesPerSheet < 1) throw new Error("Calculator girth is too large.");
    price = ((rate * 48 * length) / piecesPerSheet) * 1.35 + 6;
  } else {
    const formula = STANDARD_FORMULAS[key];
    let girth = formula.girthConstant ?? 0;
    for (const [dimension, coefficient] of Object.entries(
      formula.coefficients,
    )) {
      girth += numericValue(values, dimension) * (coefficient as number);
    }
    price = girth * rate * length * 1.5 + formula.labor;
  }

  if (!Number.isFinite(price) || price <= 0 || price > 99_999_999) {
    throw new Error("Calculator price is invalid.");
  }
  return price.toFixed(2);
}
