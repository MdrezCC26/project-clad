import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import {
  getViewerCompanyContext,
  viewerHasAdminTag,
} from "../utils/customerTags.server";
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

  const [projects, viewerCompanyCtx] = await Promise.all([
    prisma.project.findMany({
      where: projectsListWhere(shop, customerId, viewerIsAppAdmin),
      include: { jobs: { include: { orderLink: true } } },
      orderBy: { createdAt: "desc" },
    }),
    viewerIsAppAdmin
      ? Promise.resolve({ tags: [], displayNames: [], keys: [] as string[] })
      : getViewerCompanyContext(shop, customerId),
  ]);

  return Response.json({
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      poNumber: project.poNumber,
      companyName: project.companyName,
      storefrontStatus: project.storefrontStatus,
      jobs: project.jobs.map((job) => ({
        id: job.id,
        name: job.name,
        purchaseOrderNumber: job.purchaseOrderNumber,
        isLocked: job.isLocked || Boolean(job.orderLink),
      })),
    })),
    viewerDefaultCompany: viewerCompanyCtx.displayNames[0] ?? null,
  });
};
