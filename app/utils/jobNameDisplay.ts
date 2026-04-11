/**
 * `Job.name` may still include a Shopify-style suffix while `orderLink.orderName` is canonical.
 * Customer "PURCHASE ORDER #" is stored on `Job.purchaseOrderNumber` (not in `name`). Strip
 * order-name suffixes here so the collapsed header matches the plain order title.
 */
export function jobNameForOrderSummary(
  name: string,
  orderName: string | null | undefined,
): string {
  let n = String(name || "").replace(/\s+$/, "");
  const raw = orderName != null ? String(orderName).trim() : "";
  if (!raw) return n;

  const withHash = raw.startsWith("#") ? raw : `#${raw}`;
  const noHash = raw.startsWith("#") ? raw.slice(1) : raw;

  const suffixes = new Set<string>();
  for (const core of [raw, withHash, noHash]) {
    suffixes.add(` (${core})`);
    suffixes.add(`(${core})`);
    suffixes.add(` [${core}]`);
    suffixes.add(`[${core}]`);
  }
  const ordered = [...suffixes].sort((a, b) => b.length - a.length);

  for (let pass = 0; pass < 4; pass++) {
    let removed = false;
    for (const suf of ordered) {
      if (n.endsWith(suf)) {
        n = n.slice(0, -suf.length).replace(/\s+$/, "");
        removed = true;
        break;
      }
    }
    if (!removed) break;
  }
  return n;
}

/** Customer PO for display: DB column first, else legacy `name` suffix ` … (#…)`. */
export function jobPurchaseOrderDisplay(
  name: string,
  purchaseOrderNumber: string | null | undefined,
): string {
  const col = (purchaseOrderNumber ?? "").trim();
  if (col) return col;
  const m = String(name || "").match(/\s+\(#([^)]+)\)\s*$/);
  return m ? m[1].trim() : "";
}
