/**
 * Sync `Project.companyName` and `Project.ownerCompanyKey` from each owner's Shopify
 * B2B company (first `companyContactProfiles` entry). Skips owners with no B2B profile.
 * Does not touch jobs, members, addresses, or `visibleToCompany`.
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
 * Safe to re-run — only writes when companyName or ownerCompanyKey differs from B2B.
 *
 * This script deliberately does NOT import `app/shopify.server.ts` so it can run
 * outside of `shopify app dev` (no SHOPIFY_APP_URL env required). It reads the
 * offline access token straight from the `Session` table and calls Admin GraphQL.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ADMIN_API_VERSION = "2024-10";

function normalizeCompanyKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase().replace(/\s+/g, " ");
  return v || null;
}

function customerGid(customerId: string): string {
  const numeric = customerId.replace(/\D/g, "");
  return `gid://shopify/Customer/${numeric}`;
}

const apply = process.env.APPLY === "1";
const shopFilter = process.env.SHOP?.trim() || null;

type Update = {
  projectId: string;
  shop: string;
  ownerCustomerId: string;
  companyName: string;
  ownerCompanyKey: string;
  previousCompanyName: string | null;
  previousOwnerCompanyKey: string | null;
};

type B2bLookup = {
  companyName: string;
  ownerCompanyKey: string;
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

async function fetchOwnerB2bCompany(
  shop: string,
  ownerCustomerId: string,
  accessToken: string,
): Promise<B2bLookup | null> {
  const shopDomain = shop.trim().toLowerCase();
  const endpoint = `https://${shopDomain}/admin/api/${ADMIN_API_VERSION}/graphql.json`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      query: `
        query BackfillOwnerB2bCompany($id: ID!) {
          customer(id: $id) {
            companyContactProfiles {
              company {
                name
              }
            }
          }
        }
      `,
      variables: { id: customerGid(ownerCustomerId) },
    }),
  });

  if (!response.ok) {
    throw new Error(`Shopify GraphQL responded ${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: {
      customer?: {
        companyContactProfiles?: Array<{
          company?: { name?: string | null } | null;
        } | null> | null;
      } | null;
    };
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors?.length) {
    throw new Error(
      payload.errors.map((e) => e.message).filter(Boolean).join(", "),
    );
  }

  const companyName =
    payload.data?.customer?.companyContactProfiles?.[0]?.company?.name?.trim() ||
    null;
  const ownerCompanyKey = normalizeCompanyKey(companyName);
  if (!companyName || !ownerCompanyKey) return null;

  return { companyName, ownerCompanyKey };
}

async function main() {
  const whereClause: { shop?: string } = {};
  if (shopFilter) whereClause.shop = shopFilter;

  const projects = await prisma.project.findMany({
    where: whereClause,
    select: {
      id: true,
      shop: true,
      ownerCustomerId: true,
      companyName: true,
      ownerCompanyKey: true,
    },
  });

  console.log(
    `[backfill] scanning ${projects.length} projects` +
      (shopFilter ? ` in shop=${shopFilter}` : " across all shops") +
      (apply ? " (APPLY mode)" : " (dry run)"),
  );

  const tokenByShop = new Map<string, string | null>();
  const b2bByOwnerKey = new Map<string, B2bLookup | null>();
  const updates: Update[] = [];
  const skippedNoB2b: Array<{ projectId: string; reason: string }> = [];
  const skippedUnchanged: Array<{ projectId: string }> = [];
  const skippedError: Array<{ projectId: string; reason: string }> = [];

  for (const project of projects) {
    if (!tokenByShop.has(project.shop)) {
      tokenByShop.set(
        project.shop,
        await getOfflineAccessTokenForShop(project.shop),
      );
    }
    const token = tokenByShop.get(project.shop) ?? null;
    if (!token) {
      skippedError.push({
        projectId: project.id,
        reason: `no offline token for shop ${project.shop}`,
      });
      continue;
    }

    const ownerCacheKey = `${project.shop}::${project.ownerCustomerId}`;
    let b2b = b2bByOwnerKey.get(ownerCacheKey);
    if (b2b === undefined) {
      try {
        b2b = await fetchOwnerB2bCompany(
          project.shop,
          project.ownerCustomerId,
          token,
        );
      } catch (err) {
        skippedError.push({
          projectId: project.id,
          reason: `B2B lookup failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }
      b2bByOwnerKey.set(ownerCacheKey, b2b);
    }

    if (!b2b) {
      skippedNoB2b.push({
        projectId: project.id,
        reason: "owner has no Shopify B2B company",
      });
      continue;
    }

    const currentName = project.companyName?.trim() || null;
    const currentKey = project.ownerCompanyKey?.trim() || null;
    if (currentName === b2b.companyName && currentKey === b2b.ownerCompanyKey) {
      skippedUnchanged.push({ projectId: project.id });
      continue;
    }

    updates.push({
      projectId: project.id,
      shop: project.shop,
      ownerCustomerId: project.ownerCustomerId,
      companyName: b2b.companyName,
      ownerCompanyKey: b2b.ownerCompanyKey,
      previousCompanyName: project.companyName,
      previousOwnerCompanyKey: project.ownerCompanyKey,
    });
  }

  console.log(`[backfill] would_update: ${updates.length}`);
  for (const u of updates) {
    console.log(
      `  • project=${u.projectId} shop=${u.shop} owner=${u.ownerCustomerId}`,
    );
    console.log(
      `      companyName: ${JSON.stringify(u.previousCompanyName)} -> ${JSON.stringify(u.companyName)}`,
    );
    console.log(
      `      ownerCompanyKey: ${JSON.stringify(u.previousOwnerCompanyKey)} -> ${JSON.stringify(u.ownerCompanyKey)}`,
    );
  }

  console.log(`[backfill] skipped_no_b2b: ${skippedNoB2b.length}`);
  for (const s of skippedNoB2b) {
    console.log(`  • project=${s.projectId}: ${s.reason}`);
  }

  console.log(`[backfill] skipped_unchanged: ${skippedUnchanged.length}`);

  if (skippedError.length > 0) {
    console.log(`[backfill] skipped_error: ${skippedError.length}`);
    for (const s of skippedError) {
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
      data: {
        companyName: u.companyName,
        ownerCompanyKey: u.ownerCompanyKey,
      },
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
