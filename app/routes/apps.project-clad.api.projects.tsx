import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import { viewerHasAdminTag } from "../utils/customerTags.server";
import { projectsListWhere } from "../utils/projectAccess.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, customerId, customerEmail } = requireAppProxyCustomer(request, {
    jsonOnFail: true,
  });
  const viewerIsAppAdmin = await viewerHasAdminTag(
    shop,
    customerId,
    customerEmail,
  );

  const projects = await prisma.project.findMany({
    where: projectsListWhere(shop, customerId, viewerIsAppAdmin),
    include: { jobs: { include: { orderLink: true } } },
    orderBy: { createdAt: "desc" },
  });

  return Response.json({
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      poNumber: project.poNumber,
      companyName: project.companyName,
      jobs: project.jobs.map((job) => ({
        id: job.id,
        name: job.name,
        isLocked: job.isLocked || Boolean(job.orderLink),
      })),
    })),
  });
};
