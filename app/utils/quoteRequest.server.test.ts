import assert from "node:assert/strict";
import test from "node:test";
import {
  QUOTE_MAX_FILE_BYTES,
  generateQuoteReference,
  parseQuoteRequestForm,
} from "./quoteRequest.server";

function baseForm(mode: string): FormData {
  const fd = new FormData();
  fd.append("contact_name", "Pat Builder");
  fd.append("email", "pat@example.com");
  fd.append("phone", "613-555-0100");
  fd.append("mode", mode);
  fd.append("order_gauge", "");
  return fd;
}

const pdf = (name = "plan.pdf", bytes = 10) =>
  new File([new Uint8Array(bytes)], name, { type: "application/pdf" });

test("drawings mode needs a drawing or notes", async () => {
  const empty = await parseQuoteRequestForm(baseForm("DRAWINGS"));
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.fieldErrors.drawings, "Upload a drawing or fill in Notes");

  const withNotes = baseForm("DRAWINGS");
  withNotes.append("parts_notes", "40 pcs drip edge, 10ft");
  const notesResult = await parseQuoteRequestForm(withNotes);
  assert.equal(notesResult.ok, true);
  if (notesResult.ok) assert.equal(notesResult.value.lineItems.length, 0);

  const withFile = baseForm("DRAWINGS");
  withFile.append("drawings[]", pdf());
  withFile.append("colours[]", "Black");
  withFile.append("colours[]", " black ");
  withFile.append("colours[]", "Charcoal");
  const fileResult = await parseQuoteRequestForm(withFile);
  assert.equal(fileResult.ok, true);
  if (fileResult.ok) {
    assert.equal(fileResult.value.drawings.length, 1);
    assert.deepEqual(fileResult.value.colours, ["Black", "Charcoal"]);
  }
});

test("itemized mode needs at least one part with description and quantity", async () => {
  const none = await parseQuoteRequestForm(baseForm("ITEMIZED"));
  assert.equal(none.ok, false);
  if (!none.ok) assert.equal(none.fieldErrors.parts, "Add at least one part");

  const bad = baseForm("ITEMIZED");
  bad.append("part_count", "1");
  bad.append("parts[0][description]", "");
  bad.append("parts[0][quantity]", "0");
  const badResult = await parseQuoteRequestForm(bad);
  assert.equal(badResult.ok, false);
  if (!badResult.ok) {
    assert.equal(badResult.fieldErrors["parts[0][description]"], "Describe the profile");
    assert.equal(badResult.fieldErrors["parts[0][quantity]"], "Quantity must be at least 1");
  }
});

test("itemized parts inherit order gauge and drawings unless overridden", async () => {
  const fd = baseForm("ITEMIZED");
  fd.set("order_gauge", "24 ga");
  fd.append("part_count", "2");
  fd.append("parts[0][description]", "Z bar");
  fd.append("parts[0][quantity]", "12");
  fd.append("parts[0][gauge]", "");
  fd.append("parts[0][drawing_source]", "order");
  fd.append("parts[1][description]", "Drip cap");
  fd.append("parts[1][quantity]", "3");
  fd.append("parts[1][gauge]", "26 ga");
  fd.append("parts[1][drawing_source]", "own");
  fd.append("parts[1][files][]", pdf("drip.pdf"));
  fd.append("parts[1][material]", "Aluminum");

  const result = await parseQuoteRequestForm(fd);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const [first, second] = result.value.lineItems;
  assert.equal(result.value.gauge, "24 ga");
  assert.equal(first.gauge, null);
  assert.equal(first.useOrderDrawings, true);
  assert.equal(second.gauge, "26 ga");
  assert.equal(second.useOrderDrawings, false);
  assert.equal(second.files.length, 1);
  assert.equal("material" in second, false);
});

test("rejects unknown gauges, bad modes, oversized and non-drawing files", async () => {
  const fd = baseForm("SOMETHING");
  fd.set("order_gauge", "9 ga");
  fd.append("drawings[]", new File([new Uint8Array(QUOTE_MAX_FILE_BYTES + 1)], "huge.pdf"));
  fd.append("documents[]", new File([new Uint8Array(4)], "virus.exe", { type: "application/x-msdownload" }));

  const result = await parseQuoteRequestForm(fd);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.fieldErrors.mode);
  assert.ok(result.fieldErrors.order_gauge);
  assert.match(result.fieldErrors.drawings, /huge\.pdf is over/);
  assert.match(result.fieldErrors.documents, /virus\.exe is not a photo/);
});

test("quote references are short and unambiguous", () => {
  for (let i = 0; i < 50; i++) {
    assert.match(generateQuoteReference(), /^Q-[2-9A-HJKMNP-Z]{6}$/);
  }
});
