import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logProjectActivity } from "../utils/projectActivity.server";
import { notifyMissionControl } from "../utils/missionControl.server";
import { settleBackupDraftOrderOnPaidBestEffort } from "../utils/shopifyDraftOrder.server";

type LineItem = {
  name?: string;
  title?: string;
  quantity?: number;
  price?: string;
  pre_tax_price?: string;
};

type OrderPayload = {
  id?: number | string;
  name?: string;
  order_number?: number;
  currency?: string;
  subtotal_price?: string;
  total_price?: string;
  line_items?: LineItem[];
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const order = payload as OrderPayload;
  const rawId = order?.id;
  const orderId =
    rawId != null
      ? String(rawId)
          .replace(/^gid:\/\/shopify\/Order\//i, "")
          .split("/")
          .pop() || String(rawId)
      : "";
  if (!orderId) {
    return new Response();
  }

  const link = await prisma.jobOrderLink.findUnique({
    where: { orderId },
    include: { job: { include: { project: true } } },
  });

  if (!link || link.job.project.shop !== shop) {
    return new Response();
  }

  if (link.job.paidAt) {
    return new Response();
  }

  const lines = (order.line_items || []).map((li) => {
    const qty = Number(li.quantity || 0);
    const unit = String(li.price ?? li.pre_tax_price ?? "0");
    const unitNum = Number.parseFloat(unit);
    const lineTotal = Number.isFinite(unitNum)
      ? (unitNum * qty).toFixed(2)
      : unit;
    return {
      title: String(li.name || li.title || "Line"),
      quantity: qty,
      unitPrice: unit,
      lineTotal,
    };
  });

  const receiptSnapshot = {
    orderName:
      order.name ??
      (order.order_number != null ? `#${order.order_number}` : null),
    currency: order.currency ?? null,
    subtotal: order.subtotal_price ?? null,
    total: order.total_price ?? null,
    lines,
  };

  const orderName =
    order.name ?? link.orderName ?? receiptSnapshot.orderName ?? null;

  await prisma.$transaction([
    prisma.job.update({
      where: { id: link.jobId },
      data: {
        orderLifecycleStatus: "paid",
        paidAt: new Date(),
        completedAt: link.job.completedAt ?? new Date(),
        receiptSnapshot,
      },
    }),
    prisma.jobOrderLink.update({
      where: { id: link.id },
      data: { orderName: orderName ?? link.orderName },
    }),
  ]);

  await logProjectActivity({
    projectId: link.job.projectId,
    jobId: link.jobId,
    type: "order_paid",
    visibility: "member",
    payload: {
      jobName: link.job.name,
      orderName: receiptSnapshot.orderName,
      total: receiptSnapshot.total,
    },
  });

  notifyMissionControl(link.jobId);
  settleBackupDraftOrderOnPaidBestEffort(shop, link.jobId);

  return new Response();
};
