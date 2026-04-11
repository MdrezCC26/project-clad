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

type ProjectForAccess = {
  ownerCustomerId: string;
  members: { customerId: string; role: string }[];
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

export function projectsListWhere(
  shop: string,
  customerId: string,
  viewerIsAppAdmin: boolean,
) {
  const shopQ = shopStringFilter(shop);
  if (viewerIsAppAdmin) {
    return { shop: shopQ };
  }
  const ids = shopifyCustomerIdVariants(customerId);
  const memberMatch = {
    members: { some: { customerId: { in: ids } } },
  };
  return {
    shop: shopQ,
    OR: [{ ownerCustomerId: { in: ids } }, memberMatch],
  };
}

export function projectByIdForCustomerWhere(
  id: string,
  shop: string,
  customerId: string,
  viewerIsAppAdmin: boolean,
) {
  const shopQ = shopStringFilter(shop);
  if (viewerIsAppAdmin) {
    return { id, shop: shopQ };
  }
  const ids = shopifyCustomerIdVariants(customerId);
  const memberMatch = {
    members: { some: { customerId: { in: ids } } },
  };
  return {
    id,
    shop: shopQ,
    OR: [{ ownerCustomerId: { in: ids } }, memberMatch],
  };
}
