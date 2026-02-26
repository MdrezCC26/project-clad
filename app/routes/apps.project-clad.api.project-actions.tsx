import crypto from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import {
  findCustomerIdByEmail,
  getCustomersByIds,
} from "../utils/adminCustomers.server";
import { getAdminVariantInfo } from "../utils/adminVariants.server";
import { isEmailConfigured, sendEmail } from "../utils/email.server";
import { verifyPassword } from "../utils/passwords.server";

const PRICING_COOKIE = "projectclad_pricing=1";

const createPricingCookie = () =>
  `${PRICING_COOKIE}; Path=/; Max-Age=3600; SameSite=Lax`;

const getNextJobSortOrder = async (projectId: string) => {
  const result = await prisma.job.aggregate({
    where: { projectId },
    _max: { sortOrder: true },
  });
  return (result._max.sortOrder ?? 0) + 1;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, customerId } = requireAppProxyCustomer(request, {
    jsonOnFail: true,
  });
  const url = new URL(request.url);
  const intent = url.searchParams.get("intent") || "";
  const projectId = url.searchParams.get("projectId") || "";

  if (!projectId) {
    return Response.json({ error: "Project is required." }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, shop },
    include: { members: true },
  });

  if (!project) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }

  const isMember =
    project.ownerCustomerId === customerId ||
    project.members.some((member) => member.customerId === customerId);
  if (!isMember) {
    return Response.json({ error: "Unauthorized." }, { status: 403 });
  }

  const memberRole = project.members.find(
    (member) => member.customerId === customerId,
  )?.role;
  const isOwner = project.ownerCustomerId === customerId;
  const canEdit = isOwner || memberRole === "edit";

  if (intent === "unlock-pricing") {
    const password = (url.searchParams.get("password") || "").trim();
    const settings = await prisma.shopSettings.findUnique({ where: { shop } });
    if (!settings?.pricingPasswordHash || !settings.pricingPasswordSalt) {
      return Response.json({ error: "Pricing is not configured." }, { status: 400 });
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
    return Response.json({ error: "Invalid password." }, { status: 400 });
  }

  if (intent === "create-job") {
    if (!canEdit) {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }
    const name = (url.searchParams.get("jobName") || "").trim();
    if (!name) {
      return Response.json({ error: "Order name is required." }, { status: 400 });
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
      return Response.json({ error: "This order already exists." }, { status: 400 });
    }
    const nextSortOrder = await getNextJobSortOrder(projectId);
    await prisma.job.create({
      data: { projectId, name, sortOrder: nextSortOrder },
    });
    return Response.json({ ok: true });
  }

  if (intent === "delete-job") {
    if (!canEdit) {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }
    const jobId = url.searchParams.get("jobId") || "";
    if (!jobId) {
      return Response.json({ error: "Order is required." }, { status: 400 });
    }
    const job = await prisma.job.findFirst({
      where: { id: jobId, projectId },
      include: { orderLink: true },
    });
    if (!job) {
      return Response.json({ error: "Order not found." }, { status: 404 });
    }
    const isLocked = job.isLocked || Boolean(job.orderLink);
    if (isLocked) {
      return Response.json({ error: "Order is locked." }, { status: 403 });
    }
    await prisma.job.delete({ where: { id: jobId } });
    return Response.json({ ok: true });
  }

  if (intent === "delete-item") {
    if (!canEdit) {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }
    const itemId = url.searchParams.get("itemId") || "";
    if (!itemId) {
      return Response.json({ error: "Item is required." }, { status: 400 });
    }
    const item = await prisma.jobItem.findFirst({
      where: { id: itemId },
      include: { job: { include: { orderLink: true } } },
    });
    if (!item || item.job.projectId !== projectId) {
      return Response.json({ error: "Item not found." }, { status: 404 });
    }
    const isLocked = item.job.isLocked || Boolean(item.job.orderLink);
    if (isLocked) {
      return Response.json({ error: "Order is locked." }, { status: 403 });
    }
    await prisma.jobItem.delete({ where: { id: itemId } });
    await prisma.approvalRequest.deleteMany({
      where: {
        projectId,
        jobId: item.jobId,
        itemId: "",
      },
    });
    return Response.json({ ok: true });
  }

  if (intent === "share-project") {
    if (!canEdit) {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }
    const role = url.searchParams.get("role") || "view";
    const token = crypto.randomBytes(16).toString("hex");
    await prisma.projectShareToken.create({
      data: {
        projectId,
        token,
        role: role === "edit" ? "edit" : "view",
      },
    });
    return Response.json({ shareLink: `/apps/project-clad/share/${token}` });
  }

  if (intent === "add-member") {
    if (!isOwner) {
      return Response.json(
        { error: "Only the project owner can add members." },
        { status: 403 },
      );
    }
    const email = (url.searchParams.get("email") || "").trim();
    const role = url.searchParams.get("role") === "edit" ? "edit" : "view";
    if (!email) {
      return Response.json({ error: "Email is required." }, { status: 400 });
    }
    let memberCustomerId: string | null = null;
    try {
      memberCustomerId = await findCustomerIdByEmail(shop, email);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Customer lookup failed.",
        },
        { status: 400 },
      );
    }
    if (!memberCustomerId) {
      return Response.json(
        { error: "No customer found with that email." },
        { status: 404 },
      );
    }
    if (memberCustomerId === project.ownerCustomerId) {
      return Response.json(
        { error: "This customer already owns the project." },
        { status: 400 },
      );
    }
    await prisma.projectMember.upsert({
      where: {
        projectId_customerId: {
          projectId,
          customerId: memberCustomerId,
        },
      },
      update: { role },
      create: { projectId, customerId: memberCustomerId, role },
    });
    return Response.json({ ok: true });
  }

  if (intent === "remove-member") {
    if (!isOwner) {
      return Response.json(
        { error: "Only the project owner can remove members." },
        { status: 403 },
      );
    }
    const memberCustomerId = url.searchParams.get("memberCustomerId") || "";
    if (!memberCustomerId || memberCustomerId === project.ownerCustomerId) {
      return Response.json({ error: "Invalid member." }, { status: 400 });
    }
    await prisma.projectMember.deleteMany({
      where: { projectId, customerId: memberCustomerId },
    });
    return Response.json({ ok: true });
  }

  if (intent === "submit-for-approval") {
    if (!isEmailConfigured()) {
      return Response.json(
        { error: "Email is not configured. Approval requests cannot be sent." },
        { status: 400 },
      );
    }
    const memberIds = [
      project.ownerCustomerId,
      ...project.members.map((m) => m.customerId),
    ];
    let customerInfo: Awaited<ReturnType<typeof getCustomersByIds>> = {};
    try {
      customerInfo = await getCustomersByIds(shop, memberIds);
    } catch {
      return Response.json(
        { error: "Could not load project members." },
        { status: 500 },
      );
    }
    const hasNATag = (tags: string[]) =>
      tags.some((t) => String(t).trim().toUpperCase() === "NA");
    const approverIds = memberIds.filter((id) => {
      const tags = customerInfo[id]?.tags ?? [];
      return !hasNATag(tags) && id !== customerId;
    });
    const approverEmails = approverIds
      .map((id) => customerInfo[id]?.email)
      .filter((e): e is string => Boolean(e?.trim()));
    if (approverEmails.length === 0) {
      return Response.json(
        { error: "Add project member to continue" },
        { status: 400 },
      );
    }
    const requester = customerInfo[customerId];
    const requesterName = [requester?.firstName, requester?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() || "A team member";
    const projectLink = `https://${shop}/apps/project-clad/project?id=${projectId}`;
    const jobId = url.searchParams.get("jobId") || "";
    const itemId = url.searchParams.get("itemId") || "";

    let contextLabel = project.name;
    if (jobId) {
      const job = await prisma.job.findFirst({
        where: { id: jobId, projectId },
        select: { name: true },
      });
      const jobName = job?.name || "an order";
      if (itemId) {
        const item = await prisma.jobItem.findFirst({
          where: { id: itemId },
          include: { job: { select: { name: true } } },
        });
        if (item?.job) {
          const variantInfo = await getAdminVariantInfo(shop, [
            item.variantId,
          ]).catch(() => ({}));
          const productLabel =
            variantInfo[item.variantId]?.productTitle ||
            variantInfo[item.variantId]?.title ||
            "Item";
          contextLabel = `${productLabel} in ${item.job.name}, ${project.name}`;
        } else {
          contextLabel = `item in ${jobName}, ${project.name}`;
        }
      } else {
        contextLabel = `${jobName} in ${project.name}`;
      }
    }

    const approveQuery = new URLSearchParams({ id: projectId, approve: "1" });
    if (jobId) approveQuery.set("approveJobId", jobId);
    if (itemId) approveQuery.set("approveItemId", itemId);
    const approveLink = `https://${shop}/apps/project-clad/project?${approveQuery.toString()}`;

    const subject = `Approval request: ${contextLabel}`;
    const text = `${requesterName} has submitted the following for approval: ${contextLabel}\n\nView and approve: ${approveLink}`;

    try {
      for (const to of approverEmails) {
        await sendEmail({ to, subject, text });
      }
    } catch (err) {
      return Response.json(
        {
          error:
            err instanceof Error ? err.message : "Failed to send approval request.",
        },
        { status: 500 },
      );
    }

    await prisma.approvalRequest.upsert({
      where: {
        projectId_jobId_itemId: {
          projectId,
          jobId: jobId || "",
          itemId: itemId || "",
        },
      },
      update: { requestedAt: new Date() },
      create: {
        projectId,
        jobId: jobId || "",
        itemId: itemId || "",
      },
    });
    return Response.json({ ok: true });
  }

  if (intent === "cancel-approval-request") {
    if (!canEdit) {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }
    const jobId = url.searchParams.get("jobId") || "";
    const itemId = url.searchParams.get("itemId") || "";

    const existing = await prisma.approvalRequest.findUnique({
      where: {
        projectId_jobId_itemId: {
          projectId,
          jobId: jobId || "",
          itemId: itemId || "",
        },
      },
    });
    if (!existing) {
      return Response.json(
        { error: "No approval request found." },
        { status: 404 },
      );
    }
    if (existing.approvedAt) {
      return Response.json(
        { error: "Cannot cancel an approved request." },
        { status: 400 },
      );
    }

    await prisma.approvalRequest.delete({
      where: { id: existing.id },
    });
    return Response.json({ ok: true });
  }

  if (intent === "approve") {
    const memberIds = [
      project.ownerCustomerId,
      ...project.members.map((m) => m.customerId),
    ];
    let customerInfo: Awaited<ReturnType<typeof getCustomersByIds>> = {};
    try {
      customerInfo = await getCustomersByIds(shop, memberIds);
    } catch {
      return Response.json(
        { error: "Could not load project members." },
        { status: 500 },
      );
    }
    const hasNATag = (tags: string[]) =>
      tags.some((t) => String(t).trim().toUpperCase() === "NA");
    const currentTags = customerInfo[customerId]?.tags ?? [];
    if (hasNATag(currentTags)) {
      return Response.json(
        { error: "Only approvers (members without NA tag) can approve." },
        { status: 403 },
      );
    }
    const jobId = url.searchParams.get("approveJobId") || url.searchParams.get("jobId") || "";
    const itemId = url.searchParams.get("approveItemId") || url.searchParams.get("itemId") || "";

    const existing = await prisma.approvalRequest.findUnique({
      where: {
        projectId_jobId_itemId: {
          projectId,
          jobId: jobId || "",
          itemId: itemId || "",
        },
      },
    });
    if (!existing) {
      return Response.json(
        { error: "No approval request found for this scope." },
        { status: 404 },
      );
    }
    if (existing.approvedAt) {
      return Response.json({ ok: true, alreadyApproved: true });
    }

    await prisma.approvalRequest.update({
      where: { id: existing.id },
      data: { approvedAt: new Date(), approvedByCustomerId: customerId },
    });

    if (isEmailConfigured()) {
      const approver = customerInfo[customerId];
      const approverName =
        [approver?.firstName, approver?.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() || "A team member";

      let contextLabel = project.name;
      let itemsToInclude: { jobName: string; displayName: string; quantity: number }[] = [];

      if (jobId) {
        const job = await prisma.job.findFirst({
          where: { id: jobId, projectId },
          include: { items: { where: { quantity: { gt: 0 } }, orderBy: { sortOrder: "asc" } } },
        });
        const jobName = job?.name || "an order";
        if (itemId) {
          const item = await prisma.jobItem.findFirst({
            where: { id: itemId },
            include: { job: { select: { name: true } } },
          });
          if (item?.job) {
            const variantInfo = await getAdminVariantInfo(shop, [
              item.variantId,
            ]).catch(() => ({}));
            const productLabel =
              variantInfo[item.variantId]?.productTitle ||
              variantInfo[item.variantId]?.title ||
              "Item";
            contextLabel = `${productLabel} in ${item.job.name}, ${project.name}`;
            if (item.quantity > 0) {
              itemsToInclude.push({
                jobName: item.job.name,
                displayName: productLabel,
                quantity: item.quantity,
              });
            }
          } else {
            contextLabel = `item in ${jobName}, ${project.name}`;
          }
        } else if (job) {
          contextLabel = `${jobName} in ${project.name}`;
          const variantIds = job.items.map((i) => i.variantId);
          const variantInfo = await getAdminVariantInfo(shop, variantIds).catch(() => ({}));
          for (const i of job.items) {
            const label =
              variantInfo[i.variantId]?.productTitle ||
              variantInfo[i.variantId]?.title ||
              "Item";
            itemsToInclude.push({ jobName: job.name, displayName: label, quantity: i.quantity });
          }
        }
      } else {
        const jobs = await prisma.job.findMany({
          where: { projectId },
          include: { items: { where: { quantity: { gt: 0 } }, orderBy: { sortOrder: "asc" } } },
          orderBy: { sortOrder: "asc" },
        });
        const variantIds = jobs.flatMap((j) => j.items.map((i) => i.variantId));
        const variantInfo = await getAdminVariantInfo(shop, variantIds).catch(() => ({}));
        for (const j of jobs) {
          for (const i of j.items) {
            const label =
              variantInfo[i.variantId]?.productTitle ||
              variantInfo[i.variantId]?.title ||
              "Item";
            itemsToInclude.push({ jobName: j.name, displayName: label, quantity: i.quantity });
          }
        }
      }

      const projectLink = `https://${shop}/apps/project-clad/project?id=${projectId}`;
      const memberEmails = memberIds
        .map((id) => customerInfo[id]?.email)
        .filter((e): e is string => Boolean(e?.trim()));

      const subject = `Order approved: ${contextLabel}`;
      const itemsList =
        itemsToInclude.length > 0
          ? "\n\nItems:\n" +
            itemsToInclude
              .map(
                (i) =>
                  `  • ${i.displayName} (×${i.quantity})${itemsToInclude.some((x) => x.jobName !== i.jobName) ? ` — ${i.jobName}` : ""}`,
              )
              .join("\n") +
            "\n"
          : "";
      const text = `${approverName} has approved: ${contextLabel}${itemsList}\nView project: ${projectLink}`;

      try {
        for (const to of memberEmails) {
          await sendEmail({ to, subject, text });
        }
      } catch (err) {
        console.error("Approval notification email error:", err);
      }
    }

    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unsupported action." }, { status: 400 });
};

/** Handles POST for reject-with-reason (cancel-approval-request with rejectReason). */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }
  const { shop, customerId } = requireAppProxyCustomer(request, {
    jsonOnFail: true,
  });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const intent = String(body.intent || "");
  const projectId = String(body.projectId || "");
  const jobId = String(body.jobId ?? "");
  const itemId = String(body.itemId ?? "");
  const rejectReason = String(body.rejectReason ?? "").trim();

  if (intent !== "cancel-approval-request" || !projectId) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, shop },
    include: { members: true },
  });
  if (!project) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }

  const isMember =
    project.ownerCustomerId === customerId ||
    project.members.some((member) => member.customerId === customerId);
  if (!isMember) {
    return Response.json({ error: "Unauthorized." }, { status: 403 });
  }

  const memberRole = project.members.find(
    (member) => member.customerId === customerId,
  )?.role;
  const isOwner = project.ownerCustomerId === customerId;
  const canEdit = isOwner || memberRole === "edit";
  if (!canEdit) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  const existing = await prisma.approvalRequest.findUnique({
    where: {
      projectId_jobId_itemId: {
        projectId,
        jobId,
        itemId,
      },
    },
  });
  if (!existing) {
    return Response.json(
      { error: "No approval request found." },
      { status: 404 },
    );
  }
  if (existing.approvedAt) {
    return Response.json(
      { error: "Cannot cancel an approved request." },
      { status: 400 },
    );
  }

  const memberIds = [
    project.ownerCustomerId,
    ...project.members.map((m) => m.customerId),
  ];
  let customerInfo: Awaited<ReturnType<typeof getCustomersByIds>> = {};
  try {
    customerInfo = await getCustomersByIds(shop, memberIds);
  } catch {
    return Response.json(
      { error: "Could not load project members." },
      { status: 500 },
    );
  }

  const rejector = customerInfo[customerId];
  const rejectorName =
    [rejector?.firstName, rejector?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() || "A team member";

  let contextLabel = project.name;
  if (jobId) {
    const job = await prisma.job.findFirst({
      where: { id: jobId, projectId },
      select: { name: true },
    });
    const jobName = job?.name || "an order";
    if (itemId) {
      const item = await prisma.jobItem.findFirst({
        where: { id: itemId },
        include: { job: { select: { name: true } } },
      });
      if (item?.job) {
        const variantInfo = await getAdminVariantInfo(shop, [
          item.variantId,
        ]).catch(() => ({}));
        const productLabel =
          variantInfo[item.variantId]?.productTitle ||
          variantInfo[item.variantId]?.title ||
          "Item";
        contextLabel = `${productLabel} in ${item.job.name}, ${project.name}`;
      } else {
        contextLabel = `item in ${jobName}, ${project.name}`;
      }
    } else {
      contextLabel = `${jobName} in ${project.name}`;
    }
  }

  await prisma.approvalRequest.delete({
    where: { id: existing.id },
  });

  if (isEmailConfigured()) {
    const projectLink = `https://${shop}/apps/project-clad/project?id=${projectId}`;
    const memberEmails = memberIds
      .map((id) => customerInfo[id]?.email)
      .filter((e): e is string => Boolean(e?.trim()));

    const subject = `Order rejected: ${contextLabel}`;
    const reasonText = rejectReason
      ? `\n\nRejection reason:\n${rejectReason}\n`
      : "";
    const text =
      `${rejectorName} has rejected: ${contextLabel}${reasonText}\nView project: ${projectLink}`;

    try {
      for (const to of memberEmails) {
        await sendEmail({ to, subject, text });
      }
    } catch (err) {
      console.error("Rejection notification email error:", err);
    }
  }

  return Response.json({ ok: true });
};
