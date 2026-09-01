import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { getAdminVariantInfo } from "./adminVariants.server";
import { getVariantInfo } from "./storefront.server";

/** Normalized variant + product fields used across storefront and admin loaders. */
export type VariantDisplayInfo = {
  title: string;
  productTitle: string;
  imageUrl: string | null;
  imageAlt: string | null;
  productHandle: string | null;
  sku: string | null;
  /** Shopify Product legacy numeric id (from GID). */
  catalogProductId: string | null;
};

export type VariantSnapshotV1 = {
  productTitle: string;
  variantTitle: string;
  imageUrl: string | null;
  imageAlt: string | null;
  productHandle: string | null;
  capturedAt: string;
  /** Set when snapshot was captured from the storefront cart at save time. */
  source?: string;
  sku?: string | null;
  vendor?: string | null;
};

/** Line labels from `/cart.js` at save time (survives deleted catalog / draft-only variants). */
export type CartLineMetaInput = {
  productTitle?: string;
  variantTitle?: string;
  imageUrl?: string | null;
  productHandle?: string | null;
  /** Shopify product id from `/cart.js` (numeric string). */
  productId?: string | null;
  sku?: string | null;
  vendor?: string | null;
};

export function cartLineMetaToVariantSnapshot(
  meta: CartLineMetaInput,
): VariantSnapshotV1 {
  const productTitle = (meta.productTitle || "Product").trim() || "Product";
  const variantTitle = (meta.variantTitle || "").trim() || "Default Title";
  return {
    productTitle,
    variantTitle,
    imageUrl: meta.imageUrl ?? null,
    imageAlt: productTitle,
    productHandle: meta.productHandle ?? null,
    capturedAt: new Date().toISOString(),
    source: "cart_line",
    sku: meta.sku ?? null,
    vendor: meta.vendor ?? null,
  };
}

export type VariantDisplaySource = "live" | "snapshot" | "unknown";

export function formatVariantLineLabel(
  productTitle: string,
  variantTitle: string,
): string {
  return variantTitle && variantTitle !== "Default Title"
    ? `${productTitle} — ${variantTitle}`
    : productTitle;
}

/** Immutable audit row: set once when the job line is created (not updated by catalog sync). */
export type OrderLineCaptureV1 = {
  v: 1;
  displayLabel: string;
  variantId: string;
  sku: string | null;
  /** Shopify product id when captured from cart (numeric). */
  productId?: string | null;
  unitPrice: string;
  capturedAt: string;
};

export function buildOrderLineCapture(args: {
  variantId: string;
  unitPrice: string;
  lineMeta?: CartLineMetaInput | null;
}): OrderLineCaptureV1 {
  const meta = args.lineMeta;
  const productTitle = (meta?.productTitle ?? "").trim();
  const variantTitle = (meta?.variantTitle ?? "").trim();
  const displayLabel =
    productTitle || variantTitle
      ? formatVariantLineLabel(
          productTitle || "Product",
          variantTitle || "Default Title",
        )
      : `Variant ${args.variantId}`;
  const productId = meta?.productId?.trim() ? meta.productId.trim() : null;
  return {
    v: 1,
    displayLabel,
    variantId: args.variantId,
    sku: meta?.sku?.trim() ? meta.sku.trim() : null,
    ...(productId ? { productId } : {}),
    unitPrice: args.unitPrice,
    capturedAt: new Date().toISOString(),
  };
}

export function parseOrderLineCapture(
  raw: unknown,
): OrderLineCaptureV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (typeof o.displayLabel !== "string" || typeof o.variantId !== "string") {
    return null;
  }
  const productId =
    typeof o.productId === "string" && o.productId.trim()
      ? o.productId.trim()
      : null;
  return {
    v: 1,
    displayLabel: o.displayLabel,
    variantId: o.variantId,
    sku: typeof o.sku === "string" ? o.sku : null,
    ...(productId ? { productId } : {}),
    unitPrice: typeof o.unitPrice === "string" ? o.unitPrice : "",
    capturedAt: typeof o.capturedAt === "string" ? o.capturedAt : "",
  };
}

export function parseVariantSnapshot(
  raw: unknown,
): VariantSnapshotV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.productTitle !== "string" || typeof o.variantTitle !== "string") {
    return null;
  }
  return {
    productTitle: o.productTitle,
    variantTitle: o.variantTitle,
    imageUrl: typeof o.imageUrl === "string" ? o.imageUrl : null,
    imageAlt: typeof o.imageAlt === "string" ? o.imageAlt : null,
    productHandle: typeof o.productHandle === "string" ? o.productHandle : null,
    capturedAt: typeof o.capturedAt === "string" ? o.capturedAt : "",
    source: typeof o.source === "string" ? o.source : undefined,
    sku: typeof o.sku === "string" ? o.sku : null,
    vendor: typeof o.vendor === "string" ? o.vendor : null,
  };
}

