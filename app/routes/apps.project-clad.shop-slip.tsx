import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import { viewerHasAdminTag } from "../utils/customerTags.server";
import { isProjectMember, shopStringFilter } from "../utils/projectAccess.server";
import { buildShopSlipHtml } from "../utils/shopSlipDocument.server";

/** Standalone shop cut sheet / packing slip document (no default export: HTML only). */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, customerId, customerEmail } = requireAppProxyCustomer(request);
  const url = new URL(request.url);
  const projectId = String(url.searchParams.get("id") || "").trim();
  const jobId = String(url.searchParams.get("jobId") || "").trim();

  if (!projectId || !jobId) {
    throw new Response("Missing parameters", { status: 400 });
  }

  const viewerIsAppAdmin = await viewerHasAdminTag(
    shop,
    customerId,
    customerEmail,
  );

  const project = await prisma.project.findFirst({
    where: { id: projectId, shop: shopStringFilter(shop) },
    include: {
      members: true,
      jobs: {
        where: { id: jobId },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });

  if (!project?.jobs[0]) {
    throw new Response("Not found", { status: 404 });
  }

  if (!isProjectMember(project, customerId, viewerIsAppAdmin)) {
    throw new Response("Forbidden", { status: 403 });
  }

  return new Response(buildShopSlipHtml({ project, job: project.jobs[0] }), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-cache, must-revalidate",
    },
  });
};
