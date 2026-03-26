import crypto from "node:crypto";
import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import {
  Form,
  Link,
  useSearchParams,
  useActionData,
  useLoaderData,
  useLocation,
} from "react-router";
import { redirect } from "react-router";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import { getVariantInfo } from "../utils/storefront.server";
import { getAdminVariantInfo } from "../utils/adminVariants.server";
import {
  findCustomerIdByEmail,
  getCustomersByIds,
} from "../utils/adminCustomers.server";
import { hasAdminTag } from "../utils/customerTags.server";
import { verifyPassword } from "../utils/passwords.server";
import { getThemeStyles } from "../utils/themeAssets.server";
import proxyStylesUrl from "../styles/project-clad-proxy.css?url";
import proxyStylesText from "../styles/project-clad-proxy.css?raw";

type JobItemView = {
  id: string;
  variantId: string;
  quantity: number;
  priceSnapshot: string;
  displayName: string;
  imageUrl: string | null;
  imageAlt: string | null;
  productUrl: string | null;
  properties?: { name: string; value: string }[] | null;
};

type JobView = {
  id: string;
  name: string;
  createdAt: string;
  isLocked: boolean;
  workOrderStatus: string | null;
  completedAt: string | null;
  paidAt: string | null;
  receiptSnapshot: unknown | null;
  orderName: string | null;
  items: JobItemView[];
  subtotal: number;
};

type ActivityFeedItem = {
  id: string;
  type: string;
  visibility: string;
  payload: unknown;
  createdAt: string;
  actorLabel: string | null;
};

type CommentFeedItem = {
  id: string;
  body: string;
  createdAt: string;
  authorCustomerId: string;
  authorLabel: string;
  deletedAt: string | null;
  deletedByLabel: string | null;
};

type ProjectTimelineItem =
  | ({
      kind: "activity";
    } & ActivityFeedItem)
  | ({
      kind: "comment";
    } & CommentFeedItem);

type ProjectView = {
  id: string;
  name: string;
  poNumber: string | null;
  companyName: string | null;
  createdAt: string;
  jobs: JobView[];
  members: {
    customerId: string;
    role: "owner" | "edit" | "view";
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  }[];
  subtotal: number;
};

const PRICING_COOKIE = "projectclad_pricing=1";

const formatPrice = (value: string | number) => {
  const num = Number(value || 0);
  if (Number.isNaN(num)) return "$0.00";
  return `$${num.toFixed(2)}`;
};

const hasPricingAccess = (request: Request) => {
  const cookie = request.headers.get("Cookie") || "";
  return cookie.split(";").some((value) => value.trim().startsWith(PRICING_COOKIE));
};

const createPricingCookie = () =>
  `${PRICING_COOKIE}; Path=/; Max-Age=3600; SameSite=Lax`;

const getProjectId = (request: Request) => {
  const url = new URL(request.url);
  return url.searchParams.get("id") || "";
};

/** POST may hit `/project` on the app; redirects must target the customer’s storefront host + proxy path. */
const getStorefrontOriginForAppProxyRedirect = (
  request: Request,
  shop: string,
) => {
  let appHost = "";
  try {
    const appUrl = process.env.SHOPIFY_APP_URL;
    if (appUrl) appHost = new URL(appUrl).host;
  } catch {
    // ignore
  }

  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      const ref = new URL(referer);
      const h = ref.host;
      const isLocal =
        h === "localhost" ||
        h.startsWith("127.0.0.1") ||
        h.endsWith(".localhost");
      if (h && h !== appHost && !isLocal) {
        return `${ref.protocol}//${h}`;
      }
    } catch {
      // ignore
    }
  }

  return `https://${shop}`;
};

