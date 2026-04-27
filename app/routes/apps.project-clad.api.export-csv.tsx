import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import { buildAcombaCsvForJob } from "../utils/acombaExport.server";
import {
  isProjectMember,
  canViewProjectViaCompany,
  shopStringFilter,
  shopifyCustomerIdVariants,
} from "../utils/projectAccess.server";
import {
  customerEmailInConfiguredList,
  getViewerCompanyContext,
} from "../utils/customerTags.server";

/** Finance-only allowlist: prefer `PROJECTCLAD_CSV_EXPORT_EMAILS`; legacy `PROJECTCLAD_ACOMBA_EXPORT_EMAILS` still accepted. */
function csvExportEmailAllowlist(): string | undefined {
  return (
    process.env.PROJECTCLAD_CSV_EXPORT_EMAILS?.trim() ||
    process.env.PROJECTCLAD_ACOMBA_EXPORT_EMAILS?.trim()
  );
}

/**
 * Streams a per-order CSV for finance / bookkeeping. Reachable from the
 * storefront proxy at `/apps/project-clad/api/export-csv?jobId=...`.
 *
 * Access: viewer must be project owner, an explicit member, OR have read
 * access via `visibleToCompany` + a matching `company:*` customer tag.
 *
 * Output: text/csv with a UTF-8 BOM. The browser triggers a download via
 * `Content-Disposition: attachment`.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, customerId, customerEmail } = requireAppProxyCustomer(request);
  const url = new URL(request.url);
  const jobId = (url.searchParams.get("jobId") || "").trim();

  if (!jobId) {
    return Response.json({ error: "Missing jobId" }, { status: 400 });
  }

  /* Hard gate: only the configured finance email(s) can download the CSV.
     UI hides the button for everyone else; this is server-side enforcement. */
  const allowlist = csvExportEmailAllowlist();
  if (!allowlist || !customerEmailInConfiguredList(customerEmail, allowlist)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId, project: { shop: shopStringFilter(shop) } },
    select: {
      id: true,
      project: {
        select: {
          ownerCustomerId: true,
          ownerCompanyKey: true,
          visibleToCompany: true,
          members: { select: { customerId: true, role: true } },
        },
      },
    },
  });

  if (!job?.project) {
    return Response.json({ error: "Order not found" }, { status: 404 });
  }

  /* Access check — same rules as the project detail page. */
  let allowed = isProjectMember(
    {
      ownerCustomerId: job.project.ownerCustomerId,
      members: job.project.members,
    },
    customerId,
    /* viewerIsAppAdmin */ false,
  );

  if (!allowed) {
    const viewerCtx = await getViewerCompanyContext(shop, customerId);
    allowed = canViewProjectViaCompany(
      {
        ownerCompanyKey: job.project.ownerCompanyKey,
        visibleToCompany: job.project.visibleToCompany,
      },
      viewerCtx?.keys,
    );
  }

  /* Belt + suspenders: ensure id format mismatches don't lock out the owner. */
  if (!allowed) {
    const ids = shopifyCustomerIdVariants(customerId);
    allowed = ids.includes(job.project.ownerCustomerId);
  }

  if (!allowed) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const built = await buildAcombaCsvForJob({ jobId, shop });
  if (!built) {
    return Response.json({ error: "Order not found" }, { status: 404 });
  }

  return new Response(built.contents, {
    status: 200,
    headers: {
      "Content-Type": built.contentType,
      "Content-Disposition": `attachment; filename="${built.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
};
