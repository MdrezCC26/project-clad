import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import {
  Link,
  Outlet,
  redirect,
  useLoaderData,
  useLocation,
  useSearchParams,
} from "react-router";
import { useMemo } from "react";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import {
  fetchCustomerTagsRest,
  getCustomersByIds,
  type CustomerInfo,
} from "../utils/adminCustomers.server";
import { getCsvForProjectIds } from "../utils/exportProjectsCsv.server";
import { isEmailConfigured } from "../utils/email.server";
import {
  getEmailNotificationPrefs,
  isEmailNotificationEnabled,
} from "../utils/emailNotificationPrefs.server";
import { sendTransactionalEmail } from "../utils/transactionalEmail.server";
import {
  buildVariantPresentation,
  parseVariantSnapshot,
  persistVariantSnapshotsFromLive,
  resolveVariantDisplayInfo,
} from "../utils/variantInfo.server";
import { getThemeStyles } from "../utils/themeAssets.server";
import { PROJECT_CLAD_CURSOR_GLOW_SCRIPT } from "../utils/projectCladCursorGlowScript";
import { rewriteProjectCladProxyFontUrls } from "../utils/projectCladProxyStyles.server";
import {
  getViewerCompanyContext,
  hasTag,
  normalizeStorefrontCustomerId,
  viewerHasAdminTag,
} from "../utils/customerTags.server";
import {
  canAdminProjectMembers,
  customerIdsMatch,
  projectsListWhere,
  shopStringFilter,
} from "../utils/projectAccess.server";
import { ProjectCladStorefrontNav } from "../components/ProjectCladStorefrontNav";
import { getStorefrontAppNav } from "../utils/storefrontAppNav";

