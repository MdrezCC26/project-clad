/**
 * Backfill `Project.ownerCompanyKey` for every row where it's still null, using the
 * owner's current Shopify `company:<name>` customer tag.
 *
 * Usage (PowerShell):
 *   npx tsx scripts/backfill-project-company-key.ts                                 # dry run
 *   $env:APPLY="1"; npx tsx scripts/backfill-project-company-key.ts; Remove-Item Env:APPLY
 *   $env:SHOP="projectclad.myshopify.com"; npx tsx scripts/backfill-project-company-key.ts
 *
 * Usage (bash / zsh):
 *   npx tsx scripts/backfill-project-company-key.ts
 *   APPLY=1 npx tsx scripts/backfill-project-company-key.ts
 *
 * Safe to re-run — only touches rows where ownerCompanyKey is null.
 *
 * This script deliberately does NOT import `app/shopify.server.ts` so it can run
 * outside of `shopify app dev` (no SHOPIFY_APP_URL env required). It reads the
 * offline access token straight from the `Session` table and calls the Admin REST
 * API directly.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CUSTOMER_API_VERSION = "2024-10";

/* Pure helpers inlined from app/utils/customerTags.server.ts so this script can run
   without loading the Shopify SDK (which requires SHOPIFY_APP_URL). Keep in sync. */
const COMPANY_TAG_PREFIX = "company:";

function extractCompanyTags(tags: string[] | undefined): string[] {
  if (!tags?.length) return [];
  return tags
    .map((t) => String(t).trim())
    .filter((t) => t.toLowerCase().startsWith(COMPANY_TAG_PREFIX));
}

function normalizeCompanyKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase().replace(/\s+/g, " ");
  return v || null;
}

function companyKeyFromTag(tag: string): string | null {
  return normalizeCompanyKey(tag.slice(COMPANY_TAG_PREFIX.length).trim());
}

const apply = process.env.APPLY === "1";
const shopFilter = process.env.SHOP?.trim() || null;

type Update = {
  projectId: string;
  shop: string;
  ownerCustomerId: string;
  ownerCompanyKey: string;
  sourceTag: string;
};

async function getOfflineAccessTokenForShop(
  shop: string,
): Promise<string | null> {
  const trimmed = shop.trim();
  const row = await prisma.session.findFirst({
    where: {
      isOnline: false,
      shop: { equals: trimmed, mode: "insensitive" },
    },
    orderBy: { expires: "desc" },
  });
  return row?.accessToken ?? null;
}

function normalizeTagsField(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

async function fetchCustomerTagsRest(
  shop: string,
  numericCustomerId: string,
  accessToken: string,
): Promise<string[]> {
  const shopDomain = shop.trim().toLowerCase();
  const digits = numericCustomerId.replace(/\D/g, "");
  const idVariants = new Set<string>([numericCustomerId.trim()]);
  if (digits) {
    idVariants.add(digits);
    const canonical = String(parseInt(digits, 10));
    if (canonical !== "NaN") idVariants.add(canonical);
  }

  for (const tryId of idVariants) {
    if (!tryId) continue;
    const url = `https://${shopDomain}/admin/api/${CUSTOMER_API_VERSION}/customers/${tryId}.json`;
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
    });
    if (!response.ok) continue;
    const payload = (await response.json()) as {
      customer?: { tags?: string };
    };
    return normalizeTagsField(payload.customer?.tags);
  }

  return [];
}

async function main() {
  const whereClause: { ownerCompanyKey: null; shop?: string } = {
    ownerCompanyKey: null,
  };
  if (shopFilter) whereClause.shop = shopFilter;

  const projects = await prisma.project.findMany({
    where: whereClause,
    select: {
      id: true,
      shop: true,
      ownerCustomerId: true,
    },
  });

  console.log(
    `[backfill] scanning ${projects.length} projects` +
      (shopFilter ? ` in shop=${shopFilter}` : " across all shops") +
      (apply ? " (APPLY mode)" : " (dry run)"),
  );

  /* Cache tokens and fetched tags per (shop, customerId) to avoid re-fetching the same
     owner across multiple projects. */
  const tokenByShop = new Map<string, string | null>();
  const tagsByKey = new Map<string, string[]>();
  const updates: Update[] = [];
  const skipped: Array<{ projectId: string; reason: string }> = [];

  for (const project of projects) {
    if (!tokenByShop.has(project.shop)) {
      tokenByShop.set(
        project.shop,
        await getOfflineAccessTokenForShop(project.shop),
      );
    }
    const token = tokenByShop.get(project.shop) ?? null;
    if (!token) {
      skipped.push({
        projectId: project.id,
        reason: `no offline token for shop ${project.shop}`,
      });
      continue;
    }

    const cacheKey = `${project.shop}::${project.ownerCustomerId}`;
    let tags = tagsByKey.get(cacheKey);
    if (!tags) {
      try {
        tags = await fetchCustomerTagsRest(
          project.shop,
          project.ownerCustomerId,
          token,
        );
      } catch (err) {
        skipped.push({
          projectId: project.id,
          reason: `tag lookup failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }
      tagsByKey.set(cacheKey, tags);
    }

    const companyTags = extractCompanyTags(tags);
    if (companyTags.length === 0) {
      skipped.push({
        projectId: project.id,
        reason: "owner has no company:* tag",
      });
      continue;
    }

    const firstTag = companyTags[0];
    const key = companyKeyFromTag(firstTag);
    if (!key) {
      skipped.push({
        projectId: project.id,
        reason: `could not normalize tag "${firstTag}"`,
      });
      continue;
    }

    updates.push({
      projectId: project.id,
      shop: project.shop,
      ownerCustomerId: project.ownerCustomerId,
      ownerCompanyKey: key,
      sourceTag: firstTag,
    });
  }

  console.log(`[backfill] eligible updates: ${updates.length}`);
  for (const u of updates) {
    console.log(
      `  • project=${u.projectId} shop=${u.shop} owner=${u.ownerCustomerId} -> ${u.ownerCompanyKey} (from "${u.sourceTag}")`,
    );
  }

  if (skipped.length > 0) {
    console.log(`[backfill] skipped: ${skipped.length}`);
    for (const s of skipped) {
      console.log(`  • project=${s.projectId}: ${s.reason}`);
    }
  }

  if (!apply) {
    console.log("\n[backfill] dry run complete. Re-run with APPLY=1 to write.");
    return;
  }

  let written = 0;
  for (const u of updates) {
    await prisma.project.update({
      where: { id: u.projectId },
      data: { ownerCompanyKey: u.ownerCompanyKey },
    });
    written += 1;
  }
  console.log(`[backfill] wrote ${written} projects.`);
}

main()
  .catch((err) => {
    console.error("[backfill] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
