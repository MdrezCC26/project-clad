import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import { shopStringFilter } from "../utils/projectAccess.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop, customerId } = requireAppProxyCustomer(request);
  const token = params.token ?? "";

  /* One invite row per project (`ProjectShareToken.projectId` is unique): token stays stable;
     acceptance assigns `shareToken.role` to `ProjectMember`. */
  const shareToken = await prisma.projectShareToken.findFirst({
    where: { token, project: { shop: shopStringFilter(shop) } },
    include: { project: true },
  });

  if (!shareToken) {
    throw new Response("Share link not found", { status: 404 });
  }

  await prisma.projectMember.upsert({
    where: {
      projectId_customerId: {
        projectId: shareToken.projectId,
        customerId: customerId,
      },
    },
    update: { role: shareToken.role },
    create: {
      projectId: shareToken.projectId,
      customerId: customerId,
      role: shareToken.role,
    },
  });

  // Use the canonical project URL (not `/projects/:id`) so we always hit `apps.project-clad.project`.
  return redirect(
    `/apps/project-clad/project?id=${encodeURIComponent(shareToken.projectId)}`,
  );
};
