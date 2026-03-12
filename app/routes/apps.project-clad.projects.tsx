import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import { getCustomersByIds } from "../utils/adminCustomers.server";
import { getCsvForProjectIds } from "../utils/exportProjectsCsv.server";
import { isEmailConfigured, sendEmail } from "../utils/email.server";
import { getVariantInfo } from "../utils/storefront.server";
import { getAdminVariantInfo } from "../utils/adminVariants.server";
import { getThemeStyles } from "../utils/themeAssets.server";
import proxyStylesUrl from "../styles/project-clad-proxy.css?url";
import proxyStylesText from "../styles/project-clad-proxy.css?raw";

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
  const { shop, customerId } = requireAppProxyCustomer(request);
  const themeStyles = await getThemeStyles(shop);
  const settings = await prisma.shopSettings.findUnique({
    where: { shop },
  });

  const projects = await prisma.project.findMany({
    where: {
      shop,
      OR: [
        { ownerCustomerId: customerId },
        { members: { some: { customerId } } },
      ],
    },
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
  let variantInfo: Record<
    string,
    { title: string; productTitle: string; imageUrl?: string | null; imageAlt?: string | null; productHandle?: string | null }
  > = {};
  let variantLookupError: string | null = null;
  try {
    // Prefer Storefront API; fall back to Admin API if needed.
    variantInfo = await getVariantInfo(shop, variantIds);
    if (Object.keys(variantInfo).length === 0) {
      variantInfo = await getAdminVariantInfo(shop, variantIds);
    }
  } catch (error) {
    try {
      variantInfo = await getAdminVariantInfo(shop, variantIds);
    } catch (error2) {
      variantLookupError =
        error2 instanceof Error ? error2.message : "Product lookup failed.";
    }
  }

  let hideAddToCart = false;
  try {
    const numericId = String(customerId).includes("/")
      ? String(customerId).split("/").pop() || customerId
      : customerId;
    const customerInfo = await getCustomersByIds(shop, [numericId]);
    const viewerTags =
      customerInfo[numericId]?.tags ?? customerInfo[customerId]?.tags ?? [];
    hideAddToCart = viewerTags.some(
      (t) => String(t).trim().toUpperCase() === "NA",
    );
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
      ? await getCustomersByIds(shop, approverCustomerIds).catch(() => ({}))
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
        const info = variantInfo[item.variantId];
        const displayName = info
          ? `${info.productTitle} — ${info.title}`
          : `Variant ${item.variantId}`;

        const productUrl = info?.productHandle
          ? `https://${shop}/products/${info.productHandle}?variant=${item.variantId}`
          : null;

        return {
          id: item.id,
          variantId: item.variantId,
          quantity: item.quantity,
          displayName,
          imageUrl: info?.imageUrl || null,
          imageAlt: info?.imageAlt || null,
          productUrl,
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
    projects: payload,
    themeStyles,
    shop,
    variantLookupError,
    hideAddToCart,
    storefrontTheme: settings?.storefrontTheme || "default",
    navButtons,
    logoDataUrl: settings?.logoDataUrl || null,
    backgroundLogoDataUrl: settings?.backgroundLogoDataUrl || null,
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

  const project = await prisma.project.findFirst({
    where: { id: projectId, shop },
    include: { members: true },
  });

  if (!project) {
    return new Response("Project not found", { status: 404 });
  }

  const memberRole = project.members.find(
    (member) => member.customerId === customerId,
  )?.role;
  const isOwner = project.ownerCustomerId === customerId;
  const canEdit = isOwner || memberRole === "edit";

  let canAdminMembers = isOwner;
  try {
    const customerInfo = await getCustomersByIds(shop, [customerId]);
    const viewerTags = customerInfo[customerId]?.tags ?? [];
    const hasNATag = viewerTags.some(
      (t) => String(t).trim().toUpperCase() === "NA",
    );
    canAdminMembers = isOwner || (canEdit && !hasNATag);
  } catch {
    // If customer lookup fails, fall back to owner-only admin.
    canAdminMembers = isOwner;
  }

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
    projects,
    themeStyles,
    shop,
    variantLookupError,
    hideAddToCart,
    storefrontTheme,
    navButtons,
    logoDataUrl,
    backgroundLogoDataUrl,
  } = useLoaderData<typeof loader>();
  const inlineStyles = themeStyles?.styles || [];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: proxyStylesText }} />
      {inlineStyles.map((css, index) => (
        <style key={index} dangerouslySetInnerHTML={{ __html: css }} />
      ))}
      <main
        className={`project-clad-page project-clad-page--projects${backgroundLogoDataUrl ? " project-clad-page--card-bg-logo" : ""}`}
        data-theme={storefrontTheme || "default"}
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
                    <div className="project-clad-summary-row">
                      <div>
                        <h2 className="project-clad-title">{project.name}</h2>
                        <p className="project-clad-muted">
                          Created {new Date(project.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <dl className="project-clad-meta">
                      <div>
                        <dt>Orders</dt>
                        <dd>{project.jobCount}</dd>
                      </div>
                      <div className="project-clad-meta__company">
                        <dt>Company name</dt>
                        <dd>{project.companyName || "—"}</dd>
                      </div>
                      <div>
                        <dt>PO number</dt>
                        <dd>{project.poNumber || "—"}</dd>
                      </div>
                    </dl>
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

export const links: LinksFunction = (args) => {
  const hrefs = args?.data?.themeStyles?.urls || [];
  return [
    ...hrefs.map((href) => ({ rel: "stylesheet", href })),
    { rel: "stylesheet", href: proxyStylesUrl },
  ];
};
