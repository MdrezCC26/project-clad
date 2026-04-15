import prisma from "../db.server";
import { sessionStorage } from "../shopify.server";

const CUSTOMER_API_VERSION = "2024-10";

const shopHost = (shop: string) => shop.trim().toLowerCase();

/**
 * Offline Admin token for storefront proxy requests. Session rows sometimes differ
 * in shop string casing from the signed `shop` query param, so we fall back to DB.
 */
export async function getOfflineAccessTokenForShop(
  shop: string,
): Promise<string | null> {
  const trimmed = shop.trim();
  const tryShops = Array.from(new Set([trimmed, trimmed.toLowerCase()]));

  for (const s of tryShops) {
    const sessions = await sessionStorage.findSessionsByShop(s);
    const offline = sessions.find((sess) => !sess.isOnline);
    if (offline?.accessToken) {
      return offline.accessToken;
    }
  }

  const row = await prisma.session.findFirst({
    where: {
      isOnline: false,
      shop: { equals: trimmed, mode: "insensitive" },
    },
    orderBy: { expires: "desc" },
  });
  return row?.accessToken ?? null;
}

/** So `logged_in_customer_id` matches GraphQL map keys (leading zeros, formatting). */
function addCustomerInfoKeyAliases(results: Record<string, CustomerInfo>): void {
  for (const v of Object.values(results)) {
    const digits = v.id.replace(/\D/g, "");
    if (!digits) continue;
    results[digits] = v;
    const canonical = String(parseInt(digits, 10));
    if (canonical !== "NaN" && canonical !== digits) {
      results[canonical] = v;
    }
  }
}

/** Shopify may return tags as `[String!]` or a comma-separated string (REST / some payloads). */
export function normalizeShopifyTagsField(raw: unknown): string[] {
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

export type CustomerInfo = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  /** From default address when present (Admin API). */
  phone: string | null;
  tags: string[];
};

const chunk = <T,>(items: T[], size: number) => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};

export const findCustomerIdByEmail = async (
  shop: string,
  email: string,
): Promise<string | null> => {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return null;

  const shopDomain = shopHost(shop);
  const accessToken = await getOfflineAccessTokenForShop(shop);
  if (!accessToken) {
    return null;
  }

  const endpoint = `https://${shopDomain}/admin/api/${CUSTOMER_API_VERSION}/graphql.json`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      query: `
        query ProjectCladCustomerByEmail($query: String!) {
          customers(first: 1, query: $query) {
            edges {
              node {
                id
              }
            }
          }
        }
      `,
      variables: { query: `email:"${trimmed}"` },
    }),
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "Customer lookup unavailable. Reauthorize the app with read_customers.",
    );
  }

  if (response.ok) {
    const payload = (await response.json()) as {
    data?: {
      customers?: { edges?: Array<{ node?: { id?: string } }> };
    };
      errors?: Array<{ message?: string }>;
  };

    if (payload.errors?.length) {
      throw new Error(
        payload.errors.map((error) => error.message).filter(Boolean).join(", "),
      );
    }

    const gid = payload.data?.customers?.edges?.[0]?.node?.id;
    if (gid) {
      const parts = gid.split("/");
      return parts[parts.length - 1] || null;
    }
  }

  const restEndpoint = `https://${shopDomain}/admin/api/${CUSTOMER_API_VERSION}/customers/search.json?query=${encodeURIComponent(
    `email:${trimmed}`,
  )}`;
  const restResponse = await fetch(restEndpoint, {
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
  });

  if (restResponse.status === 401 || restResponse.status === 403) {
    throw new Error(
      "Customer lookup unavailable. Reauthorize the app with read_customers.",
    );
  }

  if (!restResponse.ok) {
    return null;
  }

  const restPayload = (await restResponse.json()) as {
    customers?: Array<{ id?: number }>;
  };
  const id = restPayload.customers?.[0]?.id;
  return id ? String(id) : null;
};

