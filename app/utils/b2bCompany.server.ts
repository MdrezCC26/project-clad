import { getOfflineAccessTokenForShop } from "./adminCustomers.server";

const ADMIN_API_VERSION = "2024-10";
const VIEWER_B2B_TTL_MS = 60_000;
const COMPANY_CONTACTS_PAGE_SIZE = 50;
const COMPANY_CONTACTS_MAX = 250;

export type ViewerB2bCompanyContext = {
  companyId: string | null;
  companyName: string | null;
  companyKey: string | null;
};

export type CompanyContactCustomer = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
};

const viewerB2bCache = new Map<
  string,
  { ctx: ViewerB2bCompanyContext; expiresAt: number }
>();

function shopHost(shop: string) {
  return shop.trim().toLowerCase();
}

function normalizeStorefrontCustomerId(customerId: string): string {
  return String(customerId).includes("/")
    ? String(customerId).split("/").pop() || customerId
    : customerId;
}

/** Canonical key for storage/matching: lowercased, whitespace-collapsed. */
export function normalizeCompanyKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase().replace(/\s+/g, " ");
  return v || null;
}

function viewerB2bCacheKey(shop: string, customerId: string) {
  return `${shopHost(shop)}::${normalizeStorefrontCustomerId(customerId)}`;
}

function customerGid(customerId: string): string {
  const numeric = normalizeStorefrontCustomerId(customerId).replace(/\D/g, "");
  return `gid://shopify/Customer/${numeric}`;
}

function companyGid(companyId: string): string {
  if (companyId.startsWith("gid://")) return companyId;
  const numeric = companyId.replace(/\D/g, "");
  return `gid://shopify/Company/${numeric}`;
}

function customerIdFromGid(gid: string): string {
  const parts = gid.split("/");
  return parts[parts.length - 1] || gid;
}

async function adminGraphql<T>(
  shop: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const endpoint = `https://${shopHost(shop)}/admin/api/${ADMIN_API_VERSION}/graphql.json`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "B2B company lookup unavailable. Reauthorize the app with read_customers.",
    );
  }

  if (!response.ok) {
    throw new Error(`Shopify GraphQL responded ${response.status}.`);
  }

  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors?.length) {
    throw new Error(
      payload.errors.map((e) => e.message).filter(Boolean).join(", "),
    );
  }

  return payload.data as T;
}

type CustomerB2bQueryResult = {
  customer?: {
    companyContactProfiles?: Array<{
      company?: { id?: string; name?: string | null } | null;
    } | null> | null;
  } | null;
};

const CUSTOMER_B2B_QUERY = `
  query ProjectCladCustomerB2bCompany($id: ID!) {
    customer(id: $id) {
      companyContactProfiles {
        company {
          id
          name
        }
      }
    }
  }
`;

/** Resolve the viewer's first Shopify B2B company (v1: first profile only). */
export async function fetchCustomerB2bCompany(
  shop: string,
  customerId: string,
  accessToken?: string | null,
): Promise<ViewerB2bCompanyContext> {
  const token = accessToken ?? (await getOfflineAccessTokenForShop(shop));
  if (!token) {
    return { companyId: null, companyName: null, companyKey: null };
  }

  const data = await adminGraphql<CustomerB2bQueryResult>(
    shop,
    token,
    CUSTOMER_B2B_QUERY,
    { id: customerGid(customerId) },
  );

  const profile = data.customer?.companyContactProfiles?.[0];
  const company = profile?.company;
  const companyName = company?.name?.trim() || null;
  const companyId = company?.id ? customerIdFromGid(company.id) : null;
  const companyKey = normalizeCompanyKey(companyName);

  if (!companyId || !companyName || !companyKey) {
    return { companyId: null, companyName: null, companyKey: null };
  }

  return { companyId, companyName, companyKey };
}

/** Cached B2B company lookup. TTL ~60s keyed by (shop, customerId). */
export async function getViewerB2bCompanyContext(
  shop: string,
  customerId: string,
): Promise<ViewerB2bCompanyContext> {
  const key = viewerB2bCacheKey(shop, customerId);
  const now = Date.now();
  const hit = viewerB2bCache.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.ctx;
  }

  let ctx: ViewerB2bCompanyContext = {
    companyId: null,
    companyName: null,
    companyKey: null,
  };
  try {
    ctx = await fetchCustomerB2bCompany(shop, customerId);
  } catch (err) {
    if (process.env.PROJECTCLAD_DEBUG_B2B === "1") {
      console.warn(
        "[ProjectClad B2B] company lookup failed:",
        { shop, customerId },
        err instanceof Error ? err.message : err,
      );
    }
    ctx = { companyId: null, companyName: null, companyKey: null };
  }

  viewerB2bCache.set(key, { ctx, expiresAt: now + VIEWER_B2B_TTL_MS });
  return ctx;
}

export function invalidateViewerB2bCache(shop: string, customerId: string) {
  viewerB2bCache.delete(viewerB2bCacheKey(shop, customerId));
}

type CompanyContactsQueryResult = {
  company?: {
    contacts?: {
      nodes?: Array<{
        customer?: {
          id?: string;
          email?: string | null;
          firstName?: string | null;
          lastName?: string | null;
        } | null;
      } | null> | null;
      pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } | null;
    } | null;
  } | null;
};

const COMPANY_CONTACTS_QUERY = `
  query ProjectCladCompanyContacts($companyId: ID!, $first: Int!, $after: String) {
    company(id: $companyId) {
      contacts(first: $first, after: $after) {
        nodes {
          customer {
            id
            email
            firstName
            lastName
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

/** List customers linked to a B2B company via company contacts (paginated, capped). */
export async function listCompanyContactCustomers(
  shop: string,
  companyId: string,
  accessToken?: string | null,
): Promise<CompanyContactCustomer[]> {
  const token = accessToken ?? (await getOfflineAccessTokenForShop(shop));
  if (!token) {
    throw new Error("Shopify access unavailable. Reauthorize the app.");
  }

  const results: CompanyContactCustomer[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage && results.length < COMPANY_CONTACTS_MAX) {
    const first = Math.min(
      COMPANY_CONTACTS_PAGE_SIZE,
      COMPANY_CONTACTS_MAX - results.length,
    );

    const data = await adminGraphql<CompanyContactsQueryResult>(
      shop,
      token,
      COMPANY_CONTACTS_QUERY,
      {
        companyId: companyGid(companyId),
        first,
        after,
      },
    );

    const nodes = data.company?.contacts?.nodes ?? [];
    for (const node of nodes) {
      const customer = node?.customer;
      if (!customer?.id) continue;
      const id = customerIdFromGid(customer.id);
      if (seen.has(id)) continue;
      seen.add(id);
      results.push({
        id,
        email: customer.email ?? null,
        firstName: customer.firstName ?? null,
        lastName: customer.lastName ?? null,
      });
    }

    hasNextPage = Boolean(data.company?.contacts?.pageInfo?.hasNextPage);
    after = data.company?.contacts?.pageInfo?.endCursor ?? null;
    if (!after) hasNextPage = false;
  }

  return results;
}
