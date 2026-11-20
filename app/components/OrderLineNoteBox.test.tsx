import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { collectOrderLineNotes } from "../utils/orderLineNote";
import { OrderLineNoteBox } from "./OrderLineNoteBox";

function renderNotes(
  properties: { name: string; value: string }[] | null,
): string {
  return renderToStaticMarkup(
    <OrderLineNoteBox notes={collectOrderLineNotes(properties)} />,
  );
}

test("a long multi-paragraph note shows in full with paragraphs kept", () => {
  const html = renderNotes([
    {
      name: "Note",
      value: [
        "Mike, mockup was good just make make it as close to flat as you can but include the bend still so we can manipulate on site.",
        "",
        "Drip Face, make it 90 or a hair less.",
        "this stays in the same paragraph",
        "",
        "Finished piece are long enough that the whole sentence has to stay visible with no cutoff.",
      ].join("\n"),
    },
  ]);
  assert.equal(html.match(/<p>/g)?.length, 3);
  assert.match(html, /manipulate on site\./);
  assert.match(html, /this stays in the same paragraph/);
  assert.match(html, /no cutoff\./);
  assert.match(html, /data-projectclad-order-line-note/);
  assert.doesNotMatch(html, /View comment|order-note-open/);
});

test("a note with inch quotes renders real quotes and escapes HTML", () => {
  const html = renderNotes([
    {
      name: "Additional Details",
      value:
        'Mike @ 2&quot; and finished pieces are 64-65&quot;. <script>alert(1)</script>',
    },
  ]);
  // A real quote is escaped as &quot; in HTML. A missed decode would be &amp;quot;.
  assert.match(html, /2&quot;/);
  assert.match(html, /64-65&quot;/);
  assert.doesNotMatch(html, /&amp;quot;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("a line with no note shows no box", () => {
  assert.equal(renderNotes([{ name: "Gauge", value: "26 Gauge" }]), "");
  assert.equal(renderNotes(null), "");
  assert.equal(renderNotes([]), "");
});
