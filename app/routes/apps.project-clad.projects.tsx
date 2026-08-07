import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import {
  Link,
  Outlet,
  redirect,
  useLoaderData,
  useLocation,
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
import { projectCladProxyStylesHref } from "../utils/projectCladProxyStyles.server";
import { projectCladScriptSrc } from "../utils/projectCladProxyScripts.server";
import { buildShopBrandingUrls } from "../utils/shopBrandingAssets.server";
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
import { STOREFRONT_ORDER_CONFIRMED_ACTIVITY } from "../utils/projectActivity.shared";
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
  /**
   * Most recent time an order on this project was submitted / set to ordered
   * (ISO), or null if none yet. Used by the Recent sort.
   */
  lastOrderedAt: string | null;
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

function lastOrderedMs(p: ProjectListItem): number {
  if (!p.lastOrderedAt) return 0;
  const t = new Date(p.lastOrderedAt).getTime();
  return Number.isFinite(t) ? t : 0;
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
      const oa = lastOrderedMs(a);
      const ob = lastOrderedMs(b);
      if (oa !== ob) return ob - oa;
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
  const proxyStylesHref = projectCladProxyStylesHref(request);
  const proxyScriptSrcs = {
    pageNav: projectCladScriptSrc(request, "projects-page-nav.js"),
    filters: projectCladScriptSrc(request, "projects-filters.js"),
    dirtyGuard: projectCladScriptSrc(request, "pc-dirty-guard.js"),
  };
  const { shop, customerId, customerEmail } = requireAppProxyCustomer(request);
  const [themeStyles, settings] = await Promise.all([
    getThemeStyles(shop),
    prisma.shopSettings.findFirst({
      where: { shop: shopStringFilter(shop) },
    }),
  ]);
  const viewerIsAppAdmin = await viewerHasAdminTag(
    shop,
    customerId,
    customerEmail,
    settings,
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
          catalogProductId: item.catalogProductId,
          catalogSku: item.catalogSku,
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

  const orderActivityRows =
    projectIds.length > 0
      ? await prisma.projectActivityEvent.findMany({
          where: {
            projectId: { in: projectIds },
            type: {
              in: [STOREFRONT_ORDER_CONFIRMED_ACTIVITY, "order_lifecycle_status"],
            },
          },
          select: {
            projectId: true,
            createdAt: true,
            type: true,
            payload: true,
          },
        })
      : [];

  const lastOrderedAtByProjectId = new Map<string, Date>();
  for (const row of orderActivityRows) {
    if (row.type === "order_lifecycle_status") {
      const payload =
        row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
          ? (row.payload as Record<string, unknown>)
          : null;
      if (String(payload?.to || "").trim() !== "ordered") continue;
    }
    const prev = lastOrderedAtByProjectId.get(row.projectId);
    if (!prev || row.createdAt > prev) {
      lastOrderedAtByProjectId.set(row.projectId, row.createdAt);
    }
  }

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
    lastOrderedAt:
      lastOrderedAtByProjectId.get(project.id)?.toISOString() ?? null,
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
    const oa = lastOrderedMs(a);
    const ob = lastOrderedMs(b);
    if (oa !== ob) return ob - oa;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const storefrontAppNav = getStorefrontAppNav(settings);
  const branding = buildShopBrandingUrls({ request, shop, settings });

  return {
    proxyStylesHref,
    proxyScriptSrcs,
    projects: payload,
    themeStyles,
    shop,
    variantLookupError,
    hideAddToCart,
    storefrontAppNav,
    logoUrl: branding.logoUrl,
    backgroundLogoUrl: branding.backgroundLogoUrl,
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
    proxyStylesHref,
    proxyScriptSrcs,
    projects,
    themeStyles,
    variantLookupError,
    hideAddToCart,
    storefrontAppNav,
    logoUrl,
    backgroundLogoUrl,
    navAccountInitial,
    navAccountFirstName,
    viewerIsAppAdmin,
  } = useLoaderData<typeof loader>();
  const inlineStyles = themeStyles?.styles || [];
  const { pathname } = useLocation();
  /*
   * Search, filtering and sorting for this list are owned by the vanilla controls script
   * at the bottom of this route: it shows, hides and reorders the rendered cards in place
   * and rewrites the summary counts. These are the values the server renders with, and the
   * same defaults that script initialises itself from, so the two always agree.
   *
   * Deliberately constants rather than state. As state, a keystroke would re-render the
   * card list out from under the script that had just finished mutating those same nodes.
   */
  const listUiState: ProjectsListUiState = {
    q: "",
    status: "all",
    view: "all",
    sort: "recent",
  };
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
      <link rel="stylesheet" href={proxyStylesHref} />
      <main
        className={`project-clad-page project-clad-page--projects project-clad-page--cc-v2 cc-store-neu${backgroundLogoUrl ? " project-clad-page--card-bg-logo" : ""}`}
        style={
          backgroundLogoUrl
            ? { ["--project-clad-bg-logo" as string]: `url("${backgroundLogoUrl}")` }
            : undefined
        }
      >
        <header className="project-clad-header project-clad-header--fullbleed">
          <ProjectCladStorefrontNav
            logoSrc={logoUrl}
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
            htmlTemplateHeader
            htmlTemplateNavActive="projects"
            hideTrailingIcons={true}
          />
        </header>
        <div className="page-width project-clad-container project-clad-container--full-width">
          {/* No visible page title by design — the nav bar and the control tiles carry
              the context. The heading still has to exist, or the project card <h2>s start
              the document outline at level 2 with nothing above them. */}
          <h1 className="project-clad-sr-only">Projects</h1>
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
                            /* Uncontrolled: the controls script reads this input on
                               every keystroke and filters the cards itself. */
                            defaultValue={listSearchQ}
                            autoComplete="off"
                            data-pc-search
                            /* Filtering the list in place is not work to lose — this must
                               never arm the unsaved-changes guard. */
                            data-pc-no-dirty
                          />
                        </div>
                        {/* Always in the DOM so the controls script can reveal it once a
                            filter is active. Gated on React state it never rendered at
                            all, which left the reset handler unreachable and no way to
                            clear a filter short of reloading. Inline display beats the
                            class rule; the script clears it to show the button. */}
                        <button
                          type="button"
                          className="project-clad-projects-toolbar__clear"
                          data-pc-reset
                          data-projectclad-no-transition
                          style={
                            listSearchQ || hasNonDefaultFilters
                              ? undefined
                              : { display: "none" }
                          }
                        >
                          Reset all
                        </button>
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
                  className="project-clad-hidden-link"
                  style={{ textDecoration: "underline" }}
                  data-pc-reset
                  data-projectclad-no-transition
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
                  data-pc-last-ordered-at={String(
                    project.lastOrderedAt
                      ? new Date(project.lastOrderedAt).getTime()
                      : 0,
                  )}
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
          logoSrc={logoUrl}
          logoAlt="Canadian Cladding"
          logoHref="/"
        />
      </main>
      <script
        dangerouslySetInnerHTML={{ __html: PROJECT_CLAD_CURSOR_GLOW_SCRIPT }}
      />
      <script src={proxyScriptSrcs.pageNav} />
      <script src={proxyScriptSrcs.filters} />
      {/*
        Unsaved-work guard — same script as the project detail page. Little on this page is
        typed into, but it supplies `pcReload`/`pcConfirmLeave` to the two scripts above so
        the card-link navigation and the post-approval reload behave the same everywhere.
        Loaded last so its submit listener runs after the per-form ajax handlers.
      */}
      <script src={proxyScriptSrcs.dirtyGuard} />
    </>
  );
}

/* Proxy CSS is inlined in-document (after theme) — do not also <link> the same file or a cached copy can override fresh rules */
export const links: LinksFunction = () => [];
