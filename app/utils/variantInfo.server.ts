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
  return {
    v: 1,
    displayLabel,
    variantId: args.variantId,
    sku: meta?.sku?.trim() ? meta.sku.trim() : null,
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
  return {
    v: 1,
    displayLabel: o.displayLabel,
    variantId: o.variantId,
    sku: typeof o.sku === "string" ? o.sku : null,
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
  };
}

function snapshotsEqual(a: VariantSnapshotV1, b: VariantSnapshotV1) {
  return (
    a.productTitle === b.productTitle &&
    a.variantTitle === b.variantTitle &&
    a.imageUrl === b.imageUrl &&
    a.productHandle === b.productHandle
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

  let merged: Record<string, VariantDisplayInfo> = {};
  let storefrontError: string | null = null;

  try {
    merged = await getVariantInfo(shop, unique);
  } catch (e) {
    storefrontError =
      e instanceof Error ? e.message : "Storefront variant lookup failed.";
  }

  const missingAfterStorefront = unique.filter((id) => !merged[id]);

  if (missingAfterStorefront.length > 0) {
    try {
      const admin = await getAdminVariantInfo(
        shop,
        missingAfterStorefront,
        options?.adminSession,
      );
      merged = { ...merged, ...admin };
    } catch (e) {
      const adminMsg =
        e instanceof Error ? e.message : "Admin variant lookup failed.";
      if (Object.keys(merged).length === 0) {
        return { info: {}, error: adminMsg };
      }
      return {
        info: merged,
        error: storefrontError
          ? `${storefrontError} · ${adminMsg}`
          : adminMsg,
      };
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
    return {
      displayName: formatVariantLineLabel(live.productTitle, live.title),
      imageUrl: live.imageUrl,
      imageAlt: live.imageAlt,
      productUrl: live.productHandle
        ? `https://${shop}/products/${live.productHandle}?variant=${variantId}`
        : null,
      source: "live",
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
 * When Shopify returns live data, persist it on the line item so titles/images survive
 * API hiccups or catalog changes when possible.
 */
export async function persistVariantSnapshotsFromLive(args: {
  items: Array<{ id: string; variantId: string; variantSnapshot: unknown }>;
  liveByVariantId: Record<string, VariantDisplayInfo>;
}): Promise<void> {
  const { items, liveByVariantId } = args;
  const updates: Array<{ id: string; data: Prisma.JobItemUpdateInput }> = [];

  for (const item of items) {
    const live = liveByVariantId[item.variantId];
    if (!live) continue;

    const prev = parseVariantSnapshot(item.variantSnapshot);
    const next: VariantSnapshotV1 = {
      ...snapshotFromLive(live),
      sku: prev?.sku ?? null,
      vendor: prev?.vendor ?? null,
      source: "shopify_api",
    };
    if (prev && snapshotsEqual(prev, next)) continue;

    updates.push({
      id: item.id,
      data: { variantSnapshot: next as unknown as Prisma.InputJsonValue },
    });
  }

  if (updates.length === 0) return;

  await prisma.$transaction(
    updates.map((u) =>
      prisma.jobItem.update({ where: { id: u.id }, data: u.data }),
    ),
  );
}
