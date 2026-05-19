import type { Prisma } from "@prisma/client";

/** App proxy / session shop strings must match DB rows even if casing differs. */
export function shopStringFilter(shop: string): Prisma.StringFilter {
  return { equals: shop.trim(), mode: "insensitive" };
}

function customerIdDigitTail(id: string): string {
  const s = String(id).trim();
  const tail = s.includes("/")
    ? (s.split("/").pop() ?? s).replace(/\D/g, "")
    : s.replace(/\D/g, "");
  return tail;
}

/** True if two Shopify customer id strings refer to the same customer (GID vs numeric). */
export function customerIdsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const sa = String(a).trim();
  const sb = String(b).trim();
  if (sa === sb) return true;
  const da = customerIdDigitTail(sa);
  const db = customerIdDigitTail(sb);
  return Boolean(da && db && da.length >= 6 && da === db);
}

/** Variants to use in Prisma `in` filters when session and DB formats may differ. */
export function shopifyCustomerIdVariants(customerId: string): string[] {
  const s = String(customerId).trim();
  const out = new Set<string>([s]);
  const digits = customerIdDigitTail(s);
  if (digits && digits.length >= 6) {
    out.add(digits);
    out.add(`gid://shopify/Customer/${digits}`);
  }
  return [...out];
}

/** Digits-only ids for Admin API lookups that prepend `gid://shopify/Customer/` per id. */
export function customerNumericIdsForAdminApi(customerIdRaw: string): string[] {
  const set = new Set<string>();
  for (const v of shopifyCustomerIdVariants(customerIdRaw)) {
    const tail = v.includes("/")
      ? v.split("/").pop() ?? v
      : v;
    const digits = String(tail).replace(/\D/g, "");
    if (digits.length >= 6) {
      set.add(digits);
    }
  }
  const d = String(customerIdRaw).replace(/\D/g, "");
  if (d.length >= 6) {
    set.add(d);
  }
  return [...set];
}

type ProjectForAccess = {
  ownerCustomerId: string;
  members: { customerId: string; role: string }[];
};

type ProjectForCompanyAccess = {
  ownerCompanyKey?: string | null;
  visibleToCompany?: boolean | null;
};

export function isProjectMember(
  project: ProjectForAccess,
  customerId: string,
  viewerIsAppAdmin: boolean,
): boolean {
  if (viewerIsAppAdmin) return true;
  if (customerIdsMatch(project.ownerCustomerId, customerId)) return true;
  return project.members.some((m) => customerIdsMatch(m.customerId, customerId));
}

/**
 * True when the viewer may READ the project because at least one of their `company:*` tag
 * keys matches the project owner's company and the project is flagged visible to company.
 * Never grants edit rights — callers still gate writes with {@link canEditProject}.
 */
export function canViewProjectViaCompany(
  project: ProjectForCompanyAccess,
  viewerCompanyKeys: string[] | null | undefined,
): boolean {
  if (!project.visibleToCompany) return false;
  const key = project.ownerCompanyKey?.trim();
  if (!key) return false;
  if (!viewerCompanyKeys?.length) return false;
  return viewerCompanyKeys.includes(key);
}

/** True when the viewer is the Shopify customer who owns the project (handles GID vs numeric id). */
export function isProjectOwner(
  project: Pick<ProjectForAccess, "ownerCustomerId">,
  customerId: string,
): boolean {
  return customerIdsMatch(project.ownerCustomerId, customerId);
}

export function canEditProject(
  project: ProjectForAccess,
  customerId: string,
  viewerIsAppAdmin: boolean,
): boolean {
  if (viewerIsAppAdmin) return true;
  if (customerIdsMatch(project.ownerCustomerId, customerId)) return true;
  return project.members.some(
    (m) => customerIdsMatch(m.customerId, customerId) && m.role === "edit",
  );
}

export function canAdminProjectMembers(
  project: ProjectForAccess,
  customerId: string,
  viewerIsAppAdmin: boolean,
  viewerHasNATag: boolean,
): boolean {
  if (viewerIsAppAdmin) return true;
  const isOwner = customerIdsMatch(project.ownerCustomerId, customerId);
  if (isOwner) return true;
  const memberRole = project.members.find((m) =>
    customerIdsMatch(m.customerId, customerId),
  )?.role;
  const canEdit = isOwner || memberRole === "edit";
  return canEdit && !viewerHasNATag;
}

/** Optional extras for the list/detail where-builders to support the "Company" scope. */
export type ProjectAccessOptions = {
  /** "mine" = owner + explicit members only (default). "company" = additionally include company-tag matches. */
  scope?: "mine" | "company";
  /** Normalized `company:*` keys derived from the viewer's Shopify customer tags. */
  viewerCompanyKeys?: string[];
};

function buildCompanyVisibilityMatch(keys?: string[]) {
  if (!keys?.length) return null;
  return {
    ownerCompanyKey: { in: keys },
    visibleToCompany: true,
  };
}

export function projectsListWhere(
  shop: string,
  customerId: string,
  viewerIsAppAdmin: boolean,
  options: ProjectAccessOptions = {},
) {
  const shopQ = shopStringFilter(shop);
  if (viewerIsAppAdmin) {
    return { shop: shopQ };
  }

  const ids = shopifyCustomerIdVariants(customerId);
  const ownerOrMember = [
    { ownerCustomerId: { in: ids } },
    { members: { some: { customerId: { in: ids } } } },
  ];

  if (options.scope !== "company") {
    return { shop: shopQ, OR: ownerOrMember };
  }

  const companyMatch = buildCompanyVisibilityMatch(options.viewerCompanyKeys);
  if (!companyMatch) {
    return { shop: shopQ, OR: ownerOrMember };
  }

  return {
    shop: shopQ,
    OR: [...ownerOrMember, companyMatch],
  };
}

export function projectByIdForCustomerWhere(
  id: string,
  shop: string,
  customerId: string,
  viewerIsAppAdmin: boolean,
  options: ProjectAccessOptions = {},
) {
  const shopQ = shopStringFilter(shop);
  if (viewerIsAppAdmin) {
    return { id, shop: shopQ };
  }

  const ids = shopifyCustomerIdVariants(customerId);
  const ownerOrMember = [
    { ownerCustomerId: { in: ids } },
    { members: { some: { customerId: { in: ids } } } },
  ];

  /* Project detail defaults to scope "company" so coworkers who click through
     a shared URL can view read-only without needing to toggle a filter. */
  const effectiveScope = options.scope ?? "company";
  if (effectiveScope !== "company") {
    return { id, shop: shopQ, OR: ownerOrMember };
  }

  const companyMatch = buildCompanyVisibilityMatch(options.viewerCompanyKeys);
  if (!companyMatch) {
    return { id, shop: shopQ, OR: ownerOrMember };
  }

  return {
    id,
    shop: shopQ,
    OR: [...ownerOrMember, companyMatch],
  };
}
