import { sessionStorage } from "../shopify.server";

const CUSTOMER_API_VERSION = "2024-10";

type CustomerInfo = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
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

  const sessions = await sessionStorage.findSessionsByShop(shop);
  const offlineSession = sessions.find((session) => !session.isOnline);
  if (!offlineSession) {
    return null;
  }

  const endpoint = `https://${shop}/admin/api/${CUSTOMER_API_VERSION}/graphql.json`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": offlineSession.accessToken,
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

  const restEndpoint = `https://${shop}/admin/api/${CUSTOMER_API_VERSION}/customers/search.json?query=${encodeURIComponent(
    `email:${trimmed}`,
  )}`;
  const restResponse = await fetch(restEndpoint, {
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": offlineSession.accessToken,
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

  const sessions = await sessionStorage.findSessionsByShop(shop);
  const offlineSession = sessions.find((session) => !session.isOnline);
  if (!offlineSession) {
    throw new Error(
      "Customer details unavailable. Reauthorize the app to refresh access.",
    );
  }

  const uniqueIds = Array.from(new Set(customerIds));
  const gids = uniqueIds.map((id) => `gid://shopify/Customer/${id}`);
  const results: Record<string, CustomerInfo> = {};
  const endpoint = `https://${shop}/admin/api/${CUSTOMER_API_VERSION}/graphql.json`;

  for (const group of chunk(gids, 50)) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": offlineSession.accessToken,
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
        tags: Array.isArray(node.tags) ? node.tags : [],
      };
    });
  }

  return results;
};

export const listCustomers = async (
  shop: string,
): Promise<CustomerInfo[]> => {
  const sessions = await sessionStorage.findSessionsByShop(shop);
  const offlineSession = sessions.find((session) => !session.isOnline);
  if (!offlineSession) {
    throw new Error(
      "Customer details unavailable. Reauthorize the app to refresh access.",
    );
  }

  const endpoint = `https://${shop}/admin/api/${CUSTOMER_API_VERSION}/graphql.json`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": offlineSession.accessToken,
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
    .map((edge) => {
      const node = edge.node;
      if (!node?.id) return null;
      const parts = node.id.split("/");
      const id = parts[parts.length - 1];
      return {
        id,
        email: node.email ?? null,
        firstName: node.firstName ?? null,
        lastName: node.lastName ?? null,
        tags: Array.isArray(node.tags) ? node.tags : [],
      };
    })
    .filter((customer): customer is CustomerInfo => Boolean(customer));
};
