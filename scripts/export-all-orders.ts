/**
 * Export Project Clad orders to a multi-sheet Excel workbook:
 *   In Progress | Ordered | Delivered | Paid
 *
 * Usage (PowerShell):
 *   npm run export-orders
 *   $env:SHOP="rnc2a0-d3.myshopify.com"; npm run export-orders
 *   $env:OUT="C:\Users\you\Desktop\orders.xlsx"; npm run export-orders
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const shop = process.env.SHOP?.trim() || "rnc2a0-d3.myshopify.com";

const { buildAllOrdersWorkbook } = await import("../app/utils/exportAllOrders.server");

async function main() {
  const result = await buildAllOrdersWorkbook(shop);
  const outPath = process.env.OUT?.trim()
    ? resolve(process.env.OUT.trim())
    : resolve(process.cwd(), result.filename);

  writeFileSync(outPath, result.buffer);
  const counts = Object.entries(result.rowCounts)
    .map(([sheet, n]) => `${sheet}=${n}`)
    .join(", ");
  const sheetSum = Object.values(result.rowCounts).reduce((s, n) => s + n, 0);
  console.log(
    `[export-orders] wrote workbook from shop=${shop}\n` +
      `  sheets: ${counts}\n` +
      `  total: ${result.totalCount} (${sheetSum} across sheets)\n` +
      `  → ${outPath}`,
  );
}

main()
  .catch((err) => {
    console.error("[export-orders] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { default: prisma } = await import("../app/db.server");
    await prisma.$disconnect();
  });
