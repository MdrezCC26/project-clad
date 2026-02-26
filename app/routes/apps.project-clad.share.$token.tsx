import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop, customerId } = requireAppProxyCustomer(request);
  const token = params.token || "";

  const shareToken = await prisma.projectShareToken.findFirst({
    where: { token, project: { shop } },
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

  return redirect(`/apps/project-clad/projects/${shareToken.projectId}`);
};
