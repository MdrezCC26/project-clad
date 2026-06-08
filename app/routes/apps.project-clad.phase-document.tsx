import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import { shopStringFilter, isProjectMember } from "../utils/projectAccess.server";
import { viewerHasAdminTag } from "../utils/customerTags.server";
import { getShopDeliveryFee } from "../utils/shopDeliveryFee.server";
import { buildPhasePdfBuffer } from "../utils/phaseDocumentPdf.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, customerId, customerEmail } = requireAppProxyCustomer(request);
  const url = new URL(request.url);
  const projectId = String(url.searchParams.get("id") || "").trim();
  const jobId = String(url.searchParams.get("jobId") || "").trim();
  const phaseId = String(url.searchParams.get("phaseId") || "").trim();
  const modeRaw = String(url.searchParams.get("mode") || "packing").toLowerCase();
  const mode = modeRaw === "invoice" ? "invoice" : "packing";

  if (!projectId || !jobId || !phaseId) {
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
        include: {
          items: { orderBy: { sortOrder: "asc" } },
          deliveryPhases: {
            where: { id: phaseId },
            include: { lines: true },
          },
        },
      },
    },
  });

  if (!project?.jobs[0]) {
    throw new Response("Not found", { status: 404 });
  }

  if (!isProjectMember(project, customerId, viewerIsAppAdmin)) {
    throw new Response("Forbidden", { status: 403 });
  }

  const job = project.jobs[0];
  const phase = job.deliveryPhases[0];
  if (!phase) {
    throw new Response("Phase not found", { status: 404 });
  }

  if (mode === "invoice") {
    const showInvoice =
      viewerIsAppAdmin ||
      job.orderLifecycleStatus === "delivered" ||
      job.orderLifecycleStatus === "paid" ||
      Boolean(phase.fulfillmentPhotoStorageKey);
    if (!showInvoice) {
      throw new Response("Forbidden", { status: 403 });
    }
  }

  const shopDeliveryFee = await getShopDeliveryFee(shop);
  const pdf = await buildPhasePdfBuffer({
    mode,
    project,
    job,
    phase,
    shopDeliveryFee,
  });

  const filename = `${mode}-delivery-${phase.sequence}-${job.name.replace(/[^a-z0-9-_]+/gi, "-")}.pdf`;
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-cache",
    },
  });
};
