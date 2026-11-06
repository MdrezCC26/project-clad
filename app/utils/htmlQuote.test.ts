import assert from "node:assert/strict";
import test from "node:test";
import { decodeHtmlQuotes, decodePropertyValue } from "./htmlQuote";
import { collectOrderLineSpecMap } from "./orderLineSpecs";

test("decodeHtmlQuotes turns OPC inch-mark entities into a quote", () => {
  assert.equal(decodeHtmlQuotes("120&quot;"), '120"');
  assert.equal(decodeHtmlQuotes("120&QUOT;"), '120"');
  assert.equal(decodeHtmlQuotes("120&amp;quot;"), '120"');
  assert.equal(decodeHtmlQuotes("120&#34;"), '120"');
  assert.equal(decodeHtmlQuotes("120&#x22;"), '120"');
  assert.equal(decodeHtmlQuotes("26 Gauge"), "26 Gauge");
  assert.equal(decodeHtmlQuotes("8783 — Polar White"), "8783 — Polar White");
  assert.equal(decodeHtmlQuotes("Smith & Sons"), "Smith & Sons");
});

test("decodePropertyValue fixes Length inside the OPC payload without breaking JSON", () => {
  const payload =
    '{"Gauge":"26 Gauge","L1":"2","Color Picker":"8783 — Polar White","Length":"120&quot;"}';
  const decoded = decodePropertyValue(payload);
  const parsed = JSON.parse(decoded) as { Length: string; Gauge: string };
  assert.equal(parsed.Length, '120"');
  assert.equal(parsed.Gauge, "26 Gauge");
  assert.equal(decodePropertyValue("120&quot;"), '120"');
  assert.equal(decodePropertyValue('120"'), '120"');
});

test("order line specs show a decoded Length for saved OPC lines", () => {
  const { map } = collectOrderLineSpecMap([
    {
      name: "__ooCalcPayload",
      value:
        '{"Gauge":"26 Gauge","L1":"2","Length":"120&quot;","Color Picker":"8783 — Polar White"}',
    },
    { name: "Length", value: "120&quot;" },
    { name: "Gauge", value: "26 Gauge" },
    { name: "L1", value: "2" },
  ]);
  assert.equal(map.get("length"), '120"');
  assert.equal(map.get("gauge"), "26 Gauge");
  assert.equal(map.get("l1"), "2");
});
