import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateOpcUnitPrice,
  CartPricingError,
} from "./calculatorPricing.server";

const properties = (values: Record<string, string>) => [
  {
    name: "__ooCalcPayload",
    value: JSON.stringify(values),
  },
  {
    name: "__ooCustomPrice",
    value: "0.01",
  },
];

test("recomputes a standard OPC formula and ignores submitted price", () => {
  assert.equal(
    calculateOpcUnitPrice({
      productTitle: "L Shape",
      properties: properties({
        Gauge: "24 Gauge",
        Length: '120"',
        L1: "2",
        L2: "3",
      }),
    }),
    "11.88",
  );
});

test("recomputes the Omega Bar sheet-yield formula", () => {
  assert.equal(
    calculateOpcUnitPrice({
      productTitle: "Omega Bar",
      properties: properties({
        Gauge: "22 Gauge",
        Length: '120"',
        L1: "2",
        L2: "1",
        L3: "1",
      }),
    }),
    "13.57",
  );
});

test("rejects unsupported calculator lengths", () => {
  assert.throws(
    () =>
      calculateOpcUnitPrice({
        productTitle: "L Shape",
        properties: properties({
          Gauge: "24 Gauge",
          Length: '72"',
          L1: "2",
          L2: "3",
        }),
      }),
    /length is not supported/i,
  );
});

test("rejects products without a canonical formula", () => {
  assert.throws(
    () =>
      calculateOpcUnitPrice({
        productTitle: "Unknown Calculator",
        properties: properties({
          Gauge: "24 Gauge",
          Length: '120"',
          L1: "2",
        }),
      }),
    (error: unknown) =>
      error instanceof CartPricingError &&
      /"Unknown Calculator" does not have server-side pricing configured/.test(
        error.message,
      ),
  );
});

test("Drip Faced 3 uses its own five-leg formula, not Drip Faced", () => {
  assert.equal(
    calculateOpcUnitPrice({
      productTitle: "Drip Faced 3",
      properties: properties({
        Gauge: "24 Gauge",
        Length: '120"',
        L1: "2",
        L2: "2",
        L3: "2",
        L4: "2",
        L5: "2",
      }),
    }),
    "28.75",
  );
});

test("Flat Stock prices by sheet area without a Length field", () => {
  assert.equal(
    calculateOpcUnitPrice({
      productTitle: "Flat Stock",
      properties: properties({
        Gauge: "24 Gauge",
        L1: "12",
        L2: "120",
      }),
    }),
    "27.50",
  );
});

test("sized titles use the longest matching profile", () => {
  const dims = properties({
    Gauge: "24 Gauge",
    Length: '120"',
    L1: "2",
    L2: "2",
    L3: "2",
    L4: "2",
  });
  assert.equal(
    calculateOpcUnitPrice({ productTitle: "J TRIM JAMB 0.5", properties: dims }),
    calculateOpcUnitPrice({ productTitle: "J Trim Jamb", properties: dims }),
  );
});

test("covers every supplied OPC calculator export", () => {
  const calculatorNames = [
    "Architects Drip",
    "Architects Drip Edge",
    "Clip",
    "Column Cap",
    "Corner Edge",
    "Drip Edge",
    "Drip Expansion",
    "Drip Faced",
    "Drip Edge Faced",
    "Drip Faced 2",
    "Drip Faced 3",
    "Drip Header",
    "Drip Edge Header",
    "Drip Jamb",
    "Drip Edge Jamb",
    "Flat Expansion",
    "Flat Stock",
    "Garage Door Cap",
    "Inside Corner Edge",
    "J Trim",
    "J Trim Full",
    "J Trim Jamb",
    "L Angle",
    "L Expansion",
    "L Shape",
    "L Shape Fascia",
    "L Shape Fascia Double Hem",
    "Omega Bar",
    "Parapet Cap",
    "Sill Clip",
    "Sill Faced",
    "Sill Flat",
    "Sill Full Flat",
    "Snow Guard Base",
    "Snow Guard Cover",
    "Starter",
    "T Jamb",
    "U Bar",
    "U Bar Trim",
    "Z Bar",
    "Z Bar Trim",
    "Z Tail",
  ];
  const commonProperties = properties({
    Gauge: "24 Gauge",
    Length: '120"',
    L1: "2",
    L2: "2",
    L3: "2",
    L4: "2",
    L5: "2",
  });

  for (const productTitle of calculatorNames) {
    assert.match(
      calculateOpcUnitPrice({
        productTitle,
        properties: commonProperties,
      }),
      /^\d+\.\d{2}$/,
      productTitle,
    );
  }
});