export const getCustomersByIds = async (
  shop: string,
  customerIds: string[],
): Promise<Record<string, CustomerInfo>> => {
  if (customerIds.length === 0) {
    return {};
  }

  const shopDomain = shopHost(shop);
  const accessToken = await getOfflineAccessTokenForShop(shop);
  if (!accessToken) {
    throw new Error(
      "Customer details unavailable. Reauthorize the app to refresh access.",
    );
  }

  const uniqueIds = Array.from(new Set(customerIds));
  const gids = uniqueIds.map((id) => `gid://shopify/Customer/${id}`);
  const results: Record<string, CustomerInfo> = {};
  const endpoint = `https://${shopDomain}/admin/api/${CUSTOMER_API_VERSION}/graphql.json`;

  for (const group of chunk(gids, 50)) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query: `
          query ProjectCladCustomersById($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Customer {
                id
                email
                firstName
                lastName
                tags
                defaultAddress {
                  phone
                }
              }
            }
          }
        `,
        variables: { ids: group },
      }),
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "Customer lookup unavailable. Reauthorize the app with read_customers.",
      );
    }

    if (!response.ok) {
      continue;
    }

    const payload = (await response.json()) as {
      data?: {
        nodes?: Array<{
          id: string;
          email?: string | null;
          firstName?: string | null;
          lastName?: string | null;
          tags?: string[];
          defaultAddress?: { phone?: string | null } | null;
        } | null>;
      };
      errors?: Array<{ message?: string }>;
    };

    if (payload.errors?.length) {
      throw new Error(
        payload.errors.map((error) => error.message).filter(Boolean).join(", "),
      );
    }

    payload.data?.nodes?.forEach((node) => {
      if (!node?.id) return;
      const parts = node.id.split("/");
      const id = parts[parts.length - 1];
      results[id] = {
        id,
        email: node.email ?? null,
        firstName: node.firstName ?? null,
        lastName: node.lastName ?? null,
        phone: node.defaultAddress?.phone?.trim() || null,
        tags: normalizeShopifyTagsField(node.tags),
      };
    });
  }

  addCustomerInfoKeyAliases(results);
  return results;
};

export const listCustomers = async (
  shop: string,
): Promise<CustomerInfo[]> => {
  const shopDomain = shopHost(shop);
  const accessToken = await getOfflineAccessTokenForShop(shop);
  if (!accessToken) {
    throw new Error(
      "Customer details unavailable. Reauthorize the app to refresh access.",
    );
  }

  const endpoint = `https://${shopDomain}/admin/api/${CUSTOMER_API_VERSION}/graphql.json`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      query: `
        query ProjectCladCustomers {
          customers(first: 250) {
            edges {
              node {
                id
                email
                firstName
                lastName
                tags
              }
            }
          }
        }
      `,
    }),
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "Customer details unavailable. Reauthorize the app to refresh access.",
    );
  }

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as {
    data?: {
      customers?: {
        edges?: Array<{
          node?: {
            id?: string;
            email?: string | null;
            firstName?: string | null;
            lastName?: string | null;
            tags?: string[];
          };
        }>;
      };
    };
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors?.length) {
    throw new Error(
      payload.errors.map((error) => error.message).filter(Boolean).join(", "),
    );
  }

  const edges = payload.data?.customers?.edges || [];
  return edges
    .map((edge): CustomerInfo | null => {
      const node = edge.node;
      if (!node?.id) return null;
      const parts = node.id.split("/");
      const id = parts[parts.length - 1];
      const row: CustomerInfo = {
        id,
        email: node.email ?? null,
        firstName: node.firstName ?? null,
        lastName: node.lastName ?? null,
        phone: null,
        tags: normalizeShopifyTagsField(node.tags),
      };
      return row;
    })
    .filter((customer): customer is CustomerInfo => customer != null);
};

/**
 * REST Admin API returns `tags` as a comma-separated string; use when GraphQL nodes miss tags.
 */
export async function fetchCustomerTagsRest(
  shop: string,
  numericCustomerId: string,
): Promise<string[]> {
  const shopDomain = shopHost(shop);
  const accessToken = await getOfflineAccessTokenForShop(shop);
  if (!accessToken) {
    return [];
  }

  const digits = numericCustomerId.replace(/\D/g, "");
  const idVariants = new Set<string>([numericCustomerId.trim()]);
  if (digits) {
    idVariants.add(digits);
    const canonical = String(parseInt(digits, 10));
    if (canonical !== "NaN") {
      idVariants.add(canonical);
    }
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

    if (!response.ok) {
      continue;
    }

    const payload = (await response.json()) as {
      customer?: { tags?: string };
    };
    return normalizeShopifyTagsField(payload.customer?.tags);
  }

  return [];
}
