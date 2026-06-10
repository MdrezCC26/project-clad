import prisma from "../db.server";
import { getViewerCompanyContext } from "./customerTags.server";
import { customerIdsMatch } from "./projectAccess.server";

export async function transferProjectOwner(args: {
  shop: string;
  projectId: string;
  previousOwnerCustomerId: string;
  newOwnerCustomerId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { shop, projectId, previousOwnerCustomerId, newOwnerCustomerId } = args;

  if (customerIdsMatch(newOwnerCustomerId, previousOwnerCustomerId)) {
    return { ok: false, error: "This member is already the project owner." };
  }

  const members = await prisma.projectMember.findMany({
    where: { projectId },
  });
  const member = members.find((m) =>
    customerIdsMatch(m.customerId, newOwnerCustomerId),
  );
  if (!member) {
    return {
      ok: false,
      error:
        "Only existing project members can be made owner. Add them as a member first.",
    };
  }

  const newOwnerCtx = await getViewerCompanyContext(shop, newOwnerCustomerId);
  const ownerCompanyKey = newOwnerCtx.keys[0] ?? null;
  const b2bCompanyName = newOwnerCtx.displayNames[0] ?? null;

  const resolvedNewOwnerId = member.customerId;

  await prisma.$transaction(async (tx) => {
    await tx.projectMember.deleteMany({
      where: { projectId, customerId: resolvedNewOwnerId },
    });
    await tx.projectMember.upsert({
      where: {
        projectId_customerId: {
          projectId,
          customerId: previousOwnerCustomerId,
        },
      },
      update: { role: "edit" },
      create: {
        projectId,
        customerId: previousOwnerCustomerId,
        role: "edit",
      },
    });
    await tx.project.update({
      where: { id: projectId },
      data: {
        ownerCustomerId: resolvedNewOwnerId,
        ownerCompanyKey,
        ...(b2bCompanyName ? { companyName: b2bCompanyName } : {}),
      },
    });
  });

  return { ok: true };
}
