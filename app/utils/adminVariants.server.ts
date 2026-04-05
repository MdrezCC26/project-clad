import { sessionStorage } from "../shopify.server";
import { shopifyGidToLegacyNumericId } from "./shopifyIds.server";

export type AdminVariantInfo = {
  title: string;
  productTitle: string;
  imageUrl: string | null;
  imageAlt: string | null;
  productHandle: string | null;
  sku: string | null;
  catalogProductId: string | null;
};

const chunk = <T,>(items: T[], size: number) => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};

type SessionWithOptionalToken = { accessToken?: string | null };

export const getAdminVariantInfo = async (
  shop: string,
  variantIds: string[],
  currentSession?: SessionWithOptionalToken,
): Promise<Record<string, AdminVariantInfo>> => {
  if (variantIds.length === 0) {
    return {};
  }

  let accessToken: string | undefined =
    currentSession?.accessToken ?? undefined;
  if (!accessToken) {
    const sessions = await sessionStorage.findSessionsByShop(shop);
    const offlineSession = sessions.find((session) => !session.isOnline);
    accessToken = offlineSession?.accessToken ?? undefined;
  }

  if (!accessToken) {
    throw new Error("Product details unavailable.");
  }

  const uniqueIds = Array.from(new Set(variantIds));
  const idMap = new Map<string, string>();
  const gids = uniqueIds.map((variantId) => {
    const gid = `gid://shopify/ProductVariant/${variantId}`;
    idMap.set(gid, variantId);
    return gid;
  });

  const results: Record<string, AdminVariantInfo> = {};
  const endpoint = `https://${shop}/admin/api/2024-10/graphql.json`;

  for (const group of chunk(gids, 50)) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query: `
          query ProjectCladVariantInfo($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on ProductVariant {
                id
                title
                sku
                image {
                  url
                  altText
                }
                product {
                  id
                  title
                  handle
                  featuredImage {
                    url
                    altText
                  }
                }
              }
            }
          }
        `,
        variables: { ids: group },
      }),
    });

    if (!response.ok) {
      throw new Error(
        "Product details unavailable. Reauthorize the app to refresh access.",
      );
    }

    const payload = (await response.json()) as {
      data?: {
        nodes?: Array<{
          id: string;
          title: string;
          sku?: string | null;
          image?: { url: string; altText?: string | null } | null;
          product?: {
            id: string;
            title: string;
            handle: string;
            featuredImage?: { url: string; altText?: string | null } | null;
          } | null;
        } | null>;
      };
      errors?: Array<{ message?: string }>;
    };

    if (payload.errors?.length) {
      throw new Error(
        payload.errors.map((error) => error.message).filter(Boolean).join(", "),
      );
    }

    const nodes = payload.data?.nodes as
      | Array<{
          id: string;
          title: string;
          sku?: string | null;
          image?: { url: string; altText?: string | null } | null;
          product?: {
            id: string;
            title: string;
            handle: string;
            featuredImage?: { url: string; altText?: string | null } | null;
          } | null;
        } | null>
      | undefined;

    nodes?.forEach((node) => {
      if (!node) return;
      const variantId = idMap.get(node.id);
      if (!variantId) return;
      const image = node.image || node.product?.featuredImage || null;
      const sku = node.sku?.trim() ? node.sku.trim() : null;
      results[variantId] = {
        title: node.title,
        productTitle: node.product?.title || "Product",
        imageUrl: image?.url || null,
        imageAlt: image?.altText || node.product?.title || null,
        productHandle: node.product?.handle || null,
        sku,
        catalogProductId: shopifyGidToLegacyNumericId(node.product?.id),
      };
    });
  }

  return results;
};