type ProjectListItem = {
  id: string;
  isOwner: boolean;
  /** True when this row is only visible because viewer's `company:*` tag matches the owner's. */
  viaCompany: boolean;
  /** Display name for the owner (falls back to email / id). Populated only in Company scope. */
  ownerLabel: string | null;
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

function projectListItemMatchesQuery(project: ProjectListItem, qRaw: string): boolean {
  const q = qRaw.trim().toLowerCase();
  if (!q) return true;
  const parts = q.split(/\s+/).filter(Boolean);
  const hay = [
    project.name,
    project.poNumber || "",
    project.companyName || "",
    String(project.jobCount),
    ...project.jobs.flatMap((job) => [
      job.name,
      ...job.items.map((item) => item.displayName),
    ]),
  ]
    .join(" ")
    .toLowerCase();
  return parts.every((part) => hay.includes(part));
}

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

  /* "mine" shows owner + explicit membership. "company" additionally surfaces coworker
     projects via matching `company:*` customer tags (read-only). Default "mine". */
  const url = new URL(request.url);
  const scopeParam = url.searchParams.get("scope");
  const scope: "mine" | "company" = scopeParam === "company" ? "company" : "mine";

  const viewerCompanyCtx = viewerIsAppAdmin
    ? { tags: [], displayNames: [], keys: [] as string[] }
    : await getViewerCompanyContext(shop, customerId);
  const hasAnyCompanyTag = viewerCompanyCtx.keys.length > 0;

  const projects = await prisma.project.findMany({
    where: projectsListWhere(shop, customerId, viewerIsAppAdmin, {
      scope,
      viewerCompanyKeys: viewerCompanyCtx.keys,
    }),
    include: {
      members: { select: { customerId: true } },
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
  let navAccountInitial: string | null = null;
  try {
    const numericId = normalizeStorefrontCustomerId(customerId);
    const [customerInfo, viewerTagsFromRest] = await Promise.all([
      getCustomersByIds(shop, [numericId]),
      fetchCustomerTagsRest(shop, numericId),
    ]);
    const viewer =
      customerInfo[numericId] ?? customerInfo[customerId];
    hideAddToCart =
      hasTag(viewerTagsFromRest, "NA") && !viewerIsAppAdmin;
    const fn = viewer?.firstName?.trim();
    navAccountInitial = fn
      ? fn.charAt(0).toUpperCase()
      : customerEmail?.trim()
        ? customerEmail.trim().charAt(0).toUpperCase()
        : null;
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

  /* Owner attribution for the Company scope. In "mine" scope every row is either the
     viewer's or a project they're explicitly a member of, so we still compute it cheaply
     here — adds minimal overhead since we already batch-fetched approver data. */
  const ownerIds = Array.from(
    new Set(projects.map((p) => p.ownerCustomerId).filter(Boolean)),
  );
  const ownerInfo =
    ownerIds.length > 0
      ? await getCustomersByIds(shop, ownerIds).catch(
          () => ({}) as Record<string, CustomerInfo>,
        )
      : ({} as Record<string, CustomerInfo>);
  const labelForOwner = (id: string): string | null => {
    const c = ownerInfo[id];
    if (!c) return null;
    const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
    return name || c.email || id;
  };

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

    const isOwnerRow = customerIdsMatch(project.ownerCustomerId, customerId);
    const isExplicitMember =
      !isOwnerRow &&
      project.members.some((m) => customerIdsMatch(m.customerId, customerId));
    const viaCompanyRow =
      !isOwnerRow &&
      !isExplicitMember &&
      !viewerIsAppAdmin &&
      Boolean(project.visibleToCompany) &&
      project.ownerCompanyKey != null &&
      viewerCompanyCtx.keys.includes(project.ownerCompanyKey);

    return {
    id: project.id,
    isOwner: isOwnerRow,
    viaCompany: viaCompanyRow,
    ownerLabel: labelForOwner(project.ownerCustomerId),
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

  const storefrontAppNav = getStorefrontAppNav(settings);

  return {
    proxyStylesCss,
    projects: payload,
    themeStyles,
    shop,
    variantLookupError,
    hideAddToCart,
    storefrontAppNav,
    logoDataUrl: settings?.logoDataUrl || null,
    backgroundLogoDataUrl: settings?.backgroundLogoDataUrl || null,
    navAccountInitial,
    scope,
    hasCompanyScope: hasAnyCompanyTag || viewerIsAppAdmin,
    viewerCompanyDisplayNames: viewerCompanyCtx.displayNames,
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

  const vid = normalizeStorefrontCustomerId(customerId);
  const viewerTagsForDelete = await fetchCustomerTagsRest(shop, vid);
  const viewerHasNATag = hasTag(viewerTagsForDelete, "NA");

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
    const deleteNotifyPrefs = await getEmailNotificationPrefs(shop);
    if (isEmailNotificationEnabled(deleteNotifyPrefs, "projectDeleteBackup")) {
      try {
        const csv = await getCsvForProjectIds(shop, [projectId]);
        await sendTransactionalEmail({
          shop,
          to: backupEmail,
          subject: `ProjectClad project export: ${project.name}`,
          text: `Your project "${project.name}" has been deleted.`,
          extraAttachments: [
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
  }

  await prisma.project.delete({ where: { id: projectId } });
  return redirect("/apps/project-clad/projects");
};

export default function ProjectsPage() {
  const {
    proxyStylesCss,
    projects,
    themeStyles,
    variantLookupError,
    hideAddToCart,
    storefrontAppNav,
    logoDataUrl,
    backgroundLogoDataUrl,
    navAccountInitial,
    scope,
    hasCompanyScope,
    viewerCompanyDisplayNames,
  } = useLoaderData<typeof loader>();
  const inlineStyles = themeStyles?.styles || [];
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const listSearchQ = (searchParams.get("q") || "").trim();
  /* Build links with only our own params. Shopify-signed proxy params (shop,
     logged_in_customer_id, path_prefix, timestamp, signature) are scoped to the
     original request — re-using them with new query strings invalidates the
     signature and Shopify returns its own 404 before reaching the app. */
  const scopeLinkQs = (targetScope: "mine" | "company") => {
    const params = new URLSearchParams();
    const q = searchParams.get("q");
    if (q) params.set("q", q);
    if (targetScope === "company") params.set("scope", "company");
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  };
  const companyScopeTitle =
    viewerCompanyDisplayNames && viewerCompanyDisplayNames.length > 0
      ? `Show projects from coworkers tagged with ${viewerCompanyDisplayNames.join(", ")}`
      : "Show projects from coworkers at the same company";
  const filteredProjects = useMemo(
    () => projects.filter((p) => projectListItemMatchesQuery(p, listSearchQ)),
    [projects, listSearchQ],
  );
  /** Nested legacy route `apps.project-clad.projects.$projectId` — parent must render `<Outlet />`. */
  const isNestedProjectDetail = /\/apps\/project-clad\/projects\/[^/?#]+/.test(
    pathname,
  );

  if (isNestedProjectDetail) {
    return <Outlet />;
  }

  return (
    <>
      {(themeStyles?.urls ?? []).map((href: string) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      {inlineStyles.map((css, index) => (
        <style key={index} dangerouslySetInnerHTML={{ __html: css }} />
      ))}
      {/* After theme inlines so Project Clad rules win over storefront base.css */}
      <style dangerouslySetInnerHTML={{ __html: proxyStylesCss }} />
      <main
        className={`project-clad-page project-clad-page--projects${backgroundLogoDataUrl ? " project-clad-page--card-bg-logo" : ""}`}
        style={
          backgroundLogoDataUrl
            ? { ["--project-clad-bg-logo" as string]: `url(${backgroundLogoDataUrl})` }
            : undefined
        }
      >
        <div className="page-width project-clad-container project-clad-container--full-width">
          <header className="project-clad-header">
            <ProjectCladStorefrontNav
              logoDataUrl={logoDataUrl}
              logoHref="/"
              links={storefrontAppNav.links}
              cartUrl={storefrontAppNav.cartUrl}
              searchUrl={storefrontAppNav.searchUrl}
              accountUrl={storefrontAppNav.accountUrl}
              accountInitial={navAccountInitial}
              inAppSearch="projects"
            />
          </header>
          {hasCompanyScope && (
            <nav
              className="project-clad-projects-scope"
              aria-label="Project visibility"
            >
              <Link
                to={`/apps/project-clad/projects${scopeLinkQs("mine")}`}
                className={`project-clad-projects-scope__link${scope === "mine" ? " is-active" : ""}`}
                aria-current={scope === "mine" ? "page" : undefined}
                data-projectclad-no-transition
              >
                My projects
              </Link>
              <Link
                to={`/apps/project-clad/projects${scopeLinkQs("company")}`}
                className={`project-clad-projects-scope__link${scope === "company" ? " is-active" : ""}`}
                aria-current={scope === "company" ? "page" : undefined}
                title={companyScopeTitle}
                data-projectclad-no-transition
              >
                Company
              </Link>
            </nav>
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
          ) : filteredProjects.length === 0 ? (
            <section className="project-clad-card">
              <p className="project-clad-muted">
                No projects match &ldquo;{listSearchQ}&rdquo;. Try different words or{" "}
                <Link to="/apps/project-clad/projects" className="project-clad-hidden-link" style={{ textDecoration: "underline" }}>
                  clear the search
                </Link>
                .
              </p>
            </section>
          ) : (
            <section className="project-clad-grid">
              {filteredProjects.map((project) => (
                <div
                  key={project.id}
                  className={`project-clad-card${project.approvalStatus.requested ? " project-clad-card--confirming" : ""}`}
                >
                  <a
                    href={`/apps/project-clad/project?id=${encodeURIComponent(project.id)}`}
                    className="project-clad-card-link"
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
                      {!project.isOwner && project.ownerLabel && (
                        <p className="project-clad-muted project-clad-projects-tile-owner">
                          {project.viaCompany ? "Shared by: " : "Owner: "}
                          {project.ownerLabel}
                        </p>
                      )}
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
                            action="/apps/project-clad/api/project-actions"
                            data-projectclad-submit-approval
                            data-project-id={project.id}
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
  window.addEventListener('pageshow', function(ev) {
    if (ev.persisted) window.location.reload();
  });
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
      var msgEl = form.querySelector('[data-projectclad-approval-message]');
      function setMsg(t) { if (msgEl) msgEl.textContent = t || ''; }
      setMsg('');
      var intent = form.getAttribute('data-intent') || 'submit-for-approval';
      var url = '/apps/project-clad/api/project-actions?intent=' + encodeURIComponent(intent) + '&projectId=' + encodeURIComponent(projectId);
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

/* Proxy CSS is inlined in-document (after theme) — do not also <link> the same file or a cached copy can override fresh rules */
export const links: LinksFunction = () => [];
