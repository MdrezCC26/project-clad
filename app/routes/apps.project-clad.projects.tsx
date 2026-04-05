import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import {
  getCustomersByIds,
  type CustomerInfo,
} from "../utils/adminCustomers.server";
import { getCsvForProjectIds } from "../utils/exportProjectsCsv.server";
import { isEmailConfigured, sendEmail } from "../utils/email.server";
import {
  buildVariantPresentation,
  parseVariantSnapshot,
  persistVariantSnapshotsFromLive,
  resolveVariantDisplayInfo,
} from "../utils/variantInfo.server";
import { getThemeStyles } from "../utils/themeAssets.server";
import proxyStylesUrl from "../styles/project-clad-proxy.css?url";
import { PROJECT_CLAD_CURSOR_GLOW_SCRIPT } from "../utils/projectCladCursorGlowScript";
import { rewriteProjectCladProxyFontUrls } from "../utils/projectCladProxyStyles.server";
import {
  hasAdminTag,
  normalizeStorefrontCustomerId,
  viewerHasAdminTag,
} from "../utils/customerTags.server";
import {
  canAdminProjectMembers,
  projectsListWhere,
  shopStringFilter,
} from "../utils/projectAccess.server";

type ProjectListItem = {
  id: string;
  isOwner: boolean;
  name: string;
  createdAt: string;
  poNumber: string | null;
  companyName: string | null;
  jobCount: number;
  approvedJobCount: number;
  approvedBy: string[];
  approvalStatus: { requested: boolean; approved: boolean };
  jobs: {
    id: string;
    name: string;
    createdAt: string;
    isLocked: boolean;
    itemCount: number;
    items: {
      id: string;
      variantId: string;
      quantity: number;
      displayName: string;
      imageUrl: string | null;
      imageAlt: string | null;
      productUrl: string | null;
    }[];
  }[];
};

