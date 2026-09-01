import { useCallback, useEffect, useMemo, useState } from "react";
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

/** An order can join a batch when it has an open drop with something still outstanding on it. */
function isBatchEligible(job: AdminOrderQueueJobRow): boolean {
  return (
    !job.paidAt &&
    job.hasPhasedDelivery &&
    Boolean(job.openPhaseId) &&
    job.deliveryInputs.length > 0
  );
}

/** "12 Main St, Ottawa · Dave Renaud (613) 555-0134" — enough to spot an order that was not on the truck. */
function deliveryContextLine(job: AdminOrderQueueJobRow): string {
  const where =
    job.deliveryMethod === "pickup"
      ? "In store pickup"
      : job.deliveryAddressLine || "No delivery address";
  const who = [job.siteContactName, job.siteContactPhone]
    .filter(Boolean)
    .join(" ");
  return who ? `${where} · ${who}` : where;
}

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
  const batchFetcher = useFetcher<ActionData>();
  const busy =
    statusFetcher.state !== "idle" ||
    photoFetcher.state !== "idle" ||
    batchFetcher.state !== "idle";
  const storefrontProjectBase = useMemo(
    () => `https://${shop}/apps/project-clad/project`,
    [shop],
  );

  const eligibleIds = useMemo(
    () => jobs.filter(isBatchEligible).map((job) => job.id),
    [jobs],
  );
  const [selected, setSelected] = useState<string[]>([]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  /* Drop anything that stopped being eligible after a reload, otherwise a stale id would be
     posted and come back as a per-order failure nobody can act on. */
  useEffect(() => {
    setSelected((prev) => prev.filter((id) => eligibleIds.includes(id)));
  }, [eligibleIds]);

  /* A confirmed batch leaves its checkboxes ticked over orders that are now delivered. */
  useEffect(() => {
    if (batchFetcher.state === "idle" && batchFetcher.data?.ok) {
      setSelected([]);
    }
  }, [batchFetcher.state, batchFetcher.data]);

  const toggle = useCallback((jobId: string) => {
    setSelected((prev) =>
      prev.includes(jobId)
        ? prev.filter((id) => id !== jobId)
        : [...prev, jobId],
    );
  }, []);

  const allSelected =
    eligibleIds.length > 0 && selected.length === eligibleIds.length;

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
        {batchFetcher.data?.ok === false ? (
          <s-banner tone="critical">{batchFetcher.data.error}</s-banner>
        ) : null}
        {statusFetcher.data?.ok === true && statusFetcher.data.message ? (
          <s-banner tone="success">{statusFetcher.data.message}</s-banner>
        ) : null}
        {photoFetcher.data?.ok === true && photoFetcher.data.message ? (
          <s-banner tone="success">{photoFetcher.data.message}</s-banner>
        ) : null}
        {batchFetcher.data?.ok === true && batchFetcher.data.message ? (
          <s-banner tone="success">{batchFetcher.data.message}</s-banner>
        ) : null}

        {/*
          One drop often covers several orders. Without this, staff attached the photo to one
          of them and the rest sat looking undelivered.
        */}
        {eligibleIds.length > 1 ? (
          <batchFetcher.Form
            method="post"
            action="/app/work-orders"
            encType="multipart/form-data"
            style={{
              border: "1px solid rgba(0,0,0,0.16)",
              borderRadius: 8,
              padding: "12px 16px",
              marginBottom: 16,
              background: "rgba(0,0,0,0.02)",
            }}
          >
            <input type="hidden" name="intent" value="batch-confirm-delivery" />
            {selected.map((id) => (
              <input key={id} type="hidden" name="jobIds" value={id} />
            ))}

            <p style={{ margin: 0, fontWeight: 600 }}>
              Batch delivery — one photo, several orders
            </p>
            <p style={{ margin: "4px 0 10px", fontSize: "0.9em", opacity: 0.85 }}>
              Tick the orders that arrived on this drop, then upload the single
              photo. Every selected order is marked delivered in full and gets
              its own customer and finance email.
            </p>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
              }}
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => setSelected(allSelected ? [] : eligibleIds)}
              >
                {allSelected ? "Clear selection" : "Select all"}
              </button>
              <span style={{ fontSize: "0.9em", opacity: 0.85 }}>
                {selected.length} of {eligibleIds.length} selected
              </span>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: "0.9em" }}>Delivery photo</span>
                <input
                  type="file"
                  name="photo"
                  accept="image/jpeg,image/png,image/webp"
                  required
                  disabled={busy}
                />
              </label>
              <button type="submit" disabled={busy || selected.length === 0}>
                {batchFetcher.state !== "idle"
                  ? "Confirming…"
                  : selected.length === 1
                    ? "Confirm 1 delivery"
                    : `Confirm ${selected.length} deliveries`}
              </button>
            </div>
          </batchFetcher.Form>
        ) : null}

        {jobs.length === 0 ? (
          <s-paragraph>{emptyMessage}</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {jobs.map((job) => {
              const eligible = isBatchEligible(job);
              const checked = selectedSet.has(job.id);
              return (
                <div
                  key={job.id}
                  style={{
                    border: checked
                      ? "1px solid rgba(0,90,200,0.55)"
                      : "1px solid rgba(0,0,0,0.12)",
                    borderRadius: 8,
                    padding: "12px 16px",
                    background: checked ? "rgba(0,90,200,0.04)" : undefined,
                  }}
                >
                  {eligible && eligibleIds.length > 1 ? (
                    <label
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        marginBottom: 8,
                        fontSize: "0.9em",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={busy}
                        onChange={() => toggle(job.id)}
                      />
                      <span>Include in batch delivery</span>
                    </label>
                  ) : null}

                  <p style={{ margin: 0, fontWeight: 600 }}>
                    {job.orderNumber != null ? `#${job.orderNumber} · ` : ""}
                    {job.projectName}
                    <span style={{ fontWeight: 400, opacity: 0.85 }}>
                      {" "}
                      — {job.name}
                      {job.orderName ? ` (${job.orderName})` : ""}
                    </span>
                  </p>

                  <p
                    style={{
                      margin: "4px 0 0",
                      fontSize: "0.9em",
                      opacity: 0.85,
                    }}
                  >
                    {deliveryContextLine(job)}
                  </p>

                  <p
                    style={{
                      margin: "4px 0 8px",
                      fontSize: "0.9em",
                      opacity: 0.85,
                    }}
                  >
                    {new Date(job.createdAt).toLocaleString()} · Status:{" "}
                    <strong>
                      {job.orderLifecycleStatus === "ordered"
                        ? "Ordered"
                        : "Delivered"}
                    </strong>
                    {" · "}
                    <strong>{job.deliveredPercent}% delivered</strong>
                    {job.confirmedPhaseCount > 0
                      ? ` · ${job.confirmedPhaseCount} deliver${job.confirmedPhaseCount === 1 ? "y" : "ies"} confirmed`
                      : null}
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
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <input
                      type="hidden"
                      name="intent"
                      value="update-order-lifecycle"
                    />
                    <input type="hidden" name="jobId" value={job.id} />
                    <label
                      style={{ display: "flex", gap: 8, alignItems: "center" }}
                    >
                      <span style={{ fontSize: "0.9em" }}>Order status</span>
                      <select
                        name="status"
                        defaultValue={job.orderLifecycleStatus}
                        disabled={Boolean(job.paidAt) || busy}
                      >
                        <option value="ordered">Ordered</option>
                        <option value="delivered">Delivered</option>
                        <option value="paid">Paid</option>
                      </select>
                    </label>
                    <button type="submit" disabled={Boolean(job.paidAt) || busy}>
                      Apply
                    </button>
                  </statusFetcher.Form>

                  {!job.paidAt && job.hasPhasedDelivery && job.openPhaseId ? (
                    <photoFetcher.Form
                      method="post"
                      action="/app/work-orders"
                      encType="multipart/form-data"
                      style={{ marginTop: 12 }}
                    >
                      <input
                        type="hidden"
                        name="intent"
                        value="upload-phase-fulfillment-photo"
                      />
                      <input type="hidden" name="jobId" value={job.id} />
                      <input
                        type="hidden"
                        name="phaseId"
                        value={job.openPhaseId}
                      />
                      <p
                        style={{
                          margin: "0 0 8px",
                          fontSize: "0.9em",
                          fontWeight: 600,
                        }}
                      >
                        Delivery {job.openPhaseSequence ?? "?"} — mark what
                        arrived
                      </p>
                      {job.deliveryInputs.length === 0 ? (
                        <p
                          style={{
                            margin: 0,
                            fontSize: "0.9em",
                            opacity: 0.85,
                          }}
                        >
                          No remaining quantity on this drop. Reload the page.
                        </p>
                      ) : (
                        <table
                          style={{
                            width: "100%",
                            fontSize: "0.9rem",
                            borderCollapse: "collapse",
                            marginBottom: 8,
                          }}
                        >
                          <thead>
                            <tr>
                              <th
                                style={{
                                  textAlign: "left",
                                  padding: "4px 8px 4px 0",
                                }}
                              >
                                Line
                              </th>
                              <th style={{ textAlign: "left", padding: "4px 8px" }}>
                                Ordered
                              </th>
                              <th style={{ textAlign: "left", padding: "4px 8px" }}>
                                Remaining
                              </th>
                              <th style={{ textAlign: "left", padding: "4px 0" }}>
                                Qty this delivery
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {job.deliveryInputs.map((line) => (
                              <tr key={line.jobItemId}>
                                <td style={{ padding: "4px 8px 4px 0" }}>
                                  {line.displayName}
                                </td>
                                <td style={{ padding: "4px 8px" }}>
                                  {line.orderedQuantity}
                                </td>
                                <td style={{ padding: "4px 8px" }}>
                                  {line.remaining}
                                </td>
                                <td style={{ padding: "4px 0" }}>
                                  <input
                                    type="number"
                                    name={`qty_${line.jobItemId}`}
                                    min={0}
                                    max={line.remaining}
                                    step={1}
                                    defaultValue={line.remaining}
                                    disabled={busy}
                                    style={{ width: "5rem" }}
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 8,
                          alignItems: "center",
                        }}
                      >
                        <label
                          style={{ display: "flex", gap: 8, alignItems: "center" }}
                        >
                          <span style={{ fontSize: "0.9em" }}>
                            Fulfillment photo
                          </span>
                          <input
                            type="file"
                            name="photo"
                            accept="image/jpeg,image/png,image/webp"
                            required
                            disabled={busy}
                          />
                        </label>
                        <button
                          type="submit"
                          disabled={busy || job.deliveryInputs.length === 0}
                        >
                          Confirm delivery
                        </button>
                      </div>
                    </photoFetcher.Form>
                  ) : null}

                  {!job.paidAt &&
                  job.hasPhasedDelivery &&
                  !job.openPhaseId &&
                  job.deliveredPercent >= 100 ? (
                    <p
                      style={{
                        margin: "12px 0 0",
                        fontSize: "0.9em",
                        opacity: 0.85,
                      }}
                    >
                      All items delivered. Mark Paid when invoicing is complete.
                    </p>
                  ) : null}

                  {!job.paidAt && !job.hasPhasedDelivery ? (
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
                      <input
                        type="hidden"
                        name="intent"
                        value="upload-fulfillment-photo"
                      />
                      <input type="hidden" name="jobId" value={job.id} />
                      <label
                        style={{ display: "flex", gap: 8, alignItems: "center" }}
                      >
                        <span style={{ fontSize: "0.9em" }}>
                          Fulfillment photo (legacy)
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
                          : "Upload photo"}
                      </button>
                    </photoFetcher.Form>
                  ) : null}
                </div>
              );
            })}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
