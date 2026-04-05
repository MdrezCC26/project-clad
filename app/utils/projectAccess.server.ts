import type { Prisma } from "@prisma/client";

/** App proxy / session shop strings must match DB rows even if casing differs. */
export function shopStringFilter(shop: string): Prisma.StringFilter {
  return { equals: shop.trim(), mode: "insensitive" };
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
  if (project.ownerCustomerId === customerId) return true;
  return project.members.some((m) => m.customerId === customerId);
}

export function canEditProject(
  project: ProjectForAccess,
  customerId: string,
  viewerIsAppAdmin: boolean,
): boolean {
  if (viewerIsAppAdmin) return true;
  if (project.ownerCustomerId === customerId) return true;
  return project.members.some(
    (m) => m.customerId === customerId && m.role === "edit",
  );
}

export function canAdminProjectMembers(
  project: ProjectForAccess,
  customerId: string,
  viewerIsAppAdmin: boolean,
  viewerHasNATag: boolean,
): boolean {
  if (viewerIsAppAdmin) return true;
  const isOwner = project.ownerCustomerId === customerId;
  if (isOwner) return true;
  const memberRole = project.members.find((m) => m.customerId === customerId)
    ?.role;
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
  return {
    shop: shopQ,
    OR: [
      { ownerCustomerId: customerId },
      { members: { some: { customerId } } },
    ],
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
  return {
    id,
    shop: shopQ,
    OR: [
      { ownerCustomerId: customerId },
      { members: { some: { customerId } } },
    ],
  };
}
