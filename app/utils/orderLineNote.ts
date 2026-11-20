/**
 * Free-text notes on an order line (an upload part's Note, a calculator's
 * Additional Details). The project page shows them in full under the line tile.
 */
import {
  collectOrderLineSpecMap,
  isWrappingOrderLineNote,
  normalizeOrderSpecKey,
  type OrderLineProperty,
} from "./orderLineSpecs";

export type OrderLineNoteText = {
  key: string;
  paragraphs: string[];
};

/** Blank lines separate paragraphs; single line breaks stay inside one. */
export function splitOrderLineNoteParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export function collectOrderLineNotes(
  properties: OrderLineProperty[] | null | undefined,
): OrderLineNoteText[] {
  if (!properties?.length) return [];
  const { map } = collectOrderLineSpecMap(properties);
  const notes: OrderLineNoteText[] = [];
  for (const [key, value] of map) {
    if (!isWrappingOrderLineNote(key)) continue;
    // An empty property is stored under its own name, which is not a note.
    if (normalizeOrderSpecKey(value) === key) continue;
    const paragraphs = splitOrderLineNoteParagraphs(value);
    if (paragraphs.length) notes.push({ key, paragraphs });
  }
  return notes;
}
