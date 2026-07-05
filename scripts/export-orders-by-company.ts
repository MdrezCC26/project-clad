/**
 * Export orders + partial deliveries since a cutoff date, grouped by company (one sheet each).
 *
 * Usage (PowerShell):
 *   npm run export-orders-company
 *   $env:SINCE="2026-05-01"; npm run export-orders-company
 *   $env:OUT="C:\Users\you\Desktop\orders-by-company.xlsx"; npm run export-orders-company
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

process.env.SHOPIFY_APP_URL ??= "https://project-clad.onrender.com";

const shop = process.env.SHOP?.trim() || "rnc2a0-d3.myshopify.com";
const since = process.env.SINCE?.trim() || "2026-05-01";

const { buildOrdersByCompanyWorkbook } = await import(
  "../app/utils/exportOrdersByCompany.server"
);

async function main() {
  const result = await buildOrdersByCompanyWorkbook(shop, since);
  const outPath = process.env.OUT?.trim()
    ? resolve(process.env.OUT.trim())
    : resolve(process.cwd(), result.filename);

  writeFileSync(outPath, result.buffer);
  const counts = Object.entries(result.rowCounts)
    .map(([sheet, n]) => `${sheet}=${n}`)
    .join(", ");
  console.log(
    `[export-orders-company] since ${result.sinceDate} · shop=${shop}\n` +
      `  sheets: ${counts}\n` +
      `  total rows: ${result.totalRows}\n` +
      `  → ${outPath}`,
  );
}

main()
  .catch((err) => {
    console.error("[export-orders-company] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { default: prisma } = await import("../app/db.server");
    await prisma.$disconnect();
  });