function snapshotFromLive(info: VariantDisplayInfo): VariantSnapshotV1 {
  return {
    productTitle: info.productTitle,
    variantTitle: info.title,
    imageUrl: info.imageUrl,
    imageAlt: info.imageAlt,
    productHandle: info.productHandle,
    capturedAt: new Date().toISOString(),
    sku: info.sku ?? null,
  };
}

function snapshotsEqual(a: VariantSnapshotV1, b: VariantSnapshotV1) {
  return (
    a.productTitle === b.productTitle &&
    a.variantTitle === b.variantTitle &&
    a.imageUrl === b.imageUrl &&
    a.productHandle === b.productHandle &&
    (a.sku ?? null) === (b.sku ?? null)
  );
}

/** After creating line items, merge in live Shopify data when available. */
export async function hydrateJobItemVariantSnapshots(
  shop: string,
  jobItems: Array<{ id: string; variantId: string; variantSnapshot: unknown }>,
): Promise<void> {
  if (jobItems.length === 0) return;
  const variantIds = jobItems.map((r) => r.variantId);
  const { info } = await resolveVariantDisplayInfo(shop, variantIds);
  await persistVariantSnapshotsFromLive({
    items: jobItems,
    liveByVariantId: info,
  });
}

/**
 * Every storefront page render resolved each line's variant through a Storefront GraphQL call plus
 * an Admin call for whatever the storefront did not return. Catalog titles and images change far
 * more slowly than pages are viewed, so results are memoized per (shop, variant). Misses are cached
 * too, on a shorter clock, so deleted or draft-only variants stop re-triggering the Admin fallback.
 */
const VARIANT_INFO_TTL_MS = 5 * 60 * 1000;
const VARIANT_INFO_MISS_TTL_MS = 60 * 1000;
const VARIANT_INFO_CACHE_MAX_ENTRIES = 5000;

const variantInfoCache = new Map<
  string,
  { info: VariantDisplayInfo | null; expiresAt: number }
>();

function variantInfoCacheKey(shop: string, variantId: string) {
  return `${shop.trim().toLowerCase()}::${variantId}`;
}

function readVariantInfoCache(
  shop: string,
  variantId: string,
): { info: VariantDisplayInfo | null } | undefined {
  const key = variantInfoCacheKey(shop, variantId);
  const hit = variantInfoCache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    variantInfoCache.delete(key);
    return undefined;
  }
  return hit;
}

function writeVariantInfoCache(
  shop: string,
  variantId: string,
  info: VariantDisplayInfo | null,
): void {
  const key = variantInfoCacheKey(shop, variantId);
  /* Re-insert so Map iteration order stays least-recently-written first for eviction. */
  variantInfoCache.delete(key);
  variantInfoCache.set(key, {
    info,
    expiresAt:
      Date.now() + (info ? VARIANT_INFO_TTL_MS : VARIANT_INFO_MISS_TTL_MS),
  });
  while (variantInfoCache.size > VARIANT_INFO_CACHE_MAX_ENTRIES) {
    const oldest = variantInfoCache.keys().next();
    if (oldest.done) break;
    variantInfoCache.delete(oldest.value);
  }
}

/** Drop memoized catalog data for specific variants (or the whole shop when none are given). */
export function invalidateVariantInfoCache(
  shop: string,
  variantIds?: string[],
): void {
  if (variantIds?.length) {
    for (const id of variantIds) {
      variantInfoCache.delete(variantInfoCacheKey(shop, id));
    }
    return;
  }
  const prefix = `${shop.trim().toLowerCase()}::`;
  for (const key of variantInfoCache.keys()) {
    if (key.startsWith(prefix)) {
      variantInfoCache.delete(key);
    }
  }
}

/**
 * Merge Storefront + Admin lookups so partial Storefront responses still fill gaps
 * (previously Admin ran only when Storefront returned zero keys).
 */
export async function resolveVariantDisplayInfo(
  shop: string,
  variantIds: string[],
  options?: { adminSession?: { accessToken?: string | null } },
): Promise<{ info: Record<string, VariantDisplayInfo>; error: string | null }> {
  const unique = Array.from(new Set(variantIds.filter(Boolean)));
  if (unique.length === 0) {
    return { info: {}, error: null };
  }

  const merged: Record<string, VariantDisplayInfo> = {};
  const lookupIds: string[] = [];
  for (const id of unique) {
    const cached = readVariantInfoCache(shop, id);
    if (!cached) {
      lookupIds.push(id);
    } else if (cached.info) {
      merged[id] = cached.info;
    }
  }

  if (lookupIds.length === 0) {
    return { info: merged, error: null };
  }

  let fresh: Record<string, VariantDisplayInfo> = {};
  let storefrontError: string | null = null;

  try {
    fresh = (await getVariantInfo(shop, lookupIds)) as Record<
      string,
      VariantDisplayInfo
    >;
  } catch (e) {
    storefrontError =
      e instanceof Error ? e.message : "Storefront variant lookup failed.";
  }

  const missingAfterStorefront = lookupIds.filter((id) => !fresh[id]);
  let adminError: string | null = null;

  if (missingAfterStorefront.length > 0) {
    try {
      const admin = await getAdminVariantInfo(
        shop,
        missingAfterStorefront,
        options?.adminSession,
      );
      fresh = {
        ...fresh,
        ...(admin as Record<string, VariantDisplayInfo>),
      };
    } catch (e) {
      adminError =
        e instanceof Error ? e.message : "Admin variant lookup failed.";
    }
  }

  for (const [id, info] of Object.entries(fresh)) {
    writeVariantInfoCache(shop, id, info);
    merged[id] = info;
  }

  if (adminError) {
    /* A failed lookup says nothing about whether the variant exists, so nothing is cached. */
    if (Object.keys(merged).length === 0) {
      return { info: {}, error: adminError };
    }
    return {
      info: merged,
      error: storefrontError
        ? `${storefrontError} · ${adminError}`
        : adminError,
    };
  }

  for (const id of lookupIds) {
    if (!fresh[id]) {
      writeVariantInfoCache(shop, id, null);
    }
  }

  return {
    info: merged,
    error:
      storefrontError && Object.keys(merged).length < unique.length
        ? storefrontError
        : null,
  };
}

