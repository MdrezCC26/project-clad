import type { ActionFunctionArgs } from "react-router";
import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import { getCustomersByIds } from "../utils/adminCustomers.server";
import { getAdminVariantInfo } from "../utils/adminVariants.server";
import { hasAdminTag } from "../utils/customerTags.server";
import { logProjectActivity } from "../utils/projectActivity.server";
import { fetchVariantPriceUsd } from "../utils/shopifyVariantPrice.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const { shop, customerId: viewerCustomerId } = requireAppProxyCustomer(
    request,
    {
      jsonOnFail: true,
    },
  );
  const customerId = viewerCustomerId as string;

  let customerInfo: Awaited<ReturnType<typeof getCustomersByIds>>;
  try {
    customerInfo = await getCustomersByIds(shop, [customerId]);
  } catch {
    return Response.json({ error: "Could not verify admin." }, { status: 500 });
  }
  const tags = customerInfo[customerId]?.tags ?? [];
  if (!hasAdminTag(tags)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const intent = String(body.intent || "");
  const jobId = String(body.jobId || "");

  const job = jobId
    ? await prisma.job.findFirst({
        where: { id: jobId, project: { shop } },
        include: { project: true, items: true, orderLink: true },
      })
    : null;

  if (intent === "update-work-order-status") {
    if (!job) {
      return Response.json({ error: "Job not found" }, { status: 404 });
    }
    if (job.paidAt) {
      return Response.json(
        { error: "Cannot change work order status after payment." },
        { status: 400 },
      );
    }
    const next = String(body.status || "");
    if (next !== "unread" && next !== "in_progress" && next !== "complete") {
      return Response.json({ error: "Invalid status" }, { status: 400 });
    }

    const prev = job.workOrderStatus;
    const data: {
      workOrderStatus: string;
      completedAt: Date | null;
    } = {
      workOrderStatus: next,
      completedAt:
        next === "complete"
          ? new Date()
          : null,
    };
    if (next !== "complete") {
      data.completedAt = null;
    }

    await prisma.job.update({
      where: { id: job.id },
      data,
    });

    await logProjectActivity({
      projectId: job.projectId,
      jobId: job.id,
      type: "work_order_status",
      visibility: "member",
      actorCustomerId: customerId,
      payload: {
        jobName: job.name,
        from: prev ?? null,
        to: next,
      },
    });

    return Response.json({ ok: true });
  }

  if (intent === "swap-job-item-variant") {
    const itemId = String(body.itemId || "");
    const newVariantId = String(body.newVariantId || "").replace(/\D/g, "");
    if (!job || !itemId || !newVariantId) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    if (job.paidAt) {
      return Response.json(
        { error: "Cannot replace products after payment." },
        { status: 400 },
      );
    }
    if (job.workOrderStatus === "complete") {
      return Response.json(
        { error: "Unlock work order status before replacing products." },
        { status: 400 },
      );
    }

    const item = job.items.find((i) => i.id === itemId);
    if (!item) {
      return Response.json({ error: "Line item not found" }, { status: 404 });
    }

    const prevVariantId = item.variantId;
    const price = await fetchVariantPriceUsd(shop, newVariantId);
    if (price == null || Number.isNaN(price)) {
      return Response.json(
        { error: "Could not resolve price for new variant." },
        { status: 400 },
      );
    }

    await prisma.jobItem.update({
      where: { id: itemId },
      data: {
        variantId: newVariantId,
        priceSnapshot: new Prisma.Decimal(price),
      },
    });

    const info: Record<
      string,
      { productTitle?: string | null; title?: string | null }
    > = await getAdminVariantInfo(shop, [prevVariantId, newVariantId]).catch(
      () => ({}),
    );
    const fromLabel =
      info[prevVariantId]?.productTitle && info[prevVariantId]?.title
        ? `${info[prevVariantId].productTitle} — ${info[prevVariantId].title}`
        : prevVariantId;
    const toLabel =
      info[newVariantId]?.productTitle && info[newVariantId]?.title
        ? `${info[newVariantId].productTitle} — ${info[newVariantId].title}`
        : newVariantId;

    await logProjectActivity({
      projectId: job.projectId,
      jobId: job.id,
      type: "job_item_variant_swapped",
      visibility: "admin",
      actorCustomerId: customerId,
      payload: {
        jobName: job.name,
        itemId,
        fromVariantId: prevVariantId,
        toVariantId: newVariantId,
        fromLabel,
        toLabel,
      },
    });

    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unsupported intent" }, { status: 400 });
};
