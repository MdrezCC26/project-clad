/**
 * Push existing Project Clad jobs into Mission Control.
 *
 * Usage (PowerShell):
 *   npx tsx scripts/backfill-mission-control.ts
 *   $env:LIMIT="20"; npx tsx scripts/backfill-mission-control.ts
 *   $env:SHOP="canadiancladding.myshopify.com"; npx tsx scripts/backfill-mission-control.ts
 *
 * Requires on the Project Clad host:
 *   MISSION_CONTROL_URL=http://<mc-api-host>:4000
 *   MISSION_CONTROL_INGEST_KEY=<same as MC INGEST_API_KEY>
 *
 * Mission Control API must be running before you run this script.
 */
import "dotenv/config";

// missionControl.server pulls in adminCustomers → shopify.server at import time.
process.env.SHOPIFY_APP_URL ??= "https://project-clad.onrender.com";

import type { OrderLifecycleStatus, Prisma } from "@prisma/client";

const { PrismaClient } = await import("@prisma/client");

const ORDER_LIFECYCLE_STATUSES = new Set<OrderLifecycleStatus>([
  "draft",
  "pending_review",
  "ready_to_order",
  "ordered",
  "delivered",
  "paid",
]);
const { pushOrderToMissionControl } = await import("../app/utils/missionControl.server");

const prisma = new PrismaClient();

const shopFilter = process.env.SHOP?.trim() || null;
const limit = Math.max(0, Number.parseInt(process.env.LIMIT ?? "0", 10) || 0);
const statuses = (
  process.env.STATUSES ??
  "ordered,delivered,paid,ready_to_order,draft,pending_review"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function main() {
  const base = process.env.MISSION_CONTROL_URL?.trim();
  const key = process.env.MISSION_CONTROL_INGEST_KEY?.trim();
  if (!base || !key) {
    console.error(
      "[mc-backfill] Set MISSION_CONTROL_URL and MISSION_CONTROL_INGEST_KEY in .env first.",
    );
    process.exitCode = 1;
    return;
  }

  const statusFilter = statuses.filter((s): s is OrderLifecycleStatus =>
    ORDER_LIFECYCLE_STATUSES.has(s as OrderLifecycleStatus),
  );

  const where: Prisma.JobWhereInput = {};
  if (shopFilter) where.project = { shop: shopFilter };
  if (statusFilter.length) where.orderLifecycleStatus = { in: statusFilter };

  const jobs = await prisma.job.findMany({
    where,
    orderBy: { createdAt: "desc" },
    ...(limit > 0 ? { take: limit } : {}),
    select: {
      id: true,
      orderNumber: true,
      orderLifecycleStatus: true,
      project: { select: { shop: true, name: true } },
    },
  });

  console.log(
    `[mc-backfill] pushing ${jobs.length} job(s) to ${base}` +
      (shopFilter ? ` shop=${shopFilter}` : "") +
      (limit > 0 ? ` limit=${limit}` : ""),
  );

  let ok = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const pushed = await pushOrderToMissionControl(job.id);
      if (pushed) {
        ok += 1;
        console.log(
          `  ✓ #${job.orderNumber ?? "?"} ${job.project.name} (${job.orderLifecycleStatus})`,
        );
      } else {
        failed += 1;
      }
    } catch (err) {
      failed += 1;
      console.error(
        `  ✗ job=${job.id}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  console.log(`[mc-backfill] done — ${ok} pushed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("[mc-backfill] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
