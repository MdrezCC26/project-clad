/**
 * OPC writes the Length label through an HTML escape before it reaches the
 * cart, so a 120" option is stored as the characters 120&quot;. Decode that
 * quote entity only. Other text, including ampersands in names and URLs, stays
 * as it was.
 */

const QUOTE_ENTITY = /&(?:amp;)*quot;|&#0*34;|&#x0*22;/gi;

export function decodeHtmlQuotes(value: string): string {
  let current = value;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = current.replace(QUOTE_ENTITY, '"');
    if (next === current) return current;
    current = next;
  }
  return current;
}

/** Decode a cart property. JSON blobs (the OPC payload) are parsed first so a quote inside a value cannot break the JSON. */
export function decodePropertyValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        let changed = false;
        const next: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(record)) {
          if (typeof entry === "string") {
            const decoded = decodeHtmlQuotes(entry);
            next[key] = decoded;
            if (decoded !== entry) changed = true;
          } else {
            next[key] = entry;
          }
        }
        return changed ? JSON.stringify(next) : value;
      }
    } catch {
      /* Braces around ordinary text. Fall through. */
    }
  }
  return decodeHtmlQuotes(value);
}
