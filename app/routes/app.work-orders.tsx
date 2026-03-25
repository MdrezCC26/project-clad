import { useMemo } from "react";
import { useFetcher, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logProjectActivity } from "../utils/projectActivity.server";
import { fetchVariantPriceUsd } from "../utils/shopifyVariantPrice.server";
import { getAdminVariantInfo } from "../utils/adminVariants.server";

type WoStatus = "unread" | "in_progress" | "complete";

type JobRow = {
  id: string;
  name: string;
  createdAt: string;
  projectId: string;
  projectName: string;
  workOrderStatus: string | null;
  paidAt: string | null;
  jobApproved: boolean;
  orderName: string | null;
  items: { id: string; variantId: string; quantity: number }[];
};

type LoaderData = { jobs: JobRow[]; shop: string };

type ActionData =
  | { ok: true; message?: string }
  | { ok: false; error: string };

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticate.admin(request);

  const jobs = await prisma.job.findMany({
    where: { project: { shop: session.shop } },
    orderBy: { createdAt: "desc" },
    include: {
      project: { select: { id: true, name: true } },
      orderLink: { select: { orderName: true } },
      items: { orderBy: { sortOrder: "asc" } },
    },
  });

  const jobIds = jobs.map((j) => j.id);
  const approvals = jobIds.length
    ? await prisma.approvalRequest.findMany({
        where: { jobId: { in: jobIds }, itemId: "" },
      })
    : [];
  const byJobId = new Map(approvals.map((a) => [a.jobId, a]));

  return {
    shop: session.shop,
    jobs: jobs.map((job) => {
      const ap = byJobId.get(job.id);
      return {
        id: job.id,
        name: job.name,
        createdAt: job.createdAt.toISOString(),
        projectId: job.project.id,
        projectName: job.project.name,
        workOrderStatus: job.workOrderStatus ?? null,
        paidAt: job.paidAt?.toISOString() ?? null,
        jobApproved: Boolean(ap?.approvedAt),
        orderName: job.orderLink?.orderName ?? null,
        items: job.items.map((i) => ({
          id: i.id,
          variantId: i.variantId,
          quantity: i.quantity,
        })),
      };
    }),
  };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const jobId = String(form.get("jobId") || "");

  const job = jobId
    ? await prisma.job.findFirst({
        where: { id: jobId, project: { shop } },
        include: { project: true, items: true, orderLink: true },
      })
    : null;

  if (intent === "update-work-order-status") {
    if (!job) {
      return { ok: false, error: "Job not found." };
    }
    if (job.paidAt) {
      return { ok: false, error: "Cannot change status after payment." };
    }
    const next = String(form.get("status") || "") as WoStatus;
    if (next !== "unread" && next !== "in_progress" && next !== "complete") {
      return { ok: false, error: "Invalid status." };
    }

    const prev = job.workOrderStatus;
    const completedAt =
      next === "complete" ? new Date() : null;

    await prisma.job.update({
      where: { id: job.id },
      data: {
        workOrderStatus: next,
        completedAt,
      },
    });

    await logProjectActivity({
      projectId: job.projectId,
      jobId: job.id,
      type: "work_order_status",
      visibility: "member",
      actorCustomerId: null,
      payload: {
        jobName: job.name,
        from: prev ?? null,
        to: next,
        source: "shopify_admin",
      },
    });

    return { ok: true, message: "Status updated." };
  }

  if (intent === "swap-job-item-variant") {
    const itemId = String(form.get("itemId") || "");
    const newVariantId = String(form.get("newVariantId") || "").replace(/\D/g, "");
    if (!job || !itemId || !newVariantId) {
      return { ok: false, error: "Invalid request." };
    }
    if (job.paidAt) {
      return { ok: false, error: "Cannot swap after payment." };
    }
    if (job.workOrderStatus === "complete") {
      return { ok: false, error: "Set status away from complete first." };
    }

    const item = job.items.find((i) => i.id === itemId);
    if (!item) {
      return { ok: false, error: "Line not found." };
    }

    const prevVariantId = item.variantId;
    const price = await fetchVariantPriceUsd(shop, newVariantId);
    if (price == null || Number.isNaN(price)) {
      return { ok: false, error: "Could not resolve variant price." };
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
      actorCustomerId: null,
      payload: {
        jobName: job.name,
        itemId,
        fromVariantId: prevVariantId,
        toVariantId: newVariantId,
        fromLabel,
        toLabel,
        source: "shopify_admin",
      },
    });

    return { ok: true, message: "Variant swapped." };
  }

  return { ok: false, error: "Unknown action." };
};

