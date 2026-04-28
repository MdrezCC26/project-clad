import type { ActionFunctionArgs } from "react-router";
import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import { getAdminVariantInfo } from "../utils/adminVariants.server";
import { viewerHasAdminTag } from "../utils/customerTags.server";
import { shopStringFilter } from "../utils/projectAccess.server";
import { logProjectActivity } from "../utils/projectActivity.server";
import { fetchVariantPriceUsd } from "../utils/shopifyVariantPrice.server";

function parseNumericPrice(input: unknown): number | null {
  if (typeof input === "number") {
    return Number.isFinite(input) ? input : null;
  }
  if (typeof input === "string") {
    const n = Number(input.replace(/[^0-9.-]/g, "").trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function customConfiguredPrice(customData: Prisma.JsonValue | null | undefined): number | null {
  if (!Array.isArray(customData)) return null;
  let best: number | null = null;

  for (const row of customData) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { name?: unknown; value?: unknown };
    const key = String(rec.name ?? "").trim().toLowerCase();
    if (!key) continue;

    if (key === "product_price") {
      const n = parseNumericPrice(rec.value);
      if (n != null && n > 0) best = best == null ? n : Math.max(best, n);
      continue;
    }

    if (key === "__oocalcpayload" && typeof rec.value === "string") {
      try {
        const payload = JSON.parse(rec.value) as Record<string, unknown>;
        const n = parseNumericPrice(payload.PRODUCT_PRICE ?? payload.product_price);
        if (n != null && n > 0) best = best == null ? n : Math.max(best, n);
      } catch {
        // Ignore malformed calculator payload.
      }
    }
  }

  return best;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const { shop, customerId: viewerCustomerId, customerEmail } =
    requireAppProxyCustomer(request, {
      jsonOnFail: true,
    });
  const customerId = viewerCustomerId as string;

  const isStaff = await viewerHasAdminTag(
    shop,
    customerId,
    customerEmail,
  );
  if (!isStaff) {
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
        where: { id: jobId, project: { shop: shopStringFilter(shop) } },
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
    const variantPrice = await fetchVariantPriceUsd(shop, newVariantId);
    if (variantPrice == null || Number.isNaN(variantPrice)) {
      return Response.json(
        { error: "Could not resolve price for new variant." },
        { status: 400 },
      );
    }
    const priorPrice = Number(item.priceSnapshot?.toString?.() ?? item.priceSnapshot ?? 0);
    const configuredPrice = customConfiguredPrice(item.customData);
    const resolvedPrice =
      variantPrice > 0
        ? variantPrice
        : configuredPrice != null && configuredPrice > 0
          ? configuredPrice
          : priorPrice > 0
            ? priorPrice
            : variantPrice;

    await prisma.jobItem.update({
      where: { id: itemId },
      data: {
        variantId: newVariantId,
        priceSnapshot: new Prisma.Decimal(resolvedPrice),
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