export function buildVariantPresentation(args: {
  shop: string;
  variantId: string;
  live?: VariantDisplayInfo;
  snapshot: VariantSnapshotV1 | null;
}): {
  displayName: string;
  imageUrl: string | null;
  imageAlt: string | null;
  productUrl: string | null;
  source: VariantDisplaySource;
} {
  const { shop, variantId, live, snapshot } = args;

  if (live) {
    const imageUrl = live.imageUrl ?? snapshot?.imageUrl ?? null;
    const imageAlt = live.imageAlt ?? snapshot?.imageAlt ?? null;
    return {
      displayName: formatVariantLineLabel(live.productTitle, live.title),
      imageUrl,
      imageAlt,
      productUrl: live.productHandle
        ? `https://${shop}/products/${live.productHandle}?variant=${variantId}`
        : null,
      source: live.imageUrl ? "live" : snapshot?.imageUrl ? "snapshot" : "live",
    };
  }

  if (snapshot) {
    return {
      displayName: formatVariantLineLabel(
        snapshot.productTitle,
        snapshot.variantTitle,
      ),
      imageUrl: snapshot.imageUrl,
      imageAlt: snapshot.imageAlt,
      productUrl: snapshot.productHandle
        ? `https://${shop}/products/${snapshot.productHandle}?variant=${variantId}`
        : null,
      source: "snapshot",
    };
  }

  return {
    displayName: `Variant ${variantId}`,
    imageUrl: null,
    imageAlt: null,
    productUrl: null,
    source: "unknown",
  };
}

/**
 * When Shopify returns live data, persist titles/SKU/images on the line item so labels
 * and storefront product art (e.g. custompart profile diagrams) stay current.
 */
export async function persistVariantSnapshotsFromLive(args: {
  items: Array<{
    id: string;
    variantId: string;
    variantSnapshot: unknown;
    catalogProductId?: string | null;
    catalogSku?: string | null;
  }>;
  liveByVariantId: Record<string, VariantDisplayInfo>;
}): Promise<void> {
  const { items, liveByVariantId } = args;
  const updates: Array<{ id: string; data: Prisma.JobItemUpdateInput }> = [];

  for (const item of items) {
    const live = liveByVariantId[item.variantId];
    if (!live) continue;

    const prev = parseVariantSnapshot(item.variantSnapshot);
    const fromLive = snapshotFromLive(live);
    const prevImage = prev?.imageUrl ?? null;
    const imageUrl =
      fromLive.imageUrl ??
      (prevImage && !prevImage.startsWith("data:image/") ? prevImage : null);
    const next: VariantSnapshotV1 = {
      ...fromLive,
      imageUrl,
      imageAlt: fromLive.imageAlt ?? prev?.imageAlt ?? null,
      sku: live.sku ?? prev?.sku ?? null,
      vendor: prev?.vendor ?? null,
      source: "shopify_api",
    };

    /**
     * Each field is compared against what is already stored. Assigning unconditionally meant any
     * item with a live `catalogProductId` produced a non-empty `data`, so the "nothing changed"
     * guard below never fired and every page view issued an UPDATE per line item.
     */
    const data: Prisma.JobItemUpdateInput = {};
    if (!(prev && snapshotsEqual(prev, next))) {
      data.variantSnapshot = next as unknown as Prisma.InputJsonValue;
    }
    if (live.catalogProductId && live.catalogProductId !== item.catalogProductId) {
      data.catalogProductId = live.catalogProductId;
    }
    if (live.sku && live.sku !== item.catalogSku) {
      data.catalogSku = live.sku;
    }
    if (Object.keys(data).length === 0) continue;

    updates.push({ id: item.id, data });
  }

  if (updates.length === 0) return;

  await prisma.$transaction(
    updates.map((u) =>
      prisma.jobItem.update({ where: { id: u.id }, data: u.data }),
    ),
  );
}
