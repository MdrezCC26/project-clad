import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, customerId } = requireAppProxyCustomer(request, {
    jsonOnFail: true,
  });

  const projects = await prisma.project.findMany({
    where: {
      shop,
      OR: [
        { ownerCustomerId: customerId },
        { members: { some: { customerId } } },
      ],
    },
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