const buildProjectCartItems = (jobs: ProjectListItem["jobs"]) => {
  const totals = new Map<string, number>();
  jobs.forEach((job) => {
    job.items.forEach((item) => {
      totals.set(item.variantId, (totals.get(item.variantId) || 0) + item.quantity);
    });
  });
  return Array.from(totals.entries()).map(([variantId, quantity]) => ({
    variantId,
    quantity,
  }));
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const proxyStylesCss = rewriteProjectCladProxyFontUrls(request);
  const { shop, customerId, customerEmail } = requireAppProxyCustomer(request);
  const themeStyles = await getThemeStyles(shop);
  const settings = await prisma.shopSettings.findFirst({
    where: { shop: shopStringFilter(shop) },
  });
  const viewerIsAppAdmin = await viewerHasAdminTag(
    shop,
    customerId,
    customerEmail,
  );

  const projects = await prisma.project.findMany({
    where: projectsListWhere(shop, customerId, viewerIsAppAdmin),
    include: {
      jobs: {
        orderBy: { sortOrder: "asc" },
        include: {
          items: { orderBy: { sortOrder: "asc" } },
          orderLink: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const variantIds = projects.flatMap((project) =>
    project.jobs.flatMap((job) => job.items.map((item) => item.variantId)),
  );
  const { info: variantInfo, error: variantLookupError } =
    await resolveVariantDisplayInfo(shop, variantIds);

  await persistVariantSnapshotsFromLive({
    items: projects.flatMap((project) =>
      project.jobs.flatMap((job) =>
        job.items.map((item) => ({
          id: item.id,
          variantId: item.variantId,
          variantSnapshot: item.variantSnapshot,
        })),
      ),
    ),
    liveByVariantId: variantInfo,
  });

  let hideAddToCart = false;
  try {
    const numericId = normalizeStorefrontCustomerId(customerId);
    const customerInfo = await getCustomersByIds(shop, [numericId]);
    const viewerTags =
      customerInfo[numericId]?.tags ?? customerInfo[customerId]?.tags ?? [];
    hideAddToCart =
      viewerTags.some(
        (t: string) => String(t).trim().toUpperCase() === "NA",
      ) && !hasAdminTag(viewerTags);
  } catch {
    // If customer lookup fails, show add-to-cart (no NA restriction)
  }

  const projectIds = projects.map((p) => p.id);
  const projectLevelApprovals = await prisma.approvalRequest.findMany({
    where: {
      projectId: { in: projectIds },
      jobId: "",
      itemId: "",
    },
  });
  const approvalByProjectId = new Map(
    projectLevelApprovals.map((a) => [
      a.projectId,
      { requested: true, approved: Boolean(a.approvedAt) },
    ]),
  );

  const jobLevelApprovals = await prisma.approvalRequest.findMany({
    where: {
      projectId: { in: projectIds },
      NOT: { jobId: "" },
      itemId: "",
      approvedAt: { not: null },
    },
  });
  const approvedJobIds = new Set(jobLevelApprovals.map((a) => a.jobId));
  const approverCustomerIds = [
    ...new Set(
      jobLevelApprovals
        .map((a) => a.approvedByCustomerId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const approverInfo =
    approverCustomerIds.length > 0
      ? await getCustomersByIds(shop, approverCustomerIds).catch(
          () => ({}) as Record<string, CustomerInfo>,
        )
      : {};

  const payload: ProjectListItem[] = projects.map((project) => {
    const projectJobIds = new Set(project.jobs.map((j) => j.id));
    const projectApprovals = jobLevelApprovals.filter(
      (a) => a.projectId === project.id && projectJobIds.has(a.jobId),
    );
    const approverIds = [
      ...new Set(
        projectApprovals
          .map((a) => a.approvedByCustomerId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const approvedByNames = approverIds
      .map((id) => {
        const c = approverInfo[id];
        if (!c) return null;
        const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
        return name || c.email || id;
      })
      .filter((n): n is string => Boolean(n));

    return {
    id: project.id,
    isOwner: project.ownerCustomerId === customerId,
    name: project.name,
    createdAt: project.createdAt.toISOString(),
    poNumber: project.poNumber,
    companyName: project.companyName,
    jobCount: project.jobs.length,
    approvedJobCount: project.jobs.filter((job) =>
      approvedJobIds.has(job.id),
    ).length,
    approvedBy: approvedByNames,
    jobs: project.jobs.map((job) => ({
      id: job.id,
      name: job.name,
      createdAt: job.createdAt.toISOString(),
      isLocked: job.isLocked || Boolean(job.orderLink),
      itemCount: job.items.reduce((sum, item) => sum + item.quantity, 0),
      items: job.items.map((item) => {
        const pres = buildVariantPresentation({
          shop,
          variantId: item.variantId,
          live: variantInfo[item.variantId],
          snapshot: parseVariantSnapshot(item.variantSnapshot),
        });

        return {
          id: item.id,
          variantId: item.variantId,
          quantity: item.quantity,
          displayName: pres.displayName,
          imageUrl: pres.imageUrl,
          imageAlt: pres.imageAlt,
          productUrl: pres.productUrl,
        };
      }),
    })),
    approvalStatus: approvalByProjectId.get(project.id) ?? {
      requested: false,
      approved: false,
    },
  };
  });

  const navButtons = [
    { label: "Home", url: "/" },
    {
      label: settings?.navButton2Label || "Shop",
      url: settings?.navButton2Url || "/collections/main-products",
    },
    {
      label: settings?.navButton3Label || "Cart",
      url: settings?.navButton3Url || "/cart",
    },
  ];

  return {
    proxyStylesCss,
    projects: payload,
    themeStyles,
    shop,
    variantLookupError,
    hideAddToCart,
    navButtons,
    logoDataUrl: settings?.logoDataUrl || null,
    backgroundLogoDataUrl: settings?.backgroundLogoDataUrl || null,
    viewerStaffViewAll: viewerIsAppAdmin,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, customerId, customerEmail } = requireAppProxyCustomer(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent !== "delete-project") {
    return new Response("Unsupported action", { status: 400 });
  }

  const projectId = String(formData.get("projectId") || "");
  if (!projectId) {
    return new Response("Project not found", { status: 404 });
  }

  const viewerIsAppAdmin = await viewerHasAdminTag(
    shop,
    customerId,
    customerEmail,
  );

  const project = await prisma.project.findFirst({
    where: { id: projectId, shop: shopStringFilter(shop) },
    include: { members: true },
  });

  if (!project) {
    return new Response("Project not found", { status: 404 });
  }

  let viewerHasNATag = false;
  try {
    const vid = normalizeStorefrontCustomerId(customerId);
    const customerInfo = await getCustomersByIds(shop, [vid]);
    const viewerTags = customerInfo[vid]?.tags ?? [];
    viewerHasNATag = viewerTags.some(
      (t: string) => String(t).trim().toUpperCase() === "NA",
    );
  } catch {
    viewerHasNATag = false;
  }

  const canAdminMembers = canAdminProjectMembers(
    project,
    customerId,
    viewerIsAppAdmin,
    viewerHasNATag,
  );

  if (!canAdminMembers) {
    throw new Response("Forbidden", { status: 403 });
  }

  const backupEmail = "michaeldrezin@canadiancladding.ca";

  if (isEmailConfigured()) {
    try {
      const csv = await getCsvForProjectIds(shop, [projectId]);
      await sendEmail({
        to: backupEmail,
        subject: `ProjectClad project export: ${project.name}`,
        text: `Your project "${project.name}" has been deleted.`,
        attachments: [
          {
            filename: `projectclad-${project.name.replace(/[^a-z0-9-_]/gi, "-")}.csv`,
            content: csv,
          },
        ],
      });
    } catch {
      // Still delete the project even if email fails
    }
  }

  await prisma.project.delete({ where: { id: projectId } });
  return redirect("/apps/project-clad/projects");
};

export default function ProjectsPage() {
  const {
    proxyStylesCss,
    projects,
    themeStyles,
    shop,
    variantLookupError,
    hideAddToCart,
    navButtons,
    logoDataUrl,
    backgroundLogoDataUrl,
    viewerStaffViewAll,
  } = useLoaderData<typeof loader>();
  const inlineStyles = themeStyles?.styles || [];

  return (
    <>
      {(themeStyles?.urls ?? []).map((href: string) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      <style dangerouslySetInnerHTML={{ __html: proxyStylesCss }} />
      {inlineStyles.map((css, index) => (
        <style key={index} dangerouslySetInnerHTML={{ __html: css }} />
      ))}
      <main
        className={`project-clad-page project-clad-page--projects${backgroundLogoDataUrl ? " project-clad-page--card-bg-logo" : ""}`}
        style={
          backgroundLogoDataUrl
            ? { ["--project-clad-bg-logo" as string]: `url(${backgroundLogoDataUrl})` }
            : undefined
        }
      >
        <div className="page-width project-clad-container project-clad-container--full-width">
          {logoDataUrl && (
            <div className="project-clad-logo">
              <a href="/apps/project-clad/projects" className="project-clad-logo__link">
                <img
                  src={logoDataUrl}
                  alt="Logo"
                  className="project-clad-logo__img"
                />
              </a>
            </div>
          )}
          <header className="project-clad-header">
            <div className="project-clad-header-row">
              <nav className="project-clad-nav">
                {navButtons.map((btn, i) => (
                  <a key={i} href={btn.url} className="project-clad-button">
                    {btn.label}
                  </a>
                ))}
              </nav>
            </div>
          </header>
          {viewerStaffViewAll && (
            <p className="project-clad-staff-banner">
              Staff view: showing all saved projects for this store.
            </p>
          )}
          {variantLookupError && (
            <p className="project-clad-muted">{variantLookupError}</p>
          )}
          {projects.length === 0 ? (
            <section className="project-clad-card">
              <p className="project-clad-muted">
                You have not saved any projects yet.
              </p>
            </section>
          ) : (
            <section className="project-clad-grid">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className={`project-clad-card${project.approvalStatus.requested ? " project-clad-card--confirming" : ""}`}
                >
                  <a
                    href={`https://${shop}/apps/project-clad/project?id=${project.id}`}
                    className="project-clad-card-link"
                    rel="noopener"
                  >
                    <div className="project-clad-projects-tile-head">
                      <h2 className="project-clad-title">{project.name}</h2>
                      <p className="project-clad-muted project-clad-projects-tile-company">
                        Company name: {project.companyName || "—"}
                      </p>
                      <p className="project-clad-muted project-clad-projects-tile-po">
                        Project #: {project.poNumber || "—"}
                      </p>
                      <p className="project-clad-muted project-clad-projects-tile-created">
                        Created: {new Date(project.createdAt).toLocaleDateString()}
                      </p>
                      <p className="project-clad-muted project-clad-projects-tile-orders">
                        Orders: {project.jobCount}
                      </p>
                    </div>
                  </a>
                  {hideAddToCart && (() => {
                    const status = project.approvalStatus;
                    if (status.approved) {
                      return (
                        <div className="project-clad-actions">
                          <span className="project-clad-muted">Order approved</span>
                        </div>
                      );
                    }
                    if (status.requested) {
                      return (
                        <div className="project-clad-actions">
                          <form
                            method="get"
                            action={`https://${shop}/apps/project-clad/api/project-actions`}
                            data-projectclad-submit-approval
                            data-project-id={project.id}
                            data-shop={shop}
                            data-intent="cancel-approval-request"
                          >
                            <input
                              type="hidden"
                              name="intent"
                              value="cancel-approval-request"
                            />
                            <input
                              type="hidden"
                              name="projectId"
                              value={project.id}
                            />
                            <button
                              type="submit"
                              className="project-clad-button"
                            >
                              Confirming order
                            </button>
                            <span
                              className="project-clad-muted"
                              data-projectclad-approval-message
                            />
                          </form>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              ))}
            </section>
          )}
        </div>
      </main>
      <script
        dangerouslySetInnerHTML={{ __html: PROJECT_CLAD_CURSOR_GLOW_SCRIPT }}
      />
      <script
        dangerouslySetInnerHTML={{
          __html: `
(function() {
  var main = document.querySelector('.project-clad-page');
  if (main) {
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        main.classList.add('project-clad-enter-done');
      });
    });
  }
  document.addEventListener('click', function(e) {
    var a = e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.getAttribute('data-projectclad-no-transition')) return;
    var href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    try {
      var url = new URL(href, location.origin);
      if (url.origin !== location.origin) return;
    } catch (err) { return; }
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.add('project-clad-leaving');
    setTimeout(function() { window.location.href = href; }, 180);
  }, true);
})();
          `,
        }}
      />
      <script
        dangerouslySetInnerHTML={{
          __html: `
(function() {
  document.querySelectorAll('[data-projectclad-submit-approval]').forEach(function(form) {
    if (!(form instanceof HTMLFormElement)) return;
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var projectId = form.getAttribute('data-project-id');
      var shop = form.getAttribute('data-shop');
      var msgEl = form.querySelector('[data-projectclad-approval-message]');
      function setMsg(t) { if (msgEl) msgEl.textContent = t || ''; }
      setMsg('');
      var intent = form.getAttribute('data-intent') || 'submit-for-approval';
      var url = 'https://' + shop + '/apps/project-clad/api/project-actions?intent=' + encodeURIComponent(intent) + '&projectId=' + encodeURIComponent(projectId);
      fetch(url, { credentials: 'include' }).then(function(r) {
        return r.json().then(function(data) {
          if (!r.ok && data?.redirectTo) {
            window.location.href = data.redirectTo;
            return;
          }
          return { response: r, data: data };
        });
      }).then(function(result) {
        if (!result) return;
        var data = result.data;
        if (data.ok) {
          setMsg(intent === 'cancel-approval-request' ? 'Approval request cancelled.' : 'Approval request sent.');
          window.location.reload();
        } else {
          setMsg(data.error || '');
        }
      }).catch(function() { setMsg('Unable to send.'); });
    });
  });
})();
          `,
        }}
      />
    </>
  );
}

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: proxyStylesUrl },
];
