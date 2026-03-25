/**
 * Seed GaugeConfig with default values.
 * Run: npx tsx scripts/seed-gauges.ts
 *
 * Set SHOP in .env or edit the defaultShop below.
 * Thickness values are placeholders - update to your actual gauge specs.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const defaultShop = process.env.SHOP || "your-store.myshopify.com";

const gauges = [
  { gauge: 16, value: 0.3, thicknessInches: 0.0598 },
  { gauge: 18, value: 0.23, thicknessInches: 0.0478 },
  { gauge: 20, value: 0.21, thicknessInches: 0.0516 },
  { gauge: 24, value: 0.25, thicknessInches: 0.0239 },
  { gauge: 26, value: 0.21, thicknessInches: 0.0179 },
];

async function main() {
  for (const row of gauges) {
    await prisma.gaugeConfig.upsert({
      where: { shop_gauge: { shop: defaultShop, gauge: row.gauge } },
      create: {
        shop: defaultShop,
        gauge: row.gauge,
        value: row.value,
        thicknessInches: row.thicknessInches,
      },
      update: {
        value: row.value,
        thicknessInches: row.thicknessInches,
      },
    });
  }
  console.log(`Seeded ${gauges.length} gauges for shop: ${defaultShop}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
