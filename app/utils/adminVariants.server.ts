import { sessionStorage } from "../shopify.server";

type VariantInfo = {
  title: string;
  productTitle: string;
  imageUrl: string | null;
  imageAlt: string | null;
  productHandle: string | null;
};

const chunk = <T,>(items: T[], size: number) => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};

export const getAdminVariantInfo = async (
  shop: string,
  variantIds: string[],
): Promise<Record<string, VariantInfo>> => {
  if (variantIds.length === 0) {
    return {};
  }

  const sessions = await sessionStorage.findSessionsByShop(shop);
  const offlineSession = sessions.find((session) => !session.isOnline);

  if (!offlineSession) {
    throw new Error(
      "Product details unavailable. Reauthorize the app to refresh access.",
    );
  }

  const uniqueIds = Array.from(new Set(variantIds));
  const idMap = new Map<string, string>();
  const gids = uniqueIds.map((variantId) => {
    const gid = `gid://shopify/ProductVariant/${variantId}`;
    idMap.set(gid, variantId);
    return gid;
  });

  const results: Record<string, VariantInfo> = {};
  const endpoint = `https://${shop}/admin/api/2024-10/graphql.json`;

  for (const group of chunk(gids, 50)) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": offlineSession.accessToken,
      },
      body: JSON.stringify({
        query: `
          query ProjectCladVariantInfo($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on ProductVariant {
                id
                title
                image {
                  url
                  altText
                }
                product {
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
          image?: { url: string; altText?: string | null } | null;
          product?: {
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
          image?: { url: string; altText?: string | null } | null;
          product?: {
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
      results[variantId] = {
        title: node.title,
        productTitle: node.product?.title || "Product",
        imageUrl: image?.url || null,
        imageAlt: image?.altText || node.product?.title || null,
        productHandle: node.product?.handle || null,
      };
    });
  }

  return results;
};
