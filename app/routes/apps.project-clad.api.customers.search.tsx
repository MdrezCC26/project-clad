import type { LoaderFunctionArgs } from "react-router";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import {
  getViewerB2bCompanyContext,
  listCompanyContactCustomers,
} from "../utils/b2bCompany.server";
import { getOfflineAccessTokenForShop } from "../utils/adminCustomers.server";

const MAX_RESULTS = 10;

type SearchResult = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
};

/**
 * Free-text customer search scoped to the viewer's Shopify B2B company. Used by the
 * project detail "Add member" typeahead.
 *
 * Strategy: fetch contacts on the viewer's B2B company via Admin GraphQL, then filter
 * in memory against `q`. Fine at company scale (dozens, not thousands).
 *
 * Query params:
 *   - `q` (required, min 2 chars): substring match against email / first / last name / "first last".
 *
 * Response:
 *   - `{ results: [...] }` (up to 10) when viewer has a B2B company.
 *   - `{ results: [], reason: "no-b2b-company" }` when viewer has no B2B company.
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

  const viewerB2b = await getViewerB2bCompanyContext(shop, customerId);
  if (!viewerB2b.companyId) {
    return Response.json({ results: [], reason: "no-b2b-company" });
  }

  const accessToken = await getOfflineAccessTokenForShop(shop);
  if (!accessToken) {
    return Response.json(
      { error: "Shopify access unavailable. Reauthorize the app." },
      { status: 500 },
    );
  }

  let contacts;
  try {
    contacts = await listCompanyContactCustomers(
      shop,
      viewerB2b.companyId,
      accessToken,
    );
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to load company contacts.",
      },
      { status: 502 },
    );
  }

  const viewerId = String(customerId).replace(/\D/g, "");
  const needle = q.toLowerCase();

  const results: SearchResult[] = contacts
    .map((row): SearchResult | null => {
      const idStr = row.id;
      if (!idStr) return null;
      if (idStr.replace(/\D/g, "") === viewerId) return null;

      const email = (row.email ?? "").toLowerCase();
      const first = (row.firstName ?? "").toLowerCase();
      const last = (row.lastName ?? "").toLowerCase();
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
        firstName: row.firstName ?? null,
        lastName: row.lastName ?? null,
      };
    })
    .filter((r): r is SearchResult => Boolean(r))
    .slice(0, MAX_RESULTS);

  return Response.json({ results });
};
