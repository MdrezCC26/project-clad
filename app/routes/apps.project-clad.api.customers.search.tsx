import type { LoaderFunctionArgs } from "react-router";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import {
  getOfflineAccessTokenForShop,
  normalizeShopifyTagsField,
} from "../utils/adminCustomers.server";
import {
  COMPANY_TAG_PREFIX,
  getViewerCompanyContext,
} from "../utils/customerTags.server";

const CUSTOMER_API_VERSION = "2024-10";
const MAX_RESULTS = 10;
/** Upper bound on raw rows we pull from Shopify before in-memory filtering. */
const SHOPIFY_LIMIT = 50;

type SearchResult = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  companyTags: string[];
};

type RawCustomer = {
  id?: number | string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  tags?: unknown;
};

/**
 * Free-text customer search scoped to the viewer's `company:<name>` tags. Used by the
 * project detail "Add member" typeahead.
 *
 * Strategy: fetch every customer who shares ANY of the viewer's `company:*` tags from
 * Shopify with a single `tag:...` query, then filter in memory against `q`. This avoids
 * the flaky behavior of nested `(tag:X) AND (first_name:Y* OR ...)` queries on the
 * REST search endpoint, and is fine at company scale (dozens, not thousands).
 *
 * Query params:
 *   - `q` (required, min 2 chars): substring match against email / first / last name / "first last".
 *
 * Response:
 *   - `{ results: [...] }` (up to 10) when viewer has company tags.
 *   - `{ results: [], reason: "no-company-tag" }` when viewer has no company tag.
 *   - `{ results: [], reason: "too-short" }` when q has < 2 chars.
 *   - `{ error: string }` (4xx/5xx) on auth/network failures.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, customerId } = requireAppProxyCustomer(request);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();

  if (q.length < 2) {
    return Response.json({ results: [], reason: "too-short" });
  }

  const viewerCtx = await getViewerCompanyContext(shop, customerId);
  if (viewerCtx.tags.length === 0) {
    return Response.json({ results: [], reason: "no-company-tag" });
  }

  const accessToken = await getOfflineAccessTokenForShop(shop);
  if (!accessToken) {
    return Response.json(
      { error: "Shopify access unavailable. Reauthorize the app." },
      { status: 500 },
    );
  }

  /* One Shopify call per company tag. Usually just 1; 2-3 if viewer spans companies.
     Tag matching is case-insensitive on Shopify's side, so raw casing is fine. */
  const shopDomain = shop.trim().toLowerCase();
  const endpointBase = `https://${shopDomain}/admin/api/${CUSTOMER_API_VERSION}/customers/search.json`;
  const rawById = new Map<string, RawCustomer>();

  for (const tag of viewerCtx.tags) {
    const tagQuery = `tag:"${tag.replace(/"/g, '\\"')}"`;
    const endpoint = `${endpointBase}?query=${encodeURIComponent(tagQuery)}&limit=${SHOPIFY_LIMIT}`;

    let response: Response;
    try {
      response = await fetch(endpoint, {
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
      });
    } catch (err) {
      return Response.json(
        {
          error:
            err instanceof Error
              ? `Shopify network error: ${err.message}`
              : "Shopify network error.",
        },
        { status: 502 },
      );
    }

    if (response.status === 401 || response.status === 403) {
      return Response.json(
        {
          error:
            "Customer search unavailable. App needs reauthorization with read_customers.",
        },
        { status: 403 },
      );
    }

    if (!response.ok) {
      return Response.json(
        { error: `Shopify responded ${response.status} for tag "${tag}".` },
        { status: 502 },
      );
    }

    const payload = (await response.json().catch(() => null)) as {
      customers?: RawCustomer[];
    } | null;

    for (const row of payload?.customers ?? []) {
      const idStr = row.id != null ? String(row.id) : "";
      if (!idStr) continue;
      /* Dedupe across multiple tag queries (viewer with multiple company tags). */
      if (!rawById.has(idStr)) rawById.set(idStr, row);
    }
  }

  const viewerId = String(customerId).replace(/\D/g, "");
  const needle = q.toLowerCase();

  const results: SearchResult[] = Array.from(rawById.values())
    .map((row): SearchResult | null => {
      const idStr = row.id != null ? String(row.id) : "";
      if (!idStr) return null;
      /* Exclude viewer from their own suggestions. */
      if (idStr.replace(/\D/g, "") === viewerId) return null;

      const tags = normalizeShopifyTagsField(row.tags);
      const companyTags = tags.filter((t) =>
        t.toLowerCase().startsWith(COMPANY_TAG_PREFIX),
      );

      const email = (row.email ?? "").toLowerCase();
      const first = (row.first_name ?? "").toLowerCase();
      const last = (row.last_name ?? "").toLowerCase();
      const full = `${first} ${last}`.trim();

      const matches =
        email.includes(needle) ||
        first.includes(needle) ||
        last.includes(needle) ||
        full.includes(needle);
      if (!matches) return null;

      return {
        id: idStr,
        email: row.email ?? null,
        firstName: row.first_name ?? null,
        lastName: row.last_name ?? null,
        companyTags,
      };
    })
    .filter((r): r is SearchResult => Boolean(r))
    .slice(0, MAX_RESULTS);

  return Response.json({ results });
};
