/**
 * Batch-update OPC calculator JSONs to TEMPLATE V3 pricing (formulas, gauges, colours, length).
 */
import fs from "node:fs";
import path from "node:path";

const JSONS_DIR = path.resolve(
  "C:/Users/MichaelDrezin/Desktop/Pricing/JSONS",
);

type Field = Record<string, unknown> & {
  keyName?: string;
  type?: string;
  options?: Array<Record<string, unknown>>;
};

type CalculatorJson = {
  name: string;
  fields: Field[][];
  formula: string;
  design?: Record<string, unknown>;
  settings?: Record<string, unknown>;
};

const GALVANIZED_LABEL = "0000 — Galvanized";

const PROFILE_SPECS: Record<
  string,
  { bracket: string; gauges: number[]; colorMode: "galvanized" | "painted" }
> = {
  "ARCHITECTS DRIP.json": {
    bracket: "( field_1 + field_2 + field_3 + field_7 + 1.5 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "CORNER EDGE.json": {
    bracket:
      "( field_1 + field_2 + field_3 + field_7 + field_1 + field_2 + field_3 + field_7 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "DRIP EDGE.json": {
    bracket: "( field_1 + field_2 + field_3 + field_3 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "DRIP EXPANSION.json": {
    bracket: "( field_1 + field_2 + field_3 + 3.5 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "DRIP FACED.json": {
    bracket: "( field_1 + field_2 + field_3 + 1.5 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "DRIP HEADER.json": {
    bracket: "( field_1 + field_2 + field_3 + field_3 + field_2 + field_7 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "DRIP JAMB.json": {
    bracket: "( field_1 + field_2 + field_3 + 1.5 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "FLAT EXPANSION.json": {
    bracket: "( field_1 + field_2 + 2 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "FLAT STOCK.json": {
    bracket: "( field_1 * field_2 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "INSIDE CORNER EDGE.json": {
    bracket:
      "( field_1 + field_2 + field_3 + field_7 + field_1 + field_2 + field_3 + field_7 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "J TRIM FULL.json": {
    bracket: "( field_1 + field_2 + field_2 + field_3 + field_3 + field_7 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "J TRIM JAMB.json": {
    bracket: "( field_1 + field_2 + field_3 + field_7 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "J TRIM.json": {
    bracket: "( field_1 + field_2 + field_3 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "L ANGLE.json": {
    bracket: "( field_1 + field_2 )",
    gauges: [16, 18, 20, 22],
    colorMode: "galvanized",
  },
  "L EXPANSION.json": {
    bracket: "( field_1 + field_2 + field_3 + 2 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "L SHAPE FASCIA DOUBLE HEM.json": {
    bracket: "( field_1 + field_2 + field_3 + field_3 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "L SHAPE FASICA.json": {
    bracket: "( field_1 + field_2 + field_3 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "L SHAPE.json": {
    bracket: "( field_1 + field_2 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "OMEGA BAR.json": {
    bracket: "( field_1 + field_2 + field_2 + field_3 + field_3 )",
    gauges: [16, 18, 20, 22],
    colorMode: "galvanized",
  },
  "PARAPET CAP.json": {
    bracket: "( field_1 + field_2 + field_3 + 3 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "SILL CLIP.json": {
    bracket: "( field_1 + field_2 + field_3 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "SILL FACED.json": {
    bracket: "( field_1 + field_2 + field_3 + field_3 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "SILL FLAT.json": {
    bracket: "( field_1 + field_2 + field_2 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "SILL FULL FLAT.json": {
    bracket: "( field_1 + field_2 + field_2 + field_3 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "SNOW GUARD BASE.json": {
    bracket: "( field_1 )",
    gauges: [16, 18, 20, 22],
    colorMode: "galvanized",
  },
  "SNOW GUARD COVER.json": {
    bracket: "( field_1 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "SNOW GUARD KIT.json": {
    bracket: "( field_1 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "STARTER.json": {
    bracket: "( field_1 + field_2 + field_3 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "T JAMB.json": {
    bracket: "( field_1 + field_2 + field_3 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "U BAR TRIM.json": {
    bracket: "( field_1 + field_2 + field_3 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "U BAR.json": {
    bracket: "( field_1 + field_2 + field_3 )",
    gauges: [16, 18, 20, 22],
    colorMode: "galvanized",
  },
  "Z BAR TRIM.json": {
    bracket: "( field_1 + field_2 + field_3 )",
    gauges: [24, 26],
    colorMode: "painted",
  },
  "Z BAR.json": {
    bracket: "( field_1 + field_2 + field_3 )",
    gauges: [16, 18, 20, 22],
    colorMode: "galvanized",
  },
};

function flattenFields(fields: Field[][]): Field[] {
  return fields.map((row) => row[0]).filter(Boolean);
}

function gaugeNumber(label: unknown): number | null {
  if (typeof label !== "string") return null;
  const m = label.match(/^(\d+)\s+Gauge$/);
  return m ? Number(m[1]) : null;
}

function findField(fields: Field[][], keyName: string): Field | undefined {
  return flattenFields(fields).find((f) => f.keyName === keyName);
}

