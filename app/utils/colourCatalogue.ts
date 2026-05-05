/**
 * Maps storefront / line-item colour strings to a display label + swatch hex.
 * Safe for client bundles (no server-only imports).
 */

export type ColourCatalogueLine = {
  display: string;
  hex: string;
};

/** Normalize for loose matching (case, spacing, leading SKU codes). */
function colourKeyVariants(raw: string): string[] {
  const t = raw.trim();
  if (!t) return [];
  const lower = t.toLowerCase().replace(/\s+/g, " ");
  const out = new Set<string>();
  out.add(lower);
  /* "0000 - Galvanized" → "galvanized" */
  const stripLeadingCode = lower.replace(/^[\d\s]+-\s*/i, "").trim();
  if (stripLeadingCode) out.add(stripLeadingCode);
  const dash = lower.split(/\s*-\s*/);
  if (dash.length > 1) {
    const tail = dash[dash.length - 1]?.trim();
    if (tail) out.add(tail);
  }
  return [...out];
}

function matchesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => n && haystack.includes(n));
}

/**
 * Returns a catalogue row when `raw` matches a known finish/colour name; otherwise `null`
 * so callers can fall back to a plain text chip.
 */
export function resolveColourCatalogueLine(raw: string): ColourCatalogueLine | null {
  const keys = colourKeyVariants(raw);
  if (keys.length === 0) return null;

  for (const k of keys) {
    if (matchesAny(k, ["galvanized", "galv", "0000"])) {
      return { display: "Galvanized", hex: "#b4bcc4" };
    }
    if (matchesAny(k, ["black", "matte black", "jet black"])) {
      return { display: "Black", hex: "#1a1a1a" };
    }
    if (matchesAny(k, ["white", "bright white", "off white", "off-white"])) {
      return { display: "White", hex: "#f2f2f2" };
    }
    if (matchesAny(k, ["charcoal", "graphite", "slate grey", "slate gray"])) {
      return { display: "Charcoal", hex: "#3d4551" };
    }
    if (matchesAny(k, ["brown", "espresso", "bronze"])) {
      return { display: "Brown", hex: "#5c4033" };
    }
    if (matchesAny(k, ["red", "brick red"])) {
      return { display: "Red", hex: "#9b2e2e" };
    }
    if (matchesAny(k, ["green", "hunter green", "forest green"])) {
      return { display: "Green", hex: "#2d4a3a" };
    }
    if (matchesAny(k, ["blue", "navy", "royal blue"])) {
      return { display: "Blue", hex: "#1e3a5f" };
    }
    if (matchesAny(k, ["beige", "tan", "sand", "sandstone"])) {
      return { display: "Sand", hex: "#c9b8a0" };
    }
    if (matchesAny(k, ["cream", "ivory", "almond"])) {
      return { display: "Cream", hex: "#ebe4d6" };
    }
  }

  return null;
}
