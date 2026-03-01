import crypto from "node:crypto";
import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import {
  Form,
  Link,
  useSearchParams,
  useActionData,
  useLoaderData,
} from "react-router";
import { redirect } from "react-router";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import { getCustomersByIds } from "../utils/adminCustomers.server";
import { verifyPassword } from "../utils/passwords.server";
import { getThemeStyles } from "../utils/themeAssets.server";
import proxyStylesUrl from "../styles/project-clad-proxy.css?url";
import proxyStylesText from "../styles/project-clad-proxy.css?raw";

type JobItemView = {
  id: string;
  variantId: string;
  quantity: number;
  priceSnapshot: string;
};

type JobView = {
  id: string;
  name: string;
  createdAt: string;
  isLocked: boolean;
  items: JobItemView[];
};

type ProjectView = {
  id: string;
  name: string;
  poNumber: string | null;
  companyName: string | null;
  createdAt: string;
  jobs: JobView[];
};

const PRICING_COOKIE = "projectclad_pricing=1";

const hasPricingAccess = (request: Request) => {
  const cookie = request.headers.get("Cookie") || "";
  return cookie.split(";").some((value) => value.trim().startsWith(PRICING_COOKIE));
};

const createPricingCookie = () =>
  `${PRICING_COOKIE}; Path=/; Max-Age=3600; SameSite=Lax`;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop, customerId } = requireAppProxyCustomer(request);
  const themeStyles = await getThemeStyles(shop);
  const settings = await prisma.shopSettings.findUnique({
    where: { shop },
  });
  const projectId = params.projectId || "";

  const project = await prisma.project.findFirst({
    where: { id: projectId, shop },
    include: {
      jobs: {
        orderBy: { sortOrder: "asc" },
        include: { items: { orderBy: { sortOrder: "asc" } }, orderLink: true },
      },
      members: true,
    },
  });

  if (!project) {
    throw new Response("Project not found", { status: 404 });
  }

  const isMember =
    project.ownerCustomerId === customerId ||
    project.members.some((member) => member.customerId === customerId);

  if (!isMember) {
    throw new Response("Unauthorized", { status: 403 });
  }

  const memberRole = project.members.find(
    (member) => member.customerId === customerId,
  )?.role;
  const canEdit = project.ownerCustomerId === customerId || memberRole === "edit";

  const otherProjects = await prisma.project.findMany({
    where: {
      shop,
      id: { not: projectId },
      OR: [
        { ownerCustomerId: customerId },
        { members: { some: { customerId } } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  let hideAddToCart = false;
  try {
    const customerInfo = await getCustomersByIds(shop, [customerId]);
    const viewerTags = customerInfo[customerId]?.tags ?? [];
    hideAddToCart = viewerTags.some(
      (t) => String(t).trim().toUpperCase() === "NA",
    );
  } catch {
    // If customer lookup fails, show add-to-cart (no NA restriction)
  }

  const payload: ProjectView = {
    id: project.id,
    name: project.name,
    poNumber: project.poNumber,
    companyName: project.companyName,
    createdAt: project.createdAt.toISOString(),
    jobs: project.jobs.map((job) => ({
      id: job.id,
      name: job.name,
      createdAt: job.createdAt.toISOString(),
      isLocked: job.isLocked || Boolean(job.orderLink),
      items: job.items.map((item) => ({
        id: item.id,
        variantId: item.variantId,
        quantity: item.quantity,
        priceSnapshot: item.priceSnapshot.toString(),
      })),
    })),
  };

  return {
    project: payload,
    shop,
    otherProjects: otherProjects.map((other) => ({
      id: other.id,
      name: other.name,
    })),
    canViewPricing: !hideAddToCart || hasPricingAccess(request),
    canEdit,
    themeStyles,
    storefrontTheme: settings?.storefrontTheme || "default",
    logoDataUrl: settings?.logoDataUrl || null,
    navButtons: [
      {
        label: settings?.navButton1Label || "Projects",
        url: settings?.navButton1Url || "/apps/project-clad/projects",
      },
      {
        label: settings?.navButton2Label || "Store",
        url: settings?.navButton2Url || "/",
      },
      {
        label: settings?.navButton3Label || "Cart",
        url: settings?.navButton3Url || "/cart",
      },
    ],
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const contentType = request.headers.get("Content-Type") || "";
  const isJsonRequest = contentType.includes("application/json");
  const { shop, customerId } = requireAppProxyCustomer(request, {
    jsonOnFail: isJsonRequest,
  });
  const projectId = params.projectId || "";

  if (contentType.includes("application/json")) {
    const payload = (await request.json()) as {
      intent?: string;
      jobId?: string;
      jobIds?: string[];
      itemIds?: string[];
    };

    if (payload.intent === "reorder-jobs") {
      const jobIds = payload.jobIds || [];

      const project = await prisma.project.findFirst({
        where: { id: projectId, shop },
        include: { members: true },
      });

      if (!project) {
        throw new Response("Project not found", { status: 404 });
      }

      const memberRole = project.members.find(
        (member) => member.customerId === customerId,
      )?.role;
      const canEdit =
        project.ownerCustomerId === customerId || memberRole === "edit";

      if (!canEdit) {
        throw new Response("Forbidden", { status: 403 });
      }

      if (jobIds.length) {
        const jobs = await prisma.job.findMany({
          where: { id: { in: jobIds }, projectId },
          select: { id: true },
        });

        if (jobs.length !== jobIds.length) {
          throw new Response("Invalid order list", { status: 400 });
        }

        await prisma.$transaction(
          jobIds.map((jobId, index) =>
            prisma.job.update({
              where: { id: jobId },
              data: { sortOrder: index + 1 },
            }),
          ),
        );
      }

      return new Response(null, { status: 204 });
    }

    if (payload.intent === "reorder-items") {
      const jobId = payload.jobId || "";
      const itemIds = payload.itemIds || [];

      const project = await prisma.project.findFirst({
        where: { id: projectId, shop },
        include: { members: true },
      });

      if (!project) {
        throw new Response("Project not found", { status: 404 });
      }

      const memberRole = project.members.find(
        (member) => member.customerId === customerId,
      )?.role;
      const canEdit =
        project.ownerCustomerId === customerId || memberRole === "edit";

      if (!canEdit) {
        throw new Response("Forbidden", { status: 403 });
      }

      if (jobId && itemIds.length) {
        await prisma.$transaction(
          itemIds.map((itemId, index) =>
            prisma.jobItem.update({
              where: { id: itemId },
              data: { sortOrder: index + 1 },
            }),
          ),
        );
      }

      return new Response(null, { status: 204 });
    }

  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  const project = await prisma.project.findFirst({
    where: { id: projectId, shop },
    include: { members: true },
  });

  if (!project) {
    throw new Response("Project not found", { status: 404 });
  }

  const isMember =
    project.ownerCustomerId === customerId ||
    project.members.some((member) => member.customerId === customerId);

  if (!isMember) {
    throw new Response("Unauthorized", { status: 403 });
  }

  const memberRole = project.members.find(
    (member) => member.customerId === customerId,
  )?.role;
  const canEdit = project.ownerCustomerId === customerId || memberRole === "edit";

  if (intent === "create-job") {
    if (!canEdit) {
      throw new Response("Forbidden", { status: 403 });
    }

    const name = String(formData.get("jobName") || "").trim();
    if (!name) {
      return redirect(request.url);
    }

    const maxOrder = await prisma.job.aggregate({
      where: { projectId },
      _max: { sortOrder: true },
    });
    const nextSortOrder = (maxOrder._max.sortOrder ?? 0) + 1;

    await prisma.job.create({
      data: {
        projectId,
        name,
        sortOrder: nextSortOrder,
      },
    });

    return redirect(request.url);
  }

  if (intent === "delete-job") {
    if (!canEdit) {
      throw new Response("Forbidden", { status: 403 });
    }

    const jobId = String(formData.get("jobId") || "");
    if (!jobId) {
      return redirect(request.url);
    }

    const job = await prisma.job.findFirst({
      where: { id: jobId, projectId },
      include: { orderLink: true },
    });

    if (!job) {
      throw new Response("Order not found", { status: 404 });
    }

    const isLocked = job.isLocked || Boolean(job.orderLink);
    if (isLocked) {
      throw new Response("Order is locked", { status: 403 });
    }

    await prisma.job.delete({ where: { id: jobId } });

    return redirect(request.url);
  }

  if (intent === "move-job") {
    if (!canEdit) {
      throw new Response("Forbidden", { status: 403 });
    }

    const jobId = String(formData.get("jobId") || "");
    const targetProjectId = String(formData.get("targetProjectId") || "");

    if (jobId && targetProjectId) {
      const job = await prisma.job.findFirst({
        where: { id: jobId, projectId },
      });

      if (job) {
        await prisma.job.update({
          where: { id: jobId },
          data: { projectId: targetProjectId },
        });
      }
    }

    return redirect(request.url);
  }

  if (intent === "copy-job") {
    if (!canEdit) {
      throw new Response("Forbidden", { status: 403 });
    }

    const jobId = String(formData.get("jobId") || "");
    const targetProjectId = String(formData.get("targetProjectId") || "");

    if (jobId && targetProjectId) {
      const job = await prisma.job.findFirst({
        where: { id: jobId, projectId },
        include: { items: true },
      });

      if (job) {
        await prisma.job.create({
          data: {
            projectId: targetProjectId,
            name: `${job.name} (Copy)`,
            isLocked: false,
            items: {
              create: job.items.map((item) => ({
                variantId: item.variantId,
                quantity: item.quantity,
                priceSnapshot: item.priceSnapshot,
              })),
            },
          },
        });
      }
    }

    return redirect(request.url);
  }

  if (intent === "delete-item") {
    if (!canEdit) {
      throw new Response("Forbidden", { status: 403 });
    }

    const itemId = String(formData.get("itemId") || "");

    if (itemId) {
      const item = await prisma.jobItem.findFirst({
        where: { id: itemId },
        include: { job: { include: { orderLink: true } } },
      });

      if (!item || item.job.projectId !== projectId) {
        throw new Response("Item not found", { status: 404 });
      }

      const isLocked = item.job.isLocked || Boolean(item.job.orderLink);
      if (isLocked) {
        throw new Response("Order is locked", { status: 403 });
      }

      await prisma.jobItem.delete({
        where: { id: itemId },
      });
      await prisma.approvalRequest.deleteMany({
        where: {
          projectId,
          jobId: item.jobId,
          itemId: "",
        },
      });
    }

    return redirect(request.url);
  }


  if (intent === "share-project") {
    if (!canEdit) {
      throw new Response("Forbidden", { status: 403 });
    }

    const role = String(formData.get("role") || "view");
    const token = crypto.randomBytes(16).toString("hex");

    await prisma.projectShareToken.create({
      data: {
        projectId,
        token,
        role: role === "edit" ? "edit" : "view",
      },
    });

    return { shareLink: `/apps/project-clad/share/${token}` };
  }

  if (intent === "unlock-pricing") {
    const password = String(formData.get("password") || "").trim();
    const settings = await prisma.shopSettings.findUnique({
      where: { shop },
    });

    if (!settings?.pricingPasswordHash || !settings.pricingPasswordSalt) {
      return redirect(request.url);
    }

    if (
      password &&
      verifyPassword(
        password,
        settings.pricingPasswordSalt,
        settings.pricingPasswordHash,
      )
    ) {
      return redirect(request.url, {
        headers: { "Set-Cookie": createPricingCookie() },
      });
    }

    return new Response("Invalid password", { status: 400 });
  }

  return new Response("Unsupported action", { status: 400 });
};

const buildCartLink = (items: JobItemView[]) => {
  if (items.length === 0) {
    return "/cart";
  }

  const lineItems = items
    .map((item) => `${encodeURIComponent(item.variantId)}:${item.quantity}`)
    .join(",");

  return `/cart/${lineItems}`;
};

export default function ProjectDetailPage() {
  const { project, shop, otherProjects, canViewPricing, canEdit } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const shareLink =
    actionData &&
    typeof actionData === "object" &&
    "shareLink" in actionData
      ? (actionData.shareLink as string)
      : null;

  useEffect(() => {
    if (!shareLink) return;
    const fullUrl = `https://${shop}${shareLink}`;
    const copy = async () => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(fullUrl);
        }
      } catch {}
    };
    copy();
  }, [shareLink, shop]);

  const [searchParams] = useSearchParams();
  const selectedJobId = searchParams.get("job");
  const [jobs, setJobs] = useState(project.jobs);
  const dragItemId = useRef<string | null>(null);
  const dragJobId = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedJobId) return;
    const target = document.getElementById(`job-${selectedJobId}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedJobId]);

  useEffect(() => {
    setJobs(project.jobs);
  }, [project.jobs]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const showPriceBtn = (event.target as HTMLElement)?.closest?.(
        "[data-projectclad-show-price]",
      );
      if (showPriceBtn instanceof HTMLElement) {
        event.preventDefault();
        const modal = document.querySelector(
          "[data-projectclad-pricing-modal-backdrop]",
        );
        if (modal instanceof HTMLElement) {
          modal.style.display = "flex";
          const pw = modal.querySelector<HTMLInputElement>('input[name="password"]');
          if (pw) {
            pw.value = "";
            setTimeout(() => pw.focus(), 50);
          }
        }
      }
      const cancel = (event.target as HTMLElement)?.closest?.(
        "[data-projectclad-pricing-modal-cancel]",
      );
      const backdrop = (event.target as HTMLElement)?.closest?.(
        "[data-projectclad-pricing-modal-backdrop]",
      );
      if (cancel || event.target === backdrop) {
        const m = document.querySelector(
          "[data-projectclad-pricing-modal-backdrop]",
        );
        if (m instanceof HTMLElement) m.style.display = "none";
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  const reorderItems = async (jobId: string, overItemId: string) => {
    if (!canEdit || !dragItemId.current || dragItemId.current === overItemId) {
      dragItemId.current = null;
      return;
    }

    let reordered: string[] | null = null;

    setJobs((current) =>
      current.map((job) => {
        if (job.id !== jobId) return job;
        const items = [...job.items];
        const fromIndex = items.findIndex(
          (item) => item.id === dragItemId.current,
        );
        const toIndex = items.findIndex((item) => item.id === overItemId);
        if (fromIndex === -1 || toIndex === -1) return job;
        const [moved] = items.splice(fromIndex, 1);
        items.splice(toIndex, 0, moved);
        reordered = items.map((item) => item.id);
        return { ...job, items };
      }),
    );

    if (!reordered) {
      dragItemId.current = null;
      return;
    }
    const res = await fetch(`/apps/project-clad/projects/${project.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "reorder-items",
        jobId,
        itemIds: reordered,
      }),
      credentials: "include",
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok && payload?.redirectTo) {
      window.location.href = payload.redirectTo;
      return;
    }

    dragItemId.current = null;
  };

  const reorderJobs = async (overJobId: string) => {
    if (!canEdit || !dragJobId.current || dragJobId.current === overJobId) {
      dragJobId.current = null;
      return;
    }

    let reordered: string[] | null = null;

    setJobs((current) => {
      const next = [...current];
      const fromIndex = next.findIndex((job) => job.id === dragJobId.current);
      const toIndex = next.findIndex((job) => job.id === overJobId);
      if (fromIndex === -1 || toIndex === -1) return current;
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      reordered = next.map((job) => job.id);
      return next;
    });

    if (!reordered) {
      dragJobId.current = null;
      return;
    }

    const res = await fetch(`/apps/project-clad/projects/${project.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "reorder-jobs",
        jobIds: reordered,
      }),
      credentials: "include",
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok && payload?.redirectTo) {
      window.location.href = payload.redirectTo;
      return;
    }

    dragJobId.current = null;
  };


  const { themeStyles, storefrontTheme, navButtons, logoDataUrl } =
    useLoaderData<typeof loader>();
  const inlineStyles = themeStyles?.styles || [];

  return (
    <>
      <div
        className="project-clad-modal-backdrop project-clad-reject-modal-backdrop"
        data-projectclad-pricing-modal-backdrop
        data-theme={storefrontTheme || "default"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pricing-modal-title"
        style={{ display: "none" }}
      >
        <div
          className="project-clad-card project-clad-modal project-clad-reject-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="pricing-modal-title">Show price</h2>
          <Form method="post" className="project-clad-inline-form project-clad-pricing-form">
            <input type="hidden" name="intent" value="unlock-pricing" />
            <input
              type="password"
              name="password"
              placeholder="Enter password to view price"
              required
              className="project-clad-pricing-password-input"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button type="submit" className="project-clad-button project-clad-reject-modal-btn">
              Show price
            </button>
            <button
              type="button"
              className="project-clad-button project-clad-reject-modal-btn"
              data-projectclad-pricing-modal-cancel
            >
              Cancel
            </button>
          </Form>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: proxyStylesText }} />
      {inlineStyles.map((css, index) => (
        <style key={index} dangerouslySetInnerHTML={{ __html: css }} />
      ))}
      <main
        className="project-clad-page"
        data-theme={storefrontTheme || "default"}
      >
        <div className="page-width project-clad-container">
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
              <h1 className="main-page-title page-title">{project.name}</h1>
              <nav className="project-clad-nav">
                {navButtons.map((btn, i) => (
                  <a
                    key={i}
                    href={btn.url}
                    className="project-clad-button"
                  >
                    {btn.label}
                  </a>
                ))}
              </nav>
            </div>
            <p className="project-clad-muted">
              Created {new Date(project.createdAt).toLocaleDateString()} • PO number{" "}
              {project.poNumber || "—"} • Company name {project.companyName || "—"}
            </p>
          </header>

          <section className="project-clad-section">
            <h2 className="project-clad-section-title">Orders</h2>
            {canEdit && (
              <Form method="post" className="project-clad-inline-form">
                <input type="hidden" name="intent" value="create-job" />
                <label htmlFor="new-job-name">New order</label>
                <input
                  id="new-job-name"
                  name="jobName"
                  placeholder="Order name"
                  required
                />
                <button type="submit" className="project-clad-button">
                  Add order
                </button>
              </Form>
            )}
            {project.jobs.length === 0 ? (
              <p className="project-clad-muted">No orders saved yet.</p>
            ) : (
              <div className="project-clad-grid">
                {jobs.map((job) => (
                  <details
                    key={job.id}
                    id={`job-${job.id}`}
                    open={selectedJobId === job.id}
                    className={
                      canEdit ? "project-clad-card project-clad-details project-clad-draggable" : "project-clad-card project-clad-details"
                    }
                    draggable={canEdit}
                    onDragStart={(event) => {
                      if (!canEdit) return;
                      dragJobId.current = job.id;
                      event.dataTransfer.setData("text/plain", job.id);
                    }}
                    onDragOver={(event) => {
                      if (!canEdit) return;
                      event.preventDefault();
                    }}
                    onDrop={(event) => {
                      if (!canEdit) return;
                      event.preventDefault();
                      reorderJobs(job.id);
                    }}
                  >
                    <summary className="project-clad-summary">
                      <div className="project-clad-summary-row">
                        <div>
                          <h3 className="project-clad-title">{job.name}</h3>
                          <p className="project-clad-muted">
                            Created {new Date(job.createdAt).toLocaleDateString()} •{" "}
                            {job.isLocked ? "Locked" : "Editable"}
                          </p>
                        </div>
                        <a
                          href={buildCartLink(job.items)}
                          className="link"
                          onClick={(event) => event.stopPropagation()}
                        >
                          Add items to cart
                        </a>
                      </div>
                    </summary>
                    {canEdit && !job.isLocked && (
                      <div className="project-clad-actions">
                        <Form
                          method="post"
                          onSubmit={(event) => {
                            if (!confirm("Are you sure you want to delete this order?")) {
                              event.preventDefault();
                            }
                          }}
                        >
                          <input type="hidden" name="intent" value="delete-job" />
                          <input type="hidden" name="jobId" value={job.id} />
                          <button type="submit" className="project-clad-button">
                            Delete order
                          </button>
                        </Form>
                      </div>
                    )}
                    <div className="project-clad-stack">
                      <div>
                        <strong>Total quantity:</strong>{" "}
                        {job.items.reduce((sum, item) => sum + item.quantity, 0)}
                      </div>
                      {job.items.length === 0 ? (
                        <p className="project-clad-muted">No items saved.</p>
                      ) : (
                        <table className="project-clad-table project-clad-orders-table">
                          <thead>
                            <tr>
                              <th>Variant</th>
                              <th className="project-clad-table-right">Quantity</th>
                              <th className="project-clad-table-right">Price</th>
                              {canEdit && !job.isLocked && (
                                <th className="project-clad-table-right">Actions</th>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {job.items.map((item) => (
                              <tr
                                key={item.id}
                                draggable={canEdit && !job.isLocked}
                                onDragStart={() => {
                                  if (!canEdit || job.isLocked) return;
                                  dragItemId.current = item.id;
                                }}
                                onDragOver={(event) => {
                                  if (!canEdit || job.isLocked) return;
                                  event.preventDefault();
                                }}
                                onDrop={(event) => {
                                  if (!canEdit || job.isLocked) return;
                                  event.preventDefault();
                                  reorderItems(job.id, item.id);
                                }}
                                className={
                                  canEdit && !job.isLocked ? "project-clad-draggable" : undefined
                                }
                              >
                                <td>{item.variantId}</td>
                                <td className="project-clad-table-right">
                                  {item.quantity}
                                </td>
                                <td className="project-clad-table-right">
                                  {canViewPricing ? (
                                    item.priceSnapshot
                                  ) : (
                                    <button
                                      type="button"
                                      className="project-clad-hidden-link"
                                      data-projectclad-show-price
                                    >
                                      Hidden
                                    </button>
                                  )}
                                </td>
                                {canEdit && !job.isLocked && (
                                  <td className="project-clad-table-right">
                                    <Form
                                      method="post"
                                      onSubmit={(e) => {
                                        if (!confirm("Are you sure you want to remove this item?")) {
                                          e.preventDefault();
                                        }
                                      }}
                                    >
                                      <input type="hidden" name="intent" value="delete-item" />
                                      <input type="hidden" name="itemId" value={item.id} />
                                      <button type="submit" className="link">
                                        Remove
                                      </button>
                                    </Form>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                    {canEdit && otherProjects.length > 0 && (
                      <div className="project-clad-stack">
                        <Form method="post" className="project-clad-inline-form">
                          <input type="hidden" name="intent" value="move-job" />
                          <input type="hidden" name="jobId" value={job.id} />
                          <label>Move to</label>
                          <select name="targetProjectId" required>
                            <option value="">Select project</option>
                            {otherProjects.map((projectOption) => (
                              <option
                                key={projectOption.id}
                                value={projectOption.id}
                              >
                                {projectOption.name}
                              </option>
                            ))}
                          </select>
                          <button type="submit" className="button button--secondary">
                            Move order
                          </button>
                        </Form>
                        <Form method="post" className="project-clad-inline-form">
                          <input type="hidden" name="intent" value="copy-job" />
                          <input type="hidden" name="jobId" value={job.id} />
                          <label>Copy to</label>
                          <select name="targetProjectId" required>
                            <option value="">Select project</option>
                            {otherProjects.map((projectOption) => (
                              <option
                                key={projectOption.id}
                                value={projectOption.id}
                              >
                                {projectOption.name}
                              </option>
                            ))}
                          </select>
                          <button type="submit" className="button button--secondary">
                            Copy order
                          </button>
                        </Form>
                      </div>
                    )}
                  </details>
                ))}
              </div>
            )}
          </section>

          <section className="project-clad-section">
            <h2 className="project-clad-section-title">Share access</h2>
            {canEdit ? (
              <>
                <Form method="post" className="project-clad-inline-form">
                  <input type="hidden" name="intent" value="share-project" />
                  <input type="hidden" name="role" value="view" />
                  <button
                    type="submit"
                    className="project-clad-button"
                    disabled={
                      actionData &&
                      typeof actionData === "object" &&
                      "shareLink" in actionData
                    }
                  >
                    {actionData &&
                    typeof actionData === "object" &&
                    "shareLink" in actionData
                      ? "Link Added to Clipboard"
                      : "Share"}
                  </button>
                </Form>
              </>
            ) : (
              <p className="project-clad-muted">
                You have view-only access to this project.
              </p>
            )}
          </section>
        </div>
      </main>
    </>
  );
}

export const links: LinksFunction = ({ data }) => {
  const hrefs = data?.themeStyles?.urls || [];
  return [
    ...hrefs.map((href) => ({ rel: "stylesheet", href })),
    { rel: "stylesheet", href: proxyStylesUrl },
  ];
};
