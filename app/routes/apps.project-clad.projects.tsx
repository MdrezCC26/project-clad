import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import {
  Link,
  Outlet,
  redirect,
  useLoaderData,
  useLocation,
} from "react-router";
import { useMemo, useState } from "react";
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
import { ProjectCladStorefrontFooter } from "../components/ProjectCladStorefrontFooter";
import { ProjectCladStorefrontNav } from "../components/ProjectCladStorefrontNav";
import { getStorefrontAppNav } from "../utils/storefrontAppNav";
import type {
  OrderLifecycleStatus,
  ProjectStorefrontStatus,
} from "@prisma/client";

type ProjectListItem = {
  id: string;
  isOwner: boolean;
  /** True when this row is only visible because viewer's `company:*` tag matches the owner's. */
  viaCompany: boolean;
  /** Display name for the owner when the viewer is not the owner. */
  ownerLabel: string | null;
  name: string;
  createdAt: string;
  poNumber: string | null;
  companyName: string | null;
  jobCount: number;
  /** Pending approval rows tied to orders/lines (jobId non-empty), not project-level. */
  pendingOrderApprovalCount: number;
  approvedBy: string[];
  approvalStatus: { requested: boolean; approved: boolean };
  storefrontStatus: ProjectStorefrontStatus;
  jobs: {
    id: string;
    name: string;
    createdAt: string;
    isLocked: boolean;
    orderLifecycleStatus: OrderLifecycleStatus;
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

/** YYYY.MM.DD — matches dashboard-style project tiles */
function formatProjectTileDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

function getProjectTileMetrics(project: ProjectListItem): {
  deliveredCount: number;
} {
  const deliveredCount = project.jobs.filter(
    (j) => j.orderLifecycleStatus === "delivered",
  ).length;

  return { deliveredCount };
}

function getProjectUnitCount(project: ProjectListItem): number {
  let units = 0;
  for (const j of project.jobs) {
    for (const it of j.items) {
      units += it.quantity ?? 0;
    }
  }
  return units;
}

/** Base path fragment for nested project-detail detection (`.../projects/:id`). */
const STOREFRONT_PROJECTS_LIST_MARKER = "/apps/project-clad/projects";

/** Matches nested detail URLs even with a storefront locale prefix (e.g. `/fr-ca/.../projects/foo`). */
function pathnameHasProjectsListDetailSegment(pathname: string): boolean {
  const marker = `${STOREFRONT_PROJECTS_LIST_MARKER}/`;
  const i = pathname.indexOf(marker);
  if (i === -1) return false;
  const rest = pathname.slice(i + marker.length).split(/[/#?]/)[0] ?? "";
  return rest.length > 0;
}

/** Header pill when project-level approval is pending (not storefront status). */
function getProjectTileStatusPill(project: ProjectListItem): {
  label: string;
  tone: "approval";
} | null {
  const ar = project.approvalStatus;
  if (ar?.requested && !ar?.approved) {
    return { label: "APPROVAL", tone: "approval" };
  }
  return null;
}

type ProjectsStatusFilter = "all" | "approval";
type ProjectsViewFilter = "all" | "mine" | "company";
type ProjectsSortKey = "recent" | "newest" | "oldest" | "name" | "orders";
type ProjectsListUiState = {
  q: string;
  status: ProjectsStatusFilter;
  view: ProjectsViewFilter;
  sort: ProjectsSortKey;
};

function parseStatusFilter(raw: string | null): ProjectsStatusFilter {
  const s = (raw || "").trim().toLowerCase();
  if (s === "approval") return "approval";
  return "all";
}

function parseViewFilter(raw: string | null): ProjectsViewFilter {
  const s = (raw || "").trim().toLowerCase();
  if (s === "mine" || s === "company") return s;
  return "all";
}

function parseSortKey(raw: string | null): ProjectsSortKey {
  const s = (raw || "").trim().toLowerCase();
  if (s === "newest" || s === "oldest" || s === "name" || s === "orders") {
    return s;
  }
  return "recent";
}

function projectMatchesStatusFilter(
  project: ProjectListItem,
  status: ProjectsStatusFilter,
): boolean {
  if (status === "all") return true;
  if (status === "approval") {
    const ar = project.approvalStatus;
    const projectPending = Boolean(ar?.requested && !ar?.approved);
    return projectPending || (project.pendingOrderApprovalCount ?? 0) > 0;
  }
  return true;
}

function projectMatchesViewFilter(
  project: ProjectListItem,
  view: ProjectsViewFilter,
): boolean {
  if (view === "all") return true;
  if (view === "mine") return !project.viaCompany;
  return project.viaCompany;
}

function listRankForSort(p: ProjectListItem): number {
  return p.isOwner ? 0 : p.viaCompany ? 2 : 1;
}

function sortFilteredProjects(
  list: ProjectListItem[],
  sort: ProjectsSortKey,
): ProjectListItem[] {
  const out = [...list];
  if (sort === "recent") {
    out.sort((a, b) => {
      const ra = listRankForSort(a);
      const rb = listRankForSort(b);
      if (ra !== rb) return ra - rb;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return out;
  }
  if (sort === "newest") {
    out.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return out;
  }
  if (sort === "oldest") {
    out.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    return out;
  }
  if (sort === "name") {
    out.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
    return out;
  }
  if (sort === "orders") {
    out.sort((a, b) => {
      const d = b.jobCount - a.jobCount;
      if (d !== 0) return d;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    return out;
  }
  return out;
}

function projectsListQueryString(
  base: URLSearchParams,
  updates: Record<string, string | null>,
): string {
  const next = new URLSearchParams(base);
  for (const [k, v] of Object.entries(updates)) {
    if (v === null || v === "") next.delete(k);
    else next.set(k, v);
  }
  return next.toString();
}

function projectListItemMatchesQuery(project: ProjectListItem, qRaw: string): boolean {
  const q = qRaw.trim().toLowerCase();
  if (!q) return true;
  const parts = q.split(/\s+/).filter(Boolean);
  const pill = getProjectTileStatusPill(project);
  const hay = [
    project.name,
    project.poNumber || "",
    project.companyName || "",
    String(project.jobCount),
    pill?.label || "",
    ...project.jobs.flatMap((job) => [
      job.name,
      ...job.items.map((item) => item.displayName ?? ""),
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

  /* Single list: yours (owner or member) + company-visible coworker projects when applicable. */
  const viewerCompanyCtx = viewerIsAppAdmin
    ? { tags: [], displayNames: [], keys: [] as string[] }
    : await getViewerCompanyContext(shop, customerId);

  const projects = await prisma.project.findMany({
    where: projectsListWhere(shop, customerId, viewerIsAppAdmin, {
      scope: "company",
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
  let navAccountFirstName: string | null = null;
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
    navAccountFirstName = fn || null;
    navAccountInitial = fn
      ? fn.charAt(0).toUpperCase()
      : customerEmail?.trim()
        ? customerEmail.trim().charAt(0).toUpperCase()
        : null;
  } catch {
    // If customer lookup fails, show add-to-cart (no NA restriction)
  }

  const projectIds = projects.map((p) => p.id);

  const pendingOrderApprovalRows = await prisma.approvalRequest.findMany({
    where: {
      projectId: { in: projectIds },
      approvedAt: null,
      NOT: { jobId: "" },
    },
    select: { projectId: true },
  });
  const pendingApprovalCountByProjectId = new Map<string, number>();
  for (const row of pendingOrderApprovalRows) {
    pendingApprovalCountByProjectId.set(
      row.projectId,
      (pendingApprovalCountByProjectId.get(row.projectId) ?? 0) + 1,
    );
  }

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

  /* Owner attribution for rows where the viewer is not the owner. */
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
    storefrontStatus: project.storefrontStatus,
    jobCount: project.jobs.length,
    pendingOrderApprovalCount:
      pendingApprovalCountByProjectId.get(project.id) ?? 0,
    approvedBy: approvedByNames,
    jobs: project.jobs.map((job) => ({
      id: job.id,
      name: job.name,
      createdAt: job.createdAt.toISOString(),
      isLocked: job.isLocked || Boolean(job.orderLink),
      orderLifecycleStatus: job.orderLifecycleStatus,
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

  const listRank = (p: ProjectListItem) =>
    p.isOwner ? 0 : p.viaCompany ? 2 : 1;

  payload.sort((a, b) => {
    const ra = listRank(a);
    const rb = listRank(b);
    if (ra !== rb) return ra - rb;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
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
    navAccountFirstName,
    viewerIsAppAdmin,
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
    navAccountFirstName,
    viewerIsAppAdmin,
  } = useLoaderData<typeof loader>();
  const inlineStyles = themeStyles?.styles || [];
  const { pathname } = useLocation();
  const [listUiState, setListUiState] = useState<ProjectsListUiState>({
    q: "",
    status: "all",
    view: "all",
    sort: "recent",
  });
  const listSearchQ = listUiState.q;
  const statusFilter = listUiState.status;
  const viewFilter = listUiState.view;
  const sortKey = listUiState.sort;

  const hasCompanyRows = useMemo(
    () => projects.some((p) => p.viaCompany),
    [projects],
  );
  const hasApprovalRows = useMemo(
    () =>
      projects.some(
        (p) =>
          (p.approvalStatus?.requested && !p.approvalStatus?.approved) ||
          (p.pendingOrderApprovalCount ?? 0) > 0,
      ),
    [projects],
  );

  const filteredProjects = useMemo(() => {
    let list = projects.filter((p) =>
      projectListItemMatchesQuery(p, listSearchQ),
    );
    list = list.filter((p) => projectMatchesStatusFilter(p, statusFilter));
    list = list.filter((p) => projectMatchesViewFilter(p, viewFilter));
    return sortFilteredProjects(list, sortKey);
  }, [projects, listSearchQ, statusFilter, viewFilter, sortKey]);

  const listTotals = useMemo(() => {
    let totalOrders = 0;
    let totalApprovals = 0;
    for (const p of filteredProjects) {
      totalOrders += p.jobCount;
      totalApprovals += p.pendingOrderApprovalCount ?? 0;
    }
    return {
      projectCount: filteredProjects.length,
      totalOrders,
      totalApprovals,
    };
  }, [filteredProjects]);

  const hasNonDefaultFilters =
    statusFilter !== "all" ||
    viewFilter !== "all" ||
    sortKey !== "recent";

  const updateListUiState = (updates: Record<string, string | null>) => {
    setListUiState((prev) => ({
      q: updates.q !== undefined ? (updates.q || "").trim() : prev.q,
      status:
        updates.status !== undefined
          ? parseStatusFilter(updates.status)
          : prev.status,
      view:
        updates.view !== undefined
          ? parseViewFilter(updates.view)
          : prev.view,
      sort:
        updates.sort !== undefined
          ? parseSortKey(updates.sort)
          : prev.sort,
    }));
  };
  const clearListUiParams = () =>
    setListUiState({ q: "", status: "all", view: "all", sort: "recent" });

  /** Nested legacy route `apps.project-clad.projects.$projectId` — parent must render `<Outlet />`. */
  const isNestedProjectDetail = pathnameHasProjectsListDetailSegment(pathname);

  if (isNestedProjectDetail) {
    return <Outlet />;
  }

  return (
    <>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Onest:wght@300;400;500;600;700&display=swap"
      />
      {(themeStyles?.urls ?? []).map((href: string) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      {inlineStyles.map((css, index) => (
        <style key={index} dangerouslySetInnerHTML={{ __html: css }} />
      ))}
      {/* After theme inlines so Project Clad rules win over storefront base.css */}
      <style dangerouslySetInnerHTML={{ __html: proxyStylesCss }} />
      <main
        className={`project-clad-page project-clad-page--projects project-clad-page--cc-v2 cc-store-neu${backgroundLogoDataUrl ? " project-clad-page--card-bg-logo" : ""}`}
        style={
          backgroundLogoDataUrl
            ? { ["--project-clad-bg-logo" as string]: `url(${backgroundLogoDataUrl})` }
            : undefined
        }
      >
        <header className="project-clad-header project-clad-header--fullbleed">
          <ProjectCladStorefrontNav
            logoDataUrl={logoDataUrl}
            logoHref="/"
            logoAlt="Canadian Cladding"
            links={storefrontAppNav.links}
            cartUrl={storefrontAppNav.cartUrl}
            searchUrl={storefrontAppNav.searchUrl}
            accountUrl={storefrontAppNav.accountUrl}
            accountInitial={navAccountInitial}
            accountFirstName={navAccountFirstName}
            inAppSearch="projects"
            inAppSearchQuery={listSearchQ}
            onInAppSearchQueryChange={(query) =>
              updateListUiState({ q: query || null })
            }
            htmlTemplateHeader
            htmlTemplateNavActive="projects"
            hideTrailingIcons={true}
          />
        </header>
        <div className="page-width project-clad-container project-clad-container--full-width">
          {projects.length > 0 ? (
            <>
              <div
                className="project-clad-projects-controls-grid"
                role="region"
                aria-label="Filter, sort, and search projects"
              >
                <div className="project-clad-projects-controls-grid__col project-clad-projects-controls-grid__col--left">
                  <div
                    className={`project-clad-projects-control-tile project-clad-projects-control-tile--status${hasApprovalRows ? "" : " project-clad-projects-control-tile--status-hidden"}`}
                  >
                    {hasApprovalRows ? (
                      <div className="project-clad-projects-toolbar__cluster project-clad-projects-toolbar__cluster--status">
                        <span className="project-clad-projects-toolbar__label">Filter</span>
                        <nav className="project-clad-projects-toolbar__chips" aria-label="Filter projects">
                          <button
                            type="button"
                            data-pc-status="all"
                            className={`project-clad-projects-toolbar__chip${statusFilter === "all" ? " is-active" : ""}`}
                            data-projectclad-no-transition
                          >
                            All
                          </button>
                          <button
                            type="button"
                            data-pc-status="approval"
                            className={`project-clad-projects-toolbar__chip${statusFilter === "approval" ? " is-active" : ""}`}
                            data-projectclad-no-transition
                          >
                            Approval
                          </button>
                        </nav>
                      </div>
                    ) : null}
                    {hasCompanyRows ? (
                      <div className="project-clad-projects-toolbar__row project-clad-projects-toolbar__row--view">
                        <span className="project-clad-projects-toolbar__label">View</span>
                        <nav
                          className="project-clad-projects-toolbar__chips"
                          aria-label="Filter by how you access the project"
                        >
                          <button
                            type="button"
                            data-pc-view="all"
                            className={`project-clad-projects-toolbar__chip${viewFilter === "all" ? " is-active" : ""}`}
                            data-projectclad-no-transition
                          >
                            All
                          </button>
                          <button
                            type="button"
                            data-pc-view="mine"
                            className={`project-clad-projects-toolbar__chip${viewFilter === "mine" ? " is-active" : ""}`}
                            data-projectclad-no-transition
                          >
                            Mine
                          </button>
                          <button
                            type="button"
                            data-pc-view="company"
                            className={`project-clad-projects-toolbar__chip${viewFilter === "company" ? " is-active" : ""}`}
                            title="Projects visible because of your company tag (read-only browsing)"
                            data-projectclad-no-transition
                          >
                            Company
                          </button>
                        </nav>
                      </div>
                    ) : null}
                  </div>
                  <div className="project-clad-projects-control-tile project-clad-projects-control-tile--sort">
                    <div className="project-clad-projects-toolbar__cluster project-clad-projects-toolbar__cluster--sort">
                      <span className="project-clad-projects-toolbar__label">Sort</span>
                      <nav className="project-clad-projects-toolbar__chips" aria-label="Sort project list">
                        <button
                          type="button"
                          data-pc-sort="recent"
                          className={`project-clad-projects-toolbar__chip${sortKey === "recent" ? " is-active" : ""}`}
                          data-projectclad-no-transition
                        >
                          Recent
                        </button>
                        <button
                          type="button"
                          data-pc-sort="newest"
                          className={`project-clad-projects-toolbar__chip${sortKey === "newest" ? " is-active" : ""}`}
                          data-projectclad-no-transition
                        >
                          Newest
                        </button>
                        <button
                          type="button"
                          data-pc-sort="oldest"
                          className={`project-clad-projects-toolbar__chip${sortKey === "oldest" ? " is-active" : ""}`}
                          data-projectclad-no-transition
                        >
                          Oldest
                        </button>
                        <button
                          type="button"
                          data-pc-sort="name"
                          className={`project-clad-projects-toolbar__chip${sortKey === "name" ? " is-active" : ""}`}
                          data-projectclad-no-transition
                        >
                          Name
                        </button>
                        <button
                          type="button"
                          data-pc-sort="orders"
                          className={`project-clad-projects-toolbar__chip${sortKey === "orders" ? " is-active" : ""}`}
                          data-projectclad-no-transition
                        >
                          Orders
                        </button>
                      </nav>
                    </div>
                  </div>
                </div>
                <div className="project-clad-projects-controls-grid__col project-clad-projects-controls-grid__col--right">
                  <section
                    className="project-clad-projects-control-tile project-clad-projects-control-tile--summary project-clad-projects-summary"
                    aria-label="Totals for the filtered project list"
                  >
                    <div className="project-clad-projects-summary__stat">
                      <span
                        className="project-clad-tile-dash__stat-num"
                        data-pc-summary-value="projects"
                      >
                        {listTotals.projectCount}
                      </span>
                      <span className="project-clad-tile-dash__stat-label">
                        PROJECTS
                      </span>
                    </div>
                    <div className="project-clad-projects-summary__stat">
                      <span
                        className="project-clad-tile-dash__stat-num"
                        data-pc-summary-value="orders"
                      >
                        {listTotals.totalOrders}
                      </span>
                      <span className="project-clad-tile-dash__stat-label">ORDERS</span>
                    </div>
                    <div
                      className={`project-clad-projects-summary__stat project-clad-projects-summary__stat--approvals${listTotals.totalApprovals === 0 ? " project-clad-projects-summary__stat--dim" : ""}`}
                    >
                      <span
                        className="project-clad-tile-dash__stat-num"
                        data-pc-summary-value="approvals"
                      >
                        {listTotals.totalApprovals}
                      </span>
                      <span className="project-clad-tile-dash__stat-label">
                        APPROVALS
                      </span>
                    </div>
                  </section>
                  <div className="project-clad-projects-control-tile project-clad-projects-control-tile--search">
                    <div className="project-clad-projects-toolbar__cluster project-clad-projects-toolbar__cluster--search">
                      <div className="project-clad-projects-toolbar__search-row">
                        <div className="project-clad-projects-toolbar__search-wrap">
                          <span
                            className="project-clad-projects-toolbar__search-icon"
                            aria-hidden="true"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                              <path
                                d="M20 20l-4.2-4.2"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                              />
                            </svg>
                          </span>
                          <label
                            className="project-clad-sr-only"
                            htmlFor="project-clad-projects-search"
                          >
                            Search Projects
                          </label>
                          <input
                            id="project-clad-projects-search"
                            type="search"
                            className="project-clad-projects-toolbar__search"
                            placeholder="Search Projects"
                            value={listSearchQ}
                            onChange={(e) =>
                              updateListUiState({ q: e.target.value || null })
                            }
                            autoComplete="off"
                            data-pc-search
                          />
                        </div>
                        {listSearchQ || hasNonDefaultFilters ? (
                          <button
                            type="button"
                            onClick={clearListUiParams}
                            className="project-clad-projects-toolbar__clear"
                            data-pc-reset
                            data-projectclad-no-transition
                          >
                            Reset all
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}
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
                {listSearchQ ? (
                  <>
                    No projects match &ldquo;{listSearchQ}&rdquo;
                    {hasNonDefaultFilters ? " with the current filters" : ""}.
                  </>
                ) : (
                  <>No projects match the current filters.</>
                )}{" "}
                <button
                  type="button"
                  onClick={clearListUiParams}
                  className="project-clad-hidden-link"
                  style={{ textDecoration: "underline" }}
                >
                  Reset search and filters
                </button>
                .
              </p>
            </section>
          ) : (
            <section className="project-clad-grid">
              {filteredProjects.map((project) => {
                const m = getProjectTileMetrics(project);
                const pill = getProjectTileStatusPill(project);
                const unitCount = getProjectUnitCount(project);
                const ownsTile =
                  project.isOwner || viewerIsAppAdmin;
                const ownershipCls = ownsTile
                  ? " project-clad-card--tile-ownership-owned"
                  : " project-clad-card--tile-ownership-shared";
                return (
                <div
                  key={project.id}
                  className={`project-clad-card project-clad-card--project-list-dash${ownershipCls}${
                    project.approvalStatus?.requested &&
                    !project.approvalStatus?.approved
                      ? " project-clad-card--confirming"
                      : ""
                  }`}
                  data-pc-project-card="1"
                  data-pc-owner={ownsTile ? "1" : "0"}
                  data-pc-via-company={project.viaCompany ? "1" : "0"}
                  data-pc-pending-approvals={String(project.pendingOrderApprovalCount ?? 0)}
                  data-pc-project-approval-pending={
                    project.approvalStatus?.requested &&
                    !project.approvalStatus?.approved
                      ? "1"
                      : "0"
                  }
                  data-pc-created-at={String(new Date(project.createdAt).getTime())}
                  data-pc-name={project.name.toLowerCase()}
                  data-pc-search={`${project.name} ${project.poNumber || ""} ${project.companyName || ""}`.toLowerCase()}
                  data-pc-orders={String(project.jobCount)}
                  data-pc-units={String(unitCount)}
                >
                  <a
                    href={`/apps/project-clad/project?id=${encodeURIComponent(project.id)}`}
                    className="project-clad-card-link"
                  >
                    <div className="project-clad-tile-dash">
                      <div className="project-clad-tile-dash__header">
                        <div className="project-clad-tile-dash__head-left">
                          <h2 className="project-clad-title project-clad-tile-dash__title project-clad-project-card__title">
                            {project.name}
                          </h2>
                          <div className="project-clad-tile-dash__ref project-clad-tile-dash__ref--mono">
                            {(project.poNumber ?? "").trim()
                              ? `Project #${(project.poNumber ?? "").trim()}`
                              : "—"}
                          </div>
                        </div>
                        {pill ? (
                          <span
                            className={`project-clad-tile-dash__status-pill project-clad-tile-dash__status-pill--${pill.tone}`}
                          >
                            <span
                              className="project-clad-tile-dash__status-dot"
                              aria-hidden="true"
                            />
                            {pill.label}
                          </span>
                        ) : null}
                      </div>
                      <div
                        className="project-clad-tile-dash__stat-row"
                        aria-label={`${project.pendingOrderApprovalCount ?? 0} pending approval requests across orders in this project`}
                      >
                        <div className="project-clad-tile-dash__stat">
                          <span className="project-clad-tile-dash__stat-num">
                            {project.jobCount}
                          </span>
                          <span className="project-clad-tile-dash__stat-label">
                            ORDERS
                          </span>
                        </div>
                        <div
                          className={`project-clad-tile-dash__stat${m.deliveredCount === 0 ? " project-clad-tile-dash__stat--dim" : ""}`}
                        >
                          <span className="project-clad-tile-dash__stat-num">
                            {m.deliveredCount}
                          </span>
                          <span className="project-clad-tile-dash__stat-label">
                            DELIVERED
                          </span>
                        </div>
                        <div
                          className={`project-clad-tile-dash__stat${
                            (project.pendingOrderApprovalCount ?? 0) === 0
                              ? " project-clad-tile-dash__stat--dim"
                              : " project-clad-tile-dash__stat--alert"
                          }`}
                        >
                          <span className="project-clad-tile-dash__stat-num">
                            {project.pendingOrderApprovalCount ?? 0}
                          </span>
                          <span className="project-clad-tile-dash__stat-label">
                            APPROVALS
                          </span>
                        </div>
                      </div>
                      <div
                        className="project-clad-tile-dash__meta-row"
                        role="group"
                        aria-label="Project details"
                      >
                        <div className="project-clad-tile-dash__meta-pair">
                          <span className="project-clad-tile-dash__meta-k">
                            CREATED
                          </span>
                          <span className="project-clad-tile-dash__meta-v project-clad-tile-dash__meta-v--mono">
                            {formatProjectTileDate(project.createdAt)}
                          </span>
                        </div>
                        <span
                          className="project-clad-tile-dash__meta-sep"
                          aria-hidden="true"
                        />
                        <div className="project-clad-tile-dash__meta-pair">
                          <span className="project-clad-tile-dash__meta-k">
                            COMPANY
                          </span>
                          <span className="project-clad-tile-dash__meta-v">
                            {project.companyName || "—"}
                          </span>
                        </div>
                      </div>
                      {!project.isOwner && project.ownerLabel ? (
                        <p className="project-clad-tile-dash__owner">
                          {project.viaCompany ? "Shared by: " : "Owner: "}
                          {project.ownerLabel}
                        </p>
                      ) : null}
                    </div>
                  </a>
                  {hideAddToCart && (() => {
                    const status = project.approvalStatus ?? {
                      requested: false,
                      approved: false,
                    };
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
                );
              })}
            </section>
          )}
        </div>
        <ProjectCladStorefrontFooter
          logoDataUrl={logoDataUrl}
          logoAlt="Canadian Cladding"
          logoHref="/"
        />
      </main>
      <script
        dangerouslySetInnerHTML={{ __html: PROJECT_CLAD_CURSOR_GLOW_SCRIPT }}
      />
      <script
        dangerouslySetInnerHTML={{
          __html: `
(function() {
  var APP_PROXY_KEYS = {
    signature: true,
    shop: true,
    path_prefix: true,
    timestamp: true,
    logged_in_customer_id: true,
    logged_in_customer_email: true
  };
  var main = document.querySelector('.project-clad-page');
  if (main) {
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        main.classList.add('project-clad-enter-done');
      });
    });
  }
  /* Only animate tile click-throughs. Query-only controls (filter/sort/search links) must remain SPA
     navigations; forcing full reload in app-proxy context can break URL signatures and appear as 404/no-op. */
  document.addEventListener('click', function(e) {
    var target = e.target;
    if (target && target.nodeType === Node.TEXT_NODE) target = target.parentElement;
    if (!(target instanceof Element)) return;
    var a = target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('data-projectclad-no-transition')) return;
    if (!a.classList.contains('project-clad-card-link')) return;
    var href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    try {
      var url = new URL(href, location.origin);
      if (url.origin !== location.origin) return;
    } catch (err) { return; }
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.add('project-clad-leaving');
    setTimeout(function() {
      try {
        var nextUrl = new URL(href, location.origin);
        var currentParams = new URLSearchParams(location.search);
        currentParams.forEach(function(value, key) {
          if (APP_PROXY_KEYS[key] && !nextUrl.searchParams.has(key)) {
            nextUrl.searchParams.set(key, value);
          }
        });
        window.location.href = nextUrl.pathname + nextUrl.search + nextUrl.hash;
      } catch (err) {
        window.location.href = href;
      }
    }, 180);
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
  var root = document.querySelector('.project-clad-page--projects');
  var controlsRoot = root && root.querySelector('.project-clad-projects-controls-grid');
  var grid = root && root.querySelector('.project-clad-grid');
  if (controlsRoot && grid) {
    var searchInput = controlsRoot.querySelector('[data-pc-search]');
    var summary = root && root.querySelector('.project-clad-projects-summary');
    var ui = {
      status: 'all',
      view: 'all',
      sort: 'recent',
      q:
        searchInput && 'value' in searchInput
          ? String(searchInput.value || '').trim().toLowerCase()
          : ''
    };
    function getCards() {
      return Array.prototype.slice.call(grid.querySelectorAll('[data-pc-project-card="1"]'));
    }
    function setActive(groupAttr, value) {
      controlsRoot.querySelectorAll('[' + groupAttr + ']').forEach(function(btn) {
        if (!(btn instanceof Element)) return;
        if (btn.getAttribute(groupAttr) === value) btn.classList.add('is-active');
        else btn.classList.remove('is-active');
      });
    }
    function matches(card) {
      var viaCompany = card.getAttribute('data-pc-via-company') === '1';
      var isOwner = card.getAttribute('data-pc-owner') === '1';
      var pending = Number(card.getAttribute('data-pc-pending-approvals') || '0');
      var projApproval = card.getAttribute('data-pc-project-approval-pending') === '1';
      var searchHay = (card.getAttribute('data-pc-search') || '').toLowerCase();
      if (ui.status === 'approval' && !projApproval && pending <= 0) return false;
      if (ui.view === 'mine' && !isOwner) return false;
      if (ui.view === 'company' && !viaCompany) return false;
      if (ui.q && searchHay.indexOf(ui.q) === -1) return false;
      return true;
    }
    function comparator(a, b) {
      var aCreated = Number(a.getAttribute('data-pc-created-at') || '0');
      var bCreated = Number(b.getAttribute('data-pc-created-at') || '0');
      if (ui.sort === 'newest') return bCreated - aCreated;
      if (ui.sort === 'oldest') return aCreated - bCreated;
      if (ui.sort === 'name') {
        var an = a.getAttribute('data-pc-name') || '';
        var bn = b.getAttribute('data-pc-name') || '';
        return an.localeCompare(bn);
      }
      if (ui.sort === 'orders') {
        var ao = Number(a.getAttribute('data-pc-orders') || '0');
        var bo = Number(b.getAttribute('data-pc-orders') || '0');
        if (bo !== ao) return bo - ao;
        return bCreated - aCreated;
      }
      var aOwner = a.getAttribute('data-pc-owner') === '1' ? 0 : 1;
      var bOwner = b.getAttribute('data-pc-owner') === '1' ? 0 : 1;
      if (aOwner !== bOwner) return aOwner - bOwner;
      return bCreated - aCreated;
    }
    function writeSummary() {
      if (!summary) return;
      var cards = getCards();
      var pv = 0;
      var ov = 0;
      var av = 0;
      cards.forEach(function(card) {
        if (!matches(card)) return;
        pv += 1;
        ov += Number(card.getAttribute('data-pc-orders') || '0');
        av += Number(card.getAttribute('data-pc-pending-approvals') || '0');
      });
      function setVal(key, n) {
        var el = summary.querySelector('[data-pc-summary-value="' + key + '"]');
        if (el) el.textContent = String(n);
      }
      setVal('projects', pv);
      setVal('orders', ov);
      setVal('approvals', av);
      var apprEl = summary.querySelector('.project-clad-projects-summary__stat--approvals');
      if (apprEl) {
        if (av === 0) apprEl.classList.add('project-clad-projects-summary__stat--dim');
        else apprEl.classList.remove('project-clad-projects-summary__stat--dim');
      }
    }
    function apply() {
      var cards = getCards();
      var ordered = cards.slice().sort(comparator);
      ordered.forEach(function(card) {
        card.style.display = matches(card) ? '' : 'none';
        grid.appendChild(card);
      });
      setActive('data-pc-status', ui.status);
      setActive('data-pc-view', ui.view);
      setActive('data-pc-sort', ui.sort);
      writeSummary();
    }
    controlsRoot.addEventListener('click', function(ev) {
      var target = ev.target;
      if (target && target.nodeType === Node.TEXT_NODE) target = target.parentElement;
      if (!(target instanceof Element)) return;
      var statusBtn = target.closest('[data-pc-status]');
      if (statusBtn) {
        ev.preventDefault();
        ui.status = statusBtn.getAttribute('data-pc-status') || 'all';
        apply();
        return;
      }
      var viewBtn = target.closest('[data-pc-view]');
      if (viewBtn) {
        ev.preventDefault();
        ui.view = viewBtn.getAttribute('data-pc-view') || 'all';
        apply();
        return;
      }
      var sortBtn = target.closest('[data-pc-sort]');
      if (sortBtn) {
        ev.preventDefault();
        ui.sort = sortBtn.getAttribute('data-pc-sort') || 'recent';
        apply();
        return;
      }
      var resetBtn = target.closest('[data-pc-reset]');
      if (resetBtn) {
        ev.preventDefault();
        ui.status = 'all';
        ui.view = 'all';
        ui.sort = 'recent';
        ui.q = '';
        if (searchInput && 'value' in searchInput) searchInput.value = '';
        apply();
      }
    }, true);
    if (searchInput) {
      searchInput.addEventListener('input', function() {
        ui.q = String(searchInput.value || '').trim().toLowerCase();
        apply();
      });
    }
    apply();
  }

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
