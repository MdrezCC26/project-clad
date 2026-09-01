/**
 * Write a browser-openable HTML preview of the finance delivered email.
 * Does not send mail or touch SMTP.
 *
 * Usage (PowerShell):
 *   npm run preview:finance-email
 *   npm run preview:finance-email -- --open
 *   $env:OUT="C:\Users\you\Desktop\finance-preview.html"; npm run preview:finance-email
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildFinanceDeliveredEmailHtml } from "../app/utils/financeDeliveredEmailHtml.server";

const openAfter =
  process.argv.includes("--open") || process.env.OPEN === "1";

const html = buildFinanceDeliveredEmailHtml({
  hasLogo: false,
  isDelivery: true,
  completedAt: new Date("2026-08-13T15:40:00-04:00"),
  customerName: "Mike Drezin",
  customerEmail: "mike@example.com",
  customerPhone: "(613) 555-0142",
  companyName: "Canadian Cladding",
  projectName: "Test Newdell",
  orderName: "Email Test Order",
  orderNumber: 1264,
  projectNumber: "98765",
  poNumber: "PO-1042",
  shipToLines: [
    "1846 Queen Street East",
    "Toronto, ON M4L 1G8",
    "Canada",
  ],
  showOrderProgress: false,
  orderDeliveredPercent: null,
  subtotal: 57.6,
  deliveryLabel: "Delivery",
  deliveryFee: 15,
  tax: 9.44,
  total: 82.04,
  projectOrderUrl:
    "https://example.myshopify.com/apps/project-clad/project?id=demo&job=demo",
  deliveryPhotoUrl:
    "https://example.com/public/fulfillment-photo?jobId=demo",
  packingSlipUrl:
    "https://example.myshopify.com/apps/project-clad/shop-slip?id=demo&jobId=demo",
});

const outPath = process.env.OUT?.trim()
  ? resolve(process.env.OUT.trim())
  : resolve(
      process.cwd(),
      "docs/email-mockups/fulfillment-delivered-finance.preview.html",
    );

writeFileSync(outPath, html, "utf8");
console.log(`[preview:finance-email] wrote ${outPath}`);

if (openAfter) {
  const { execFileSync } = await import("node:child_process");
  if (process.platform === "win32") {
    execFileSync("cmd", ["/c", "start", "", outPath], { stdio: "ignore" });
  } else if (process.platform === "darwin") {
    execFileSync("open", [outPath], { stdio: "ignore" });
  } else {
    execFileSync("xdg-open", [outPath], { stdio: "ignore" });
  }
  console.log("[preview:finance-email] opened in default browser");
} else {
  console.log("[preview:finance-email] open that file in a browser, or re-run with --open");
}
