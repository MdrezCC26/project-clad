/**
 * Property rows for customer-facing transactional emails (cart save, order placed, delivered, etc.).
 * Omits internal keys (__*, _*) and normalizes a few labels for consistency with email mockups.
 */
export function normalizePropertyLabelForCustomer(name: string): string {
  const t = String(name).trim();
  if (t === "Colour") return "Color";
  return t;
}

export function filterCustomerFacingProperties(
  props?: { name: string; value: string }[] | null,
): { name: string; value: string }[] {
  if (!props?.length) return [];
  return props
    .filter((p) => {
      const n = String(p.name || "").trim();
      if (!n) return false;
      if (n.startsWith("__")) return false;
      if (n.startsWith("_")) return false;
      return true;
    })
    .map((p) => ({
      name: normalizePropertyLabelForCustomer(String(p.name)),
      value: String(p.value ?? "").trim() || "—",
    }));
}

/** Indented block matching cart / fulfillment mockups (leading newline when non-empty). */
export function customerFacingPropertiesIndentedBlock(
  props?: { name: string; value: string }[] | null,
): string {
  const rows = filterCustomerFacingProperties(props);
  if (!rows.length) return "";
  const lines = rows.map((r) => `      · ${r.name}: ${r.value}`);
  return `\n      Properties:\n${lines.join("\n")}`;
}
