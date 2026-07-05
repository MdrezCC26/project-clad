import { useMemo } from "react";
import { useFetcher, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import {
  isSafeFulfillmentPhotoStorageKey,
  saveFulfillmentPhoto,
} from "../utils/fulfillmentPhotoStorage.server";
import prisma from "../db.server";
import { logProjectActivity } from "../utils/projectActivity.server";
import { fetchVariantPriceUsd } from "../utils/shopifyVariantPrice.server";
import { getAdminVariantInfo } from "../utils/adminVariants.server";
import { shopStringFilter } from "../utils/projectAccess.server";
import { sendFulfillmentPackageEmails } from "../utils/fulfillmentNotify.server";
import {
  confirmAdminPhaseFulfillment,
  jobHasFulfillmentEvidence,
} from "../utils/adminPhaseFulfillment.server";
import { notifyMissionControl } from "../utils/missionControl.server";
import { settleBackupDraftOrderOnPaidBestEffort } from "../utils/shopifyDraftOrder.server";

function parseNumericPrice(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
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

/** Customer-facing storefront lifecycle states; same enum as the storefront dropdown. */
type LifecycleStatus =
  | "draft"
  | "pending_review"
  | "ready_to_order"
  | "ordered"
  | "delivered"
  | "paid";

const LIFECYCLE_VALUES: ReadonlyArray<LifecycleStatus> = [
  "draft",
  "pending_review",
  "ready_to_order",
  "ordered",
  "delivered",
  "paid",
];

/** Short labels used in admin (matches the storefront pill / dropdown). */
const LIFECYCLE_LABELS: Record<LifecycleStatus, string> = {
  draft: "New",
  pending_review: "Review",
  ready_to_order: "Order now",
  ordered: "Ordered",
  delivered: "Delivered",
  paid: "Paid",
};

type JobRow = {
  id: string;
  name: string;
  orderNumber: number | null;
  createdAt: string;
  projectId: string;
  projectName: string;
  workOrderStatus: string | null;
  /** Customer-facing storefront lifecycle (draft → … → paid) — read-only mirror in admin. */
  orderLifecycleStatus: string;
  paidAt: string | null;
  jobApproved: boolean;
  orderName: string | null;
  hasFulfillmentPhoto: boolean;
  items: { id: string; variantId: string; quantity: number }[];
};

type LoaderData = { jobs: JobRow[]; shop: string };

type ActionData =
  | { ok: true; message?: string }
  | { ok: false; error: string };

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticate.admin(request);

  const jobs = await prisma.job.findMany({
    where: { project: { shop: shopStringFilter(session.shop) } },
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
        orderNumber: job.orderNumber ?? null,
        createdAt: job.createdAt.toISOString(),
        projectId: job.project.id,
        projectName: job.project.name,
        workOrderStatus: job.workOrderStatus ?? null,
        orderLifecycleStatus: job.orderLifecycleStatus,
        paidAt: job.paidAt?.toISOString() ?? null,
        jobApproved: Boolean(ap?.approvedAt),
        orderName: job.orderLink?.orderName ?? null,
        hasFulfillmentPhoto: Boolean(job.fulfillmentPhotoStorageKey),
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
        where: { id: jobId, project: { shop: shopStringFilter(shop) } },
        include: {
          project: true,
          items: true,
          orderLink: true,
          deliveryPhases: { include: { lines: true }, orderBy: { sequence: "asc" } },
        },
      })
    : null;

  if (intent === "update-order-lifecycle") {
    if (!job) {
      return { ok: false, error: "Job not found." };
    }
    if (job.paidAt) {
      return {
        ok: false,
        error: "This order is marked Paid \u2014 status is locked.",
      };
    }
    const next = String(form.get("status") || "") as LifecycleStatus;
    if (!LIFECYCLE_VALUES.includes(next)) {
      return { ok: false, error: "Invalid status." };
    }

    /* Mirrors the storefront's `staff-set-order-lifecycle` photo gate so the
       customer-visible value can never be set to "delivered" without a
       fulfillment photo on file. Staff should upload the photo from the
       storefront project page first, then come back here. */
    if (
      next === "delivered" &&
      !jobHasFulfillmentEvidence(
        job.fulfillmentPhotoStorageKey,
        job.deliveryPhases,
      )
    ) {
      return {
        ok: false,
        error:
          "Confirm at least one delivery with photo and quantities before marking Delivered.",
      };
    }

    const prev = job.orderLifecycleStatus;

    /* Auto-stamp completion / payment timestamps the same way the storefront
       does so downstream code (emails, locking, exports) sees consistent state. */
    const data: {
      orderLifecycleStatus: LifecycleStatus;
      completedAt?: Date | null;
      paidAt?: Date | null;
    } = { orderLifecycleStatus: next };

    if (next === "delivered" && !job.completedAt) {
      data.completedAt = new Date();
    }
    if (next === "paid") {
      if (!job.paidAt) data.paidAt = new Date();
      if (!job.completedAt) data.completedAt = new Date();
    }
    /* Reverting from a paid/delivered state back to a pre-delivery state clears
       the relevant timestamps so the order can re-enter the normal flow. */
    const isPreDelivery =
      next === "draft" ||
      next === "pending_review" ||
      next === "ready_to_order" ||
      next === "ordered";
    if (isPreDelivery && job.paidAt) data.paidAt = null;
    if (isPreDelivery && job.completedAt && next !== "ordered") {
      data.completedAt = null;
    }

    await prisma.job.update({
      where: { id: job.id },
      data,
    });

    await logProjectActivity({
      projectId: job.projectId,
      jobId: job.id,
      type: "order_lifecycle_status",
      visibility: "member",
      actorCustomerId: null,
      payload: {
        jobName: job.name,
        from: prev,
        to: next,
        source: "shopify_admin",
      },
    });

    notifyMissionControl(job.id);
    if (next === "paid") {
      settleBackupDraftOrderOnPaidBestEffort(shop, job.id);
    }

    return {
      ok: true,
      message: `Status updated to "${LIFECYCLE_LABELS[next]}".`,
    };
  }

  if (intent === "upload-phase-fulfillment-photo") {
    const phaseId = String(form.get("phaseId") || "");
    if (!job || !phaseId) {
      return { ok: false, error: "Invalid request." };
    }
    const result = await confirmAdminPhaseFulfillment({
      shop,
      jobId: job.id,
      phaseId,
      form,
    });
    if (!result.ok) {
      return result;
    }
    return { ok: true, message: result.message };
  }

  if (intent === "upload-fulfillment-photo") {
    if (!job) {
      return { ok: false, error: "Job not found." };
    }
    if (job.deliveryPhases.length > 0) {
      return {
        ok: false,
        error:
          "This order uses partial deliveries — use the delivery drop form with quantities and photo.",
      };
    }
    if (job.paidAt) {
      return {
        ok: false,
        error: "Order is Paid \u2014 photo cannot be replaced.",
      };
    }
    /* Admin can upload at any unpaid stage \u2014 the upload itself fast-forwards
       the order to "Delivered". This is intentionally more permissive than the
       storefront flow (which only allows uploads in "Ordered" status) because
       staff are explicitly overriding the customer-facing workflow here. */
    const file = form.get("photo");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Photo file is required." };
    }
    if (file.size > 8 * 1024 * 1024) {
      return { ok: false, error: "Photo must be 8MB or smaller." };
    }
    const orig = (file.name || "photo.jpg").toLowerCase();
    const ext = orig.endsWith(".png")
      ? ".png"
      : orig.endsWith(".webp")
        ? ".webp"
        : ".jpg";
    const shopDir = shop.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const storageKey = `${shopDir}/${job.id}-${Date.now()}${ext}`;
    if (!isSafeFulfillmentPhotoStorageKey(storageKey)) {
      return { ok: false, error: "Invalid storage path." };
    }
    const buf = Buffer.from(await file.arrayBuffer());
    await saveFulfillmentPhoto(storageKey, buf);

    await prisma.job.update({
      where: { id: job.id },
      data: {
        fulfillmentPhotoStorageKey: storageKey,
        orderLifecycleStatus: "delivered",
        ...(job.completedAt ? {} : { completedAt: new Date() }),
      },
    });

    /* One-shot fulfillment email — same idempotency the storefront uses. */
    if (!job.fulfillmentNotifiedAt) {
      try {
        await sendFulfillmentPackageEmails({
          shop,
          projectId: job.projectId,
          jobId: job.id,
        });
        await prisma.job.update({
          where: { id: job.id },
          data: { fulfillmentNotifiedAt: new Date() },
        });
      } catch (err) {
        console.error(
          "[admin work-orders] fulfillment notify failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    await logProjectActivity({
      projectId: job.projectId,
      jobId: job.id,
      type: "order_lifecycle_status",
      visibility: "member",
      actorCustomerId: null,
      payload: {
        jobName: job.name,
        from: job.orderLifecycleStatus,
        to: "delivered",
        source: "shopify_admin",
        viaPhotoUpload: true,
      },
    });

    notifyMissionControl(job.id);

    return {
      ok: true,
      message: 'Fulfillment photo uploaded — order marked "Delivered".',
    };
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
    if (
      job.orderLifecycleStatus === "delivered" ||
      job.orderLifecycleStatus === "paid"
    ) {
      return {
        ok: false,
        error: "Cannot swap a line on a delivered or paid order.",
      };
    }

    const item = job.items.find((i) => i.id === itemId);
    if (!item) {
      return { ok: false, error: "Line not found." };
    }

    const prevVariantId = item.variantId;
    const variantPrice = await fetchVariantPriceUsd(shop, newVariantId);
    if (variantPrice == null || Number.isNaN(variantPrice)) {
      return { ok: false, error: "Could not resolve variant price." };
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

/** Pill colors for the customer-facing `orderLifecycleStatus` (labels reused from `LIFECYCLE_LABELS`). */
const LIFECYCLE_COLORS: Record<
  LifecycleStatus,
  { bg: string; fg: string; border: string }
> = {
  draft: { bg: "#f1f1f1", fg: "#5a5a5a", border: "#d9d9d9" },
  pending_review: { bg: "#fff4d6", fg: "#7a5a00", border: "#f1d98a" },
  ready_to_order: { bg: "#e0ecff", fg: "#1f4fa3", border: "#b9d2ff" },
  ordered: { bg: "#d6e9ff", fg: "#0f3a83", border: "#9bc0ee" },
  delivered: { bg: "#ece1ff", fg: "#4a2585", border: "#c8b2f1" },
  paid: { bg: "#daf5e1", fg: "#1c5e34", border: "#9ed7b1" },
};

function LifecyclePill({ status }: { status: string }) {
  const known = (LIFECYCLE_VALUES as ReadonlyArray<string>).includes(status)
    ? (status as LifecycleStatus)
    : null;
  const label = known ? LIFECYCLE_LABELS[known] : status || "—";
  const c = known
    ? LIFECYCLE_COLORS[known]
    : { bg: "#f1f1f1", fg: "#5a5a5a", border: "#d9d9d9" };
  return (
    <span
      title={`Customer order status: ${label}`}
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: "0.75em",
        fontWeight: 600,
        lineHeight: 1.4,
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

export default function AdminWorkOrdersPage() {
  const { jobs, shop } = useLoaderData<LoaderData>();
  const statusFetcher = useFetcher<ActionData>();
  const swapFetcher = useFetcher<ActionData>();
  const photoFetcher = useFetcher<ActionData>();

  const busy =
    statusFetcher.state !== "idle" ||
    swapFetcher.state !== "idle" ||
    photoFetcher.state !== "idle";

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
        {photoFetcher.data?.ok === false ? (
          <s-banner tone="critical">{photoFetcher.data.error}</s-banner>
        ) : null}
        {photoFetcher.data?.ok === true && photoFetcher.data.message ? (
          <s-banner tone="success">{photoFetcher.data.message}</s-banner>
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
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 8,
                    margin: "0 0 4px",
                  }}
                >
                  <LifecyclePill status={job.orderLifecycleStatus} />
                  <p style={{ margin: 0, fontWeight: 600 }}>
                    {job.orderNumber != null ? `#${job.orderNumber} · ` : ""}
                    {job.projectName}
                    <span style={{ fontWeight: 400, opacity: 0.85 }}>
                      {" "}
                      — {job.name}
                      {job.orderName ? ` (${job.orderName})` : ""}
                    </span>
                  </p>
                </div>
                <p style={{ margin: "0 0 8px", fontSize: "0.9em", opacity: 0.85 }}>
                  {new Date(job.createdAt).toLocaleString()} ·{" "}
                  <a
                    href={`${storefrontProjectBase}?id=${encodeURIComponent(job.projectId)}&job=${encodeURIComponent(job.id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open project (storefront)
                  </a>
                  {!job.jobApproved ? " · Not approved yet" : null}
                  {job.paidAt ? " · Order complete (locked)" : null}
                </p>

                <statusFetcher.Form
                  method="post"
                  style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}
                >
                  <input type="hidden" name="intent" value="update-order-lifecycle" />
                  <input type="hidden" name="jobId" value={job.id} />
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: "0.9em" }}>Order status</span>
                    <select
                      name="status"
                      defaultValue={job.orderLifecycleStatus}
                      disabled={Boolean(job.paidAt) || busy}
                    >
                      {LIFECYCLE_VALUES.map((value) => (
                        <option key={value} value={value}>
                          {LIFECYCLE_LABELS[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" disabled={Boolean(job.paidAt) || busy}>
                    Save status
                  </button>
                </statusFetcher.Form>

                {/* Fulfillment photo upload — uploading flips the customer-facing
                    status to "Delivered" automatically. Always shown on unpaid
                    rows so staff can upload at any stage if they need to fast-
                    forward the order to delivered (e.g. when the customer never
                    confirmed via the storefront). */}
                {!job.paidAt ? (
                  <photoFetcher.Form
                    method="post"
                    encType="multipart/form-data"
                    style={{
                      marginTop: 12,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <input type="hidden" name="intent" value="upload-fulfillment-photo" />
                    <input type="hidden" name="jobId" value={job.id} />
                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: "0.9em" }}>
                        Fulfillment photo
                        {job.hasFulfillmentPhoto ? (
                          <span style={{ marginLeft: 6, opacity: 0.75 }}>
                            (replace)
                          </span>
                        ) : null}
                      </span>
                      <input
                        type="file"
                        name="photo"
                        accept="image/jpeg,image/png,image/webp"
                        required
                        disabled={busy}
                      />
                    </label>
                    <button type="submit" disabled={busy}>
                      {job.hasFulfillmentPhoto
                        ? "Replace photo"
                        : "Upload & mark Delivered"}
                    </button>
                    {job.hasFulfillmentPhoto ? (
                      <span
                        style={{
                          fontSize: "0.85em",
                          color: "#1c5e34",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        ✓ Photo on file
                        <a
                          href={`/app/fulfillment-photo?jobId=${encodeURIComponent(job.id)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View
                        </a>
                      </span>
                    ) : (
                      <span style={{ fontSize: "0.85em", opacity: 0.75 }}>
                        Required to mark Delivered
                      </span>
                    )}
                  </photoFetcher.Form>
                ) : null}

                {job.jobApproved &&
                !job.paidAt &&
                job.orderLifecycleStatus !== "delivered" &&
                job.orderLifecycleStatus !== "paid" ? (
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
