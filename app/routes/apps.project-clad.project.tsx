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
import { getAdminVariantInfo } from "../utils/adminVariants.server";
import {
  findCustomerIdByEmail,
  getCustomersByIds,
} from "../utils/adminCustomers.server";
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
};

type JobView = {
  id: string;
  name: string;
  createdAt: string;
  isLocked: boolean;
  items: JobItemView[];
  subtotal: number;
};

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

const getProjectPath = (projectId: string) =>
  `/apps/project-clad/project?id=${encodeURIComponent(projectId)}`;

const getProjectsPath = () => "/apps/project-clad/projects";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, customerId } = requireAppProxyCustomer(request);
  const themeStyles = await getThemeStyles(shop);
  const settings = await prisma.shopSettings.findUnique({
    where: { shop },
  });
  const projectId = getProjectId(request);

  if (!projectId) {
    return redirect(getProjectsPath());
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
    variantInfo = await getAdminVariantInfo(shop, variantIds);
  } catch (error) {
    variantLookupError =
      error instanceof Error ? error.message : "Product lookup failed.";
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
    (t) => String(t).trim().toUpperCase() === "NA",
  );

  const approvalRequests = await prisma.approvalRequest.findMany({
    where: { projectId },
  });

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

        return {
          id: item.id,
          variantId: item.variantId,
          quantity: item.quantity,
          priceSnapshot: item.priceSnapshot.toString(),
          displayName,
          imageUrl: info?.imageUrl || null,
          imageAlt: info?.imageAlt || null,
          productUrl,
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
    memberLookupError,
    variantLookupError,
    themeStyles,
    shop,
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

export const action = async ({ request }: ActionFunctionArgs) => {
  const contentType = request.headers.get("Content-Type") || "";
  const isJsonRequest = contentType.includes("application/json");
  const { shop, customerId } = requireAppProxyCustomer(request, {
    jsonOnFail: isJsonRequest,
  });
  const projectId = getProjectId(request);

  if (!projectId) {
    return new Response("Project not found", { status: 404 });
  }

  if (contentType.includes("application/json")) {
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

      return redirect(getProjectPath(projectId));
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
  const isOwner = project.ownerCustomerId === customerId;
  const canEdit = isOwner || memberRole === "edit";

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

    return redirect(getProjectPath(projectId));
  }

  if (intent === "delete-job") {
    if (!canEdit) {
      throw new Response("Forbidden", { status: 403 });
    }

    const jobId = String(formData.get("jobId") || "");
    if (!jobId) {
      return redirect(getProjectPath(projectId));
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

    return redirect(getProjectPath(projectId));
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

    return redirect(getProjectPath(projectId));
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

    return redirect(getProjectPath(projectId));
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

    return redirect(getProjectPath(projectId));
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
    if (!isOwner) {
      return Response.json(
        { memberError: "Only the project owner can add members." },
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

    return redirect(getProjectPath(projectId));
  }

  if (intent === "remove-member") {
    if (!isOwner) {
      return redirect(getProjectPath(projectId));
    }

    const memberCustomerId = String(formData.get("memberCustomerId") || "");
    if (!memberCustomerId || memberCustomerId === project.ownerCustomerId) {
      return redirect(getProjectPath(projectId));
    }

    await prisma.projectMember.deleteMany({
      where: {
        projectId,
        customerId: memberCustomerId,
      },
    });

    return redirect(getProjectPath(projectId));
  }

  if (intent === "update-project-details") {
    if (!canEdit) {
      throw new Response("Forbidden", { status: 403 });
    }

    const name = String(formData.get("projectName") || "").trim();
    const poNumber = String(formData.get("poNumber") || "").trim() || null;
    const companyName = String(formData.get("companyName") || "").trim() || null;

    if (!name) {
      return redirect(getProjectPath(projectId));
    }

    await prisma.project.update({
      where: { id: projectId },
      data: { name, poNumber, companyName },
    });

    return redirect(getProjectPath(projectId));
  }

  if (intent === "unlock-pricing") {
    const password = String(formData.get("password") || "").trim();
    const settings = await prisma.shopSettings.findUnique({
      where: { shop },
    });

    if (!settings?.pricingPasswordHash || !settings.pricingPasswordSalt) {
      return redirect(getProjectPath(projectId));
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
    hideAddToCart,
    approvalRequests,
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
    const lineItems = items.map((item) => ({
      id: item.variantId,
      quantity: item.quantity,
    }));

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
          <h2 id="edit-project-modal-title">Edit project details</h2>
          <Form
            method="post"
            action={`https://${shop}/apps/project-clad/project?id=${project.id}`}
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
      <style dangerouslySetInnerHTML={{ __html: proxyStylesText }} />
      {inlineStyles.map((css, index) => (
        <style key={index} dangerouslySetInnerHTML={{ __html: css }} />
      ))}
      <main
        className="project-clad-page"
        data-theme={storefrontTheme || "default"}
      >
        <div className="page-width project-clad-container" data-projectclad-project-id={project.id}>
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
                    className={`project-clad-button ${i === 0 ? "project-clad-button--projects" : ""}`}
                  >
                    {btn.label}
                  </a>
                ))}
              </nav>
            </div>
            <p className="project-clad-muted">
              Created {new Date(project.createdAt).toLocaleDateString()} • PO Number:{" "}
              {project.poNumber || "—"} • Company name: {project.companyName || "—"}
            </p>
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
            {canEdit && (
                      <Form
                        method="post"
                        action={`https://${shop}/apps/project-clad/project?id=${project.id}`}
                        className="project-clad-inline-form"
                data-projectclad-ajax
                data-projectclad-intent="create-job"
                data-projectclad-project-id={project.id}
                      >
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
                <span
                  className="project-clad-muted"
                  data-projectclad-form-message
                >
                  {jobError || ""}
                </span>
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
                    data-job-id={job.id}
                    open={selectedJobId === job.id}
                    className={
                      [
                        "project-clad-card",
                        "project-clad-details",
                        canEdit && "project-clad-draggable",
                        !hideAddToCart && getApprovalStatus(job.id, "") === "awaiting" && "project-clad-approval-pending",
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
                          <p className="project-clad-muted">
                            Created {new Date(job.createdAt).toLocaleDateString()} •{" "}
                            {job.isLocked ? "Locked" : "Editable"}
                            {(() => {
                              const approval = getJobApprovalInfo(job.id);
                              return approval ? (
                                <> • Order received {new Date(approval.approvedAt).toLocaleDateString()} by {approval.approvedBy}</>
                              ) : null;
                            })()}
                          </p>
                        </div>
                        {hideAddToCart && (() => {
                          const status = getApprovalStatus(job.id, "");
                          if (status === "approved") {
                            return <span className="project-clad-muted">Order received</span>;
                          }
                          const intent = status === "awaiting" ? "cancel-approval-request" : "submit-for-approval";
                          const label = status === "awaiting" ? "Confirming order" : "Send to shop";
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
                                          {item.productUrl ? (
                                            <a
                                              href={item.productUrl}
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
                                              <span data-projectclad-item-name data-display-name={item.displayName}>{item.quantity === 0 ? `${item.displayName} (Removed)` : item.displayName}</span>
                                            </a>
                                          ) : (
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
                                              <span data-projectclad-item-name data-display-name={item.displayName}>{item.quantity === 0 ? `${item.displayName} (Removed)` : item.displayName}</span>
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
                                    <div className="project-clad-stack">
                                      <div className="project-clad-normal-view" data-projectclad-item-actions>
                                        {!hideAddToCart && item.quantity > 0 && !isOrderAwaitingApproval(job.id) && (
                                          <div className="project-clad-actions" style={{ gap: "0.5rem" }}>
                                            <form method="post" action="/cart/add" style={{ display: "inline" }}>
                                              <input type="hidden" name="items[0][id]" value={item.variantId} />
                                              <input type="hidden" name="items[0][quantity]" value={item.quantity} />
                                              <input type="hidden" name="return_to" value="/cart" />
                                              <button type="submit" className="project-clad-button">Add to cart</button>
                                            </form>
                                            <form method="post" action="/cart/add" style={{ display: "inline" }}>
                                              <input type="hidden" name="items[0][id]" value={item.variantId} />
                                              <input type="hidden" name="items[0][quantity]" value={item.quantity} />
                                              <input type="hidden" name="return_to" value="/checkout" />
                                              <button type="submit" className="project-clad-button">Proceed to checkout</button>
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
                                job.subtotal.toFixed(2)
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
                    {!hideAddToCart && getApprovalStatus(job.id, "") === "awaiting" && (
                      <div className="project-clad-approval-buttons" style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid rgba(0,0,0,0.08)" }}>
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
                      style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid rgba(0,0,0,0.08)" }}
                    >
                      <div className="project-clad-normal-view">
                        {!hideAddToCart && job.items.filter((i) => i.quantity > 0).length > 0 && (
                          <div className="project-clad-actions" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
                            <form method="post" action="/cart/add" style={{ display: "inline" }} onPointerDownCapture={(e) => e.stopPropagation()}>
                              {job.items.filter((i) => i.quantity > 0).map((item, index) => (
                                <input key={`${job.id}-${item.variantId}`} type="hidden" name={`items[${index}][id]`} value={item.variantId} />
                              ))}
                              {job.items.filter((i) => i.quantity > 0).map((item, index) => (
                                <input key={`${job.id}-${item.variantId}-qty`} type="hidden" name={`items[${index}][quantity]`} value={item.quantity} />
                              ))}
                              <input type="hidden" name="return_to" value="/cart" />
                              <button type="submit" className="project-clad-button">
                                Add to cart
                              </button>
                            </form>
                            <form method="post" action="/cart/add" style={{ display: "inline" }} onPointerDownCapture={(e) => e.stopPropagation()}>
                              {job.items.filter((i) => i.quantity > 0).map((item, index) => (
                                <input key={`${job.id}-checkout-${item.variantId}`} type="hidden" name={`items[${index}][id]`} value={item.variantId} />
                              ))}
                              {job.items.filter((i) => i.quantity > 0).map((item, index) => (
                                <input key={`${job.id}-checkout-${item.variantId}-qty`} type="hidden" name={`items[${index}][quantity]`} value={item.quantity} />
                              ))}
                              <input type="hidden" name="return_to" value="/checkout" />
                              <button type="submit" className="project-clad-button">
                                Proceed to checkout
                              </button>
                            </form>
                          </div>
                        )}
                        {canEdit && !job.isLocked && (
                          <>
                            <button
                              type="button"
                              className="project-clad-button"
                              data-projectclad-edit-order
                              data-job-id={job.id}
                              data-project-id={project.id}
                            >
                              Edit order
                            </button>
                            <Form
                              method="post"
                              action={`/apps/project-clad/project?id=${project.id}`}
                              style={{ display: "inline" }}
                              onSubmit={(e) => {
                                if (!confirm("Are you sure you want to delete this order? This cannot be undone.")) {
                                  e.preventDefault();
                                }
                              }}
                            >
                              <input type="hidden" name="intent" value="delete-job" />
                              <input type="hidden" name="jobId" value={job.id} />
                              <button type="submit" className="project-clad-button">
                                Delete order
                              </button>
                            </Form>
                          </>
                        )}
                      </div>
                      <div className="project-clad-edit-view project-clad-actions" style={{ display: "none" }}>
                        <button
                          type="button"
                          className="project-clad-button"
                          data-projectclad-delete-order-btn
                          data-job-id={job.id}
                        >
                          Mark for deletion
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
                ))}
              </div>
            )}
          </section>

          <section className="project-clad-section">
            <div className="project-clad-card">
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
                    project.subtotal.toFixed(2)
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
            <h2 className="project-clad-section-title">Share access</h2>
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
                    <label htmlFor="member-email">Add project member</label>
                    <input
                      id="member-email"
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
                    <button type="submit" className="project-clad-button">
                      Add
                    </button>
                  </Form>
                  <div
                    className="project-clad-actions project-clad-share-buttons"
                    style={{ flexWrap: "wrap", gap: "0.5rem" }}
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
                        className="project-clad-button"
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
          </section>

          <script
            dangerouslySetInnerHTML={{
              __html: `
(() => {
  if (window.__pcShareCopyInitialized) return;
  window.__pcShareCopyInitialized = true;
  const actionsEndpoint = '/apps/project-clad/api/project-actions';
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
          deleteOrderBtn.textContent = 'Marked for deletion';
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
      try {
        const res = await fetch('/apps/project-clad/project?id=' + encodeURIComponent(projectId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intent: 'save-order-edit', jobId, removeItemIds: [], itemUpdates: itemUpdates, deleteJob: deleteJob }),
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

          <section className="project-clad-section">
            <h2 className="project-clad-section-title">Project members</h2>
            {memberLookupError && (
              <p className="project-clad-muted">{memberLookupError}</p>
            )}
            {project.members.length === 0 ? (
              <p className="project-clad-muted">No members on this project.</p>
            ) : (
              <table className="project-clad-table project-clad-members-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th className="project-clad-table-right">Project Member Role</th>
                    {isOwner && (
                      <th className="project-clad-table-right">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {project.members.map((member) => {
                    const fullName = [member.firstName, member.lastName]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <tr key={member.customerId}>
                        <td>{fullName || "—"}</td>
                        <td>{member.email || "—"}</td>
                        <td className="project-clad-table-right">
                          {member.role === "owner"
                            ? "Owner"
                            : member.role === "edit"
                              ? "Edit"
                              : "View only"}
                        </td>
                        {isOwner && (
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
                                <button type="submit" className="project-clad-button">
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
          </section>

          {isOwner && (
            <section className="project-clad-section">
              <h2 className="project-clad-section-title">Project settings</h2>
              <div className="project-clad-card">
                <div className="project-clad-actions" style={{ flexWrap: "wrap", gap: "1rem" }}>
                  <button
                    type="button"
                    className="project-clad-button"
                    data-projectclad-edit-project-details
                  >
                    Edit project details
                  </button>
                  <form
                    method="post"
                    action="/apps/project-clad/projects"
                    style={{ display: "inline" }}
                    onSubmit={(e) => {
                      if (!confirm("Are you sure you want to delete this project?")) {
                        e.preventDefault();
                      }
                    }}
                  >
                    <input type="hidden" name="intent" value="delete-project" />
                    <input type="hidden" name="projectId" value={project.id} />
                    <button type="submit" className="project-clad-button">
                      Delete this project
                    </button>
                  </form>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>
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