function insertFieldAfter(
  data: CalculatorJson,
  afterKeyName: string | null,
  field: Field,
): void {
  const flat = flattenFields(data.fields);
  const afterIdx =
    afterKeyName === null
      ? -1
      : flat.findIndex((f) => f.keyName === afterKeyName);
  const insertAt = afterIdx >= 0 ? afterIdx + 1 : flat.length;
  data.fields.splice(insertAt, 0, [field]);
}

function ensureLegField(
  data: CalculatorJson,
  keyName: string,
  templateLeg: Field,
  afterKeyName: string | null,
): void {
  if (findField(data.fields, keyName)) return;
  if (!data.formula.includes(keyName)) return;

  const legField: Field = {
    ...structuredClone(templateLeg),
    id: `${String(templateLeg.id)}_${keyName}_import`,
  };
  insertFieldAfter(data, afterKeyName, legField);
}

function ensureL4Field(data: CalculatorJson, templateL4: Field): void {
  ensureLegField(data, "field_7", templateL4, "field_3");
}

function ensureL3Field(data: CalculatorJson, templateL3: Field): void {
  ensureLegField(data, "field_3", templateL3, "field_2");
}

function ensureLengthField(data: CalculatorJson, templateLength: Field): void {
  if (findField(data.fields, "field_10")) return;
  data.fields.push([structuredClone(templateLength)]);
}

function updateGaugeOptions(
  gaugeField: Field,
  templateGauge: Field,
  allowedGauges: number[],
): void {
  const templateOptions = templateGauge.options ?? [];
  const filtered = templateOptions.filter((opt) => {
    const n = gaugeNumber(opt.label);
    return n !== null && allowedGauges.includes(n);
  });
  gaugeField.options = structuredClone(filtered);
}

function updateColorOptions(
  colorField: Field,
  templateColor: Field,
  colorMode: "galvanized" | "painted",
): void {
  const templateOptions = templateColor.options ?? [];
  const filtered = templateOptions.filter((opt) => {
    const label = String(opt.label ?? "");
    const isGalvanized = label === GALVANIZED_LABEL;
    return colorMode === "galvanized" ? isGalvanized : !isGalvanized;
  });
  colorField.options = structuredClone(filtered);
}

function syncLengthField(lengthField: Field, templateLength: Field): void {
  lengthField.type = templateLength.type;
  lengthField.label = templateLength.label;
  lengthField.keyName = templateLength.keyName;
  lengthField.options = structuredClone(templateLength.options ?? []);
  lengthField.required = templateLength.required;
  lengthField.placeholder = templateLength.placeholder;
  lengthField.defaultOptionIndex = templateLength.defaultOptionIndex;
  lengthField.value = templateLength.value;
}

function main(): void {
  const templatePath = path.join(JSONS_DIR, "TEMPLATE V3.json");
  const template = JSON.parse(
    fs.readFileSync(templatePath, "utf8"),
  ) as CalculatorJson;

  const templateGauge = findField(template.fields, "field_4");
  const templateColor = findField(template.fields, "field_9");
  const templateLength = findField(template.fields, "field_10");
  const templateL3 = findField(template.fields, "field_3");
  const templateL4 = findField(template.fields, "field_7");

  if (
    !templateGauge ||
    !templateColor ||
    !templateLength ||
    !templateL3 ||
    !templateL4
  ) {
    throw new Error("TEMPLATE V3 missing required reference fields");
  }

  const updated: string[] = [];
  const skipped: string[] = [];

  for (const fileName of fs.readdirSync(JSONS_DIR)) {
    if (!fileName.endsWith(".json")) continue;
    if (fileName.startsWith("TEMPLATE")) {
      skipped.push(fileName);
      continue;
    }

    const spec = PROFILE_SPECS[fileName];
    if (!spec) {
      console.warn(`No spec for ${fileName} — skipped`);
      skipped.push(fileName);
      continue;
    }

    const filePath = path.join(JSONS_DIR, fileName);
    const data = JSON.parse(
      fs.readFileSync(filePath, "utf8"),
    ) as CalculatorJson;

    data.formula = `${spec.bracket} * field_4 * field_10 * 1.6`;

    ensureL3Field(data, templateL3);
    ensureL4Field(data, templateL4);
    ensureLengthField(data, templateLength);

    const gaugeField = findField(data.fields, "field_4");
    const colorField = findField(data.fields, "field_9");
    const lengthField = findField(data.fields, "field_10");

    if (!gaugeField || !colorField || !lengthField) {
      throw new Error(`${fileName}: missing gauge, color, or length field`);
    }

    updateGaugeOptions(gaugeField, templateGauge, spec.gauges);
    updateColorOptions(colorField, templateColor, spec.colorMode);
    syncLengthField(lengthField, templateLength);

    data.design = {
      ...data.design,
      ...template.design,
      backgroundColor: "#ffffff",
    };
    data.settings = {
      ...data.settings,
      useFormula: true,
    };

    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    updated.push(fileName);
  }

  console.log(`Updated ${updated.length} profiles:`);
  for (const f of updated.sort()) console.log(`  ✓ ${f}`);
  if (skipped.length) {
    console.log(`Skipped: ${skipped.join(", ")}`);
  }
}

main();