export default function AdminWorkOrdersPage() {
  const { jobs, shop } = useLoaderData<LoaderData>();
  const statusFetcher = useFetcher<ActionData>();
  const swapFetcher = useFetcher<ActionData>();

  const busy =
    statusFetcher.state !== "idle" || swapFetcher.state !== "idle";

  const storefrontProjectBase = useMemo(
    () => `https://${shop}/apps/project-clad/project`,
    [shop],
  );

  return (
    <s-page heading="Work orders">
      <s-section heading="Jobs awaiting production (storefront)">
        <s-paragraph>
          Updates here are the same as the old customer-tagged admin link: status changes
          appear in the project activity feed. Variant swaps are staff-only in the feed.
        </s-paragraph>

        {statusFetcher.data?.ok === false ? (
          <s-banner tone="critical">{statusFetcher.data.error}</s-banner>
        ) : null}
        {swapFetcher.data?.ok === false ? (
          <s-banner tone="critical">{swapFetcher.data.error}</s-banner>
        ) : null}
        {statusFetcher.data?.ok === true && statusFetcher.data.message ? (
          <s-banner tone="success">{statusFetcher.data.message}</s-banner>
        ) : null}
        {swapFetcher.data?.ok === true && swapFetcher.data.message ? (
          <s-banner tone="success">{swapFetcher.data.message}</s-banner>
        ) : null}

        {jobs.length === 0 ? (
          <s-paragraph>No jobs found for this shop.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {jobs.map((job) => (
              <div
                key={job.id}
                style={{
                  border: "1px solid rgba(0,0,0,0.12)",
                  borderRadius: 8,
                  padding: "12px 16px",
                }}
              >
                <p style={{ margin: "0 0 4px", fontWeight: 600 }}>
                  {job.name}
                  <span style={{ fontWeight: 400, opacity: 0.85 }}>
                    {" "}
                    — {job.projectName}
                    {job.orderName ? ` (${job.orderName})` : ""}
                  </span>
                </p>
                <p style={{ margin: "0 0 8px", fontSize: "0.9em", opacity: 0.85 }}>
                  {new Date(job.createdAt).toLocaleString()} ·{" "}
                  <a
                    href={`${storefrontProjectBase}?id=${encodeURIComponent(job.projectId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open project (storefront)
                  </a>
                  {!job.jobApproved ? " · Not approved yet" : null}
                  {job.paidAt ? " · Paid (locked)" : null}
                </p>

                <statusFetcher.Form
                  method="post"
                  style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}
                >
                  <input type="hidden" name="intent" value="update-work-order-status" />
                  <input type="hidden" name="jobId" value={job.id} />
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: "0.9em" }}>Status</span>
                    <select
                      name="status"
                      defaultValue={job.workOrderStatus ?? "unread"}
                      disabled={Boolean(job.paidAt) || busy}
                    >
                      <option value="unread">unread</option>
                      <option value="in_progress">in_progress</option>
                      <option value="complete">complete</option>
                    </select>
                  </label>
                  <button type="submit" disabled={Boolean(job.paidAt) || busy}>
                    Save status
                  </button>
                </statusFetcher.Form>

                {job.jobApproved && !job.paidAt && job.workOrderStatus !== "complete" ? (
                  <swapFetcher.Form
                    method="post"
                    style={{
                      marginTop: 12,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <input type="hidden" name="intent" value="swap-job-item-variant" />
                    <input type="hidden" name="jobId" value={job.id} />
                    <select
                      name="itemId"
                      required
                      disabled={busy}
                      style={{ minWidth: "12rem" }}
                    >
                      {job.items.map((it, idx) => (
                        <option key={it.id} value={it.id}>
                          Line {idx + 1}: {it.variantId} × {it.quantity}
                        </option>
                      ))}
                    </select>
                    <input
                      name="newVariantId"
                      required
                      placeholder="New variant ID / GID"
                      disabled={busy}
                      style={{ minWidth: "14rem" }}
                    />
                    <button type="submit" disabled={busy}>
                      Swap variant
                    </button>
                  </swapFetcher.Form>
                ) : null}
              </div>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
