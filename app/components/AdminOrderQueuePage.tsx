import { useMemo } from "react";
import { useFetcher } from "react-router";
import type { AdminOrderQueueJobRow } from "../utils/adminOrderQueue.server";

type ActionData =
  | { ok: true; message?: string }
  | { ok: false; error: string };

type AdminOrderQueuePageProps = {
  jobs: AdminOrderQueueJobRow[];
  shop: string;
  pageHeading: string;
  sectionHeading: string;
  description: string;
  emptyMessage: string;
};

export function AdminOrderQueuePage({
  jobs,
  shop,
  pageHeading,
  sectionHeading,
  description,
  emptyMessage,
}: AdminOrderQueuePageProps) {
  const statusFetcher = useFetcher<ActionData>();
  const photoFetcher = useFetcher<ActionData>();
  const busy = statusFetcher.state !== "idle" || photoFetcher.state !== "idle";
  const storefrontProjectBase = useMemo(
    () => `https://${shop}/apps/project-clad/project`,
    [shop],
  );

  return (
    <s-page heading={pageHeading}>
      <s-section heading={sectionHeading}>
        <s-paragraph>{description}</s-paragraph>

        {statusFetcher.data?.ok === false ? (
          <s-banner tone="critical">{statusFetcher.data.error}</s-banner>
        ) : null}
        {photoFetcher.data?.ok === false ? (
          <s-banner tone="critical">{photoFetcher.data.error}</s-banner>
        ) : null}
        {statusFetcher.data?.ok === true && statusFetcher.data.message ? (
          <s-banner tone="success">{statusFetcher.data.message}</s-banner>
        ) : null}
        {photoFetcher.data?.ok === true && photoFetcher.data.message ? (
          <s-banner tone="success">{photoFetcher.data.message}</s-banner>
        ) : null}

        {jobs.length === 0 ? (
          <s-paragraph>{emptyMessage}</s-paragraph>
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
                <p style={{ margin: 0, fontWeight: 600 }}>
                  {job.orderNumber != null ? `#${job.orderNumber} · ` : ""}
                  {job.projectName}
                  <span style={{ fontWeight: 400, opacity: 0.85 }}>
                    {" "}
                    — {job.name}
                    {job.orderName ? ` (${job.orderName})` : ""}
                  </span>
                </p>

                <p style={{ margin: "4px 0 8px", fontSize: "0.9em", opacity: 0.85 }}>
                  {new Date(job.createdAt).toLocaleString()} · Status:{" "}
                  <strong>
                    {job.orderLifecycleStatus === "ordered" ? "Ordered" : "Delivered"}
                  </strong>
                  {" · "}
                  <a
                    href={`${storefrontProjectBase}?id=${encodeURIComponent(job.projectId)}&job=${encodeURIComponent(job.id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open project
                  </a>
                </p>

                <statusFetcher.Form
                  method="post"
                  action="/app/work-orders"
                  style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}
                >
                  <input type="hidden" name="intent" value="update-order-lifecycle" />
                  <input type="hidden" name="jobId" value={job.id} />
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: "0.9em" }}>Order status</span>
                    <select name="status" defaultValue={job.orderLifecycleStatus} disabled={busy}>
                      <option value="ordered">Ordered</option>
                      <option value="delivered">Delivered</option>
                      <option value="paid">Paid</option>
                    </select>
                  </label>
                  <button type="submit" disabled={busy}>
                    Apply
                  </button>
                </statusFetcher.Form>

                <photoFetcher.Form
                  method="post"
                  action="/app/work-orders"
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
                    <span style={{ fontSize: "0.9em" }}>Fulfillment photo</span>
                    <input
                      type="file"
                      name="photo"
                      accept="image/jpeg,image/png,image/webp"
                      required
                      disabled={busy}
                    />
                  </label>
                  <button type="submit" disabled={busy}>
                    {job.hasFulfillmentPhoto ? "Replace photo" : "Upload photo"}
                  </button>
                </photoFetcher.Form>
              </div>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
