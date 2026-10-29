import assert from "node:assert/strict";
import test from "node:test";
import { isReorderEligibleOrderLifecycle } from "./jobDelivery";
import {
  allocateReorderOrderName,
  customPartDrawingFromProperties,
  defaultReorderOrderName,
  linePropertiesFromCustomData,
  orderLineCaptureForReorder,
  parseReorderQuantityOverrides,
  selectReorderLines,
} from "./reorderDeliveredOrder";

test("whole-order reorder is offered for delivered and paid orders only", () => {
  assert.equal(isReorderEligibleOrderLifecycle("delivered"), true);
  assert.equal(isReorderEligibleOrderLifecycle("paid"), true);
  assert.equal(isReorderEligibleOrderLifecycle("ordered"), false);
  assert.equal(isReorderEligibleOrderLifecycle("draft"), false);
  assert.equal(isReorderEligibleOrderLifecycle("ready_to_order"), false);
  assert.equal(isReorderEligibleOrderLifecycle("pending_review"), false);
  assert.equal(isReorderEligibleOrderLifecycle(null), false);
});

test("default reorder name uses the source order name", () => {
  assert.equal(defaultReorderOrderName("West wall"), "Reorder of West wall");
  assert.equal(defaultReorderOrderName("  "), "Reorder of order");
  const long = "A".repeat(200);
  const named = defaultReorderOrderName(long);
  assert.equal(named.length, 180);
  assert.ok(named.startsWith("Reorder of "));
  assert.ok(named.endsWith("…"));
});

test("allocateReorderOrderName avoids collisions", () => {
  const first = allocateReorderOrderName("", "West wall", []);
  assert.deepEqual(first, { ok: true, name: "Reorder of West wall" });
  const second = allocateReorderOrderName("", "West wall", [
    "Reorder of West wall",
  ]);
  assert.deepEqual(second, { ok: true, name: "Reorder of West wall (2)" });
  const custom = allocateReorderOrderName("  Site B  ", "West wall", []);
  assert.deepEqual(custom, { ok: true, name: "Site B" });
});

test("selectReorderLines copies quantities without mutating the source", () => {
  const items = [
    {
      id: "b",
      variantId: "var-b",
      quantity: 1,
      sortOrder: 2,
      customData: [{ name: "Colour", value: "Black" }],
    },
    {
      id: "a",
      variantId: "var-a",
      quantity: 4,
      sortOrder: 1,
      customData: [
        { name: "shape_type", value: "L" },
        { name: "Gauge", value: "24" },
        { name: "Colour", value: "Charcoal" },
      ],
    },
  ];
  const selected = selectReorderLines(items, new Map([["a", 2], ["b", 0]]));
  assert.equal(selected.ok, true);
  if (!selected.ok) return;
  assert.equal(items[1].quantity, 4);
  assert.equal(selected.lines.length, 1);
  assert.equal(selected.lines[0].id, "a");
  assert.equal(selected.lines[0].quantity, 2);
  assert.equal(selected.lines[0].customData[2].value, "Charcoal");
});

test("selectReorderLines rejects a line with no variant and an empty reorder", () => {
  const missing = selectReorderLines(
    [{ id: "a", variantId: " ", quantity: 1, sortOrder: 1 }],
    new Map(),
  );
  assert.deepEqual(missing, {
    ok: false,
    error: "A line has no product variant to reorder.",
  });
  const empty = selectReorderLines(
    [{ id: "a", variantId: "v", quantity: 3, sortOrder: 1 }],
    new Map([["a", 0]]),
  );
  assert.deepEqual(empty, {
    ok: false,
    error: "Enter a quantity on at least one line.",
  });
});

test("parseReorderQuantityOverrides reads qty_ fields", () => {
  const form = new FormData();
  form.set("intent", "reorder-delivered-order");
  form.set("qty_itemA", "6");
  form.set("qty_itemB", "0");
  form.set("note", "ignore");
  const parsed = parseReorderQuantityOverrides(form.entries());
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.overrides.get("itemA"), 6);
  assert.equal(parsed.overrides.get("itemB"), 0);
  assert.equal(parsed.overrides.size, 2);

  const bad = new FormData();
  bad.set("qty_itemA", "1.5");
  const rejected = parseReorderQuantityOverrides(bad.entries());
  assert.equal(rejected.ok, false);
});

test("order line capture keeps the label and stores the new price", () => {
  const capture = orderLineCaptureForReorder(
    {
      v: 1,
      displayLabel: "J-trim — 24ga",
      variantId: "old",
      sku: "JT-24",
      unitPrice: "10.00",
      capturedAt: "2020-01-01T00:00:00.000Z",
    },
    "var-1",
    "12.50",
  );
  assert.equal(capture.displayLabel, "J-trim — 24ga");
  assert.equal(capture.sku, "JT-24");
  assert.equal(capture.variantId, "var-1");
  assert.equal(capture.unitPrice, "12.50");
  assert.notEqual(capture.capturedAt, "2020-01-01T00:00:00.000Z");
});

test("custom part drawing reads shape, gauge, and legs", () => {
  const props = linePropertiesFromCustomData([
    { name: "shape_type", value: "Z" },
    { name: "L1", value: "2" },
    { name: "L2", value: "3" },
    { name: "L3", value: "1.5" },
    { name: "Gauge", value: "22" },
    { name: "Colour", value: "Black" },
  ]);
  assert.equal(props.find((p) => p.name === "Colour")?.value, "Black");
  assert.deepEqual(customPartDrawingFromProperties(props), {
    shapeType: "Z",
    l1: 2,
    l2: 3,
    l3: 1.5,
    a1: undefined,
    gauge: 22,
  });
  assert.equal(
    customPartDrawingFromProperties([{ name: "Colour", value: "Red" }]),
    null,
  );
});
