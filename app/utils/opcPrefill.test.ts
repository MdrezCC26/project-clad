import assert from "node:assert/strict";
import test from "node:test";
import { collectOpcPrefillFields } from "./opcPrefill";

test("keeps Galvanized colour when the OPC option value is 0", () => {
  const fields = collectOpcPrefillFields([
    { name: "L1", value: "1.5" },
    { name: "L2", value: "4.5" },
    { name: "Color Picker", value: "0000 — Galvanized" },
    { name: "field_9", value: "0" },
    { name: "Length", value: '120"' },
    { name: "Gauge", value: "18 Gauge" },
  ]);
  assert.equal(fields.l1, "1.5");
  assert.equal(fields.l2, "4.5");
  assert.equal(fields.field_1, "1.5");
  assert.equal(fields.gauge, "18 Gauge");
  assert.equal(fields.field_4, "18 Gauge");
  assert.equal(fields.color, "0000 — Galvanized");
  assert.equal(fields.field_9, "0000 — Galvanized");
  assert.equal(fields.length, '120"');
});

test("still drops unset gauge/length sentinels of 0", () => {
  const fields = collectOpcPrefillFields([
    { name: "L1", value: "2" },
    { name: "Gauge", value: "0" },
    { name: "Length", value: "0" },
  ]);
  assert.equal(fields.l1, "2");
  assert.equal(fields.gauge, undefined);
  assert.equal(fields.length, undefined);
});
