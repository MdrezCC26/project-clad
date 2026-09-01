/**
 * Write browser-openable HTML previews of the order-placed customer + shop emails.
 *
 * Usage (PowerShell):
 *   npx tsx scripts/preview-order-placed-email.ts
 *   npx tsx scripts/preview-order-placed-email.ts --open
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildOrderPlacedEmailHtml } from "../app/utils/financeDeliveredEmailHtml.server";

const openAfter =
  process.argv.includes("--open") || process.env.OPEN === "1";

const lineItems = [
  {
    displayName: "Z BAR 1.5 — galvanized",
    quantity: 1,
    unit: 13.5,
    lineTotal: 13.5,
    imageUrl:
      "https://canadiancladding.ca/cdn/shop/files/Logo_1_black.png?v=1763687318",
    properties: [
      { name: "Gauge", value: "18 Gauge" },
      { name: "L1", value: "1.5" },
      { name: "L2", value: "1.5" },
      { name: "Color", value: "0000 - Galvanized" },
    ],
  },
  {
    displayName: "T JAMB 3.125",
    quantity: 1,
    unit: 20.8,
    lineTotal: 20.8,
    imageUrl:
      "https://canadiancladding.ca/cdn/shop/files/Logo_1_black.png?v=1763687318",
    properties: [{ name: "Color", value: "Deep Grey" }],
  },
];

const shared = {
  hasLogo: false,
  isDelivery: true,
  placedAt: new Date("2026-09-01T14:30:00-04:00"),
  companyName: "Canadian Cladding",
  projectName: "E-mail Tester",
  orderName: "Mike Test",
  orderNumber: 1288,
  projectNumber: "98765",
  poNumber: "—",
  shipToLines: [
    "100 Industrial Way",
    "Toronto, ON M5H 2N2",
    "Canada",
  ],
  requestedDelivery: "DELIVERY WEDNESDAY, SEPTEMBER 3, 2026 BETWEEN 9AM AND 10AM",
  projectOrderUrl:
    "https://example.myshopify.com/apps/project-clad/project?id=demo&job=demo",
};

const customerHtml = buildOrderPlacedEmailHtml({
  ...shared,
  customerName: "Mike Drezin",
  customerEmail: "mike@example.com",
  customerPhone: "(613) 555-0142",
  includePriceBox: true,
  subtotal: 57.6,
  deliveryFee: 15,
  tax: 9.44,
  total: 82.04,
  lineItems,
  showLineItemPrices: true,
  title: "Your order has been placed",
});

const shopHtml = buildOrderPlacedEmailHtml({
  ...shared,
  customerName: "Mike Drezin",
  customerEmail: "mike@example.com",
  customerPhone: "(613) 555-0142",
  placedByName: "Alex Admin",
  placedByEmail: "alex@canadiancladding.ca",
  placedByPhone: "(613) 555-0100",
  includePriceBox: false,
  lineItems,
  showLineItemPrices: false,
  title: "Shop — order placed",
  subcopy:
    "Order placed on Tuesday, September 1, 2026 at 2:30 PM. Click Open order to view the project.",
});

const customerPath = resolve(
  process.cwd(),
  "docs/email-mockups/order-placed.preview.html",
);
const shopPath = resolve(
  process.cwd(),
  "docs/email-mockups/order-placed-shop.preview.html",
);

writeFileSync(customerPath, customerHtml, "utf8");
writeFileSync(shopPath, shopHtml, "utf8");
console.log(`[preview:order-placed-email] wrote ${customerPath}`);
console.log(`[preview:order-placed-email] wrote ${shopPath}`);

if (openAfter) {
  const { execFileSync } = await import("node:child_process");
  if (process.platform === "win32") {
    execFileSync("cmd", ["/c", "start", "", customerPath], { stdio: "ignore" });
    execFileSync("cmd", ["/c", "start", "", shopPath], { stdio: "ignore" });
  } else if (process.platform === "darwin") {
    execFileSync("open", [customerPath], { stdio: "ignore" });
    execFileSync("open", [shopPath], { stdio: "ignore" });
  } else {
    execFileSync("xdg-open", [customerPath], { stdio: "ignore" });
    execFileSync("xdg-open", [shopPath], { stdio: "ignore" });
  }
} else {
  console.log("[preview:order-placed-email] re-run with --open to view in a browser");
}