const storefrontProjectActionPath = "/apps/project-clad/project";

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Plain 404 is easy to confuse with Shopify/network “page not found”. */
const projectMissingHtmlResponse = (
  request: Request,
  shop: string,
  projectId: string,
) => {
  const qs = new URLSearchParams(new URL(request.url).search);
  qs.delete("id");
  const listQs = qs.toString();
  const origin = getStorefrontOriginForAppProxyRedirect(request, shop);
  const backHref = `${origin}/apps/project-clad/projects${listQs ? `?${listQs}` : ""}`;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Project not found · ProjectClad</title></head><body style="font-family:system-ui,sans-serif;max-width:36rem;margin:2rem auto;padding:0 1rem"><h1>Project not found</h1><p>No project with id <code style="word-break:break-all">${escapeHtml(projectId)}</code> exists in the app database for <strong>${escapeHtml(shop)}</strong>.</p><p>Common cause: the project was created against a <strong>local/dev database</strong> while the storefront uses <strong>production</strong> (for example Render). Create the project again on the live app or migrate data.</p><p><a href="${escapeHtml(backHref)}">Back to projects</a></p></body></html>`;
  return new Response(html, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-ProjectClad-Error": "project_not_found",
    },
  });
};

const redirectToProject = (request: Request, projectId: string, shop: string) => {
  const origin = getStorefrontOriginForAppProxyRedirect(request, shop);
  return redirect(
    `${origin}${storefrontProjectActionPath}?id=${encodeURIComponent(projectId)}`,
  );
};

const getProjectsPath = () => "/apps/project-clad/projects";

function formatActivityLine(ev: ActivityFeedItem): string {
  const p =
    ev.payload && typeof ev.payload === "object"
      ? (ev.payload as Record<string, unknown>)
      : {};
  switch (ev.type) {
    case "order_approved_work_queue":
      return `Order “${String(p.jobName || "Order")}” was approved and added to the work queue.`;
    case "work_order_status": {
      const jobName = String(p.jobName || "").trim();
      return `Work order status: ${String(p.from ?? "—")} → ${String(p.to ?? "—")}${jobName ? ` (${jobName})` : ""}`;
    }
    case "job_item_variant_swapped":
      return `Product line updated: ${String(p.fromLabel || "")} → ${String(p.toLabel || "")}`;
    case "order_paid":
      return `Payment received${p.orderName ? ` (${String(p.orderName)})` : ""}.`;
    default:
      return ev.type.replace(/_/g, " ");
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, customerId: viewerCustomerId } =
    requireAppProxyCustomer(request);
  const customerId = viewerCustomerId as string;
  const themeStyles = await getThemeStyles(shop);
  const settings = await prisma.shopSettings.findUnique({
    where: { shop },
  });
  const projectId = getProjectId(request);

  if (!projectId) {
    const listParams = new URLSearchParams(new URL(request.url).search);
    listParams.delete("id");
    const listQs = listParams.toString();
    const origin = getStorefrontOriginForAppProxyRedirect(request, shop);
    return redirect(
      `${origin}/apps/project-clad/projects${listQs ? `?${listQs}` : ""}`,
    );
  }

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
    throw projectMissingHtmlResponse(request, shop, projectId);
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
  const isOwner = project.ownerCustomerId === customerId;
  const canEdit = isOwner || memberRole === "edit";

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

  const variantIds = project.jobs.flatMap((job) =>
    job.items.map((item) => item.variantId),
  );
  let variantInfo: Record<
    string,
    { title: string; productTitle: string; imageUrl?: string | null; imageAlt?: string | null; productHandle?: string | null }
  > = {};
  let variantLookupError: string | null = null;
  try {
    // Prefer Storefront API (does not depend on admin auth),
    // but fall back to Admin API if needed.
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
  const memberIds = [
    project.ownerCustomerId,
    ...project.members.map((member) => member.customerId),
  ];
  let customerInfo: Awaited<ReturnType<typeof getCustomersByIds>> = {};
  let memberLookupError: string | null = null;
  try {
    customerInfo = await getCustomersByIds(shop, memberIds);
  } catch (error) {
    memberLookupError =
      error instanceof Error ? error.message : "Member lookup failed.";
  }

  const viewerTags = customerInfo[customerId]?.tags ?? [];
  const hideAddToCart = viewerTags.some(
    (t: string) => String(t).trim().toUpperCase() === "NA",
  );
  const hasNATag = hideAddToCart;
  const canAdminMembers = isOwner || (canEdit && !hasNATag);
  const viewerIsAdmin = hasAdminTag(viewerTags);

  const approvalRequests = await prisma.approvalRequest.findMany({
    where: { projectId },
  });

  const activityWhere = viewerIsAdmin
    ? {
        projectId,
        OR: [{ visibility: "member" }, { visibility: "admin" }],
      }
    : { projectId, visibility: "member" };

  const [activityRows, commentRows] = await Promise.all([
    prisma.projectActivityEvent.findMany({
      where: activityWhere,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.projectComment.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
  ]);

  const actorIds = new Set<string>();
  for (const ev of activityRows) {
    if (ev.actorCustomerId) actorIds.add(ev.actorCustomerId);
  }
  for (const c of commentRows) {
    actorIds.add(c.authorCustomerId);
    if (c.deletedByCustomerId) actorIds.add(c.deletedByCustomerId);
  }
  const actorInfo =
    actorIds.size > 0
      ? await getCustomersByIds(shop, [...actorIds])
      : {};

  const labelForCustomer = (id: string) => {
    const c = actorInfo[id];
    if (!c) return id;
    const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
    return name || c.email || id;
  };

  const payload: ProjectView = {
    id: project.id,
    name: project.name,
    poNumber: project.poNumber,
    companyName: project.companyName,
    createdAt: project.createdAt.toISOString(),
    jobs: project.jobs.map((job) => {
      const jobSubtotal = job.items.reduce((sum, item) => {
        const price = Number(item.priceSnapshot || 0);
        return sum + price * item.quantity;
      }, 0);
      return {
        id: job.id,
        name: job.name,
        createdAt: job.createdAt.toISOString(),
        isLocked: job.isLocked || Boolean(job.orderLink),
        workOrderStatus: job.workOrderStatus ?? null,
        completedAt: job.completedAt?.toISOString() ?? null,
        paidAt: job.paidAt?.toISOString() ?? null,
        receiptSnapshot: job.receiptSnapshot ?? null,
        orderName: job.orderLink?.orderName ?? null,
        subtotal: jobSubtotal,
        items: job.items.map((item) => {
          const info = variantInfo[item.variantId];
          const displayName = info
            ? info.title && info.title !== "Default Title"
              ? `${info.productTitle} — ${info.title}`
              : info.productTitle
            : `Variant ${item.variantId}`;
          const productUrl = info?.productHandle
            ? `https://${shop}/products/${info.productHandle}?variant=${item.variantId}`
            : null;

          let properties: { name: string; value: string }[] | null = null;
          let customImageUrl: string | null = null;

          if (item.customData && Array.isArray(item.customData)) {
            properties = item.customData as { name: string; value: string }[];

            // For the special "Upload Part" product, use any URL property as the main image
            if (displayName.toLowerCase().includes("upload part")) {
              const uploadProp = properties.find((p) => {
                const v = (p.value || "").trim();
                return v.startsWith("http://") || v.startsWith("https://");
              });
              if (uploadProp) {
                customImageUrl = uploadProp.value.trim();
              }
            }
          }

          return {
            id: item.id,
            variantId: item.variantId,
            quantity: item.quantity,
            priceSnapshot: item.priceSnapshot.toString(),
            displayName,
            imageUrl: customImageUrl || info?.imageUrl || null,
            imageAlt: info?.imageAlt || null,
            productUrl,
            properties,
          };
        }),
      };
    }),
    members: [
      {
        customerId: project.ownerCustomerId,
        role: "owner",
        email: customerInfo[project.ownerCustomerId]?.email || null,
        firstName: customerInfo[project.ownerCustomerId]?.firstName || null,
        lastName: customerInfo[project.ownerCustomerId]?.lastName || null,
      },
      ...project.members
        .filter((member) => member.customerId !== project.ownerCustomerId)
        .map((member) => ({
          customerId: member.customerId,
          role: member.role,
          email: customerInfo[member.customerId]?.email || null,
          firstName: customerInfo[member.customerId]?.firstName || null,
          lastName: customerInfo[member.customerId]?.lastName || null,
        })),
    ],
    subtotal: project.jobs.reduce((sum, job) => {
      return (
        sum +
        job.items.reduce((jobSum, item) => {
          const price = Number(item.priceSnapshot || 0);
          return jobSum + price * item.quantity;
        }, 0)
      );
    }, 0),
  };

  return {
    project: payload,
    otherProjects: otherProjects.map((other) => ({
      id: other.id,
      name: other.name,
    })),
    canViewPricing: !hideAddToCart || hasPricingAccess(request),
    canEdit,
    isOwner,
    canAdminMembers,
    hideAddToCart,
    approvalRequests: approvalRequests.map((r) => {
      const approver = r.approvedByCustomerId
        ? customerInfo[r.approvedByCustomerId]
        : null;
      const approvedByName = approver
        ? [approver.firstName, approver.lastName].filter(Boolean).join(" ").trim() || approver.email || r.approvedByCustomerId
        : null;
      return {
        jobId: r.jobId,
        itemId: r.itemId,
        requestedAt: r.requestedAt.toISOString(),
        approvedAt: r.approvedAt?.toISOString() ?? null,
        approvedBy: approvedByName,
      };
    }),
    projectTimeline: (() => {
      const activities: ProjectTimelineItem[] = activityRows.map((ev) => ({
        kind: "activity",
        id: ev.id,
        type: ev.type,
        visibility: ev.visibility,
        payload: ev.payload,
        createdAt: ev.createdAt.toISOString(),
        actorLabel: ev.actorCustomerId
          ? labelForCustomer(ev.actorCustomerId)
          : null,
      }));
      const comments: ProjectTimelineItem[] = commentRows.map((c) => ({
        kind: "comment",
        id: c.id,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
        authorCustomerId: c.authorCustomerId,
        authorLabel: labelForCustomer(c.authorCustomerId),
        deletedAt: c.deletedAt?.toISOString() ?? null,
        deletedByLabel: c.deletedByLabel,
      }));
      return [...activities, ...comments].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    })(),
    viewerIsAdmin,
    currentCustomerId: customerId,
    memberLookupError,
    variantLookupError,
    themeStyles,
    shop,
    storefrontTheme: settings?.storefrontTheme || "default",
    logoDataUrl: settings?.logoDataUrl || null,
    navButtons: [
      {
        label: "Home",
        url: "/",
      },
      {
        label: settings?.navButton2Label || "Shop",
        url: settings?.navButton2Url || "/collections/main-products",
      },
      {
        label: settings?.navButton3Label || "Cart",
        url: settings?.navButton3Url || "/cart",
      },
    ],
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const contentType = request.headers.get("Content-Type") || "";
  const isJsonRequest = contentType.includes("application/json");
  const { shop, customerId: viewerCustomerId } = requireAppProxyCustomer(
    request,
    {
      jsonOnFail: isJsonRequest,
    },
  );
  const customerId = viewerCustomerId as string;

  if (isJsonRequest) {
    const projectId = getProjectId(request);
    if (!projectId) {
      return new Response("Project not found", { status: 404 });
    }

    const payload = (await request.json()) as {
      intent?: string;
      jobId?: string;
      jobIds?: string[];
      itemIds?: string[];
      removeItemIds?: string[];
      itemUpdates?: Array<{ itemId: string; quantity: number }>;
      deleteJob?: boolean;
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

    if (payload.intent === "save-order-edit") {
      const jobId = String(payload.jobId || "");
      const jobName =
        typeof payload.jobName === "string" ? payload.jobName.trim() : "";
      const removeItemIds = Array.isArray(payload.removeItemIds)
        ? payload.removeItemIds.filter((id): id is string => typeof id === "string")
        : [];
      const itemUpdates = Array.isArray(payload.itemUpdates)
        ? (payload.itemUpdates as Array<{ itemId: string; quantity: number }>).filter(
            (u) => typeof u?.itemId === "string" && typeof u?.quantity === "number" && u.quantity >= 0
          )
        : [];
      const deleteJob = Boolean(payload.deleteJob);

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

      if (jobId) {
        const job = await prisma.job.findFirst({
          where: { id: jobId, projectId },
          include: { orderLink: true, items: true },
        });

        if (job) {
          const isLocked = job.isLocked || Boolean(job.orderLink);
          if (!isLocked) {
            if (deleteJob) {
              await prisma.job.delete({ where: { id: jobId } });
            } else {
              if (jobName && jobName !== job.name) {
                await prisma.job.update({
                  where: { id: jobId },
                  data: { name: jobName },
                });
              }
              for (const { itemId, quantity } of itemUpdates) {
                const item = job.items.find((i) => i.id === itemId);
                if (item && quantity >= 0) {
                  await prisma.jobItem.update({
                    where: { id: itemId },
                    data: { quantity },
                  });
                }
              }
            }
          }
        }
      }

      return redirectToProject(request, projectId, shop);
    }

    return new Response("Unsupported JSON action", { status: 400 });
  }

  const formData = await request.formData();
  const projectId =
    getProjectId(request) || String(formData.get("id") || "");

  if (!projectId) {
    return new Response("Project not found", { status: 404 });
  }

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

  if (intent === "add-comment") {
    const text = String(formData.get("body") || "").trim();
    if (text && text.length <= 8000) {
      await prisma.projectComment.create({
        data: {
          projectId,
          authorCustomerId: customerId,
          body: text,
        },
      });
    }
    return redirectToProject(request, projectId, shop);
  }

  if (intent === "delete-comment") {
    const commentId = String(formData.get("commentId") || "");
    if (commentId) {
      const comment = await prisma.projectComment.findFirst({
        where: { id: commentId, projectId },
      });
      if (
        comment &&
        !comment.deletedAt &&
        comment.authorCustomerId === customerId
      ) {
        let deletedByLabel = customerId;
        try {
          const info = await getCustomersByIds(shop, [customerId]);
          const c = info[customerId];
          const name =
            [c?.firstName, c?.lastName].filter(Boolean).join(" ").trim() ||
            c?.email ||
            customerId;
          deletedByLabel = c?.email ? `${name} (${c.email})` : name;
        } catch {
          // keep customerId
        }
        await prisma.projectComment.update({
          where: { id: commentId },
          data: {
            deletedAt: new Date(),
            deletedByCustomerId: customerId,
            deletedByLabel,
            body: "",
          },
        });
      }
    }
    return redirectToProject(request, projectId, shop);
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

  if (intent === "create-job") {
    if (!canEdit) {
      throw new Response("Forbidden", { status: 403 });
    }

    const name = String(formData.get("jobName") || "").trim();
    if (!name) {
      return Response.json({ jobError: "Order name is required." }, { status: 400 });
    }

    const existingNames = await prisma.job.findMany({
      where: { projectId },
      select: { name: true },
    });
    const normalizedName = name.toLowerCase();
    const hasDuplicate = existingNames.some(
      (job) => job.name.toLowerCase() === normalizedName,
    );

    if (hasDuplicate) {
      return Response.json(
        { jobError: "This order already exists." },
        { status: 400 },
      );
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

    return redirectToProject(request, projectId, shop);
  }

  if (intent === "delete-job") {
    if (!canEdit) {
      throw new Response("Forbidden", { status: 403 });
    }

    const jobId = String(formData.get("jobId") || "");
    if (!jobId) {
      return redirectToProject(request, projectId, shop);
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

    return redirectToProject(request, projectId, shop);
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

    return redirectToProject(request, projectId, shop);
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

    return redirectToProject(request, projectId, shop);
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

    return redirectToProject(request, projectId, shop);
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

  if (intent === "add-member") {
    if (!canAdminMembers) {
      return Response.json(
        { memberError: "Only project admins can add members." },
        { status: 200 },
      );
    }

    const email = String(formData.get("email") || "").trim();
    const role = String(formData.get("role") || "view");

    if (!email) {
      return Response.json(
        { memberError: "Email is required." },
        { status: 200 },
      );
    }

    let memberCustomerId: string | null = null;
    try {
      memberCustomerId = await findCustomerIdByEmail(shop, email);
    } catch (error) {
      return Response.json(
        {
          memberError:
            error instanceof Error
              ? error.message
              : "Customer lookup failed.",
        },
        { status: 200 },
      );
    }

    if (!memberCustomerId) {
      return Response.json(
        { memberError: "No customer found with that email." },
        { status: 200 },
      );
    }

    if (memberCustomerId === project.ownerCustomerId) {
      return Response.json(
        { memberError: "This customer already owns the project." },
        { status: 200 },
      );
    }

    await prisma.projectMember.upsert({
      where: {
        projectId_customerId: {
          projectId,
          customerId: memberCustomerId,
        },
      },
      update: {
        role: role === "edit" ? "edit" : "view",
      },
      create: {
        projectId,
        customerId: memberCustomerId,
        role: role === "edit" ? "edit" : "view",
      },
    });

    return redirectToProject(request, projectId, shop);
  }

  if (intent === "remove-member") {
    if (!canAdminMembers) {
      return redirectToProject(request, projectId, shop);
    }

    const memberCustomerId = String(formData.get("memberCustomerId") || "");
    if (!memberCustomerId || memberCustomerId === project.ownerCustomerId) {
      return redirectToProject(request, projectId, shop);
    }

    await prisma.projectMember.deleteMany({
      where: {
        projectId,
        customerId: memberCustomerId,
      },
    });

    return redirectToProject(request, projectId, shop);
  }

  if (intent === "update-project-details") {
    if (!canEdit) {
      throw new Response("Forbidden", { status: 403 });
    }

    const name = String(formData.get("projectName") || "").trim();
    const poNumber = String(formData.get("poNumber") || "").trim() || null;
    const companyName = String(formData.get("companyName") || "").trim() || null;

    if (!name) {
      return redirectToProject(request, projectId, shop);
    }

    await prisma.project.update({
      where: { id: projectId },
      data: { name, poNumber, companyName },
    });

    return redirectToProject(request, projectId, shop);
  }

  if (intent === "unlock-pricing") {
    const password = String(formData.get("password") || "").trim();
    const settings = await prisma.shopSettings.findUnique({
      where: { shop },
    });

    if (!settings?.pricingPasswordHash || !settings.pricingPasswordSalt) {
      return redirectToProject(request, projectId, shop);
    }

    if (
      password &&
      verifyPassword(
        password,
        settings.pricingPasswordSalt,
        settings.pricingPasswordHash,
      )
    ) {
      return Response.json(
        { pricingUnlocked: true },
        { headers: { "Set-Cookie": createPricingCookie() } },
      );
    }

    return Response.json({ error: "Invalid password" }, { status: 400 });
  }

  return new Response("Unsupported action", { status: 400 });
};

export default function ProjectDetailPage() {
  const {
    project,
    otherProjects,
    canViewPricing,
    canEdit,
    isOwner,
    canAdminMembers,
    hideAddToCart,
    approvalRequests,
    projectTimeline,
    viewerIsAdmin,
    currentCustomerId,
    memberLookupError,
    variantLookupError,
    shop,
    navButtons,
    logoDataUrl,
  } = useLoaderData<typeof loader>();

  const getApprovalStatus = (jobId: string, itemId: string) => {
    const r = approvalRequests.find(
      (a) => a.jobId === (jobId || "") && a.itemId === (itemId || ""),
    );
    if (!r) return "none" as const;
    if (r.approvedAt) return "approved" as const;
    return "awaiting" as const;
  };

  const hasProjectLevelApprovalPending = approvalRequests.some(
    (r) => !r.approvedAt && !r.jobId && !r.itemId,
  );

  const isOrderAwaitingApproval = (jobId: string) =>
    hasProjectLevelApprovalPending || getApprovalStatus(jobId, "") === "awaiting";

  const getJobApprovalInfo = (jobId: string) => {
    const r = approvalRequests.find(
      (a) => a.jobId === (jobId || "") && a.itemId === "",
    );
    if (!r?.approvedAt || !r.approvedBy) return null;
    return {
      approvedAt: r.approvedAt,
      approvedBy: r.approvedBy,
    };
  };
  const actionData = useActionData<typeof action>();
  const pricingUnlocked =
    canViewPricing ||
    (actionData &&
      typeof actionData === "object" &&
      "pricingUnlocked" in actionData &&
      Boolean(actionData.pricingUnlocked));
  const actionError =
    actionData && typeof actionData === "object" && "error" in actionData
      ? (actionData.error as string)
      : null;
  const jobError =
    actionData && typeof actionData === "object" && "jobError" in actionData
      ? (actionData.jobError as string)
      : null;
  const memberError =
    actionData && typeof actionData === "object" && "memberError" in actionData
      ? (actionData.memberError as string)
      : null;
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const selectedJobId = searchParams.get("job");
  const approveMode = searchParams.get("approve") === "1";
  const approveJobId = searchParams.get("approveJobId") || "";
  const approveItemId = searchParams.get("approveItemId") || "";
  const [jobs, setJobs] = useState(project.jobs);
  const [cartPrompt, setCartPrompt] = useState<{
    items: JobItemView[];
    jobName: string;
    destination: "cart" | "checkout";
  } | null>(null);
  const [cartLoading, setCartLoading] = useState(false);
  const [cartError, setCartError] = useState<string | null>(null);
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
    if (!actionData || typeof actionData !== "object") return;
    if ("pricingUnlocked" in actionData && actionData.pricingUnlocked) {
      document.cookie = createPricingCookie();
    }
  }, [actionData]);

  const addItemsToCart = async (
    items: JobItemView[],
    mode: "add" | "replace",
  ) => {
    const lineItems = items.map((item) => {
      const base = { id: item.variantId, quantity: item.quantity };
      if (item.properties && item.properties.length > 0) {
        const props = Object.fromEntries(
          item.properties.map((p) => [p.name, p.value]),
        );
        return { ...base, properties: props };
      }
      return base;
    });

    if (mode === "replace") {
      await fetch("/cart/clear.js", { method: "POST" });
    }

    const response = await fetch("/cart/add.js", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ items: lineItems }),
    });

    if (!response.ok) {
      throw new Error("Unable to add items to cart.");
    }
  };

  const handleAddItemsClick = async (
    job: JobView,
    form: HTMLFormElement | null,
    destination: "cart" | "checkout",
  ) => {
    if (job.items.length === 0) {
      return;
    }

    setCartError(null);
    setCartLoading(true);

    try {
      const response = await fetch("/cart.js", {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error("Unable to read cart.");
      }
      const cart = (await response.json()) as { item_count?: number };
      if ((cart.item_count || 0) > 0) {
        setCartPrompt({ items: job.items, jobName: job.name, destination });
      } else if (form) {
        const returnTo = form.querySelector<HTMLInputElement>('input[name="return_to"]');
        if (returnTo) returnTo.value = destination === "checkout" ? "/checkout" : "/cart";
        form.submit();
      } else {
        await addItemsToCart(job.items, "add");
        window.location.href = destination === "checkout" ? "/checkout" : "/cart";
      }
    } catch (error) {
      setCartError(
        error instanceof Error ? error.message : "Unable to add items to cart.",
      );
      setCartPrompt({ items: job.items, jobName: job.name, destination });
    } finally {
      setCartLoading(false);
    }
  };

  const handleCartChoice = async (mode: "add" | "replace") => {
    if (!cartPrompt) return;
    setCartLoading(true);
    setCartError(null);

    try {
      await addItemsToCart(cartPrompt.items, mode);
      window.location.href = cartPrompt.destination === "checkout" ? "/checkout" : "/cart";
    } catch (error) {
      setCartError(
        error instanceof Error ? error.message : "Unable to add items to cart.",
      );
    } finally {
      setCartLoading(false);
      setCartPrompt(null);
    }
  };

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
    await fetch(`/apps/project-clad/project?id=${project.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "reorder-items",
        jobId,
        itemIds: reordered,
      }),
    });

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

    await fetch(`/apps/project-clad/project?id=${project.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "reorder-jobs",
        jobIds: reordered,
      }),
    });

    dragJobId.current = null;
  };

  const { themeStyles, storefrontTheme } = useLoaderData<typeof loader>();
  const inlineStyles = themeStyles?.styles || [];

  return (
    <>
      {cartPrompt && (
        <div
          className="project-clad-modal-backdrop"
          onClick={() => setCartPrompt(null)}
          role="presentation"
        >
          <div
            className="project-clad-card project-clad-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>Add items to cart</h2>
            <p className="project-clad-muted">
              Your cart already has items. Choose how to update it for{" "}
              {cartPrompt.jobName}.
            </p>
            {cartError && <p className="project-clad-muted">{cartError}</p>}
            <div className="project-clad-actions">
              <button
                type="button"
                className="project-clad-button"
                onClick={() => handleCartChoice("add")}
                disabled={cartLoading}
              >
                Add to cart
              </button>
              <button
                type="button"
                className="project-clad-button"
                onClick={() => handleCartChoice("replace")}
                disabled={cartLoading}
              >
                Replace cart
              </button>
              <button
                type="button"
                className="project-clad-button"
                onClick={() => setCartPrompt(null)}
                disabled={cartLoading}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      <div
        className="project-clad-modal-backdrop project-clad-reject-modal-backdrop"
        data-projectclad-reject-modal
        data-theme={storefrontTheme || "default"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reject-modal-title"
        style={{ display: "none" }}
      >
        <div
          className="project-clad-card project-clad-modal project-clad-reject-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="reject-modal-title">Reject order</h2>
          <p className="project-clad-muted">
            Provide a reason for the rejection. This will be included in the email sent to project members.
          </p>
          <form data-projectclad-reject-form className="project-clad-reject-form">
            <label htmlFor="reject-reason">Reason (optional)</label>
            <textarea
              id="reject-reason"
              name="rejectReason"
              className="project-clad-reject-textarea"
              placeholder="e.g. Quantity exceeds budget, incorrect product..."
              rows={4}
            />
            <p className="project-clad-muted" data-projectclad-reject-form-error />
            <div className="project-clad-actions project-clad-reject-modal-actions">
              <button type="submit" className="project-clad-button project-clad-reject-modal-btn">
                Reject
              </button>
              <button type="button" className="project-clad-button project-clad-reject-modal-btn" data-projectclad-reject-cancel>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
      <div
        className="project-clad-modal-backdrop project-clad-reject-modal-backdrop"
        data-projectclad-pricing-modal-backdrop
        data-theme={storefrontTheme || "default"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pricing-modal-title"
        style={{ display: "none" }}
      >
        <div className="project-clad-card project-clad-modal project-clad-reject-modal" onClick={(e) => e.stopPropagation()}>
          <h2 id="pricing-modal-title">Show price</h2>
          <Form
            method="post"
            action="#"
            className="project-clad-inline-form project-clad-pricing-form"
            data-projectclad-ajax
            data-projectclad-intent="unlock-pricing"
            data-projectclad-project-id={project.id}
          >
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
            <span className="project-clad-muted" data-projectclad-form-message />
          </Form>
        </div>
      </div>
      <div
        className="project-clad-modal-backdrop project-clad-reject-modal-backdrop"
        data-projectclad-edit-project-modal
        data-theme={storefrontTheme || "default"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-project-modal-title"
        style={{ display: "none" }}
      >
        <div
          className="project-clad-card project-clad-modal project-clad-reject-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="project-clad-modal-close"
            data-projectclad-edit-project-cancel
            aria-label="Close"
          >
            ×
          </button>
          <h2 id="edit-project-modal-title" data-projectclad-section-underline>Edit project details</h2>
          <Form
            method="post"
            action={`/apps/project-clad/project?id=${project.id}`}
            className="project-clad-inline-form project-clad-pricing-form"
          >
            <input type="hidden" name="intent" value="update-project-details" />
            <label htmlFor="edit-project-name">Project name</label>
            <input
              id="edit-project-name"
              name="projectName"
              type="text"
              defaultValue={project.name}
              required
              className="project-clad-pricing-password-input"
            />
            <label htmlFor="edit-project-po">PO number</label>
            <input
              id="edit-project-po"
              name="poNumber"
              type="text"
              defaultValue={project.poNumber || ""}
              placeholder="Optional"
              className="project-clad-pricing-password-input"
            />
            <label htmlFor="edit-project-company">Company name</label>
            <input
              id="edit-project-company"
              name="companyName"
              type="text"
              defaultValue={project.companyName || ""}
              placeholder="Optional"
              className="project-clad-pricing-password-input"
            />
            <div className="project-clad-actions" style={{ marginTop: "0.75rem", gap: "0.5rem" }}>
              <button type="submit" className="project-clad-button project-clad-reject-modal-btn">
                Save
              </button>
              <button
                type="button"
                className="project-clad-button project-clad-reject-modal-btn"
                data-projectclad-edit-project-cancel
              >
                Cancel
              </button>
            </div>
          </Form>

          {canEdit && (
            <>
              <h3 className="project-clad-section-title" style={{ marginTop: "1.5rem", marginBottom: "0.5rem" }} data-projectclad-section-underline>Create new order</h3>
              <Form
                method="post"
                action={`https://${shop}/apps/project-clad/project?id=${project.id}`}
                className="project-clad-inline-form project-clad-create-order-form"
                data-projectclad-ajax
                data-projectclad-intent="create-job"
                data-projectclad-project-id={project.id}
                style={{ marginBottom: "1rem" }}
              >
                <input type="hidden" name="intent" value="create-job" />
                <input
                  id="new-job-name-modal"
                  name="jobName"
                  placeholder="Create new order"
                  required
                  aria-label="Create new order"
                />
                <button type="submit" className="project-clad-button project-clad-reject-modal-btn">
                  Create new order
                </button>
                <span
                  className="project-clad-muted"
                  data-projectclad-form-message
                >
                  {jobError || ""}
                </span>
              </Form>
            </>
          )}

          <h3 className="project-clad-section-title" style={{ marginTop: "1.5rem", marginBottom: "0.5rem" }} data-projectclad-section-underline>Share access</h3>
          {canEdit ? (
            <>
              <div className="project-clad-share-access-form">
                <Form
                  id="projectclad-add-member-form"
                  method="post"
                  action={`https://${shop}/apps/project-clad/project?id=${project.id}`}
                  className="project-clad-inline-form"
                  data-projectclad-member-form
                  data-projectclad-member-intent="add-member"
                  data-projectclad-project-id={project.id}
                  data-projectclad-ajax
                  data-projectclad-intent="add-member"
                >
                  <input type="hidden" name="intent" value="add-member" />
                  <label htmlFor="member-email-modal">Add project member</label>
                  <input
                    id="member-email-modal"
                    name="email"
                    type="email"
                    placeholder="email@example.com"
                    required
                  />
                  <label>Project Member Role</label>
                  <select name="role" defaultValue="edit">
                    <option value="edit">Edit</option>
                    <option value="view">View only</option>
                  </select>
                  <button type="submit" className="project-clad-button project-clad-reject-modal-btn">
                    Add
                  </button>
                </Form>
                <div
                  className="project-clad-actions project-clad-share-buttons"
                  style={{ flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" }}
                >
                  <Form
                    method="post"
                    action={`https://${shop}/apps/project-clad/project?id=${project.id}`}
                    className="project-clad-inline-form"
                    style={{ display: "inline" }}
                    data-projectclad-ajax
                    data-projectclad-intent="share-project"
                    data-projectclad-project-id={project.id}
                  >
                    <input type="hidden" name="intent" value="share-project" />
                    <input type="hidden" name="role" value="view" />
                    <button
                      type="submit"
                      className="project-clad-button project-clad-reject-modal-btn"
                      data-projectclad-share-submit
                    >
                      Share
                    </button>
                  </Form>
                  <span
                    className="project-clad-muted"
                    data-projectclad-member-message
                  >
                    {memberError || ""}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <p className="project-clad-muted">
              You have view-only access to this project.
            </p>
          )}

          <h3 className="project-clad-section-title" style={{ marginTop: "1.5rem", marginBottom: "0.5rem" }} data-projectclad-section-underline>Project members</h3>
          {memberLookupError ? (
            <p className="project-clad-muted">{memberLookupError}</p>
          ) : project.members.length === 0 ? (
            <p className="project-clad-muted">No members on this project.</p>
          ) : (
            <table className="project-clad-table project-clad-members-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th className="project-clad-table-right">Project Member Role</th>
                  {canAdminMembers && (
                    <th className="project-clad-table-right">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {project.members.map((member) => {
                  const fullName = [member.firstName, member.lastName]
                    .filter(Boolean)
                    .join(" ");
                  const roleLabel =
                    member.role === "owner"
                      ? "Owner"
                      : member.role === "edit"
                        ? "Edit"
                        : "View only";
                  return (
                    <tr key={member.customerId}>
                      <td>
                        <strong>Name:</strong> {fullName || "—"}
                      </td>
                      <td>
                        <strong>E-mail:</strong> {member.email || "—"}
                      </td>
                      <td className="project-clad-table-right">
                        <strong>Permission:</strong> {roleLabel}
                      </td>
                      {canAdminMembers && (
                        <td className="project-clad-table-right">
                          {member.role === "owner" ? (
                            "—"
                          ) : (
                            <Form
                              method="post"
                              action={`https://${shop}/apps/project-clad/project?id=${project.id}`}
                              onSubmit={(event) => {
                                if (!confirm("Remove this member?")) {
                                  event.preventDefault();
                                }
                              }}
                              data-projectclad-member-form
                              data-projectclad-member-intent="remove-member"
                              data-projectclad-project-id={project.id}
                              data-projectclad-member-id={member.customerId}
                              data-projectclad-ajax
                              data-projectclad-intent="remove-member"
                            >
                              <input type="hidden" name="intent" value="remove-member" />
                              <input
                                type="hidden"
                                name="memberCustomerId"
                                value={member.customerId}
                              />
                              <button type="submit" className="project-clad-button project-clad-reject-modal-btn">
                                Remove
                              </button>
                            </Form>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {canAdminMembers && (
            <div style={{ marginTop: "2rem" }}>
              <button
                type="button"
                className="project-clad-button project-clad-button--danger project-clad-button--full project-clad-reject-modal-btn"
                data-projectclad-delete-project-open
              >
                Delete this project
              </button>
            </div>
          )}
        </div>
      </div>
      <div
        className="project-clad-modal-backdrop project-clad-reject-modal-backdrop"
        data-projectclad-edit-save-modal
        data-theme={storefrontTheme || "default"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-save-title-js"
        style={{ display: "none" }}
      >
        <div className="project-clad-card project-clad-modal project-clad-reject-modal project-clad-edit-save-modal" onClick={(e) => e.stopPropagation()}>
          <h2 id="edit-save-title-js">Save changes?</h2>
          <div className="project-clad-actions project-clad-reject-modal-actions">
            <button type="button" className="project-clad-button project-clad-reject-modal-btn" data-projectclad-edit-save-yes>
              Yes
            </button>
            <button type="button" className="project-clad-button project-clad-reject-modal-btn" data-projectclad-edit-save-no>
              No
            </button>
            <button type="button" className="project-clad-button project-clad-reject-modal-btn" data-projectclad-edit-save-close>
              Close
            </button>
          </div>
        </div>
      </div>
      <div
        className="project-clad-modal-backdrop project-clad-reject-modal-backdrop"
        data-projectclad-delete-project-modal
        data-theme={storefrontTheme || "default"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-project-modal-title"
        style={{ display: "none" }}
      >
        <div
          className="project-clad-card project-clad-modal project-clad-reject-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="delete-project-modal-title">Delete this project</h2>
          <p className="project-clad-muted" style={{ marginTop: "0.5rem" }}>
            This will permanently delete this project and all of its orders. This cannot be undone.
          </p>
          <Form
            method="post"
            action="/apps/project-clad/projects"
            style={{ marginTop: "1rem" }}
          >
            <input type="hidden" name="intent" value="delete-project" />
            <input type="hidden" name="projectId" value={project.id} />
            <div className="project-clad-actions project-clad-reject-modal-actions" style={{ marginTop: "1rem" }}>
              <button
                type="submit"
                className="project-clad-button project-clad-button--danger project-clad-button--full project-clad-reject-modal-btn"
              >
                Yes, delete this project
              </button>
              <button
                type="button"
                className="project-clad-button project-clad-reject-modal-btn"
                data-projectclad-delete-project-cancel
              >
                Cancel
              </button>
            </div>
          </Form>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: proxyStylesText }} />
      {inlineStyles.map((css, index) => (
        <style key={index} dangerouslySetInnerHTML={{ __html: css }} />
      ))}
      <main
        className="project-clad-page project-clad-page--detail"
        data-theme={storefrontTheme || "default"}
      >
        <div className="page-width project-clad-container project-clad-container--full-width" data-projectclad-project-id={project.id}>
          {logoDataUrl && (
            <div className="project-clad-logo">
              <a href={getProjectsPath()} className="project-clad-logo__link">
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
                  <a key={i} href={btn.url} className="project-clad-button">
                    {btn.label}
                  </a>
                ))}
              </nav>
            </div>
            <div className="project-clad-header-meta">
              <span>Created {new Date(project.createdAt).toLocaleDateString()}</span>
              <span>PO Number: {project.poNumber || "—"}</span>
              <span>Company name: {project.companyName || "—"}</span>
            </div>
          </header>

          {!hideAddToCart && (() => {
            const projectLevelPending = approvalRequests.find(
              (r) => !r.approvedAt && !r.jobId && !r.itemId,
            );
            return projectLevelPending ? (
              <section
                className="project-clad-card project-clad-warning project-clad-approval-pending"
                style={{ marginBottom: "1.5rem" }}
              >
                <p style={{ margin: "0 0 0.75rem 0" }}>
                  <strong>Project approval pending</strong> — {project.name}
                </p>
                <div className="project-clad-approval-buttons">
                  <form
                    method="get"
                    action="/apps/project-clad/api/project-actions"
                    data-projectclad-ajax
                    data-projectclad-intent="approve"
                    data-projectclad-project-id={project.id}
                    className="project-clad-approval-btn"
                  >
                    <input type="hidden" name="approveJobId" value="" />
                    <input type="hidden" name="approveItemId" value="" />
                    <button type="submit" className="project-clad-button">
                      Approve
                    </button>
                    <span className="project-clad-muted project-clad-approval-msg" data-projectclad-form-message />
                  </form>
                  <div className="project-clad-approval-btn">
                    <button
                      type="button"
                      className="project-clad-button"
                      data-projectclad-reject-trigger
                      data-projectclad-project-id={project.id}
                      data-projectclad-job-id=""
                      data-projectclad-item-id=""
                    >
                      Reject
                    </button>
                    <span className="project-clad-muted project-clad-approval-msg" data-projectclad-reject-message />
                  </div>
                </div>
              </section>
            ) : null;
          })()}

          <section className="project-clad-section">
            <h2 className="project-clad-section-title">Orders</h2>
            {variantLookupError && (
              <p className="project-clad-muted">{variantLookupError}</p>
            )}
            {project.jobs.length === 0 ? (
              <p className="project-clad-muted">No orders saved yet.</p>
            ) : (
              <div className="project-clad-grid">
                {jobs.map((job) => {
                  const workOrderShellClass =
                    getJobApprovalInfo(job.id) &&
                    job.workOrderStatus !== "complete"
                      ? job.workOrderStatus === "in_progress"
                        ? "project-clad-work-order--in_progress"
                        : "project-clad-work-order--unread"
                      : "";
                  return (
                  <details
                    key={job.id}
                    id={`job-${job.id}`}
                    data-job-id={job.id}
                    open={selectedJobId === job.id}
                    className={
                      [
                        "project-clad-card",
                        "project-clad-details",
                        canEdit && "project-clad-draggable",
                        !hideAddToCart && getApprovalStatus(job.id, "") === "awaiting" && "project-clad-approval-pending",
                        workOrderShellClass,
                      ]
                        .filter(Boolean)
                        .join(" ")
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
                          <h3 className="project-clad-title">
                            {job.name}
                            {!hideAddToCart && getApprovalStatus(job.id, "") === "awaiting" && (
                              <span className="project-clad-muted" style={{ fontWeight: 600, marginLeft: "0.5rem" }}>
                                — Confirming order
                              </span>
                            )}
                          </h3>
                          <input
                            type="text"
                            defaultValue={job.name}
                            data-projectclad-job-name-input
                            data-job-id={job.id}
                            data-original-job-name={job.name}
                            placeholder="Order name"
                            aria-label="Order name"
                            className="project-clad-job-name-input"
                          />
                          <p className="project-clad-muted">
                            Created {new Date(job.createdAt).toLocaleDateString()} •{" "}
                            {job.isLocked ? "Locked" : "Editable"}
                            {(() => {
                              const approval = getJobApprovalInfo(job.id);
                              return approval ? (
                                <> • Order approved {new Date(approval.approvedAt).toLocaleDateString()} by {approval.approvedBy}</>
                              ) : null;
                            })()}
                          </p>
                          {getJobApprovalInfo(job.id) ? (
                            <p
                              className="project-clad-muted"
                              style={{ marginTop: "0.35rem" }}
                            >
                              {job.workOrderStatus === "complete" &&
                              job.completedAt
                                ? `Order completed on ${new Date(job.completedAt).toLocaleDateString()}`
                                : "Order in progress"}
                              {job.paidAt
                                ? ` · Paid on ${new Date(job.paidAt).toLocaleDateString()}`
                                : ""}
                            </p>
                          ) : null}
                        </div>
                        {hideAddToCart && (() => {
                          const status = getApprovalStatus(job.id, "");
                          if (status === "approved") {
                            return <span className="project-clad-muted">Order approved</span>;
                          }
                          const intent = status === "awaiting" ? "cancel-approval-request" : "submit-for-approval";
                          const label = status === "awaiting" ? "Confirming order" : "Send for review";
                          return (
                            <form
                              method="get"
                              action="/apps/project-clad/api/project-actions"
                              className="project-clad-inline-form"
                              data-projectclad-ajax
                              data-projectclad-intent={intent}
                              data-projectclad-project-id={project.id}
                              onPointerDownCapture={(event) => event.stopPropagation()}
                            >
                              <input type="hidden" name="jobId" value={job.id} />
                              <button
                                type="submit"
                                className="project-clad-button"
                              >
                                {label}
                              </button>
                              <span
                                className="project-clad-muted"
                                data-projectclad-form-message
                              />
                            </form>
                          );
                        })()}
                      </div>
                    </summary>
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
                                      <th>Product</th>
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
                                data-projectclad-item-row
                                data-item-id={item.id}
                                data-job-id={job.id}
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
                                <td>
                                  {(() => {
                                    const isUploadPart = item.displayName
                                      .toLowerCase()
                                      .includes("upload part");
                                    const href = isUploadPart
                                      ? item.imageUrl
                                      : item.productUrl;

                                    if (href) {
                                      return (
                                        <a
                                          href={href}
                                          target={isUploadPart ? "_blank" : undefined}
                                          rel={
                                            isUploadPart
                                              ? "noopener noreferrer"
                                              : undefined
                                          }
                                          className="project-clad-item-link"
                                          onClick={(event) => event.stopPropagation()}
                                        >
                                          {item.imageUrl ? (
                                            <img
                                              src={item.imageUrl}
                                              alt={item.imageAlt || item.displayName}
                                              className="project-clad-thumb"
                                            />
                                          ) : (
                                            <span className="project-clad-thumb project-clad-thumb--placeholder" />
                                          )}
                                          <span
                                            data-projectclad-item-name
                                            data-display-name={item.displayName}
                                          >
                                            {item.quantity === 0
                                              ? `${item.displayName} (Removed)`
                                              : item.displayName}
                                          </span>
                                        </a>
                                      );
                                    }

                                    return (
                                      <div className="project-clad-item-link">
                                        {item.imageUrl ? (
                                          <img
                                            src={item.imageUrl}
                                            alt={item.imageAlt || item.displayName}
                                            className="project-clad-thumb"
                                          />
                                        ) : (
                                          <span className="project-clad-thumb project-clad-thumb--placeholder" />
                                        )}
                                        <span
                                          data-projectclad-item-name
                                          data-display-name={item.displayName}
                                        >
                                          {item.quantity === 0
                                            ? `${item.displayName} (Removed)`
                                            : item.displayName}
                                        </span>
                                      </div>
                                    );
                                  })()}
                                  {item.properties && item.properties.length > 0 && (
                                    <div className="project-clad-item-properties" style={{ marginTop: "0.5rem" }}>
                                      {(() => {
                                        // Special handling for the calculator app payload
                                        const calcPayload = item.properties.find(
                                          (p) => p.name === "__ooCalcPayload",
                                        );
                                        if (calcPayload && calcPayload.value) {
                                          try {
                                            const parsed = JSON.parse(calcPayload.value);
                                            return Object.entries(parsed).map(([key, value], index) => (
                                              <div key={`calc-${index}`} style={{ marginTop: "0.25rem" }}>
                                                <strong>{key}:</strong> {String(value)}
                                              </div>
                                            ));
                                          } catch {
                                            // Fallback to showing the raw payload if JSON parse fails
                                            return (
                                              <div style={{ marginTop: "0.25rem" }}>
                                                <strong>Details:</strong> {calcPayload.value}
                                              </div>
                                            );
                                          }
                                        }

                                        // Generic fallback for other properties
                                        return item.properties
                                          .filter((p) => {
                                            if (
                                              !p.value ||
                                              p.value.trim() === "" ||
                                              p.name.startsWith("__oo")
                                            ) {
                                              return false;
                                            }
                                            // For the special Upload Part product, hide the File: row
                                            if (
                                              item.displayName.toLowerCase().includes("upload part") &&
                                              p.name.toLowerCase() === "file"
                                            ) {
                                              return false;
                                            }
                                            return true;
                                          })
                                          .map((prop, index) => {
                                            const v = prop.value.trim();
                                            if (v.startsWith("http://") || v.startsWith("https://")) {
                                              return (
                                                <div key={index} style={{ marginTop: "0.25rem" }}>
                                                  <strong>{prop.name}:</strong>
                                                  <div>
                                                    <img
                                                      src={v}
                                                      alt={prop.name}
                                                      style={{
                                                        maxWidth: "200px",
                                                        maxHeight: "200px",
                                                        display: "block",
                                                        marginTop: "0.25rem",
                                                      }}
                                                    />
                                                  </div>
                                                </div>
                                              );
                                            }
                                            return (
                                              <div key={index} style={{ marginTop: "0.25rem" }}>
                                                <strong>{prop.name}:</strong> {v}
                                              </div>
                                            );
                                          });
                                      })()}
                                    </div>
                                  )}
                                </td>
                                <td className="project-clad-table-right">
                                  <span className="project-clad-normal-view">{item.quantity}</span>
                                  <span className="project-clad-edit-view" style={{ display: "none" }}>
                                    <input
                                      type="number"
                                      min={0}
                                      defaultValue={item.quantity}
                                      data-original-qty={String(item.quantity)}
                                      data-projectclad-qty-input
                                      data-item-id={item.id}
                                      data-job-id={job.id}
                                      style={{ width: "4rem", padding: "0.25rem 0.5rem", fontSize: "16px" }}
                                    />
                                  </span>
                                </td>
                                <td
                                  className="project-clad-table-right"
                                  data-projectclad-price
                                  data-price={item.priceSnapshot}
                                >
                                  {pricingUnlocked ? (
                                    formatPrice(item.priceSnapshot)
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
                                    <div className="project-clad-stack">
                                      <div className="project-clad-normal-view" data-projectclad-item-actions>
                                        {!hideAddToCart && item.quantity > 0 && !isOrderAwaitingApproval(job.id) && (
                                          <div className="project-clad-actions" style={{ gap: "0.5rem" }}>
                                            <form method="post" action="/cart/add" style={{ display: "inline" }}>
                                              <input type="hidden" name="items[0][id]" value={item.variantId} />
                                              <input type="hidden" name="items[0][quantity]" value={item.quantity} />
                                              {item.properties?.map((p, i) => (
                                                <input key={i} type="hidden" name={`items[0][properties][${p.name}]`} value={p.value} />
                                              ))}
                                              <input type="hidden" name="return_to" value="/cart" />
                                              <button type="submit" className="project-clad-button">Add to cart</button>
                                            </form>
                                          </div>
                                        )}
                                      </div>
                                      <div className="project-clad-edit-view" style={{ display: "none" }} data-projectclad-item-actions>
                                        <Form
                                          method="post"
                                          action={`/apps/project-clad/project?id=${project.id}`}
                                          style={{ display: "inline" }}
                                          onSubmit={(e) => {
                                            if (!confirm("Are you sure you want to remove this item?")) {
                                              e.preventDefault();
                                            }
                                          }}
                                        >
                                          <input type="hidden" name="intent" value="delete-item" />
                                          <input type="hidden" name="itemId" value={item.id} />
                                          <button type="submit" className="project-clad-button">
                                            Remove
                                          </button>
                                        </Form>
                                      </div>
                                    </div>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        <tfoot>
                          <tr>
                            <td className="project-clad-table-right" colSpan={2}>
                              Subtotal
                            </td>
                            <td
                              className="project-clad-table-right"
                              data-projectclad-price
                              data-price={job.subtotal.toFixed(2)}
                            >
                              {pricingUnlocked ? (
                              formatPrice(job.subtotal.toFixed(2))
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
                            {canEdit && !job.isLocked && <td />}
                          </tr>
                        </tfoot>
                        </table>
                      )}
                    {job.paidAt && job.receiptSnapshot ? (
                      <div
                        className="project-clad-card project-clad-receipt"
                        style={{ marginTop: "1rem" }}
                      >
                        <h4 className="project-clad-title" style={{ marginTop: 0 }}>
                          Receipt
                          {job.orderName ? ` (${job.orderName})` : ""}
                        </h4>
                        {(() => {
                          const snap = job.receiptSnapshot;
                          if (!snap || typeof snap !== "object") {
                            return (
                              <p className="project-clad-muted">
                                Receipt details on file.
                              </p>
                            );
                          }
                          const r = snap as {
                            lines?: Array<{
                              title?: string;
                              quantity?: number;
                              unitPrice?: string;
                              lineTotal?: string;
                            }>;
                            subtotal?: string | null;
                            total?: string | null;
                          };
                          const lines = Array.isArray(r.lines) ? r.lines : [];
                          if (lines.length === 0) {
                            return (
                              <p className="project-clad-muted">
                                Paid {new Date(job.paidAt).toLocaleString()}
                              </p>
                            );
                          }
                          return (
                            <table className="project-clad-table">
                              <thead>
                                <tr>
                                  <th>Item</th>
                                  <th className="project-clad-table-right">Qty</th>
                                  <th className="project-clad-table-right">Unit</th>
                                  <th className="project-clad-table-right">Line</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lines.map((line, idx) => (
                                  <tr key={idx}>
                                    <td>{line.title || "—"}</td>
                                    <td className="project-clad-table-right">
                                      {line.quantity ?? "—"}
                                    </td>
                                    <td className="project-clad-table-right">
                                      {pricingUnlocked
                                        ? formatPrice(line.unitPrice || 0)
                                        : "—"}
                                    </td>
                                    <td className="project-clad-table-right">
                                      {pricingUnlocked
                                        ? formatPrice(line.lineTotal || 0)
                                        : "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              {(r.subtotal || r.total) && (
                                <tfoot>
                                  {r.subtotal ? (
                                    <tr>
                                      <td colSpan={3} className="project-clad-table-right">
                                        Subtotal
                                      </td>
                                      <td className="project-clad-table-right">
                                        {pricingUnlocked
                                          ? formatPrice(r.subtotal)
                                          : "—"}
                                      </td>
                                    </tr>
                                  ) : null}
                                  {r.total ? (
                                    <tr>
                                      <td colSpan={3} className="project-clad-table-right">
                                        <strong>Total</strong>
                                      </td>
                                      <td className="project-clad-table-right">
                                        <strong>
                                          {pricingUnlocked
                                            ? formatPrice(r.total)
                                            : "—"}
                                        </strong>
                                      </td>
                                    </tr>
                                  ) : null}
                                </tfoot>
                              )}
                            </table>
                          );
                        })()}
                      </div>
                    ) : null}
                    {!hideAddToCart && getApprovalStatus(job.id, "") === "awaiting" && (
                      <div className="project-clad-approval-buttons" style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #000" }}>
                        <form
                          method="get"
                          action="/apps/project-clad/api/project-actions"
                          data-projectclad-ajax
                          data-projectclad-intent="approve"
                          data-projectclad-project-id={project.id}
                          className="project-clad-approval-btn"
                        >
                          <input type="hidden" name="approveJobId" value={job.id} />
                          <input type="hidden" name="approveItemId" value="" />
                          <button type="submit" className="project-clad-button">
                            Approve
                          </button>
                          <span
                            className="project-clad-muted project-clad-approval-msg"
                            data-projectclad-form-message
                          />
                        </form>
                        <div className="project-clad-approval-btn">
                          <button
                            type="button"
                            className="project-clad-button"
                            data-projectclad-reject-trigger
                            data-projectclad-project-id={project.id}
                            data-projectclad-job-id={job.id}
                            data-projectclad-item-id=""
                          >
                            Reject
                          </button>
                          <span
                            className="project-clad-muted project-clad-approval-msg"
                            data-projectclad-reject-message
                          />
                        </div>
                      </div>
                    )}
                    {!isOrderAwaitingApproval(job.id) && (
                    <div
                      className="project-clad-actions project-clad-order-actions"
                      data-projectclad-order-section
                      data-job-id={job.id}
                      style={{ marginTop: "1rem", paddingTop: "1rem" }}
                    >
                      <div className="project-clad-normal-view">
                        {canEdit && !job.isLocked && (
                          <div className="project-clad-actions project-clad-order-actions-left" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
                            <button
                              type="button"
                              className="project-clad-button"
                              data-projectclad-edit-order
                              data-job-id={job.id}
                              data-project-id={project.id}
                            >
                              Edit order
                            </button>
                          </div>
                        )}
                        {!hideAddToCart && job.items.filter((i) => i.quantity > 0).length > 0 && (
                          <div className="project-clad-actions project-clad-order-actions-add-to-cart" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
                            <form method="post" action="/cart/add" style={{ display: "inline" }} onPointerDownCapture={(e) => e.stopPropagation()} data-projectclad-add-all-to-cart data-job-name={job.name} onSubmit={(e) => { e.preventDefault(); handleAddItemsClick(job, e.currentTarget as HTMLFormElement, "cart"); }}>
                              {job.items.filter((i) => i.quantity > 0).map((item, index) => (
                                <input key={`${job.id}-${item.variantId}`} type="hidden" name={`items[${index}][id]`} value={item.variantId} />
                              ))}
                              {job.items.filter((i) => i.quantity > 0).map((item, index) => (
                                <input key={`${job.id}-${item.variantId}-qty`} type="hidden" name={`items[${index}][quantity]`} value={item.quantity} />
                              ))}
                              {job.items.filter((i) => i.quantity > 0).map((item, index) =>
                                item.properties?.map((p, pi) => (
                                  <input key={`${job.id}-${item.variantId}-p-${pi}`} type="hidden" name={`items[${index}][properties][${p.name}]`} value={p.value} />
                                )),
                              )}
                              <input type="hidden" name="return_to" value="/cart" />
                              <button type="submit" className="project-clad-button" data-projectclad-add-all-btn>
                                Add all items to cart
                              </button>
                            </form>
                          </div>
                        )}
                      </div>
                      <div className="project-clad-edit-view project-clad-actions" style={{ display: "none" }}>
                        <button
                          type="button"
                          className="project-clad-button"
                          data-projectclad-delete-order-btn
                          data-job-id={job.id}
                        >
                          Delete order
                        </button>
                        <button
                          type="button"
                          className="project-clad-button"
                          data-projectclad-edit-order
                          data-job-id={job.id}
                          data-project-id={project.id}
                        >
                          Back
                        </button>
                      </div>
                    </div>
                    )}
                    </div>
                  </details>
                );
                })}
              </div>
            )}
          </section>

          <section className="project-clad-section">
            <div className="project-clad-card project-clad-card--no-border">
              <div className="project-clad-summary-row">
                <div>
                  <h2 className="project-clad-title">Project subtotal</h2>
                </div>
                <div
                  className="project-clad-summary-action"
                  data-projectclad-price
                  data-price={project.subtotal.toFixed(2)}
                >
                  {pricingUnlocked ? (
                    formatPrice(project.subtotal.toFixed(2))
                  ) : (
                    <button
                      type="button"
                      className="project-clad-hidden-link"
                      data-projectclad-show-price
                    >
                      Hidden
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="project-clad-section">
            <h2 className="project-clad-section-title">Activity &amp; comments</h2>
            <div className="project-clad-card">
              <Form
                method="post"
                action={`${storefrontProjectActionPath}?id=${encodeURIComponent(project.id)}`}
                style={{ marginBottom: "1rem" }}
              >
                <input type="hidden" name="id" value={project.id} />
                <input type="hidden" name="intent" value="add-comment" />
                <label className="project-clad-muted" style={{ display: "block", marginBottom: "0.35rem" }}>
                  Add a comment
                </label>
                <textarea
                  name="body"
                  className="project-clad-reject-textarea"
                  rows={3}
                  required
                  style={{ width: "100%", maxWidth: "100%", fontSize: "16px" }}
                />
                <button type="submit" className="project-clad-button" style={{ marginTop: "0.5rem" }}>
                  Post
                </button>
              </Form>
              {projectTimeline.length === 0 ? (
                <p className="project-clad-muted">No activity yet.</p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {projectTimeline.map((item) =>
                    item.kind === "activity" ? (
                      <li
                        key={`a-${item.id}`}
                        className="project-clad-activity-item"
                        style={{
                          padding: "0.75rem 0",
                          borderBottom: "1px solid rgba(0,0,0,0.12)",
                        }}
                      >
                        <div className="project-clad-muted" style={{ fontSize: "0.9em" }}>
                          {new Date(item.createdAt).toLocaleString()}
                          {item.actorLabel ? ` · ${item.actorLabel}` : ""}
                          {item.visibility === "admin" && viewerIsAdmin ? (
                            <span className="project-clad-activity-badge"> Internal</span>
                          ) : null}
                        </div>
                        <div style={{ marginTop: "0.25rem" }}>
                          {formatActivityLine(item)}
                        </div>
                      </li>
                    ) : (
                      <li
                        key={`c-${item.id}`}
                        style={{
                          padding: "0.75rem 0",
                          borderBottom: "1px solid rgba(0,0,0,0.12)",
                        }}
                      >
                        {item.deletedAt ? (
                          <p className="project-clad-muted" style={{ fontStyle: "italic", margin: 0 }}>
                            Comment deleted
                            {item.deletedByLabel ? ` by ${item.deletedByLabel}` : ""}.
                          </p>
                        ) : (
                          <>
                            <div className="project-clad-muted" style={{ fontSize: "0.9em" }}>
                              {item.authorLabel} · {new Date(item.createdAt).toLocaleString()}
                            </div>
                            <p style={{ margin: "0.35rem 0 0", whiteSpace: "pre-wrap" }}>
                              {item.body}
                            </p>
                            {item.authorCustomerId === currentCustomerId ? (
                              <Form
                                method="post"
                                action={`${storefrontProjectActionPath}?id=${encodeURIComponent(project.id)}`}
                                onSubmit={(e) => {
                                  if (!confirm("Delete this comment?")) {
                                    e.preventDefault();
                                  }
                                }}
                                style={{ marginTop: "0.5rem" }}
                              >
                                <input type="hidden" name="id" value={project.id} />
                                <input type="hidden" name="intent" value="delete-comment" />
                                <input type="hidden" name="commentId" value={item.id} />
                                <button type="submit" className="project-clad-button">
                                  Delete
                                </button>
                              </Form>
                            ) : null}
                          </>
                        )}
                      </li>
                    ),
                  )}
                </ul>
              )}
            </div>
          </section>

          <script
            dangerouslySetInnerHTML={{
              __html: `
(() => {
  if (window.__pcShareCopyInitialized) return;
  window.__pcShareCopyInitialized = true;
  const actionsEndpoint = '/apps/project-clad/api/project-actions';

  document.addEventListener('click', async (event) => {
    const btn = event.target?.closest?.('button[data-projectclad-add-all-btn]');
    if (!btn) return;
    const form = btn.closest('form[data-projectclad-add-all-to-cart]');
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    try {
      const res = await fetch('/cart.js', { headers: { Accept: 'application/json' } });
      const cart = res.ok ? await res.json() : {};
      if ((cart.item_count || 0) > 0) {
        const jobName = form.getAttribute('data-job-name') || 'this order';
        if (!confirm('Your cart already has items. Add all items from "' + jobName + '" to your existing cart?')) return;
      }
      form.submit();
    } catch (e) {
      form.submit();
    }
  }, true);
  const memberMessage = document.querySelector('[data-projectclad-member-message]');
  const setMemberMessage = (text) => {
    if (memberMessage) {
      memberMessage.textContent = text || '';
    }
  };
  const revealPricing = () => {
    document.querySelectorAll('[data-projectclad-price]').forEach((cell) => {
      const value = cell.getAttribute('data-price');
      if (value) {
        cell.textContent = value;
      }
    });
    const pricingModal = document.querySelector('[data-projectclad-pricing-modal-backdrop]');
    if (pricingModal instanceof HTMLElement) {
      pricingModal.style.display = 'none';
    }
  };
  const rejectModal = document.querySelector('[data-projectclad-reject-modal]');
  const rejectForm = document.querySelector('[data-projectclad-reject-form]');
  const rejectReasonInput = document.getElementById('reject-reason');
  let rejectProjectId = '';
  let rejectJobId = '';
  let rejectItemId = '';
  let rejectMessageSpan = null;

  let editingJobId = null;
  let editRemovedItemIds = {};
  let editPendingDeleteJobId = null;
  let editSnapshotItems = {};

  document.addEventListener('input', (event) => {
    const qtyInput = event.target?.closest?.('[data-projectclad-qty-input]');
    if (qtyInput instanceof HTMLInputElement && editingJobId) {
      const itemId = qtyInput.getAttribute('data-item-id') || '';
      const jobId = qtyInput.getAttribute('data-job-id') || '';
      const val = parseInt(qtyInput.value, 10);
      const row = document.querySelector('[data-projectclad-item-row][data-item-id="' + itemId + '"]');
      const nameSpan = row?.querySelector('[data-projectclad-item-name]');
      const displayName = nameSpan?.getAttribute('data-display-name') || '';
      if (isNaN(val) || val <= 0) {
        if (!editRemovedItemIds[jobId]) editRemovedItemIds[jobId] = [];
        if (!editRemovedItemIds[jobId].includes(itemId)) editRemovedItemIds[jobId].push(itemId);
        if (nameSpan) nameSpan.textContent = displayName + ' (Removed)';
        qtyInput.value = '0';
      } else {
        editRemovedItemIds[jobId] = (editRemovedItemIds[jobId] || []).filter(id => id !== itemId);
        if (nameSpan) nameSpan.textContent = displayName;
      }
    }
  });

  document.addEventListener('change', (event) => {
    const qtyInput = event.target?.closest?.('[data-projectclad-qty-input]');
    if (qtyInput instanceof HTMLInputElement && editingJobId) {
      const val = parseInt(qtyInput.value, 10);
      if (isNaN(val) || val < 0) qtyInput.value = '0';
    }
  });

  document.addEventListener('focus', (event) => {
    const qtyInput = event.target?.closest?.('[data-projectclad-qty-input]');
    if (qtyInput instanceof HTMLInputElement) {
      qtyInput.select();
    }
  }, true);

  document.addEventListener('pointerdown', (event) => {
    const deleteOrderBtn = event.target?.closest?.('[data-projectclad-delete-order-btn]');
    if (deleteOrderBtn instanceof HTMLElement && editingJobId && !deleteOrderBtn.disabled) {
      event.preventDefault();
      event.stopPropagation();
      const jobId = deleteOrderBtn.getAttribute('data-job-id') || '';
      if (editPendingDeleteJobId === jobId) return;
      if (confirm('This order will be permanently deleted. Are you sure?')) {
        editPendingDeleteJobId = jobId;
        const details = document.querySelector('details[data-job-id="' + jobId + '"]');
        if (details) {
          details.classList.add('project-clad-pending-delete');
          deleteOrderBtn.textContent = 'Deleting';
          deleteOrderBtn.disabled = true;
        }
      }
    }
  }, true);

  document.addEventListener('click', (event) => {
    const editOrderBtn = event.target?.closest?.('[data-projectclad-edit-order]');
    if (editOrderBtn instanceof HTMLElement) {
      event.preventDefault();
      event.stopPropagation();
      const jobId = editOrderBtn.getAttribute('data-job-id') || '';
      const projectId = editOrderBtn.getAttribute('data-project-id') || '';
      const details = document.querySelector('details[data-job-id="' + jobId + '"]');
      if (!details) return;
      if (editingJobId === jobId) {
        const saveModal = document.querySelector('[data-projectclad-edit-save-modal]');
        if (saveModal instanceof HTMLElement) {
          saveModal.dataset.pendingJobId = jobId;
          saveModal.style.display = 'flex';
        }
      } else {
        editingJobId = jobId;
        editRemovedItemIds[jobId] = [];
        editPendingDeleteJobId = null;
        const rows = details.querySelectorAll('[data-projectclad-item-row]');
        editSnapshotItems[jobId] = Array.from(rows).map(r => r.getAttribute('data-item-id')).filter(Boolean);
        details.classList.add('project-clad-edit-mode');
      }
    }
    const showPriceBtn = event.target?.closest?.('[data-projectclad-show-price]');
    if (showPriceBtn instanceof HTMLElement) {
      event.preventDefault();
      const pricingModal = document.querySelector('[data-projectclad-pricing-modal-backdrop]');
      const passwordInput = pricingModal?.querySelector?.('input[name="password"]');
      if (pricingModal instanceof HTMLElement) {
        pricingModal.style.display = 'flex';
        const msg = pricingModal.querySelector('[data-projectclad-form-message]');
        if (msg) msg.textContent = '';
        if (passwordInput instanceof HTMLInputElement) {
          passwordInput.value = '';
          setTimeout(function() { passwordInput.focus(); }, 50);
        }
      }
    }
    const pricingModalCancel = event.target?.closest?.('[data-projectclad-pricing-modal-cancel]');
    const pricingModalBackdrop = event.target?.closest?.('[data-projectclad-pricing-modal-backdrop]');
    if (pricingModalCancel || event.target === pricingModalBackdrop) {
      const pm = document.querySelector('[data-projectclad-pricing-modal-backdrop]');
      if (pm instanceof HTMLElement) pm.style.display = 'none';
    }
    const btn = event.target?.closest?.('[data-projectclad-reject-trigger]');
    if (btn instanceof HTMLElement) {
      event.preventDefault();
      rejectProjectId = btn.getAttribute('data-projectclad-project-id') || '';
      rejectJobId = btn.getAttribute('data-projectclad-job-id') || '';
      rejectItemId = btn.getAttribute('data-projectclad-item-id') || '';
      rejectMessageSpan = btn.closest('.project-clad-approval-buttons')?.querySelector('[data-projectclad-reject-message]') || null;
      if (rejectModal instanceof HTMLElement) {
        rejectModal.style.display = 'flex';
        if (rejectReasonInput instanceof HTMLTextAreaElement) {
          rejectReasonInput.value = '';
          setTimeout(() => rejectReasonInput.focus(), 50);
        }
      }
    }
    if (event.target?.closest?.('[data-projectclad-reject-cancel]') || event.target === rejectModal) {
      if (rejectModal instanceof HTMLElement) rejectModal.style.display = 'none';
    }
    const editSaveClose = event.target?.closest?.('[data-projectclad-edit-save-close]');
    if (editSaveClose) {
      const m = document.querySelector('[data-projectclad-edit-save-modal]');
      if (m instanceof HTMLElement) m.style.display = 'none';
    }
    const editSaveModal = document.querySelector('[data-projectclad-edit-save-modal]');
    if (event.target === editSaveModal) {
      if (editSaveModal instanceof HTMLElement) editSaveModal.style.display = 'none';
    }
  });

  document.addEventListener('click', async (event) => {
    const editSaveYes = event.target?.closest?.('[data-projectclad-edit-save-yes]');
    if (editSaveYes) {
      const modal = document.querySelector('[data-projectclad-edit-save-modal]');
      const jobId = modal?.getAttribute?.('data-pending-job-id') || '';
      const projectId = new URLSearchParams(window.location.search).get('id') || document.querySelector('.project-clad-container')?.getAttribute?.('data-projectclad-project-id') || '';
      if (!jobId || !projectId) return;
      const details = document.querySelector('details[data-job-id="' + jobId + '"]');
      const deleteJob = editPendingDeleteJobId === jobId;
      const itemUpdates = [];
      const qtyInputs = details?.querySelectorAll?.('[data-projectclad-qty-input]') || [];
      qtyInputs.forEach(function(inp) {
        const itemId = inp.getAttribute('data-item-id');
        const qty = parseInt(inp.value, 10);
        if (itemId && !isNaN(qty) && qty >= 0) {
          itemUpdates.push({ itemId: itemId, quantity: qty });
        }
      });
      let jobName = '';
      const nameInput = details?.querySelector?.('[data-projectclad-job-name-input]');
      if (nameInput instanceof HTMLInputElement) {
        jobName = nameInput.value.trim();
      }
      try {
        const res = await fetch('/apps/project-clad/project?id=' + encodeURIComponent(projectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intent: 'save-order-edit', jobId, jobName: jobName, removeItemIds: [], itemUpdates: itemUpdates, deleteJob: deleteJob }),
          credentials: 'include',
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok && payload?.redirectTo) {
          window.location.href = payload.redirectTo;
          return;
        }
        window.location.reload();
      } catch (e) {
        console.error(e);
      }
    }
    const editSaveNo = event.target?.closest?.('[data-projectclad-edit-save-no]');
    if (editSaveNo) {
      const modal = document.querySelector('[data-projectclad-edit-save-modal]');
      const jobId = modal?.getAttribute?.('data-pending-job-id') || '';
      if (jobId) {
        const details = document.querySelector('details[data-job-id="' + jobId + '"]');
        if (details) {
          details.classList.remove('project-clad-edit-mode', 'project-clad-pending-delete');
          const nameSpans = details.querySelectorAll('[data-projectclad-item-name]');
          nameSpans.forEach(function(span) {
            const name = span.getAttribute('data-display-name');
            if (name) span.textContent = name;
          });
          const qtyInputs = details.querySelectorAll('[data-projectclad-qty-input]');
          qtyInputs.forEach(function(inp) {
            const orig = inp.getAttribute('data-original-qty');
            if (orig !== null) inp.value = orig;
          });
          const nameInput = details.querySelector('[data-projectclad-job-name-input]');
          if (nameInput instanceof HTMLInputElement) {
            const origName = nameInput.getAttribute('data-original-job-name');
            if (origName !== null) nameInput.value = origName;
          }
        }
        const deleteBtn = details?.querySelector('[data-projectclad-delete-order-btn]');
        if (deleteBtn) {
          deleteBtn.textContent = 'Delete order';
          deleteBtn.disabled = false;
        }
        editingJobId = null;
        editRemovedItemIds[jobId] = [];
        editPendingDeleteJobId = null;
      }
      if (modal instanceof HTMLElement) modal.style.display = 'none';
    }
  });

  if (rejectForm instanceof HTMLFormElement) {
    rejectForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const errEl = rejectForm.querySelector('[data-projectclad-reject-form-error]');
      if (errEl) errEl.textContent = '';
      const reason = rejectReasonInput instanceof HTMLTextAreaElement ? rejectReasonInput.value.trim() : '';
      try {
        const res = await fetch(actionsEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intent: 'cancel-approval-request',
            projectId: rejectProjectId,
            jobId: rejectJobId,
            itemId: rejectItemId,
            rejectReason: reason,
          }),
          credentials: 'include',
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || payload.error) {
          if (payload?.redirectTo) {
            window.location.href = payload.redirectTo;
            return;
          }
          if (errEl) errEl.textContent = payload.error || 'Unable to reject.';
          return;
        }
        if (rejectModal instanceof HTMLElement) rejectModal.style.display = 'none';
        if (rejectMessageSpan) rejectMessageSpan.textContent = 'Order rejected.';
        window.location.reload();
      } catch {
        if (errEl) errEl.textContent = 'Unable to complete action.';
      }
    });
  }

  document.addEventListener('click', (event) => {
    const editProjectBtn = event.target?.closest?.('[data-projectclad-edit-project-details]');
    if (editProjectBtn instanceof HTMLElement) {
      event.preventDefault();
      const modal = document.querySelector('[data-projectclad-edit-project-modal]');
      if (modal instanceof HTMLElement) modal.style.display = 'flex';
    }
    const editProjectCancel = event.target?.closest?.('[data-projectclad-edit-project-cancel]');
    if (editProjectCancel) {
      const modal = document.querySelector('[data-projectclad-edit-project-modal]');
      if (modal instanceof HTMLElement) modal.style.display = 'none';
    }
    if (event.target?.closest?.('[data-projectclad-edit-project-modal]') === event.target) {
      const modal = document.querySelector('[data-projectclad-edit-project-modal]');
      if (modal instanceof HTMLElement) modal.style.display = 'none';
    }

    const deleteProjectOpen = event.target?.closest?.('[data-projectclad-delete-project-open]');
    if (deleteProjectOpen instanceof HTMLElement) {
      event.preventDefault();
      const modal = document.querySelector('[data-projectclad-delete-project-modal]');
      if (modal instanceof HTMLElement) modal.style.display = 'flex';
    }
    const deleteProjectCancel = event.target?.closest?.('[data-projectclad-delete-project-cancel]');
    if (deleteProjectCancel) {
      const modal = document.querySelector('[data-projectclad-delete-project-modal]');
      if (modal instanceof HTMLElement) modal.style.display = 'none';
    }
    const deleteProjectBackdrop = event.target?.closest?.('[data-projectclad-delete-project-modal]');
    if (deleteProjectBackdrop && deleteProjectBackdrop === event.target) {
      const modal = document.querySelector('[data-projectclad-delete-project-modal]');
      if (modal instanceof HTMLElement) modal.style.display = 'none';
    }
  }, true);

  document.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.hasAttribute('data-projectclad-reject-form')) return;
    if (!form.hasAttribute('data-projectclad-ajax')) return;
    event.preventDefault();
    const messageNode = form.querySelector('[data-projectclad-form-message]');
    const setFormMessage = (text) => {
      if (messageNode) {
        messageNode.textContent = text || '';
      } else if (form.hasAttribute('data-projectclad-member-form')) {
        setMemberMessage(text);
      }
    };
    setFormMessage('');

    const intent = form.getAttribute('data-projectclad-intent') || '';
    const projectId = form.getAttribute('data-projectclad-project-id') || '';

    if (intent === 'delete-job' && !confirm('Are you sure you want to delete this order?')) {
      return;
    }
    if (intent === 'delete-item' && !confirm('Are you sure you want to remove this item?')) {
      return;
    }
    const memberCustomerId =
      form.getAttribute('data-projectclad-member-id') || '';

    const params = new URLSearchParams({ intent, projectId });
    const passwordInput = form.querySelector('input[name="password"]');
    const jobNameInput = form.querySelector('input[name="jobName"]');
    const jobIdInput = form.querySelector('input[name="jobId"]');
    const itemIdInput = form.querySelector('input[name="itemId"]');
    const approveJobIdInput = form.querySelector('input[name="approveJobId"]');
    const approveItemIdInput = form.querySelector('input[name="approveItemId"]');
    const emailInput = form.querySelector('input[name="email"]');
    const roleSelect = form.querySelector('select[name="role"]');

    if (passwordInput instanceof HTMLInputElement) {
      params.set('password', passwordInput.value.trim());
    }
    if (jobNameInput instanceof HTMLInputElement) {
      params.set('jobName', jobNameInput.value.trim());
    }
    if (jobIdInput instanceof HTMLInputElement) {
      params.set('jobId', jobIdInput.value);
    }
    if (itemIdInput instanceof HTMLInputElement) {
      params.set('itemId', itemIdInput.value);
    }
    if (approveJobIdInput instanceof HTMLInputElement) {
      params.set('approveJobId', approveJobIdInput.value);
    }
    if (approveItemIdInput instanceof HTMLInputElement) {
      params.set('approveItemId', approveItemIdInput.value);
    }
    if (emailInput instanceof HTMLInputElement) {
      params.set('email', emailInput.value.trim());
    }
    if (roleSelect instanceof HTMLSelectElement) {
      params.set('role', roleSelect.value);
    }
    if (memberCustomerId) {
      params.set('memberCustomerId', memberCustomerId);
    }

    try {
      const response = await fetch(actionsEndpoint + '?' + params.toString(), { credentials: 'include' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (payload?.redirectTo) {
          window.location.href = payload.redirectTo;
          return;
        }
        setFormMessage(payload.error || 'Unable to complete action.');
        return;
      }
      if (payload?.error) {
        setFormMessage(payload.error);
        return;
      }
      if (payload?.pricingUnlocked) {
        document.cookie = '${PRICING_COOKIE}; Path=/; Max-Age=3600; SameSite=Lax';
        revealPricing();
        return;
      }
      if (payload?.shareLink) {
        const fullUrl = 'https://${shop}' + payload.shareLink;
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(fullUrl);
          }
        } catch {}
        const shareBtn = document.querySelector('[data-projectclad-share-submit]');
        if (shareBtn instanceof HTMLElement) {
          shareBtn.textContent = 'Link Added to Clipboard';
        }
        return;
      }
      if ((intent === 'submit-for-approval' || intent === 'cancel-approval-request') && payload?.ok) {
        setFormMessage(intent === 'submit-for-approval' ? 'Approval request sent.' : 'Approval request cancelled.');
        window.location.reload();
        return;
      }
      if (intent === 'approve' && payload?.ok) {
        const url = new URL(window.location.href);
        url.searchParams.delete('approve');
        url.searchParams.delete('approveJobId');
        url.searchParams.delete('approveItemId');
        window.location.href = url.toString();
        return;
      }
      window.location.reload();
    } catch {
      setFormMessage('Unable to complete action.');
    }
  });
})();
              `,
            }}
          />

          {canEdit && (
            <section className="project-clad-section">
              <div className="project-clad-card project-clad-card--no-border">
                <div className="project-clad-actions project-clad-project-settings-actions" style={{ flexWrap: "wrap", gap: "1rem" }}>
                  <button
                    type="button"
                    className="project-clad-button"
                    data-projectclad-edit-project-details
                  >
                    Edit project details
                  </button>
                </div>
              </div>
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
