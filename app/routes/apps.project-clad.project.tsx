import crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs } from "react-router";
import {
  Form,
  redirect,
  useSearchParams,
  useActionData,
  useLoaderData,
  useLocation,
} from "react-router";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import {
  buildVariantPresentation,
  type OrderLineCaptureV1,
  parseOrderLineCapture,
  parseVariantSnapshot,
  persistVariantSnapshotsFromLive,
  resolveVariantDisplayInfo,
} from "../utils/variantInfo.server";
import {
  fetchCustomerTagsRest,
  findCustomerIdByEmail,
  getCustomersByIds,
} from "../utils/adminCustomers.server";
import {
  customerEmailInConfiguredList,
  hasStaffStorefrontTag,
  hasTag,
  normalizeStorefrontCustomerId,
  viewerHasAdminTag,
} from "../utils/customerTags.server";
import {
  canAdminProjectMembers,
  canEditProject,
  customerIdsMatch,
  isProjectMember,
  shopStringFilter,
} from "../utils/projectAccess.server";
import { verifyPassword } from "../utils/passwords.server";
import { getThemeStyles } from "../utils/themeAssets.server";
import { PROJECT_CLAD_CURSOR_GLOW_SCRIPT } from "../utils/projectCladCursorGlowScript";
import { rewriteProjectCladProxyFontUrls } from "../utils/projectCladProxyStyles.server";
import { ProjectCladStorefrontNav } from "../components/ProjectCladStorefrontNav";
import { getStorefrontAppNav } from "../utils/storefrontAppNav";
import { logProjectActivity } from "../utils/projectActivity.server";
import {
  sendOrderPlacedEmails,
  sendProjectStatusNotificationEmail,
} from "../utils/orderCreatedEmail.server";
import { sendFulfillmentPackageEmails } from "../utils/fulfillmentNotify.server";
import {
  formatOrderDeliveryFootline,
  isKnownOttawaHourWindow,
  isOttawaDeliveryWindowValidForDate,
  isYmdBeforeMin,
  minPreferredDeliveryYmd,
  OTTAWA_DELIVERY_HOUR_WINDOWS,
  PREFERRED_DELIVERY_MIN_DAY_OFFSET_FROM_TODAY,
} from "../utils/preferredDeliveryFormat";
import { buildSignedFulfillmentPhotoUrl } from "../utils/fulfillmentPhotoSignedUrl.server";
import {
  ORDER_DISPLAY_TAX_RATE,
  orderTaxFromSubtotal,
  orderTotalWithTax,
} from "../utils/orderDisplayTax";
import {
  jobNameForOrderSummary,
  jobPurchaseOrderDisplay,
} from "../utils/jobNameDisplay";

type JobItemView = {
  id: string;
  variantId: string;
  quantity: number;
  priceSnapshot: string;
  displayName: string;
  imageUrl: string | null;
  imageAlt: string | null;
  productUrl: string | null;
  /** Upload Part line: customer file URL when stored as an http(s) property (used for link + PDF vs image). */
  uploadPartFileUrl: string | null;
  /** live = Shopify API; snapshot = cached DB; unknown = no product data */
  variantDisplaySource: "live" | "snapshot" | "unknown";
  /** Immutable line snapshot from when the row was saved (may be null on older rows). */
  orderLineCapture: OrderLineCaptureV1 | null;
  properties?: { name: string; value: string }[] | null;
};

/** Cart / Files URLs usually end in `.pdf`; `<img>` cannot preview PDFs. */
function isLikelyPdfUrl(url: string): boolean {
  const t = url.trim();
  if (!/^https?:\/\//i.test(t)) return false;
  try {
    const u = new URL(t);
    return /\.pdf(\?|$)/i.test(u.pathname);
  } catch {
    return /\.pdf(\?|$)/i.test(t);
  }
}

function PdfGlyphSvg({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 40"
      width="32"
      height="40"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="var(--color-1, #c40000)"
        d="M2 5a4 4 0 0 1 4-4h14.5L30 12.5V35a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V5z"
      />
      <path fill="#8f0000" d="M20.5 1H22l8 8v1.5H24a4 4 0 0 1-4-4V1z" />
      <rect x="5" y="18" width="22" height="14" rx="2" fill="#fff" opacity="0.95" />
      <path
        fill="var(--color-1, #c40000)"
        d="M8 22h4.2v1.6H8V22zm0 3.4h6.4v1.6H8v-1.6zm7.2-3.4H24l-1.4 4.2h-2.8l1.4-4.2z"
      />
    </svg>
  );
}

function PdfThumbIcon({ label = "PDF document" }: { label?: string }) {
  return (
    <span className="project-clad-thumb project-clad-thumb--pdf" role="img" aria-label={label}>
      <PdfGlyphSvg />
    </span>
  );
}

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
  /** Cart / customer "PURCHASE ORDER #" (not Shopify `orderName`). */
  purchaseOrderNumber: string | null;
  items: JobItemView[];
  subtotal: number;
  orderLifecycleStatus: string;
  scheduledDeliveryDate: string | null;
  scheduledDeliveryWindow: string | null;
  fulfillmentMethod: string | null;
  hasFulfillmentPhoto: boolean;
  fulfillmentPhotoUrl: string | null;
};

function jobMatchesOrderSearch(job: JobView, qRaw: string): boolean {
  const q = qRaw.trim().toLowerCase();
  if (!q) return true;
  const parts = q.split(/\s+/).filter(Boolean);
  const hay = [
    job.name,
    job.orderName || "",
    job.purchaseOrderNumber || "",
    ...job.items.map((item) => item.displayName),
  ]
    .join(" ")
    .toLowerCase();
  return parts.every((part) => hay.includes(part));
}

/** Optional per-line unit price from save-order-edit JSON (two decimals for Prisma `Decimal`). */
function parseOptionalUnitPrice(raw: unknown): string | null {
  if (raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0 || raw > 99_999_999) return null;
    return raw.toFixed(2);
  }
  if (typeof raw === "string") {
    const t = raw.trim().replace(/,/g, "");
    if (!t) return null;
    const n = parseFloat(t);
    if (!Number.isFinite(n) || n < 0 || n > 99_999_999) return null;
    return n.toFixed(2);
  }
  return null;
}

/**
 * App proxy often omits `logged_in_customer_email` from the signed query string; fall back to
 * Admin API `getCustomersByIds` map (same source as member roster emails).
 */
function viewerEmailForPricingAllowlist(
  proxyEmail: string | undefined,
  customerId: string,
  viewerNumericId: string,
  customerInfo: Awaited<ReturnType<typeof getCustomersByIds>>,
): string | undefined {
  const fromProxy = proxyEmail?.trim();
  if (fromProxy) return fromProxy;
  for (const k of [
    viewerNumericId,
    customerId,
    normalizeStorefrontCustomerId(customerId),
  ]) {
    if (!k) continue;
    const row = customerInfo[k];
    const e = row?.email?.trim();
    if (e) return e;
  }
  for (const info of Object.values(customerInfo)) {
    if (info?.id && customerIdsMatch(info.id, customerId)) {
      const e = info.email?.trim();
      if (e) return e;
    }
  }
  return undefined;
}

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
  shipAddress1: string | null;
  shipCity: string | null;
  shipProvince: string | null;
  shipPostal: string | null;
  shipCountry: string | null;
  /** Project default: delivery (+fee) vs store pickup (no address required on project). */
  receiveMode: "delivery" | "pickup";
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

/** Per-order delivery line in order footers (display; not taxed). */
const PROJECT_DELIVERY_FEE = 15;

function hasCompleteShipToDetails(project: {
  shipAddress1?: string | null;
  shipCity?: string | null;
  shipProvince?: string | null;
  shipPostal?: string | null;
}) {
  return Boolean(
    project.shipAddress1?.trim() &&
      project.shipCity?.trim() &&
      project.shipProvince?.trim() &&
      project.shipPostal?.trim(),
  );
}

const formatPrice = (value: string | number) => {
  const num = Number(value || 0);
  if (Number.isNaN(num)) return "$0.00";
  return `$${num.toFixed(2)}`;
};

const CANADA_PROVINCE_OPTIONS: { code: string; label: string }[] = [
  { code: "AB", label: "Alberta" },
  { code: "BC", label: "British Columbia" },
  { code: "MB", label: "Manitoba" },
  { code: "NB", label: "New Brunswick" },
  { code: "NL", label: "Newfoundland and Labrador" },
  { code: "NS", label: "Nova Scotia" },
  { code: "NT", label: "Northwest Territories" },
  { code: "NU", label: "Nunavut" },
  { code: "ON", label: "Ontario" },
  { code: "PE", label: "Prince Edward Island" },
  { code: "QC", label: "Quebec" },
  { code: "SK", label: "Saskatchewan" },
  { code: "YT", label: "Yukon" },
];

function PreferredDeliveryScheduleFields({
  job,
  minYmd,
}: {
  job: JobView;
  minYmd: string | undefined;
}) {
  const [dateVal, setDateVal] = useState(job.scheduledDeliveryDate ?? "");
  const [windowVal, setWindowVal] = useState(job.scheduledDeliveryWindow ?? "");

  useEffect(() => {
    setDateVal(job.scheduledDeliveryDate ?? "");
    setWindowVal(job.scheduledDeliveryWindow ?? "");
  }, [job.id, job.scheduledDeliveryDate, job.scheduledDeliveryWindow]);

  const now = new Date();

  return (
    <div className="project-clad-preferred-delivery-fields">
      <div
        className="project-clad-preferred-delivery-row"
        role="group"
        aria-label="Preferred delivery day and time"
      >
        <div className="project-clad-preferred-delivery-field project-clad-preferred-delivery-field--date">
          <input
            type="date"
            name="scheduledDeliveryDate"
            value={dateVal}
            onChange={(e) => {
              const v = e.target.value;
              setDateVal(v);
              if (!v.trim()) {
                setWindowVal("");
                return;
              }
              setWindowVal((prev) =>
                prev && !isOttawaDeliveryWindowValidForDate(prev, v, new Date())
                  ? ""
                  : prev,
              );
            }}
            min={minYmd}
            className="project-clad-preferred-delivery-input"
            aria-label="Delivery day"
          />
        </div>
        <span className="project-clad-preferred-delivery-between">between</span>
        <div className="project-clad-preferred-delivery-field project-clad-preferred-delivery-field--time">
          <select
            name="scheduledDeliveryWindow"
            disabled={!dateVal.trim()}
            value={windowVal}
            onChange={(e) => setWindowVal(e.target.value)}
            className="project-clad-preferred-delivery-input"
            aria-label="Delivery time"
          >
          <option value="">
            {!dateVal.trim() ? "Select a day first…" : "Select…"}
          </option>
          {OTTAWA_DELIVERY_HOUR_WINDOWS.map((w) => {
            const ended =
              Boolean(dateVal.trim()) &&
              !isOttawaDeliveryWindowValidForDate(w, dateVal, now);
            return (
              <option key={w} value={w} disabled={ended}>
                {w}
                {ended ? " (ended)" : ""}
              </option>
            );
          })}
          {job.scheduledDeliveryWindow &&
          !isKnownOttawaHourWindow(job.scheduledDeliveryWindow) ? (
            <option value={job.scheduledDeliveryWindow}>
              {job.scheduledDeliveryWindow} (saved)
            </option>
          ) : null}
        </select>
        </div>
      </div>
    </div>
  );
}

function StaffFulfillmentPhotoUpload({
  job,
  projectId,
}: {
  job: JobView;
  projectId: string;
}) {
  const [pickedName, setPickedName] = useState("");
  const inputId = `project-clad-fulfillment-photo-${job.id}`;
  const actionUrl = `/apps/project-clad/project?id=${encodeURIComponent(projectId)}`;

  useEffect(() => {
    setPickedName("");
  }, [job.id]);

  /* Native <form> + full navigation: React Router <Form> can drop multipart file bodies on client navigation. */
  return (
    <form
      method="post"
      action={actionUrl}
      encType="multipart/form-data"
      className="project-clad-staff-fulfillment-photo-form"
    >
      <input type="hidden" name="intent" value="upload-fulfillment-photo" />
      <input type="hidden" name="jobId" value={job.id} />
      <div className="project-clad-staff-fulfillment-upload-row">
        <input
          type="file"
          id={inputId}
          name="photo"
          accept="image/*"
          required
          className="project-clad-staff-fulfillment__file-input"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            setPickedName(f?.name ?? "");
          }}
        />
        {pickedName ? (
          <span
            className="project-clad-staff-fulfillment__picked-name"
            title={pickedName}
          >
            {pickedName}
          </span>
        ) : null}
        <button type="submit" className="project-clad-button">
          Upload photo
        </button>
      </div>
    </form>
  );
}

function defaultCanadaProvinceCode(saved: string | null | undefined): string {
  const p = saved?.trim();
  if (!p) return "ON";
  if (CANADA_PROVINCE_OPTIONS.some((o) => o.code === p)) return p;
  const hit = CANADA_PROVINCE_OPTIONS.find(
    (o) => o.label.toLowerCase() === p.toLowerCase(),
  );
  return hit?.code ?? "ON";
}

function EditProjectDeliveryAddressForm({
  projectId,
  shipAddress1,
  shipCity,
  shipProvince,
  shipPostal,
}: {
  projectId: string;
  shipAddress1: string | null;
  shipCity: string | null;
  shipProvince: string | null;
  shipPostal: string | null;
}) {
  const [draft, setDraft] = useState(() => ({
    shipAddress1: shipAddress1 ?? "",
    shipCity: shipCity ?? "",
    shipPostal: shipPostal ?? "",
    shipProvince: defaultCanadaProvinceCode(shipProvince),
    shipCountry: "Canada",
  }));

  useEffect(() => {
    setDraft({
      shipAddress1: shipAddress1 ?? "",
      shipCity: shipCity ?? "",
      shipPostal: shipPostal ?? "",
      shipProvince: defaultCanadaProvinceCode(shipProvince),
      shipCountry: "Canada",
    });
  }, [shipAddress1, shipCity, shipProvince, shipPostal]);

  return (
    <>
      <h3
        className="project-clad-section-title"
        style={{ marginTop: "1.35rem", marginBottom: "0.5rem", fontSize: "1rem" }}
        data-projectclad-section-underline
      >
        Delivery details
      </h3>
      {/*
        Native form + full document navigation: RR <Form> uses fetch navigation and often
        loses app-proxy signing / session for POST, so pickup/delivery never persisted.
      */}
      <form
        method="post"
        action={`/apps/project-clad/project?id=${encodeURIComponent(projectId)}`}
        className="project-clad-inline-form project-clad-pricing-form"
      >
        <input type="hidden" name="intent" value="update-project-delivery" />
        <label htmlFor="edit-ship-address1">Address</label>
        <input
          id="edit-ship-address1"
          name="shipAddress1"
          type="text"
          value={draft.shipAddress1}
          onChange={(e) =>
            setDraft((d) => ({ ...d, shipAddress1: e.target.value }))
          }
          autoComplete="street-address"
          className="project-clad-pricing-password-input"
        />
        <label htmlFor="edit-ship-city">City</label>
        <input
          id="edit-ship-city"
          name="shipCity"
          type="text"
          value={draft.shipCity}
          onChange={(e) =>
            setDraft((d) => ({ ...d, shipCity: e.target.value }))
          }
          autoComplete="address-level2"
          className="project-clad-pricing-password-input"
        />
        <label htmlFor="edit-ship-province">Province</label>
        <select
          id="edit-ship-province"
          name="shipProvince"
          value={draft.shipProvince}
          onChange={(e) =>
            setDraft((d) => ({ ...d, shipProvince: e.target.value }))
          }
          className="project-clad-pricing-password-input"
        >
          <option value="">—</option>
          {CANADA_PROVINCE_OPTIONS.map(({ code, label }) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
        <label htmlFor="edit-ship-postal">Postal code</label>
        <input
          id="edit-ship-postal"
          name="shipPostal"
          type="text"
          value={draft.shipPostal}
          onChange={(e) =>
            setDraft((d) => ({ ...d, shipPostal: e.target.value }))
          }
          autoComplete="postal-code"
          className="project-clad-pricing-password-input"
        />
        <label htmlFor="edit-ship-country">Country</label>
        <select
          id="edit-ship-country"
          name="shipCountry"
          value={draft.shipCountry}
          onChange={(e) =>
            setDraft((d) => ({ ...d, shipCountry: e.target.value }))
          }
          className="project-clad-pricing-password-input"
        >
          <option value="">—</option>
          <option value="Canada">Canada</option>
        </select>
        <div className="project-clad-actions" style={{ marginTop: "0.75rem", gap: "0.5rem" }}>
          <button type="submit" className="project-clad-button project-clad-reject-modal-btn">
            Save details
          </button>
        </div>
      </form>
    </>
  );
}

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

/** One-line activity text for the timeline (paired with actor + time in the UI). */
function formatActivitySummary(ev: ActivityFeedItem): string {
  const p =
    ev.payload && typeof ev.payload === "object"
      ? (ev.payload as Record<string, unknown>)
      : {};
  switch (ev.type) {
    case "order_created": {
      const jn = String(p.jobName || "Order");
      const from = String(p.copiedFrom || "").trim();
      return from ? `New order ${jn} (from ${from})` : `New order ${jn}`;
    }
    case "order_approved": {
      if (p.scope === "project") {
        return String(p.message || "Project approved");
      }
      const jn = String(p.jobName || "Order");
      return p.itemLine ? `Line approved · ${jn}` : `Order approved · ${jn}`;
    }
    case "order_approved_work_queue":
      return `Queued · ${String(p.jobName || "Order")}`;
    case "work_order_status":
      return `${String(p.from ?? "—")} → ${String(p.to ?? "—")}`;
    case "job_item_variant_swapped":
      return `${String(p.fromLabel || "—")} → ${String(p.toLabel || "—")}`;
    case "order_paid":
      return p.orderName
        ? `Order complete · ${String(p.orderName)}`
        : "Order complete";
    case "approval_requested": {
      if (p.scope === "project") {
        return "Approval requested · entire project";
      }
      const jn = String(p.jobName || "Order");
      return p.itemLine ? `Approval requested (line) · ${jn}` : `Approval requested · ${jn}`;
    }
    case "order_rejected": {
      if (p.scope === "project") {
        const r = String(p.rejectReason || "").trim();
        return r ? `Project approval rejected — ${r}` : "Project approval rejected";
      }
      const jn = String(p.jobName || "Order");
      const r = String(p.rejectReason || "").trim();
      const suffix = r
        ? ` — ${r.length > 90 ? `${r.slice(0, 87)}…` : r}`
        : "";
      return p.itemLine
        ? `Order line rejected · ${jn}${suffix}`
        : `Order rejected · ${jn}${suffix}`;
    }
    case "approval_request_cancelled": {
      if (p.scope === "project") {
        return "Approval request withdrawn · entire project";
      }
      const jn = String(p.jobName || "Order");
      return p.itemLine
        ? `Approval request withdrawn (line) · ${jn}`
        : `Approval request withdrawn · ${jn}`;
    }
    default:
      return ev.type.replace(/_/g, " ");
  }
}

function ProjectActivityCommentLine({
  authorLabel,
  createdAt,
  body,
  emptyAuthorLabel = "Unknown",
}: {
  authorLabel: string;
  createdAt: string;
  body: string;
  /** Shown when authorLabel is blank (e.g. "System" for automated activity). */
  emptyAuthorLabel?: string;
}) {
  const name = authorLabel.trim() || emptyAuthorLabel;
  const when = new Date(createdAt).toLocaleString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const msg = body.replace(/\s+/g, " ").trim();
  const full = `${name} - ${when}: ${msg}`;
  return (
    <div className="project-clad-activity-feed__comment-line" title={full}>
      <span className="project-clad-activity-feed__comment-line-name">{name}</span>
      <span className="project-clad-muted">
        {" "}
        - {when}:{" "}
      </span>
      <span className="project-clad-activity-feed__comment-line-msg">{msg}</span>
    </div>
  );
}

function MemberRoleSelect({
  idPrefix,
  defaultValue = "edit",
}: {
  idPrefix: string;
  defaultValue?: "edit" | "view";
}) {
  const editId = `${idPrefix}-role-edit`;
  const viewId = `${idPrefix}-role-view`;
  const summaryLabel = defaultValue === "edit" ? "Edit" : "View only";
  return (
    <details
      className="project-clad-member-role-select"
      data-projectclad-member-role-select
      id={`${idPrefix}-role-widget`}
    >
      <summary className="project-clad-member-role-select__trigger">
        <span className="project-clad-member-role-select__value" data-role-label>
          {summaryLabel}
        </span>
        <span className="project-clad-member-role-select__chevron" aria-hidden="true">
          ▾
        </span>
      </summary><div className="project-clad-member-role-select__panel"><div className="project-clad-member-role-select__list" role="group">
          <label className="project-clad-member-role-select__option" htmlFor={editId}>
            <input
              id={editId}
              type="radio"
              name="role"
              value="edit"
              defaultChecked={defaultValue === "edit"}
              className="project-clad-member-role-select__input"
            />
            <span className="project-clad-member-role-select__option-text">Edit</span>
          </label>
          <label className="project-clad-member-role-select__option" htmlFor={viewId}>
            <input
              id={viewId}
              type="radio"
              name="role"
              value="view"
              defaultChecked={defaultValue === "view"}
              className="project-clad-member-role-select__input"
            />
            <span className="project-clad-member-role-select__option-text">View only</span>
          </label>
        </div></div>
    </details>
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const proxyStylesCss = rewriteProjectCladProxyFontUrls(request);
  const { shop, customerId: viewerCustomerId, customerEmail } =
    requireAppProxyCustomer(request);
  const customerId = viewerCustomerId as string;
  const themeStyles = await getThemeStyles(shop);
  const settings = await prisma.shopSettings.findFirst({
    where: { shop: shopStringFilter(shop) },
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

  const viewerIsAppAdmin = await viewerHasAdminTag(
    shop,
    customerId,
    customerEmail,
  );

  const project = await prisma.project.findFirst({
    where: { id: projectId, shop: shopStringFilter(shop) },
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

  const viewerNumericId = normalizeStorefrontCustomerId(customerId);
  const memberIds = Array.from(
    new Set([
      project.ownerCustomerId,
      ...project.members.map((member) => member.customerId),
      viewerNumericId,
    ]),
  );
  let customerInfo: Awaited<ReturnType<typeof getCustomersByIds>> = {};
  let memberLookupError: string | null = null;
  try {
    customerInfo = await getCustomersByIds(shop, memberIds);
  } catch (error) {
    memberLookupError =
      error instanceof Error ? error.message : "Member lookup failed.";
  }

  /** REST read of this customer only — matches Shopify Admin tags (avoids GraphQL batch map quirks). */
  const viewerTags = await fetchCustomerTagsRest(
    shop,
    normalizeStorefrontCustomerId(customerId),
  );

  const isMember =
    project.ownerCustomerId === customerId ||
    project.members.some((member) => member.customerId === customerId) ||
    viewerIsAppAdmin;

  if (!isMember) {
    throw new Response("Unauthorized", { status: 403 });
  }

  const isOwner = project.ownerCustomerId === customerId;
  const canEdit = canEditProject(project, customerId, viewerIsAppAdmin);

  const unitPriceEditorAllowlist =
    process.env.PROJECTCLAD_UNIT_PRICE_EDITOR_EMAILS?.trim();
  const viewerEmailResolved = viewerEmailForPricingAllowlist(
    customerEmail,
    customerId,
    viewerNumericId,
    customerInfo,
  );
  const canEditLineUnitPrices =
    Boolean(unitPriceEditorAllowlist) &&
    customerEmailInConfiguredList(viewerEmailResolved, unitPriceEditorAllowlist);

  const shopQ = shopStringFilter(shop);
  const otherProjects = await prisma.project.findMany({
    where: viewerIsAppAdmin
      ? { shop: shopQ, id: { not: projectId } }
      : {
          shop: shopQ,
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
  const { info: variantInfo, error: variantLookupError } =
    await resolveVariantDisplayInfo(shop, variantIds);

  await persistVariantSnapshotsFromLive({
    items: project.jobs.flatMap((job) =>
      job.items.map((item) => ({
        id: item.id,
        variantId: item.variantId,
        variantSnapshot: item.variantSnapshot,
      })),
    ),
    liveByVariantId: variantInfo,
  });

  const hideAddToCart = hasTag(viewerTags, "NA") && !viewerIsAppAdmin;
  const hasNATag = hasTag(viewerTags, "NA");
  const canAdminMembers = canAdminProjectMembers(
    project,
    customerId,
    viewerIsAppAdmin,
    hasNATag,
  );
  const viewerIsAdmin = viewerIsAppAdmin;

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

  const viewerCanFulfill =
    viewerIsAppAdmin || hasStaffStorefrontTag(viewerTags);

  const hasCompleteSavedAddress = hasCompleteShipToDetails({
    shipAddress1: project.shipAddress1,
    shipCity: project.shipCity,
    shipProvince: project.shipProvince,
    shipPostal: project.shipPostal,
  });
  /** Blank ship-to → treat as store pickup until a full address exists. */
  const receiveModeForUi =
    !hasCompleteSavedAddress
      ? "pickup"
      : project.receiveMode === "pickup"
        ? "pickup"
        : "delivery";

  const payload: ProjectView = {
    id: project.id,
    name: project.name,
    poNumber: project.poNumber,
    companyName: project.companyName,
    createdAt: project.createdAt.toISOString(),
    shipAddress1: project.shipAddress1 ?? null,
    shipCity: project.shipCity ?? null,
    shipProvince: project.shipProvince ?? null,
    shipPostal: project.shipPostal ?? null,
    shipCountry: project.shipCountry ?? null,
    receiveMode: receiveModeForUi,
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
        purchaseOrderNumber: job.purchaseOrderNumber ?? null,
        subtotal: jobSubtotal,
        orderLifecycleStatus: job.orderLifecycleStatus,
        scheduledDeliveryDate: job.scheduledDeliveryDate ?? null,
        scheduledDeliveryWindow: job.scheduledDeliveryWindow ?? null,
        fulfillmentMethod: job.fulfillmentMethod ?? null,
        hasFulfillmentPhoto: Boolean(job.fulfillmentPhotoStorageKey),
        fulfillmentPhotoUrl: job.fulfillmentPhotoStorageKey
          ? !hasNATag ||
            viewerIsAppAdmin ||
            job.orderLifecycleStatus === "delivered" ||
            job.orderLifecycleStatus === "paid"
            ? (buildSignedFulfillmentPhotoUrl({ jobId: job.id, shop }) ??
              `/apps/project-clad/fulfillment-photo?jobId=${encodeURIComponent(job.id)}`)
            : null
          : null,
        items: job.items.map((item) => {
          const snap = parseVariantSnapshot(item.variantSnapshot);
          const orderLineCapture = parseOrderLineCapture(item.orderLineCapture);
          const pres = buildVariantPresentation({
            shop,
            variantId: item.variantId,
            live: variantInfo[item.variantId],
            snapshot: snap,
          });
          const displayName =
            pres.source === "unknown" && orderLineCapture
              ? orderLineCapture.displayLabel
              : pres.displayName;
          const productUrl = pres.productUrl;

          let properties: { name: string; value: string }[] | null = null;
          let customImageUrl: string | null = null;
          let uploadPartFileUrl: string | null = null;
          const isUploadPartLine = displayName.toLowerCase().includes("upload part");

          if (item.customData && Array.isArray(item.customData)) {
            properties = item.customData as { name: string; value: string }[];

            // For the special "Upload Part" product, use any URL property as the main image
            if (isUploadPartLine) {
              const uploadProp = properties.find((p) => {
                const v = (p.value || "").trim();
                return v.startsWith("http://") || v.startsWith("https://");
              });
              if (uploadProp) {
                const raw = uploadProp.value.trim();
                uploadPartFileUrl = raw;
                if (!isLikelyPdfUrl(raw)) {
                  customImageUrl = raw;
                }
              }
            }
          }

          const imageUrl =
            customImageUrl ||
            (isUploadPartLine && uploadPartFileUrl && isLikelyPdfUrl(uploadPartFileUrl)
              ? null
              : pres.imageUrl || null);

          return {
            id: item.id,
            variantId: item.variantId,
            quantity: item.quantity,
            priceSnapshot: item.priceSnapshot.toString(),
            displayName,
            imageUrl,
            imageAlt: pres.imageAlt || null,
            productUrl,
            uploadPartFileUrl,
            variantDisplaySource: pres.source,
            orderLineCapture,
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

  const viewerCustomer =
    customerInfo[viewerNumericId] ?? customerInfo[customerId];
  const navName = viewerCustomer?.firstName?.trim();
  const navAccountInitial = navName
    ? navName.charAt(0).toUpperCase()
    : customerEmail?.trim()
      ? customerEmail.trim().charAt(0).toUpperCase()
      : null;

  return {
    proxyStylesCss,
    project: payload,
    otherProjects: otherProjects.map((other) => ({
      id: other.id,
      name: other.name,
    })),
    canViewPricing: !hideAddToCart || hasPricingAccess(request),
    canEdit,
    canEditLineUnitPrices,
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
    memberLookupError,
    variantLookupError,
    themeStyles,
    shop,
    logoDataUrl: settings?.logoDataUrl || null,
    backgroundLogoDataUrl: settings?.backgroundLogoDataUrl || null,
    viewerCanFulfill,
    viewerHasNATag: hasNATag,
    storefrontAppNav: getStorefrontAppNav(settings),
    navAccountInitial,
  };
};

async function emailProjectStatusSnapshot(args: {
  shop: string;
  projectId: string;
  actorCustomerId: string;
  headline: string;
  introLines?: string[];
}) {
  try {
    const p = await prisma.project.findFirst({
      where: { id: args.projectId, shop: shopStringFilter(args.shop) },
      select: {
        id: true,
        name: true,
        poNumber: true,
        companyName: true,
        ownerCustomerId: true,
      },
    });
    if (!p) return;
    await sendProjectStatusNotificationEmail({
      headline: args.headline,
      shop: args.shop,
      projectId: p.id,
      projectName: p.name,
      ownerCustomerId: p.ownerCustomerId,
      actorCustomerId: args.actorCustomerId,
      introLines: args.introLines,
    });
  } catch (err) {
    console.error(
      "[project] status email failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const contentType = request.headers.get("Content-Type") || "";
  const declaresJson = /application\/json|\+json/i.test(contentType);
  // Only skip reading the body as text for multipart uploads. Shopify’s app proxy
  // sometimes mislabels JSON POSTs as urlencoded; if we skip sniffing, jsonOnFail
  // stays false and formData() runs on a JSON body → opaque 400 from the runtime.
  const canSniffJsonBody =
    request.method === "POST" && !/multipart\/form-data/i.test(contentType);

  let postProbe = "";
  if (canSniffJsonBody) {
    postProbe = await request.clone().text();
  }
  /** BOM / whitespace before `{` would skip JSON sniffing and send the body to formData() → opaque 400 HTML. */
  const probeForJsonSniff = postProbe.replace(/^\uFEFF/, "").trimStart();
  /** Match fetch() JSON calls even if the proxy strips Content-Type (still need signed query string). */
  const likelyJsonApiPost =
    request.method === "POST" &&
    (declaresJson || probeForJsonSniff.startsWith("{"));

  const { shop, customerId, customerEmail } = requireAppProxyCustomer(request, {
    jsonOnFail: likelyJsonApiPost,
  });

  let jsonPayload: Record<string, unknown> | null = null;
  if (declaresJson) {
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return Response.json({ error: "Invalid JSON body." }, { status: 400 });
      }
      jsonPayload = parsed as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    if (typeof jsonPayload.intent !== "string") {
      return Response.json(
        { error: 'JSON body must include a string "intent" field.' },
        { status: 400 },
      );
    }
  } else if (likelyJsonApiPost && probeForJsonSniff.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(probeForJsonSniff);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return Response.json({ error: "Invalid JSON body." }, { status: 400 });
      }
      const p = parsed as Record<string, unknown>;
      if (typeof p.intent !== "string") {
        return Response.json(
          { error: 'JSON body must include a string "intent" field.' },
          { status: 400 },
        );
      }
      jsonPayload = p;
    } catch {
      return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    }
  }

  if (jsonPayload) {
    const payload = jsonPayload as {
      intent?: string;
      jobId?: string;
      jobName?: string;
      purchaseOrderNumber?: string;
      jobIds?: string[];
      itemIds?: string[];
      removeItemIds?: string[];
      itemUpdates?: Array<{
        itemId: string;
        quantity: number;
        /** When set (and valid), updates `JobItem.priceSnapshot`. Omitted = leave price unchanged. */
        unitPrice?: number | string;
      }>;
      deleteJob?: boolean;
      fulfillmentMethod?: string;
    };
    const intent = String(payload.intent || "").trim();

    const projectId = getProjectId(request);
    if (!projectId) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }

    const viewerIsAppAdmin = await viewerHasAdminTag(
      shop,
      customerId,
      customerEmail,
    );

    if (intent === "reorder-jobs") {
      const jobIds = payload.jobIds || [];

      const project = await prisma.project.findFirst({
        where: { id: projectId, shop: shopStringFilter(shop) },
        include: { members: true },
      });

      if (!project) {
        return Response.json({ error: "Project not found." }, { status: 404 });
      }

      const canEdit = canEditProject(project, customerId, viewerIsAppAdmin);

      if (!canEdit) {
        return Response.json({ error: "Forbidden." }, { status: 403 });
      }

      if (jobIds.length) {
        const jobs = await prisma.job.findMany({
          where: { id: { in: jobIds }, projectId },
          select: { id: true },
        });

        if (jobs.length !== jobIds.length) {
          return Response.json(
            { error: "Invalid order list." },
            { status: 400 },
          );
        }

        await prisma.$transaction(
          jobIds.map((jobId, index) =>
            prisma.job.update({
              where: { id: jobId },
              data: { sortOrder: index + 1 },
            }),
          ),
        );
        await emailProjectStatusSnapshot({
          shop,
          projectId,
          actorCustomerId: customerId,
          headline: "Orders reordered",
          introLines: [
            "The order list for this project was reordered.",
            "Open the project link below to review the current order list.",
          ],
        });
      }

      return new Response(null, { status: 204 });
    }

    if (intent === "reorder-items") {
      const jobId = payload.jobId || "";
      const itemIds = payload.itemIds || [];

      const project = await prisma.project.findFirst({
        where: { id: projectId, shop: shopStringFilter(shop) },
        include: { members: true },
      });

      if (!project) {
        return Response.json({ error: "Project not found." }, { status: 404 });
      }

      const canEdit = canEditProject(project, customerId, viewerIsAppAdmin);

      if (!canEdit) {
        return Response.json({ error: "Forbidden." }, { status: 403 });
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
        await emailProjectStatusSnapshot({
          shop,
          projectId,
          actorCustomerId: customerId,
          headline: "Order lines reordered",
          introLines: [
            "Line items inside an order were reordered.",
            "Open the project link below to review the updated line order.",
          ],
        });
      }

      return new Response(null, { status: 204 });
    }

    if (intent === "save-order-edit") {
      const jobId = String(payload.jobId || "");
      const jobName =
        typeof payload.jobName === "string" ? payload.jobName.trim() : "";
      const purchaseOrderNumberRaw =
        typeof payload.purchaseOrderNumber === "string"
          ? payload.purchaseOrderNumber.trim()
          : "";
      const removeItemIds = Array.isArray(payload.removeItemIds)
        ? payload.removeItemIds.filter((id): id is string => typeof id === "string")
        : [];
      const itemUpdates = Array.isArray(payload.itemUpdates)
        ? (
            payload.itemUpdates as Array<{
              itemId?: unknown;
              quantity?: unknown;
              unitPrice?: unknown;
            }>
          ).filter(
            (u) =>
              typeof u?.itemId === "string" &&
              typeof u?.quantity === "number" &&
              u.quantity >= 0,
          )
        : [];
      const deleteJob = Boolean(payload.deleteJob);

      const project = await prisma.project.findFirst({
        where: { id: projectId, shop: shopStringFilter(shop) },
        include: { members: true },
      });

      if (!project) {
        return Response.json({ error: "Project not found." }, { status: 404 });
      }

      const canEdit = canEditProject(project, customerId, viewerIsAppAdmin);

      if (!canEdit) {
        return Response.json({ error: "Forbidden." }, { status: 403 });
      }

      const unitPriceEditorAllowlist =
        process.env.PROJECTCLAD_UNIT_PRICE_EDITOR_EMAILS?.trim();
      const wantsUnitPriceChange = itemUpdates.some(
        (u) => parseOptionalUnitPrice(u.unitPrice) !== null,
      );
      let viewerEmailResolved = customerEmail?.trim() || undefined;
      if (!viewerEmailResolved && wantsUnitPriceChange && unitPriceEditorAllowlist) {
        try {
          const nid = normalizeStorefrontCustomerId(customerId);
          const map = await getCustomersByIds(shop, [nid, customerId]);
          viewerEmailResolved = viewerEmailForPricingAllowlist(
            undefined,
            customerId,
            nid,
            map,
          );
        } catch {
          // ignore — allow check fails below
        }
      }
      const allowUnitPricePersistence =
        Boolean(unitPriceEditorAllowlist) &&
        customerEmailInConfiguredList(viewerEmailResolved, unitPriceEditorAllowlist);
      if (wantsUnitPriceChange) {
        if (!unitPriceEditorAllowlist) {
          return Response.json(
            {
              error:
                "Line unit price edits require PROJECTCLAD_UNIT_PRICE_EDITOR_EMAILS on the app server.",
            },
            { status: 403 },
          );
        }
        if (!allowUnitPricePersistence) {
          return Response.json(
            { error: "You are not allowed to change line unit prices." },
            { status: 403 },
          );
        }
      }

      if (jobId) {
        const job = await prisma.job.findFirst({
          where: { id: jobId, projectId },
          include: { orderLink: true, items: true },
        });

        if (job) {
          const isLocked = job.isLocked || Boolean(job.orderLink);
          if (!isLocked) {
            let didChange = false;
            const jobTitleForMessage = job.name;

            if (deleteJob) {
              await prisma.job.delete({ where: { id: jobId } });
              didChange = true;
              await emailProjectStatusSnapshot({
                shop,
                projectId,
                actorCustomerId: customerId,
                headline: "Order deleted from project",
                introLines: [
                  `The order "${jobTitleForMessage}" was removed from this project.`,
                  "Open the project link below to see what remains on the project.",
                ],
              });
            } else {
              if (removeItemIds.length) {
                for (const rid of removeItemIds) {
                  if (job.items.some((i) => i.id === rid)) {
                    await prisma.jobItem.delete({ where: { id: rid } });
                    didChange = true;
                  }
                }
              }
              const nextPo =
                purchaseOrderNumberRaw === ""
                  ? null
                  : purchaseOrderNumberRaw;
              const prevPo = job.purchaseOrderNumber ?? null;
              const nameChanged = Boolean(jobName && jobName !== job.name);
              const poChanged = nextPo !== prevPo;
              if (nameChanged || poChanged) {
                await prisma.job.update({
                  where: { id: jobId },
                  data: {
                    ...(nameChanged ? { name: jobName } : {}),
                    ...(poChanged ? { purchaseOrderNumber: nextPo } : {}),
                  },
                });
                didChange = true;
              }
              for (const u of itemUpdates) {
                const itemId = u.itemId as string;
                const quantity = u.quantity as number;
                const row = job.items.find((i) => i.id === itemId);
                if (!row || quantity < 0) continue;
                const priceStr = allowUnitPricePersistence
                  ? parseOptionalUnitPrice(u.unitPrice)
                  : null;
                const data: { quantity: number; priceSnapshot?: string } = {
                  quantity,
                };
                if (priceStr !== null) {
                  data.priceSnapshot = priceStr;
                }
                await prisma.jobItem.update({
                  where: { id: itemId },
                  data,
                });
                didChange = true;
              }
              if (didChange) {
                await emailProjectStatusSnapshot({
                  shop,
                  projectId,
                  actorCustomerId: customerId,
                  headline: "Order updated on project page",
                  introLines: [
                    `Someone edited order "${jobTitleForMessage}" (quantities, line unit prices, name, or removed lines).`,
                    "Open the project link below to review the current order contents.",
                  ],
                });
              }
            }
          }
        }
      }

      return redirectToProject(request, projectId, shop);
    }

    if (intent === "confirm-order-now") {
      const jobId = String(payload.jobId || "");
      if (!jobId) {
        return Response.json({ error: "Order is required." }, { status: 400 });
      }

      const project = await prisma.project.findFirst({
        where: { id: projectId, shop: shopStringFilter(shop) },
        include: { members: true },
      });
      if (!project) {
        return Response.json({ error: "Project not found." }, { status: 404 });
      }

      const canEdit = canEditProject(project, customerId, viewerIsAppAdmin);
      if (!canEdit) {
        return Response.json(
          { error: "You do not have permission to place this order." },
          { status: 403 },
        );
      }

      const job = await prisma.job.findFirst({
        where: { id: jobId, projectId },
      });
      if (!job) {
        return Response.json({ error: "Order not found." }, { status: 404 });
      }
      const viewerTagsForOrder = await fetchCustomerTagsRest(
        shop,
        normalizeStorefrontCustomerId(customerId),
      );
      const viewerHasNATagForOrder = hasTag(viewerTagsForOrder, "NA");
      const orderNowSkipsApprovalReview =
        !viewerHasNATagForOrder || viewerIsAppAdmin;

      if (
        job.orderLifecycleStatus !== "ready_to_order" &&
        !(
          orderNowSkipsApprovalReview &&
          job.orderLifecycleStatus === "draft"
        )
      ) {
        return Response.json(
          { error: "This order is not ready for Order now." },
          { status: 400 },
        );
      }

      const arJob = await prisma.approvalRequest.findUnique({
        where: {
          projectId_jobId_itemId: {
            projectId,
            jobId,
            itemId: "",
          },
        },
      });
      const arProject = await prisma.approvalRequest.findUnique({
        where: {
          projectId_jobId_itemId: {
            projectId,
            jobId: "",
            itemId: "",
          },
        },
      });
      const approvedAt = arJob?.approvedAt ?? arProject?.approvedAt;
      if (!orderNowSkipsApprovalReview && !approvedAt) {
        return Response.json(
          { error: "Staff approval is required before ordering." },
          { status: 400 },
        );
      }

      const methodRaw = String(payload.fulfillmentMethod || "")
        .trim()
        .toLowerCase();
      if (methodRaw !== "delivery" && methodRaw !== "pickup") {
        return Response.json(
          { error: 'Choose "Delivery" or "Store pickup" before placing the order.' },
          { status: 400 },
        );
      }
      const fulfillmentMethod =
        methodRaw === "pickup" ? "pickup" : "delivery";

      if (fulfillmentMethod === "delivery") {
        const shipOk = Boolean(
          project.shipAddress1?.trim() &&
            project.shipCity?.trim() &&
            project.shipProvince?.trim() &&
            project.shipPostal?.trim(),
        );
        if (!shipOk) {
          return Response.json(
            {
              error:
                "Add a complete delivery address on the project before ordering for delivery.",
            },
            { status: 400 },
          );
        }
      }

      try {
        await prisma.job.update({
          where: { id: jobId },
          data: {
            orderLifecycleStatus: "ordered",
            fulfillmentMethod,
          },
        });
      } catch (e) {
        const detail =
          e instanceof Error ? e.message : "Database error while confirming order.";
        console.error("[project-clad] confirm-order-now prisma error:", e);
        return Response.json({ error: detail }, { status: 500 });
      }
      try {
        await sendOrderPlacedEmails({
          shop,
          projectId,
          jobId,
          fulfillmentMethod,
          actorCustomerId: customerId,
        });
      } catch (err) {
        console.error(
          "[project] order placed email failed:",
          err instanceof Error ? err.message : err,
        );
      }
      return Response.json({ ok: true });
    }

    return Response.json(
      {
        error: intent
          ? `Unknown action "${intent}". Reload the page and try again.`
          : "Missing action. Reload the page and try again.",
      },
      { status: 400 },
    );
  }

  const formData = await request.formData();
  const projectId =
    getProjectId(request) || String(formData.get("id") || "");

  if (!projectId) {
    return new Response("Project not found", { status: 404 });
  }

  const intent = String(formData.get("intent") || "");

  const project = await prisma.project.findFirst({
    where: { id: projectId, shop: shopStringFilter(shop) },
    include: { members: true },
  });

  if (!project) {
    throw new Response("Project not found", { status: 404 });
  }

  const viewerIsAppAdmin = await viewerHasAdminTag(
    shop,
    customerId,
    customerEmail,
  );
  const isMember =
    isProjectMember(project, customerId, viewerIsAppAdmin);

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

  const canEdit = canEditProject(project, customerId, viewerIsAppAdmin);
  const viewerTagsForAction = await fetchCustomerTagsRest(
    shop,
    normalizeStorefrontCustomerId(customerId),
  );
  const viewerHasNATag = hasTag(viewerTagsForAction, "NA");
  const viewerCanFulfill =
    viewerIsAppAdmin || hasStaffStorefrontTag(viewerTagsForAction);
  const canAdminMembers = canAdminProjectMembers(
    project,
    customerId,
    viewerIsAppAdmin,
    viewerHasNATag,
  );

  if (intent === "save-order-schedule") {
    const staffScheduleBypass =
      viewerCanFulfill && formData.get("staffSchedule") === "1";
    if (!canEdit && !staffScheduleBypass) {
      throw new Response("Forbidden", { status: 403 });
    }
    const jobId = String(formData.get("jobId") || "");
    const job = await prisma.job.findFirst({
      where: { id: jobId, projectId },
    });
    if (!job) {
      throw new Response("Order not found", { status: 404 });
    }
    const dateRaw = String(formData.get("scheduledDeliveryDate") || "").trim();
    const windowRaw = String(
      formData.get("scheduledDeliveryWindow") || "",
    ).trim();
    const staffOverride = staffScheduleBypass;
    if (
      !staffOverride &&
      (job.orderLifecycleStatus === "ordered" ||
        job.orderLifecycleStatus === "delivered" ||
        job.orderLifecycleStatus === "paid")
    ) {
      const origin = getStorefrontOriginForAppProxyRedirect(request, shop);
      return redirect(
        `${origin}${storefrontProjectActionPath}?id=${encodeURIComponent(projectId)}&scheduleLocked=1`,
      );
    }
    if (
      !staffOverride &&
      dateRaw &&
      isYmdBeforeMin(
        dateRaw,
        minPreferredDeliveryYmd(PREFERRED_DELIVERY_MIN_DAY_OFFSET_FROM_TODAY),
      )
    ) {
      const origin = getStorefrontOriginForAppProxyRedirect(request, shop);
      return redirect(
        `${origin}${storefrontProjectActionPath}?id=${encodeURIComponent(projectId)}&scheduleDateError=1`,
      );
    }
    if (windowRaw.trim() && !dateRaw.trim()) {
      const origin = getStorefrontOriginForAppProxyRedirect(request, shop);
      return redirect(
        `${origin}${storefrontProjectActionPath}?id=${encodeURIComponent(projectId)}&scheduleWindowNeedsDate=1`,
      );
    }
    if (
      dateRaw.trim() &&
      windowRaw.trim() &&
      !isOttawaDeliveryWindowValidForDate(windowRaw, dateRaw, new Date())
    ) {
      const origin = getStorefrontOriginForAppProxyRedirect(request, shop);
      return redirect(
        `${origin}${storefrontProjectActionPath}?id=${encodeURIComponent(projectId)}&scheduleWindowPastError=1`,
      );
    }
    await prisma.job.update({
      where: { id: jobId },
      data: {
        scheduledDeliveryDate: dateRaw || null,
        scheduledDeliveryWindow: windowRaw || null,
      },
    });
    return redirectToProject(request, projectId, shop);
  }

  if (intent === "upload-fulfillment-photo") {
    if (!viewerCanFulfill) {
      throw new Response("Forbidden", { status: 403 });
    }
    const jobId = String(formData.get("jobId") || "");
    const file = formData.get("photo");
    const job = await prisma.job.findFirst({
      where: { id: jobId, projectId },
    });
    if (!job) {
      throw new Response("Order not found", { status: 404 });
    }
    if (job.orderLifecycleStatus !== "ordered") {
      throw new Response(
        "Photo upload is only allowed while the order is in Ordered status.",
        { status: 400 },
      );
    }
    if (!(file instanceof File) || file.size === 0) {
      throw new Response("Photo file is required.", { status: 400 });
    }
    if (file.size > 8 * 1024 * 1024) {
      throw new Response("Photo must be 8MB or smaller.", { status: 400 });
    }
    const orig = (file.name || "photo.jpg").toLowerCase();
    const ext = orig.endsWith(".png")
      ? ".png"
      : orig.endsWith(".webp")
        ? ".webp"
        : ".jpg";
    const shopDir = shop.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const storageKey = `${shopDir}/${jobId}-${Date.now()}${ext}`;
    const root = path.resolve(process.cwd(), "storage", "fulfillment-photos");
    const abs = path.resolve(root, storageKey);
    if (!abs.startsWith(root + path.sep)) {
      throw new Response("Invalid path", { status: 400 });
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(abs, buf);

    await prisma.job.update({
      where: { id: jobId },
      data: {
        fulfillmentPhotoStorageKey: storageKey,
        orderLifecycleStatus: "delivered",
        ...(job.completedAt ? {} : { completedAt: new Date() }),
      },
    });

    if (!job.fulfillmentNotifiedAt) {
      try {
        await sendFulfillmentPackageEmails({
          shop,
          projectId,
          jobId,
        });
        await prisma.job.update({
          where: { id: jobId },
          data: { fulfillmentNotifiedAt: new Date() },
        });
      } catch (err) {
        console.error(
          "[project] fulfillment notify failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    return redirectToProject(request, projectId, shop);
  }

  if (intent === "staff-mark-order-paid") {
    if (!viewerCanFulfill) {
      throw new Response("Forbidden", { status: 403 });
    }
    const jobId = String(formData.get("jobId") || "");
    const job = await prisma.job.findFirst({
      where: { id: jobId, projectId },
    });
    if (!job) {
      throw new Response("Order not found", { status: 404 });
    }
    if (job.orderLifecycleStatus !== "delivered") {
      throw new Response(
        "Mark paid is only available after delivery (photo uploaded).",
        { status: 400 },
      );
    }
    await prisma.job.update({
      where: { id: jobId },
      data: {
        orderLifecycleStatus: "paid",
        paidAt: new Date(),
      },
    });
    return redirectToProject(request, projectId, shop);
  }

  if (intent === "staff-set-order-lifecycle") {
    if (!viewerCanFulfill) {
      throw new Response("Forbidden", { status: 403 });
    }
    const jobId = String(formData.get("jobId") || "");
    const next = String(formData.get("lifecycleStatus") || "").trim();
    const allowed = [
      "draft",
      "pending_review",
      "ready_to_order",
      "ordered",
      "delivered",
      "paid",
    ] as const;
    if (!allowed.includes(next as (typeof allowed)[number])) {
      throw new Response("Invalid status", { status: 400 });
    }
    const job = await prisma.job.findFirst({
      where: { id: jobId, projectId },
    });
    if (!job) {
      throw new Response("Order not found", { status: 404 });
    }
    if (next === "delivered" && !job.fulfillmentPhotoStorageKey) {
      const origin = getStorefrontOriginForAppProxyRedirect(request, shop);
      return redirect(
        `${origin}${storefrontProjectActionPath}?id=${encodeURIComponent(projectId)}&statusPhotoRequired=1`,
      );
    }
    const lifecycleData: {
      orderLifecycleStatus:
        | "draft"
        | "pending_review"
        | "ready_to_order"
        | "ordered"
        | "delivered"
        | "paid";
      completedAt?: Date;
      paidAt?: Date;
    } = {
      orderLifecycleStatus: next as
        | "draft"
        | "pending_review"
        | "ready_to_order"
        | "ordered"
        | "delivered"
        | "paid",
    };
    if (next === "delivered" && !job.completedAt) {
      lifecycleData.completedAt = new Date();
    }
    if (next === "paid") {
      if (!job.paidAt) {
        lifecycleData.paidAt = new Date();
      }
      if (!job.completedAt && !lifecycleData.completedAt) {
        lifecycleData.completedAt = new Date();
      }
    }

    const wasDeliveredOrPaid =
      job.orderLifecycleStatus === "delivered" ||
      job.orderLifecycleStatus === "paid";
    const wasOrderedWithPhoto =
      job.orderLifecycleStatus === "ordered" &&
      Boolean(job.fulfillmentPhotoStorageKey);
    const isPreDeliveryNext =
      next === "draft" ||
      next === "pending_review" ||
      next === "ready_to_order" ||
      next === "ordered";

    const shouldDeleteFulfillmentPhoto =
      Boolean(job.fulfillmentPhotoStorageKey) &&
      isPreDeliveryNext &&
      (wasDeliveredOrPaid ||
        (wasOrderedWithPhoto &&
          (next === "draft" ||
            next === "pending_review" ||
            next === "ready_to_order")));

    const storageKeyToRemove = shouldDeleteFulfillmentPhoto
      ? job.fulfillmentPhotoStorageKey
      : null;

    const jobUpdateData: {
      orderLifecycleStatus: (typeof lifecycleData)["orderLifecycleStatus"];
      completedAt?: Date | null;
      paidAt?: Date | null;
      fulfillmentPhotoStorageKey?: string | null;
      fulfillmentNotifiedAt?: Date | null;
    } = { ...lifecycleData };

    if (shouldDeleteFulfillmentPhoto) {
      jobUpdateData.fulfillmentPhotoStorageKey = null;
      jobUpdateData.fulfillmentNotifiedAt = null;
    }
    if (next !== "paid" && job.paidAt) {
      jobUpdateData.paidAt = null;
    }
    if (!["delivered", "paid"].includes(next) && job.completedAt) {
      jobUpdateData.completedAt = null;
    }

    const now = new Date();
    const staffApproveStatuses = [
      "ready_to_order",
      "ordered",
      "delivered",
      "paid",
    ] as const;

    const removeFulfillmentPhotoFromDisk = async (key: string) => {
      const root = path.resolve(process.cwd(), "storage", "fulfillment-photos");
      const abs = path.resolve(root, key);
      if (!abs.startsWith(root + path.sep)) return;
      try {
        await fs.unlink(abs);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException)?.code;
        if (code !== "ENOENT") {
          console.error("[project-clad] fulfillment photo unlink:", e);
        }
      }
    };

    if (next === "pending_review") {
      await prisma.$transaction([
        prisma.approvalRequest.upsert({
          where: {
            projectId_jobId_itemId: {
              projectId,
              jobId,
              itemId: "",
            },
          },
          update: {
            requestedAt: now,
            approvedAt: null,
            approvedByCustomerId: null,
          },
          create: {
            projectId,
            jobId,
            itemId: "",
            requestedAt: now,
          },
        }),
        prisma.job.update({
          where: { id: jobId },
          data: jobUpdateData,
        }),
      ]);
    } else if (next === "draft") {
      await prisma.$transaction([
        prisma.approvalRequest.deleteMany({
          where: { projectId, jobId, itemId: "" },
        }),
        prisma.job.update({
          where: { id: jobId },
          data: jobUpdateData,
        }),
      ]);
    } else if ((staffApproveStatuses as readonly string[]).includes(next)) {
      await prisma.$transaction([
        prisma.approvalRequest.upsert({
          where: {
            projectId_jobId_itemId: {
              projectId,
              jobId,
              itemId: "",
            },
          },
          update: {
            approvedAt: now,
            approvedByCustomerId: customerId,
          },
          create: {
            projectId,
            jobId,
            itemId: "",
            requestedAt: now,
            approvedAt: now,
            approvedByCustomerId: customerId,
          },
        }),
        prisma.job.update({
          where: { id: jobId },
          data: jobUpdateData,
        }),
      ]);
    }

    if (storageKeyToRemove) {
      await removeFulfillmentPhotoFromDisk(storageKeyToRemove);
    }

    return redirectToProject(request, projectId, shop);
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

    const newJob = await prisma.job.create({
      data: {
        projectId,
        name,
        sortOrder: nextSortOrder,
      },
    });

    await logProjectActivity({
      projectId,
      jobId: newJob.id,
      type: "order_created",
      visibility: "member",
      actorCustomerId: customerId,
      payload: { jobName: newJob.name },
    });

    await emailProjectStatusSnapshot({
      shop,
      projectId,
      actorCustomerId: customerId,
      headline: "New empty order added",
      introLines: [
        `Order "${newJob.name}" was created on the project page (no checkout lines yet).`,
        "Open the project link below to add lines or continue editing.",
      ],
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

    await emailProjectStatusSnapshot({
      shop,
      projectId,
      actorCustomerId: customerId,
      headline: "Order deleted from project",
      introLines: [
        `The order "${job.name}" was removed.`,
        "Open the project link below to see what remains on the project.",
      ],
    });

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
        const targetProject = await prisma.project.findFirst({
          where: { id: targetProjectId, shop: shopStringFilter(shop) },
          select: { name: true },
        });
        await prisma.job.update({
          where: { id: jobId },
          data: { projectId: targetProjectId },
        });
        await emailProjectStatusSnapshot({
          shop,
          projectId,
          actorCustomerId: customerId,
          headline: "Order moved to another project",
          introLines: [
            `Order "${job.name}" was moved out of this project.`,
            targetProject
              ? `Destination project: ${targetProject.name}`
              : "It was moved to another saved project.",
            "Open the project link below to review this project after the move.",
          ],
        });
        await emailProjectStatusSnapshot({
          shop,
          projectId: targetProjectId,
          actorCustomerId: customerId,
          headline: "Order moved into this project",
          introLines: [
            `Order "${job.name}" was moved here from another saved project.`,
            "Open the project link below to review all orders on this project.",
          ],
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
        const copyJob = await prisma.job.create({
          data: {
            projectId: targetProjectId,
            name: `${job.name} (Copy)`,
            purchaseOrderNumber: job.purchaseOrderNumber ?? undefined,
            isLocked: false,
            items: {
              create: job.items.map((item) => ({
                variantId: item.variantId,
                quantity: item.quantity,
                priceSnapshot: item.priceSnapshot,
                sortOrder: item.sortOrder,
                variantSnapshot: item.variantSnapshot ?? undefined,
                customData: item.customData ?? undefined,
                orderLineCapture: item.orderLineCapture ?? undefined,
                catalogProductId: item.catalogProductId ?? undefined,
                catalogSku: item.catalogSku ?? undefined,
              })),
            },
          },
        });
        await logProjectActivity({
          projectId: targetProjectId,
          jobId: copyJob.id,
          type: "order_created",
          visibility: "member",
          actorCustomerId: customerId,
          payload: { jobName: copyJob.name, copiedFrom: job.name },
        });

        const sourceProject = await prisma.project.findFirst({
          where: { id: projectId, shop: shopStringFilter(shop) },
          select: { name: true },
        });
        const targetProject = await prisma.project.findFirst({
          where: { id: targetProjectId, shop: shopStringFilter(shop) },
          select: { name: true },
        });
        await emailProjectStatusSnapshot({
          shop,
          projectId,
          actorCustomerId: customerId,
          headline: "Order copied to another project",
          introLines: [
            `A copy of order "${job.name}" was created${
              targetProject ? ` on project "${targetProject.name}"` : " on another project"
            } as "${copyJob.name}".`,
            "Open the project link below to review this project (source).",
          ],
        });
        await emailProjectStatusSnapshot({
          shop,
          projectId: targetProjectId,
          actorCustomerId: customerId,
          headline: "Order copied into this project",
          introLines: [
            `Order "${copyJob.name}" was added (copy of "${job.name}"${
              sourceProject ? ` from "${sourceProject.name}"` : ""
            }).`,
            "Open the project link below to review this project.",
          ],
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

      await emailProjectStatusSnapshot({
        shop,
        projectId,
        actorCustomerId: customerId,
        headline: "Line removed from order",
        introLines: [
          `A line was removed from order "${item.job.name}".`,
          "Open the project link below to review the order.",
        ],
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
      data: {
        name,
        poNumber,
        companyName,
      },
    });

    await emailProjectStatusSnapshot({
      shop,
      projectId,
      actorCustomerId: customerId,
      headline: "Project details updated",
      introLines: [
        "Project name, PO, or company was changed on the project page.",
        "Open the project link below to review the updated details.",
      ],
    });

    return redirectToProject(request, projectId, shop);
  }

  if (intent === "update-project-delivery") {
    if (!canEdit) {
      throw new Response("Forbidden", { status: 403 });
    }

    const trim = (k: string) => String(formData.get(k) || "").trim();
    const shipAddress1 = trim("shipAddress1") || null;
    const shipCity = trim("shipCity") || null;
    const shipProvince = trim("shipProvince") || null;
    const shipPostal = trim("shipPostal") || null;
    const shipCountry = trim("shipCountry") || "Canada";

    const addressComplete = Boolean(
      shipAddress1?.trim() &&
        shipCity?.trim() &&
        shipProvince?.trim() &&
        shipPostal?.trim(),
    );

    /** Derive mode from submitted fields so a stale hidden pickup flag cannot wipe a full address. */
    let receiveMode: "pickup" | "delivery";
    if (addressComplete) {
      await prisma.project.update({
        where: { id: projectId },
        data: {
          receiveMode: "delivery",
          shipAddress1,
          shipAddress2: null,
          shipCity,
          shipProvince,
          shipPostal,
          shipCountry,
        },
      });
      receiveMode = "delivery";
    } else {
      await prisma.project.update({
        where: { id: projectId },
        data: {
          receiveMode: "pickup",
          shipAddress1,
          shipAddress2: null,
          shipCity,
          shipProvince,
          shipPostal,
          shipCountry: trim("shipCountry") || null,
        },
      });
      receiveMode = "pickup";
    }

    await emailProjectStatusSnapshot({
      shop,
      projectId,
      actorCustomerId: customerId,
      headline: "Delivery settings updated",
      introLines: [
        receiveMode === "pickup"
          ? "This project was set to store pickup ($0 project delivery fee)."
          : "The delivery address or receive mode for this project was changed on the project page.",
        "Open the project link below to review delivery settings and the project.",
      ],
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

/** Shopify order ref (shown under PO on the total row when linked). */
function OrderFootShopifyCell(job: JobView) {
  const rawOrder = job.orderName != null ? String(job.orderName).trim() : "";
  if (!rawOrder) return null;
  const shopifyParen = `(${rawOrder})`;
  return (
    <div className="project-clad-order-foot-stack">
      <div className="project-clad-order-foot-line">
        <span className="project-clad-order-foot-label">Shopify order</span>{" "}
        <span className="project-clad-order-foot-order-name">{shopifyParen}</span>
      </div>
    </div>
  );
}

/** Same ink as grey nav / menu pills (--pc-btn-neu-fg); inline beats many theme rules on app proxy. */
const JOB_EDIT_ORDER_LABEL_STYLE: CSSProperties = {
  fontFamily: '"Bakbak One", Helvetica, "Helvetica Neue", Arial, sans-serif',
  fontWeight: 400,
  fontSize: "0.68rem",
  letterSpacing: "0.05em",
  color: "var(--pc-btn-neu-fg)",
  WebkitFontSmoothing: "antialiased",
};

const JOB_EDIT_ORDER_INPUT_STYLE: CSSProperties = {
  fontFamily: '"Bakbak One", Helvetica, "Helvetica Neue", Arial, sans-serif',
  fontWeight: 400,
  fontSize: "calc(0.8rem * var(--pc-text-scale))",
  letterSpacing: "0.03em",
  color: "var(--pc-btn-neu-fg)",
  WebkitFontSmoothing: "antialiased",
};

export default function ProjectDetailPage() {
  const {
    proxyStylesCss,
    project,
    canViewPricing,
    canEdit,
    canEditLineUnitPrices,
    canAdminMembers,
    hideAddToCart,
    approvalRequests,
    projectTimeline,
    viewerIsAdmin,
    memberLookupError,
    variantLookupError,
    shop,
    storefrontAppNav,
    logoDataUrl,
    backgroundLogoDataUrl,
    themeStyles,
    viewerCanFulfill,
    viewerHasNATag,
    navAccountInitial,
  } = useLoaderData<typeof loader>();

  const orderLifecycleLabel = (status: string) => {
    switch (status) {
      case "draft":
        return "Draft";
      case "pending_review":
        return "Pending review";
      case "ready_to_order":
        return "Ready to order";
      case "ordered":
        return "Ordered";
      case "delivered":
        return "Delivered";
      case "paid":
        return "Order complete";
      default:
        return status;
    }
  };

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

  const isJobPendingStaffApproval = (job: JobView) => {
    const st = getApprovalStatus(job.id, "");
    if (st === "approved") return false;
    if (st === "awaiting") return true;
    return job.orderLifecycleStatus === "pending_review";
  };

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

  const hasCompleteDeliveryAddress = Boolean(
    project.shipAddress1?.trim() &&
      project.shipCity?.trim() &&
      project.shipProvince?.trim() &&
      project.shipPostal?.trim(),
  );

  /** Saved project mode + address: required when ordering for delivery at checkout. */
  const isDeliveryCompleteForOrderNow =
    project.receiveMode === "delivery" && hasCompleteDeliveryAddress;

  const deliveryFeeForJob = (job: JobView) => {
    if (job.fulfillmentMethod === "delivery") return PROJECT_DELIVERY_FEE;
    if (job.fulfillmentMethod === "pickup") return 0;
    return isDeliveryCompleteForOrderNow ? PROJECT_DELIVERY_FEE : 0;
  };

  const [orderNowSubmittingJobId, setOrderNowSubmittingJobId] = useState<
    string | null
  >(null);

  const actionData = useActionData<typeof action>();

  const [preferredDeliveryDateMinYmd, setPreferredDeliveryDateMinYmd] =
    useState<string | undefined>(undefined);
  useEffect(() => {
    const updateMin = () => {
      setPreferredDeliveryDateMinYmd(
        minPreferredDeliveryYmd(PREFERRED_DELIVERY_MIN_DAY_OFFSET_FROM_TODAY),
      );
    };
    updateMin();
    const onVis = () => {
      if (document.visibilityState === "visible") updateMin();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  const pricingUnlocked =
    canViewPricing ||
    (actionData &&
      typeof actionData === "object" &&
      "pricingUnlocked" in actionData &&
      Boolean(actionData.pricingUnlocked));
  /** Tax on rolled-up line subtotals; delivery is per order (see order footers). */
  const projectDisplayTax = orderTaxFromSubtotal(project.subtotal, {
    pricesIncludeTax: false,
  });
  const projectSubtotalPlusTax = orderTotalWithTax(project.subtotal, {
    pricesIncludeTax: false,
  });
  const jobError =
    actionData && typeof actionData === "object" && "jobError" in actionData
      ? (actionData.jobError as string)
      : null;
  const memberError =
    actionData && typeof actionData === "object" && "memberError" in actionData
      ? (actionData.memberError as string)
      : null;
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedJobId = searchParams.get("job");
  const [jobs, setJobs] = useState(project.jobs);
  const orderListSearchQ = (searchParams.get("q") || "").trim();
  const visibleJobs = useMemo(() => {
    if (!orderListSearchQ) return jobs;
    return jobs.filter((job) => jobMatchesOrderSearch(job, orderListSearchQ));
  }, [jobs, orderListSearchQ]);

  useEffect(() => {
    if (!selectedJobId || !orderListSearchQ) return;
    if (!visibleJobs.some((j) => j.id === selectedJobId)) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("job");
          return next;
        },
        { replace: true },
      );
    }
  }, [selectedJobId, orderListSearchQ, visibleJobs, setSearchParams]);

  const projectOrderDeliveryFeesTotal = jobs.reduce(
    (sum, job) => sum + deliveryFeeForJob(job),
    0,
  );
  const projectTotalWithDisplayTax =
    projectSubtotalPlusTax + projectOrderDeliveryFeesTotal;
  const dragItemId = useRef<string | null>(null);
  const dragJobId = useRef<string | null>(null);

  const isOrderAwaitingApproval = (jobId: string) => {
    if (hasProjectLevelApprovalPending) return true;
    if (getApprovalStatus(jobId, "") === "awaiting") return true;
    return jobs.some(
      (j) => j.id === jobId && j.orderLifecycleStatus === "pending_review",
    );
  };

  /** Customer-facing order lifecycle controls (Ordered / Delivered / Order now / review). */
  const renderOrderLifecycleCustomerSummaryActions = (job: JobView) => {
    const ls = job.orderLifecycleStatus;
    const approval = getApprovalStatus(job.id, "");
    const viewerUsesNAReviewFlow = viewerHasNATag === true;
    const skipReviewOrderFlow = !viewerUsesNAReviewFlow || viewerIsAdmin;
    if (ls === "paid") {
      return (
        <button type="button" className="project-clad-button" disabled>
          Order complete
        </button>
      );
    }
    if (ls === "delivered") {
      return (
        <button type="button" className="project-clad-button" disabled>
          Delivered
        </button>
      );
    }
    if (ls === "ordered") {
      return (
        <button type="button" className="project-clad-button" disabled>
          Ordered
        </button>
      );
    }
    if (
      (ls === "ready_to_order" &&
        (approval === "approved" || skipReviewOrderFlow)) ||
      (ls === "draft" && skipReviewOrderFlow)
    ) {
      return (
        <div className="project-clad-inline-form project-clad-order-lifecycle-actions-form">
          <button
            type="button"
            className="project-clad-button"
            data-projectclad-order-now-submit
            data-job-id={job.id}
            data-has-delivery={isDeliveryCompleteForOrderNow ? "1" : "0"}
            disabled={orderNowSubmittingJobId === job.id}
          >
            {orderNowSubmittingJobId === job.id ? "Placing…" : "Order now"}
          </button>
          {project.receiveMode === "delivery" && !hasCompleteDeliveryAddress ? (
            <span
              className="project-clad-muted"
              style={{
                maxWidth: "16rem",
                fontSize: "0.82rem",
                lineHeight: 1.4,
              }}
            >
              No delivery details on file — order will be placed as{" "}
              <strong>store pickup</strong>.
            </span>
          ) : null}
        </div>
      );
    }
    if (
      viewerUsesNAReviewFlow &&
      ls !== "ready_to_order" &&
      ls !== "ordered" &&
      ls !== "delivered" &&
      ls !== "paid"
    ) {
      const intent =
        approval === "awaiting"
          ? "cancel-approval-request"
          : "submit-for-approval";
      const label =
        approval === "awaiting" ? "Confirming order" : "Send for review";
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
          <button type="submit" className="project-clad-button">
            {label}
          </button>
          <span className="project-clad-muted" data-projectclad-form-message />
        </form>
      );
    }
    return (
      <span className="project-clad-muted">{orderLifecycleLabel(ls)}</span>
    );
  };

  /** Staff lifecycle dropdown + Apply — only inside the line-item "Edit order" panel. */
  const staffOrderLifecycleStatusForm = (job: JobView) => {
    if (!viewerCanFulfill) return null;
    const sid = `${job.id}-edit-panel`;
    return (
      <Form
        method="post"
        action={`/apps/project-clad/project?id=${project.id}`}
        className="project-clad-staff-fulfillment-status-form"
      >
        <input type="hidden" name="intent" value="staff-set-order-lifecycle" />
        <input type="hidden" name="jobId" value={job.id} />
        <div className="project-clad-staff-fulfillment-status-row">
          <label
            className="project-clad-staff-fulfillment__label--tile"
            htmlFor={`project-clad-staff-status-${sid}`}
          >
            Order status
          </label>
          <select
            id={`project-clad-staff-status-${sid}`}
            name="lifecycleStatus"
            defaultValue={job.orderLifecycleStatus}
            className="project-clad-staff-fulfillment__status"
          >
            <option value="draft">New</option>
            <option value="pending_review">Review</option>
            <option value="ready_to_order">Order now</option>
            <option value="ordered">Ordered</option>
            <option value="delivered" disabled={!job.hasFulfillmentPhoto}>
              {job.hasFulfillmentPhoto
                ? "Delivered"
                : "Delivered (photo required)"}
            </option>
            <option value="paid">Order complete</option>
          </select>
          <button type="submit" className="project-clad-button">
            Apply
          </button>
        </div>
      </Form>
    );
  };

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
    await fetch(`${location.pathname}${location.search}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "reorder-items",
        jobId,
        itemIds: reordered,
      }),
      credentials: "include",
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

    await fetch(`${location.pathname}${location.search}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "reorder-jobs",
        jobIds: reordered,
      }),
      credentials: "include",
    });

    dragJobId.current = null;
  };

  /**
   * Order now lives in <summary>; use capture on document + stopImmediatePropagation so the
   * browser still delivers the interaction, then confirm() and POST confirm-order-now (→ ordered).
   */
  useLayoutEffect(() => {
    const path = `${location.pathname}${location.search}`;
    const onCaptureClick = (event: MouseEvent) => {
      let node: Node | null =
        event.target instanceof Node ? event.target : null;
      if (node?.nodeType === Node.TEXT_NODE && node.parentElement) {
        node = node.parentElement;
      }
      if (!(node instanceof Element)) return;
      const btn = node.closest("[data-projectclad-order-now-submit]");
      if (!(btn instanceof HTMLButtonElement)) return;
      if (btn.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const jobId = btn.getAttribute("data-job-id") ?? "";
      if (!jobId) return;
      if (
        !window.confirm(
          'Please ensure all delivery details are accurate. You can update delivery information under "Edit Project Details", and modify order-specific information in "Edit Order."',
        )
      ) {
        return;
      }
      const hasDelivery = btn.getAttribute("data-has-delivery") === "1";
      const fulfillmentMethod = hasDelivery ? "delivery" : "pickup";
      setOrderNowSubmittingJobId(jobId);
      void (async () => {
        try {
          const res = await fetch(path, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            credentials: "include",
            body: JSON.stringify({
              intent: "confirm-order-now",
              jobId,
              fulfillmentMethod,
            }),
          });
          const text = await res.text();
          let payload: Record<string, unknown> | null = null;
          if (text) {
            try {
              payload = JSON.parse(text) as Record<string, unknown>;
            } catch {
              payload = null;
            }
          }
          if (payload && typeof payload.redirectTo === "string") {
            window.location.href = payload.redirectTo;
            return;
          }
          const fromPayload =
            payload &&
            (typeof payload.error === "string"
              ? payload.error
              : typeof payload.message === "string"
                ? payload.message
                : null);
          let errLine = fromPayload;
          if (!errLine && text) {
            const em = text.match(/"error"\s*:\s*"([^"]*)"/);
            if (em) errLine = em[1];
          }
          if (!res.ok || errLine) {
            window.alert(
              errLine ||
                (res.status ? `Request failed (${res.status}).` : "") ||
                "Unable to confirm order.",
            );
            return;
          }
          window.location.reload();
        } catch {
          window.alert("Unable to confirm order.");
        } finally {
          setOrderNowSubmittingJobId(null);
        }
      })();
    };
    document.addEventListener("click", onCaptureClick, true);
    return () =>
      document.removeEventListener("click", onCaptureClick, true);
  }, [location.pathname, location.search]);

  const inlineStyles = themeStyles?.styles || [];

  return (
    <>
      {(themeStyles?.urls ?? []).map((href: string) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      <div
        className="project-clad-modal-backdrop project-clad-reject-modal-backdrop"
        data-projectclad-reject-modal
        role="dialog"
        aria-modal="true"
        aria-labelledby="reject-modal-title"
        style={{ display: "none" }}
      >
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- modal card: stop mousedown so backdrop logic ignores inner surface */}
        <div
          className="project-clad-card project-clad-modal project-clad-reject-modal"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <h2 id="reject-modal-title">Reject order</h2>
          <p className="project-clad-muted">
            Provide a reason for the rejection. This will be included in the email sent to project members.
          </p>
          <form data-projectclad-reject-form className="project-clad-reject-form">
            <label htmlFor="reject-reason">Reason (required)</label>
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="pricing-modal-title"
        style={{ display: "none" }}
      >
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- modal card: stop mousedown so backdrop logic ignores inner surface */}
        <div
          className="project-clad-card project-clad-modal project-clad-reject-modal"
          onMouseDown={(e) => e.stopPropagation()}
        >
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-project-modal-title"
        aria-hidden="true"
        style={{ display: "none" }}
      >
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- modal card: stop mousedown so backdrop logic ignores inner surface */}
        <div
          className="project-clad-card project-clad-modal project-clad-reject-modal"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="project-clad-modal-close"
            data-projectclad-edit-project-cancel
            aria-label="Close"
          >
            ×
          </button>
          <h2 id="edit-project-modal-title" data-projectclad-section-underline>Edit project</h2>
          <h3
            className="project-clad-section-title"
            style={{ marginTop: "0.5rem", marginBottom: "0.5rem", fontSize: "1rem" }}
            data-projectclad-section-underline
          >
            Project details
          </h3>
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
            <label htmlFor="edit-project-po">PROJECT #</label>
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
                Save project details
              </button>
            </div>
          </Form>

          <EditProjectDeliveryAddressForm
            projectId={project.id}
            shipAddress1={project.shipAddress1}
            shipCity={project.shipCity}
            shipProvince={project.shipProvince}
            shipPostal={project.shipPostal}
          />

          <div className="project-clad-actions" style={{ marginTop: "1rem", gap: "0.5rem" }}>
            <button
              type="button"
              className="project-clad-button project-clad-reject-modal-btn"
              data-projectclad-edit-project-cancel
            >
              Cancel
            </button>
          </div>

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
                  <label htmlFor="member-role-modal-role-edit">Project member role</label>
                  <MemberRoleSelect idPrefix="member-role-modal" defaultValue="edit" />
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
                            <span aria-hidden="true" style={{ visibility: "hidden" }}>
                              —
                            </span>
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-save-title-js"
        style={{ display: "none" }}
      >
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- modal card: stop mousedown so backdrop logic ignores inner surface */}
        <div
          className="project-clad-card project-clad-modal project-clad-reject-modal project-clad-edit-save-modal"
          onMouseDown={(e) => e.stopPropagation()}
        >
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-project-modal-title"
        style={{ display: "none" }}
      >
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- modal card: stop mousedown so backdrop logic ignores inner surface */}
        <div
          className="project-clad-card project-clad-modal project-clad-reject-modal"
          onMouseDown={(e) => e.stopPropagation()}
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
      {inlineStyles.map((css, index) => (
        <style key={index} dangerouslySetInnerHTML={{ __html: css }} />
      ))}
      <style dangerouslySetInnerHTML={{ __html: proxyStylesCss }} />
      <main
        className={`project-clad-page project-clad-page--detail project-clad-page--projects${backgroundLogoDataUrl ? " project-clad-page--card-bg-logo" : ""}`}
        data-pc-na-workflow={viewerHasNATag === true ? "1" : "0"}
        style={
          backgroundLogoDataUrl
            ? {
                ["--project-clad-bg-logo" as string]: `url(${backgroundLogoDataUrl})`,
              }
            : undefined
        }
      >
        <div className="page-width project-clad-container project-clad-container--full-width" data-projectclad-project-id={project.id}>
          {searchParams.get("scheduleDateError") === "1" ? (
            <div
              role="alert"
              className="project-clad-card"
              style={{
                marginBottom: "1rem",
                padding: "0.85rem 1rem",
                borderColor: "#b71c1c",
                background: "rgba(183, 28, 28, 0.06)",
              }}
            >
              <p style={{ margin: 0, fontSize: "0.92rem", lineHeight: 1.45 }}>
                The <strong>date</strong> cannot be today or tomorrow on the Ottawa (Eastern) calendar. Pick a
                later date and save again. The time window is not restricted by this rule.
              </p>
              <button
                type="button"
                className="project-clad-button project-clad-reject-modal-btn"
                style={{ marginTop: "0.65rem" }}
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.delete("scheduleDateError");
                  setSearchParams(next, { replace: true });
                }}
              >
                Dismiss
              </button>
            </div>
          ) : null}
          {searchParams.get("scheduleLocked") === "1" ? (
            <div
              role="alert"
              className="project-clad-card"
              style={{
                marginBottom: "1rem",
                padding: "0.85rem 1rem",
                borderColor: "#b71c1c",
                background: "rgba(183, 28, 28, 0.06)",
              }}
            >
              <p style={{ margin: 0, fontSize: "0.92rem", lineHeight: 1.45 }}>
                The delivery schedule cannot be changed for this order in its current status.
              </p>
              <button
                type="button"
                className="project-clad-button project-clad-reject-modal-btn"
                style={{ marginTop: "0.65rem" }}
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.delete("scheduleLocked");
                  setSearchParams(next, { replace: true });
                }}
              >
                Dismiss
              </button>
            </div>
          ) : null}
          {searchParams.get("scheduleWindowNeedsDate") === "1" ? (
            <div
              role="alert"
              className="project-clad-card"
              style={{
                marginBottom: "1rem",
                padding: "0.85rem 1rem",
                borderColor: "#b71c1c",
                background: "rgba(183, 28, 28, 0.06)",
              }}
            >
              <p style={{ margin: 0, fontSize: "0.92rem", lineHeight: 1.45 }}>
                Choose a <strong>day</strong> before selecting a time.
              </p>
              <button
                type="button"
                className="project-clad-button project-clad-reject-modal-btn"
                style={{ marginTop: "0.65rem" }}
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.delete("scheduleWindowNeedsDate");
                  setSearchParams(next, { replace: true });
                }}
              >
                Dismiss
              </button>
            </div>
          ) : null}
          {searchParams.get("scheduleWindowPastError") === "1" ? (
            <div
              role="alert"
              className="project-clad-card"
              style={{
                marginBottom: "1rem",
                padding: "0.85rem 1rem",
                borderColor: "#b71c1c",
                background: "rgba(183, 28, 28, 0.06)",
              }}
            >
              <p style={{ margin: 0, fontSize: "0.92rem", lineHeight: 1.45 }}>
                That time window has already ended for the selected day (Ottawa time). Pick a later window or
                another date.
              </p>
              <button
                type="button"
                className="project-clad-button project-clad-reject-modal-btn"
                style={{ marginTop: "0.65rem" }}
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.delete("scheduleWindowPastError");
                  setSearchParams(next, { replace: true });
                }}
              >
                Dismiss
              </button>
            </div>
          ) : null}
          {searchParams.get("statusPhotoRequired") === "1" ? (
            <div
              role="alert"
              className="project-clad-card"
              style={{
                marginBottom: "1rem",
                padding: "0.85rem 1rem",
                borderColor: "#b71c1c",
                background: "rgba(183, 28, 28, 0.06)",
              }}
            >
              <p style={{ margin: 0, fontSize: "0.92rem", lineHeight: 1.45 }}>
                You cannot set status to <strong>delivered</strong> until a fulfillment photo is uploaded.
              </p>
              <button
                type="button"
                className="project-clad-button project-clad-reject-modal-btn"
                style={{ marginTop: "0.65rem" }}
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.delete("statusPhotoRequired");
                  setSearchParams(next, { replace: true });
                }}
              >
                Dismiss
              </button>
            </div>
          ) : null}
          <header className="project-clad-header">
            <ProjectCladStorefrontNav
              logoDataUrl={logoDataUrl}
              logoHref="/apps/project-clad/projects"
              links={storefrontAppNav.links}
              cartUrl={storefrontAppNav.cartUrl}
              searchUrl={storefrontAppNav.searchUrl}
              accountUrl={storefrontAppNav.accountUrl}
              accountInitial={navAccountInitial}
              inAppSearch="orders"
              shellExtra={
                canAdminMembers || canEdit ? (
                  <div
                    className="project-clad-header-slot project-clad-header-slot--left project-clad-header-slot--nav-tools"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      flexWrap: "wrap",
                    }}
                  >
                    {canAdminMembers ? (
                      <>
                        <button
                          type="button"
                          className="project-clad-storefront-nav__icon-btn project-clad-storefront-nav__icon-btn--add-member"
                          data-projectclad-add-member-popover-toggle
                          aria-label="Add member"
                          aria-haspopup="dialog"
                          aria-expanded="false"
                          aria-controls="projectclad-add-member-popover"
                        >
                          <svg
                            className="project-clad-storefront-nav__icon"
                            width={20}
                            height={20}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <circle cx="9" cy="7" r="3.5" />
                            <path d="M4 20v-0.5C4 16.5 6.5 14 10 14s6 2.5 6 5.5V20" />
                            <path d="M19 8v6M16 11h6" />
                          </svg>
                        </button>
                        <div
                          id="projectclad-add-member-popover"
                          className="project-clad-add-member-popover"
                          data-projectclad-add-member-popover
                          role="dialog"
                          aria-label="Add project member"
                          aria-hidden="true"
                        >
                          <Form
                            id="projectclad-add-member-form-header"
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
                            <label htmlFor="member-email-header">Email</label>
                            <div className="project-clad-neu-finder-input">
                              <div className="project-clad-neu-finder-input__well">
                                <input
                                  id="member-email-header"
                                  name="email"
                                  type="email"
                                  className="project-clad-neu-finder-input__field"
                                  placeholder="customer@example.com"
                                  required
                                  autoComplete="email"
                                  aria-label="Customer email"
                                />
                              </div>
                            </div>
                            <label htmlFor="member-role-header-role-edit">Project member role</label>
                            <MemberRoleSelect idPrefix="member-role-header" defaultValue="edit" />
                            <button
                              type="submit"
                              className="project-clad-button project-clad-reject-modal-btn"
                            >
                              Add
                            </button>
                            <span
                              className="project-clad-muted"
                              data-projectclad-form-message
                              style={{ margin: 0, minHeight: "1.25em" }}
                            />
                          </Form>
                        </div>
                      </>
                    ) : null}
                    {canEdit ? (
                      <button
                        type="button"
                        className="project-clad-storefront-nav__icon-btn project-clad-storefront-nav__icon-btn--edit-project-details"
                        data-projectclad-edit-project-details
                        aria-label="Edit project details"
                      >
                        <svg
                          className="project-clad-storefront-nav__icon"
                          width={20}
                          height={20}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={1.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 0 1 1.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.559.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.894.149c-.424.07-.764.383-.929.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 0 1-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.398.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 0 1-.12-1.45l.527-.737c.25-.35.272-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 0 1 .12-1.45l.773-.773a1.125 1.125 0 0 1 1.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894Z" />
                          <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                ) : null
              }
            />
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
                    <button
                      type="submit"
                      className="project-clad-button project-clad-button--approve"
                    >
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
            <div className="project-clad-card project-clad-orders-shell">
              <h1 className="project-clad-sr-only">{project.name}</h1>
              <button
                type="button"
                className="project-clad-project-meta-chip"
                aria-labelledby="project-clad-project-meta-name"
                aria-describedby="project-clad-delivery-summary"
              >
                <span className="project-clad-project-meta-chip__inner">
                  <span className="project-clad-project-meta-chip__row">
                    <span className="project-clad-project-meta-chip__title">
                      <span className="project-clad-project-meta-chip__label">Project Name:</span>{" "}
                      <span
                        id="project-clad-project-meta-name"
                        className="project-clad-project-meta-chip__name-text"
                      >
                        {project.name}
                      </span>
                    </span>
                    <span className="project-clad-project-meta-chip__dot" aria-hidden="true" />
                    <span className="project-clad-project-meta-chip__part">
                      <span className="project-clad-project-meta-chip__label">Project #</span>{" "}
                      {project.poNumber || "—"}
                    </span>
                    <span className="project-clad-project-meta-chip__dot" aria-hidden="true" />
                    <span className="project-clad-project-meta-chip__part">
                      <span className="project-clad-project-meta-chip__label">Company name:</span>{" "}
                      {project.companyName || "—"}
                    </span>
                    <span className="project-clad-project-meta-chip__dot" aria-hidden="true" />
                    <span className="project-clad-project-meta-chip__part">
                      <span className="project-clad-project-meta-chip__label">Created</span>{" "}
                      {new Date(project.createdAt).toLocaleDateString()}
                    </span>
                  </span>
                  <span
                    className="project-clad-project-meta-chip__delivery"
                    id="project-clad-delivery-summary"
                  >
                    <span className="project-clad-project-meta-chip__label">
                      Delivery details:
                    </span>{" "}
                    {project.receiveMode === "pickup"
                      ? "Store pickup"
                      : (() => {
                          const lines = [
                            project.shipAddress1,
                            project.shipCity,
                            project.shipProvince,
                            project.shipPostal,
                          ].filter(Boolean);
                          if (!lines.length) return "—";
                          return [...lines, project.shipCountry || "Canada"].join(
                            ", ",
                          );
                        })()}
                  </span>
                </span>
              </button>
              <h2 className="project-clad-section-title project-clad-neon-title">
                Orders
              </h2>
              {variantLookupError && (
                <p className="project-clad-muted">{variantLookupError}</p>
              )}
              {project.jobs.length === 0 ? (
                <p className="project-clad-muted">No orders saved yet.</p>
              ) : visibleJobs.length === 0 ? (
                <p className="project-clad-muted">
                  No orders match &ldquo;{orderListSearchQ}&rdquo;. Adjust the search or clear it from
                  the header.
                </p>
              ) : (
                <div
                  id="project-clad-orders-font-scope"
                  className="project-clad-grid project-clad-orders-shell__list"
                >
                  <span
                    data-projectclad-server-build="unit-price-edit-v1"
                    className="project-clad-sr-only"
                    aria-hidden="true"
                  />
                  {visibleJobs.map((job) => {
                    const workOrderShellClass =
                      getJobApprovalInfo(job.id) &&
                      job.workOrderStatus !== "complete"
                        ? job.workOrderStatus === "in_progress"
                          ? "project-clad-work-order--in_progress"
                          : "project-clad-work-order--unread"
                        : "";
                    const totalQty = job.items.reduce((sum, item) => sum + item.quantity, 0);
                    const jobDisplayTax = orderTaxFromSubtotal(job.subtotal, {
                      pricesIncludeTax: false,
                    });
                    const jobSubtotalPlusTax = orderTotalWithTax(job.subtotal, {
                      pricesIncludeTax: false,
                    });
                    const jobDeliveryFeeAmount = deliveryFeeForJob(job);
                    const jobTotalWithDisplayTax =
                      jobSubtotalPlusTax + jobDeliveryFeeAmount;
                    const totalOrderQtyLabel = `Total Order Quantity: ${totalQty}`;
                    const orderFootShopify = OrderFootShopifyCell(job);
                    const jobSummaryDisplayName = jobNameForOrderSummary(
                      job.name,
                      job.orderName,
                    );
                    const poFooterDisplay =
                      jobPurchaseOrderDisplay(
                        job.name,
                        job.purchaseOrderNumber,
                      ) || "—";
                    const poDefault = jobPurchaseOrderDisplay(
                      job.name,
                      job.purchaseOrderNumber,
                    );
                    return (
                  <details
                    key={job.id}
                    id={`job-${job.id}`}
                    data-job-id={job.id}
                    open={selectedJobId === job.id}
                    className={
                      [
                        "project-clad-order-row",
                        "project-clad-details",
                        canEdit && selectedJobId === job.id && "project-clad-draggable",
                        ((job.orderLifecycleStatus === "pending_review" &&
                          getApprovalStatus(job.id, "") !== "approved") ||
                          (!hideAddToCart &&
                            getApprovalStatus(job.id, "") === "awaiting")) &&
                          "project-clad-approval-pending",
                        workOrderShellClass,
                      ]
                        .filter(Boolean)
                        .join(" ")
                    }
                    draggable={canEdit && selectedJobId === job.id}
                    onDragStart={(event) => {
                      if (!canEdit || selectedJobId !== job.id) return;
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
                    onToggle={(e) => {
                      const el = e.currentTarget;
                      if (!(el instanceof HTMLDetailsElement)) return;
                      if (el.open) {
                        setSearchParams(
                          (prev) => {
                            const next = new URLSearchParams(prev);
                            next.set("job", job.id);
                            return next;
                          },
                          { replace: true },
                        );
                      } else {
                        setSearchParams(
                          (prev) => {
                            if (prev.get("job") !== job.id) return prev;
                            const next = new URLSearchParams(prev);
                            next.delete("job");
                            return next;
                          },
                          { replace: true },
                        );
                      }
                    }}
                  >
                    <summary className="project-clad-summary">
                      <div className="project-clad-summary-row project-clad-order-summary-head-row">
                        <div className="project-clad-order-summary-padded">
                          <h3 className="project-clad-title">
                            {jobSummaryDisplayName}
                          </h3>
                          <div className="project-clad-job-name-field project-clad-job-edit-field">
                            <label
                              className="project-clad-job-edit-label"
                              style={JOB_EDIT_ORDER_LABEL_STYLE}
                              htmlFor={`projectclad-job-name-${job.id}`}
                            >
                              Order name
                            </label>
                            <input
                              id={`projectclad-job-name-${job.id}`}
                              type="text"
                              defaultValue={jobSummaryDisplayName}
                              data-projectclad-job-name-input
                              data-job-id={job.id}
                              data-original-job-name={jobSummaryDisplayName}
                              placeholder="Order name"
                              aria-label="Order name"
                              className="project-clad-job-name-input project-clad-job-edit-input"
                              style={JOB_EDIT_ORDER_INPUT_STYLE}
                            />
                          </div>
                          <div className="project-clad-job-po-field project-clad-job-edit-field">
                            <label
                              className="project-clad-job-edit-label"
                              style={JOB_EDIT_ORDER_LABEL_STYLE}
                              htmlFor={`projectclad-po-order-${job.id}`}
                            >
                              PURCHASE ORDER #
                            </label>
                            <input
                              id={`projectclad-po-order-${job.id}`}
                              type="text"
                              defaultValue={poDefault}
                              data-projectclad-purchase-order-input
                              data-job-id={job.id}
                              data-original-purchase-order={poDefault}
                              placeholder="Optional"
                              aria-label="PURCHASE ORDER #"
                              className="project-clad-job-po-input project-clad-job-edit-input"
                              style={JOB_EDIT_ORDER_INPUT_STYLE}
                            />
                          </div>
                        </div>
                        <div className="project-clad-order-summary-head-end">
                          <div className="project-clad-order-summary-head-row__subtotal">
                            <span className="project-clad-muted">Subtotal: </span>
                            {pricingUnlocked ? (
                              <span
                                className="project-clad-order-summary-qty__sub-amount"
                                data-projectclad-price
                                data-price={job.subtotal.toFixed(2)}
                              >
                                {formatPrice(job.subtotal.toFixed(2))}
                              </span>
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
                          <div className="project-clad-order-summary-lifecycle-cluster">
                            {canEdit ? (
                              renderOrderLifecycleCustomerSummaryActions(job)
                            ) : (
                              <span className="project-clad-muted">
                                {orderLifecycleLabel(job.orderLifecycleStatus)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </summary>
                    <div className="project-clad-stack" style={{ position: "relative" }}>
                      {job.items.length === 0 ? (
                        <div className="project-clad-order-empty-with-totals">
                          <p className="project-clad-muted">No items saved.</p>
                          <div className="project-clad-order-empty-with-totals__row">
                            <span
                              className="project-clad-muted"
                              aria-hidden
                              style={{ visibility: "hidden", userSelect: "none" }}
                            >
                              {totalOrderQtyLabel}
                            </span>
                            <span className="project-clad-muted">Subtotal</span>
                            <span
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
                            </span>
                          </div>
                          <div className="project-clad-order-empty-with-totals__row">
                            <span className="project-clad-muted">
                              {totalOrderQtyLabel}
                            </span>
                            <span className="project-clad-muted">
                              Tax ({Math.round(ORDER_DISPLAY_TAX_RATE * 100)}%)
                            </span>
                            <span
                              className="project-clad-table-right"
                              data-projectclad-price
                              data-price={jobDisplayTax.toFixed(2)}
                            >
                              {pricingUnlocked ? (
                                formatPrice(jobDisplayTax.toFixed(2))
                              ) : (
                                <button
                                  type="button"
                                  className="project-clad-hidden-link"
                                  data-projectclad-show-price
                                >
                                  Hidden
                                </button>
                              )}
                            </span>
                          </div>
                          <div className="project-clad-order-empty-with-totals__row">
                            <div className="project-clad-muted project-clad-order-empty-with-totals__total-lead">
                              <div className="project-clad-order-tfoot-po-total-line">
                                PURCHASE ORDER #{" "}
                                <span className="project-clad-order-tfoot-po-value">
                                  {poFooterDisplay}
                                </span>
                              </div>
                              {orderFootShopify ? (
                                <div className="project-clad-order-tfoot-shopify-with-total">
                                  {orderFootShopify}
                                </div>
                              ) : null}
                            </div>
                            <span className="project-clad-muted">Total</span>
                            <span
                              className="project-clad-table-right"
                              data-projectclad-price
                              data-price={jobTotalWithDisplayTax.toFixed(2)}
                            >
                              {pricingUnlocked ? (
                                formatPrice(jobTotalWithDisplayTax.toFixed(2))
                              ) : (
                                <button
                                  type="button"
                                  className="project-clad-hidden-link"
                                  data-projectclad-show-price
                                >
                                  Hidden
                                </button>
                              )}
                            </span>
                          </div>
                        </div>
                      ) : (
                      <div className="project-clad-table-x-scroll">
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
                                      ? item.uploadPartFileUrl || item.imageUrl
                                      : item.productUrl;
                                    const showPdfThumb =
                                      isUploadPart &&
                                      Boolean(
                                        item.uploadPartFileUrl &&
                                          isLikelyPdfUrl(item.uploadPartFileUrl),
                                      );

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
                                          {showPdfThumb ? (
                                            <PdfThumbIcon label="PDF attachment" />
                                          ) : item.imageUrl ? (
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
                                        {showPdfThumb ? (
                                          <PdfThumbIcon label="PDF attachment" />
                                        ) : item.imageUrl ? (
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
                                  {item.variantDisplaySource === "snapshot" && (
                                    <p
                                      className="project-clad-muted"
                                      style={{
                                        margin: "0.35rem 0 0",
                                        fontSize: "0.78rem",
                                        lineHeight: 1.35,
                                      }}
                                    >
                                      Saved product name (Shopify did not return this variant;
                                      name is from a previous sync).
                                    </p>
                                  )}
                                  {item.variantDisplaySource === "unknown" && (
                                    <>
                                      <p
                                        className="project-clad-muted"
                                        style={{
                                          margin: "0.35rem 0 0",
                                          fontSize: "0.78rem",
                                          lineHeight: 1.35,
                                        }}
                                      >
                                        {`Product no longer available. "Variant ${item.variantId}" has been updated or removed. Please contact us for help.`}
                                      </p>
                                      {item.orderLineCapture ? (
                                        <p
                                          className="project-clad-muted"
                                          style={{
                                            margin: "0.35rem 0 0",
                                            fontSize: "0.74rem",
                                            lineHeight: 1.35,
                                          }}
                                        >
                                          <strong>Recorded when saved:</strong>{" "}
                                          {item.orderLineCapture.displayLabel}
                                          {item.orderLineCapture.sku
                                            ? ` · SKU ${item.orderLineCapture.sku}`
                                            : ""}
                                          {item.orderLineCapture.unitPrice
                                            ? ` · ${formatPrice(item.orderLineCapture.unitPrice)} each`
                                            : ""}
                                          {(() => {
                                            const raw = item.orderLineCapture.capturedAt;
                                            if (!raw) return "";
                                            const d = new Date(raw);
                                            return Number.isNaN(d.getTime())
                                              ? ""
                                              : ` · ${d.toLocaleString()}`;
                                          })()}
                                        </p>
                                      ) : null}
                                    </>
                                  )}
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
                                              if (isLikelyPdfUrl(v)) {
                                                return (
                                                  <div key={index} style={{ marginTop: "0.25rem" }}>
                                                    <strong>{prop.name}:</strong>
                                                    <div className="project-clad-upload-url-pdf">
                                                      <a
                                                        href={v}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="project-clad-upload-url-pdf__link"
                                                      >
                                                        <PdfGlyphSvg className="project-clad-upload-url-pdf__icon" />
                                                        <span>Open PDF</span>
                                                      </a>
                                                    </div>
                                                  </div>
                                                );
                                              }
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
                                  {!pricingUnlocked ? (
                                    <button
                                      type="button"
                                      className="project-clad-hidden-link"
                                      data-projectclad-show-price
                                    >
                                      Hidden
                                    </button>
                                  ) : (
                                    <span className="project-clad-normal-view">
                                      {formatPrice(item.priceSnapshot)}
                                    </span>
                                  )}
                                  {canEdit && !job.isLocked ? (
                                    <span
                                      className="project-clad-edit-view"
                                      style={{ display: "none" }}
                                    >
                                      {pricingUnlocked ? (
                                        canEditLineUnitPrices ? (
                                          <>
                                            <label
                                              className="project-clad-sr-only"
                                              htmlFor={`projectclad-unit-price-${job.id}-${item.id}`}
                                            >
                                              Unit price for {item.displayName}
                                            </label>
                                            <input
                                              id={`projectclad-unit-price-${job.id}-${item.id}`}
                                              type="number"
                                              inputMode="decimal"
                                              step="0.01"
                                              min={0}
                                              defaultValue={Number(item.priceSnapshot).toFixed(2)}
                                              data-original-unit-price={Number(
                                                item.priceSnapshot,
                                              ).toFixed(2)}
                                              data-projectclad-unit-price-input
                                              data-item-id={item.id}
                                              data-job-id={job.id}
                                              className="project-clad-unit-price-input"
                                              aria-label={`Unit price for ${item.displayName}`}
                                            />
                                          </>
                                        ) : (
                                          <span
                                            className="project-clad-muted"
                                            style={{
                                              fontSize: "0.82rem",
                                              lineHeight: 1.35,
                                              textAlign: "right",
                                              display: "inline-block",
                                              maxWidth: "12rem",
                                            }}
                                          >
                                            Only designated staff can change unit prices.
                                          </span>
                                        )
                                      ) : (
                                        <span
                                          className="project-clad-muted"
                                          style={{
                                            fontSize: "0.82rem",
                                            lineHeight: 1.35,
                                            textAlign: "right",
                                            display: "inline-block",
                                            maxWidth: "10rem",
                                          }}
                                        >
                                          Unlock prices (Show price) to edit this amount.
                                        </span>
                                      )}
                                    </span>
                                  ) : null}
                                </td>
                                {canEdit && !job.isLocked && (
                                  <td className="project-clad-table-right">
                                    <div className="project-clad-stack">
                                      <div className="project-clad-normal-view" data-projectclad-item-actions />
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
                          <tr className="project-clad-order-tfoot-row project-clad-order-tfoot-row--subtotal">
                            <td className="project-clad-muted project-clad-order-tfoot-lead--empty" aria-hidden="true" />
                            <td className="project-clad-table-right">Subtotal</td>
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
                          <tr className="project-clad-order-tfoot-row project-clad-order-tfoot-row--tax">
                            <td className="project-clad-muted project-clad-order-tfoot-qty-cell">
                              {totalOrderQtyLabel}
                            </td>
                            <td className="project-clad-table-right">
                              Tax ({Math.round(ORDER_DISPLAY_TAX_RATE * 100)}%)
                            </td>
                            <td
                              className="project-clad-table-right"
                              data-projectclad-price
                              data-price={jobDisplayTax.toFixed(2)}
                            >
                              {pricingUnlocked ? (
                                formatPrice(jobDisplayTax.toFixed(2))
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
                          <tr className="project-clad-order-tfoot-row project-clad-order-tfoot-row--delivery">
                            <td
                              className="project-clad-muted project-clad-order-tfoot-lead--empty"
                              aria-hidden="true"
                            />
                            <td className="project-clad-table-right">Delivery</td>
                            <td
                              className="project-clad-table-right"
                              data-projectclad-price
                              data-price={jobDeliveryFeeAmount.toFixed(2)}
                            >
                              {pricingUnlocked ? (
                                formatPrice(jobDeliveryFeeAmount.toFixed(2))
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
                          <tr className="project-clad-order-tfoot-row project-clad-order-tfoot-row--total">
                            <td className="project-clad-muted project-clad-order-tfoot-order-ref-cell project-clad-order-tfoot-total-lead-cell">
                              <div className="project-clad-order-tfoot-total-lead-stack">
                                <div className="project-clad-order-tfoot-po-total-line">
                                  PURCHASE ORDER #{" "}
                                  <span className="project-clad-order-tfoot-po-value">
                                    {poFooterDisplay}
                                  </span>
                                </div>
                                {orderFootShopify ? (
                                  <div className="project-clad-order-tfoot-shopify-with-total">
                                    {orderFootShopify}
                                  </div>
                                ) : null}
                              </div>
                            </td>
                            <td className="project-clad-table-right">Total</td>
                            <td
                              className="project-clad-table-right"
                              data-projectclad-price
                              data-price={jobTotalWithDisplayTax.toFixed(2)}
                            >
                              {pricingUnlocked ? (
                                formatPrice(jobTotalWithDisplayTax.toFixed(2))
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
                      </div>
                      )}
                    {job.paidAt && job.receiptSnapshot ? (
                      <div
                        className="project-clad-card project-clad-receipt"
                        style={{ marginTop: "1rem" }}
                      >
                        <h4 className="project-clad-title" style={{ marginTop: 0 }}>
                          Receipt
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
                                Order complete {new Date(job.paidAt).toLocaleString()}
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
                    {!hideAddToCart && isJobPendingStaffApproval(job) && (
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
                          <button
                            type="submit"
                            className="project-clad-button project-clad-button--approve"
                          >
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
                    {(() => {
                      const preferredDeliveryLine = formatOrderDeliveryFootline({
                        orderLifecycleStatus: job.orderLifecycleStatus,
                        paidAt: job.paidAt,
                        completedAt: job.completedAt,
                        scheduledDeliveryDate: job.scheduledDeliveryDate,
                        scheduledDeliveryWindow: job.scheduledDeliveryWindow,
                        fulfillmentMethod: job.fulfillmentMethod,
                        projectReceiveMode: project.receiveMode,
                      });
                      const awaiting = isOrderAwaitingApproval(job.id);
                      const showLineItemEditPanel = !awaiting || viewerCanFulfill;
                      const showEditOrderButton =
                        (canEdit || viewerCanFulfill) &&
                        !job.isLocked &&
                        (!awaiting || viewerCanFulfill);
                      const showPreferredDeliveryOptions =
                        project.receiveMode === "delivery" &&
                        job.orderLifecycleStatus !== "delivered" &&
                        job.orderLifecycleStatus !== "paid";
                      const deliveryScheduleForm =
                        (canEdit || viewerCanFulfill) && showPreferredDeliveryOptions ? (
                          <Form
                            method="post"
                            action={`/apps/project-clad/project?id=${project.id}`}
                            className="project-clad-stack project-clad-preferred-delivery-form"
                            data-projectclad-preferred-delivery
                            style={{
                              width: "100%",
                              boxSizing: "border-box",
                            }}
                          >
                            <input type="hidden" name="intent" value="save-order-schedule" />
                            <input type="hidden" name="jobId" value={job.id} />
                            {viewerCanFulfill ? (
                              <input type="hidden" name="staffSchedule" value="1" />
                            ) : null}
                            <PreferredDeliveryScheduleFields
                              job={job}
                              minYmd={preferredDeliveryDateMinYmd}
                            />
                            <button
                              type="submit"
                              className="project-clad-button project-clad-preferred-delivery-submit"
                            >
                              Save
                            </button>
                          </Form>
                        ) : null;
                      return (
                    <div
                      className="project-clad-actions project-clad-order-actions"
                      data-projectclad-order-section
                      data-job-id={job.id}
                      style={{
                        marginTop: "1rem",
                        paddingTop: "1rem",
                        borderTop: "1px solid rgba(0,0,0,0.12)",
                        flexDirection: "column",
                        alignItems: "stretch",
                        gap: "0.75rem",
                      }}
                    >
                      <div
                        className={`project-clad-normal-view project-clad-order-actions-top-row${
                          preferredDeliveryLine
                            ? " project-clad-order-actions-top-row--split"
                            : ""
                        }`}
                      >
                        {preferredDeliveryLine ? (
                          <div className="project-clad-order-schedule-summary">
                            <span className="project-clad-order-schedule-summary__line">
                              {preferredDeliveryLine}
                            </span>
                          </div>
                        ) : null}
                        <div
                          className={`project-clad-order-actions-lifecycle-row${
                            preferredDeliveryLine
                              ? " project-clad-order-actions-lifecycle-row--schedule"
                              : ""
                          }`}
                        >
                          <div className="project-clad-order-actions-customer-inline">
                            {canEdit ? renderOrderLifecycleCustomerSummaryActions(job) : null}
                            {showEditOrderButton ? (
                              <button
                                type="button"
                                className="project-clad-button"
                                data-projectclad-edit-order
                                data-job-id={job.id}
                                data-project-id={project.id}
                              >
                                Edit order
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      {!showLineItemEditPanel ? deliveryScheduleForm : null}
                      {showLineItemEditPanel ? (
                      <div
                        className="project-clad-edit-view project-clad-order-edit-panel"
                        style={{
                          display: "none",
                          flexDirection: "column",
                          gap: "1rem",
                          alignItems: "stretch",
                          width: "100%",
                        }}
                      >
                        {deliveryScheduleForm}
                        {viewerCanFulfill ? (
                          <div
                            className="project-clad-staff-fulfillment"
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "0.75rem",
                              maxWidth: "32rem",
                            }}
                          >
                            {staffOrderLifecycleStatusForm(job)}
                            {job.orderLifecycleStatus === "ordered" ? (
                              <StaffFulfillmentPhotoUpload job={job} projectId={project.id} />
                            ) : null}
                            {job.orderLifecycleStatus === "delivered" ? (
                              <Form
                                method="post"
                                action={`/apps/project-clad/project?id=${project.id}`}
                              >
                                <input type="hidden" name="intent" value="staff-mark-order-paid" />
                                <input type="hidden" name="jobId" value={job.id} />
                                <button type="submit" className="project-clad-button">
                                  Mark paid
                                </button>
                              </Form>
                            ) : null}
                          </div>
                        ) : null}
                        {canEdit || viewerCanFulfill ? (
                          <div
                            className="project-clad-actions"
                            style={{ flexWrap: "wrap", gap: "0.75rem", paddingTop: "0.25rem" }}
                          >
                            {canEdit && !job.isLocked ? (
                              <button
                                type="button"
                                className="project-clad-button"
                                data-projectclad-delete-order-btn
                                data-job-id={job.id}
                              >
                                Delete order
                              </button>
                            ) : null}
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
                        ) : null}
                      </div>
                      ) : null}
                    </div>
                    );
                    })()}
                    {job.hasFulfillmentPhoto &&
                    job.fulfillmentPhotoUrl &&
                    job.orderLifecycleStatus !== "ordered" ? (
                      <div style={{ marginTop: "1rem", textAlign: "right" }}>
                        <a
                          href={job.fulfillmentPhotoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="project-clad-button"
                        >
                          View delivery photo
                        </a>
                      </div>
                    ) : null}
                    </div>
                  </details>
                );
                  })}
                </div>
              )}
              <div className="project-clad-orders-shell__footer">
                <div className="project-clad-summary-row">
                  <div>
                    <h2
                      className="project-clad-title project-clad-project-footer-metric-label"
                      style={{ marginBottom: 0 }}
                    >
                      Project subtotal
                    </h2>
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
                <div className="project-clad-summary-row project-clad-project-footer-tax-row">
                  <div>
                    <h2
                      className="project-clad-title project-clad-project-footer-metric-label"
                      style={{ marginBottom: 0 }}
                    >
                      Tax ({Math.round(ORDER_DISPLAY_TAX_RATE * 100)}%)
                    </h2>
                  </div>
                  <div
                    className="project-clad-summary-action"
                    data-projectclad-price
                    data-price={projectDisplayTax.toFixed(2)}
                  >
                    {pricingUnlocked ? (
                      formatPrice(projectDisplayTax.toFixed(2))
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
                <div className="project-clad-summary-row project-clad-project-footer-total-row">
                  <div>
                    <h2
                      className="project-clad-title project-clad-project-footer-metric-label"
                      style={{ marginBottom: 0 }}
                    >
                      Total
                    </h2>
                  </div>
                  <div
                    className="project-clad-summary-action"
                    data-projectclad-price
                    data-price={projectTotalWithDisplayTax.toFixed(2)}
                  >
                    {pricingUnlocked ? (
                      formatPrice(projectTotalWithDisplayTax.toFixed(2))
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

              <details
                id="project-clad-comments"
                className="project-clad-order-row project-clad-details project-clad-comments-drawer"
              >
                <summary className="project-clad-summary">
                  <div className="project-clad-summary-row project-clad-order-summary-head-row">
                    <div className="project-clad-order-summary-padded">
                      <h2
                        className="project-clad-title project-clad-neon-title"
                        style={{ marginBottom: 0 }}
                      >
                        More
                      </h2>
                    </div>
                  </div>
                </summary>
                <div className="project-clad-stack">
                  <span className="project-clad-sr-only">
                    More: activity, comments, and project options
                  </span>
                  <Form
                    method="post"
                    action={`${storefrontProjectActionPath}?id=${encodeURIComponent(project.id)}`}
                    className="project-clad-activity-feed__form"
                  >
                    <input type="hidden" name="id" value={project.id} />
                    <input type="hidden" name="intent" value="add-comment" />
                    <div className="project-clad-activity-feed__composer">
                      <div className="project-clad-neu-finder-input">
                        <div className="project-clad-neu-finder-input__well">
                          <textarea
                            name="body"
                            className="project-clad-neu-finder-input__field project-clad-activity-feed__textarea"
                            rows={1}
                            required
                            placeholder="COMMENT HERE:"
                            aria-label="Comment here"
                            style={{ width: "100%", maxWidth: "100%" }}
                          />
                        </div>
                      </div>
                      <button type="submit" className="project-clad-button">
                        Post
                      </button>
                    </div>
                  </Form>
                  <div className="project-clad-activity-feed__scroll">
                    {projectTimeline.length === 0 ? (
                      <p className="project-clad-muted">No activity yet.</p>
                    ) : (
                      <ul className="project-clad-activity-feed__list">
                        {projectTimeline.map((item) =>
                          item.kind === "activity" ? (
                            <li
                              key={`a-${item.id}`}
                              className="project-clad-activity-feed__comment-item"
                            >
                              <ProjectActivityCommentLine
                                authorLabel={item.actorLabel ?? ""}
                                createdAt={item.createdAt}
                                emptyAuthorLabel="System"
                                body={
                                  formatActivitySummary(item) +
                                  (item.visibility === "admin" && viewerIsAdmin
                                    ? " · Internal"
                                    : "")
                                }
                              />
                            </li>
                          ) : (
                            <li key={`c-${item.id}`} className="project-clad-activity-feed__comment-item">
                              {item.deletedAt ? (
                                <p className="project-clad-muted" style={{ fontStyle: "italic", margin: 0 }}>
                                  Comment deleted
                                  {item.deletedByLabel ? ` by ${item.deletedByLabel}` : ""}.
                                </p>
                              ) : (
                                <ProjectActivityCommentLine
                                  authorLabel={item.authorLabel}
                                  createdAt={item.createdAt}
                                  body={item.body}
                                />
                              )}
                            </li>
                          ),
                        )}
                      </ul>
                    )}
                  </div>
                  {canEdit && (
                    <div
                      className="project-clad-actions project-clad-project-settings-actions"
                      style={{ flexWrap: "wrap", gap: "1rem", marginTop: "0.75rem" }}
                    >
                      <button
                        type="button"
                        className="project-clad-button"
                        data-projectclad-edit-project-details
                      >
                        Edit project
                      </button>
                    </div>
                  )}
                </div>
              </details>
            </div>
          </section>

          <script
            dangerouslySetInnerHTML={{
              __html: `
(() => {
  if (window.__pcShareCopyInitialized) return;
  window.__pcShareCopyInitialized = true;
  const actionsEndpoint = '/apps/project-clad/api/project-actions';

  function syncMemberRoleSelect(details) {
    const labelEl = details.querySelector('[data-role-label]');
    const checked = details.querySelector('input[name="role"]:checked');
    const opt = checked && checked.closest('.project-clad-member-role-select__option');
    const textEl = opt && opt.querySelector('.project-clad-member-role-select__option-text');
    const text = textEl && textEl.textContent ? textEl.textContent.trim() : '';
    if (labelEl && text) labelEl.textContent = text;
  }

  var PC_ROLE_PANEL_MS = 240;
  var PC_ROLE_PANEL_EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';

  var PC_EDIT_PROJECT_MODAL_MS = 300;
  var editProjectModalCloseTimer = null;

  function pcEditProjectModalMotionMs() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return 0;
    }
    return PC_EDIT_PROJECT_MODAL_MS;
  }

  function openEditProjectModal() {
    var modal = document.querySelector('[data-projectclad-edit-project-modal]');
    if (!(modal instanceof HTMLElement)) return;
    if (editProjectModalCloseTimer) {
      clearTimeout(editProjectModalCloseTimer);
      editProjectModalCloseTimer = null;
    }
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.remove('project-clad-edit-project-modal--open');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        modal.classList.add('project-clad-edit-project-modal--open');
      });
    });
  }

  function closeEditProjectModal() {
    try {
      window.dispatchEvent(new CustomEvent('projectclad-edit-project-modal-closed'));
    } catch (e) {}
    var modal = document.querySelector('[data-projectclad-edit-project-modal]');
    if (!(modal instanceof HTMLElement)) return;
    if (editProjectModalCloseTimer) {
      clearTimeout(editProjectModalCloseTimer);
      editProjectModalCloseTimer = null;
    }
    var ms = pcEditProjectModalMotionMs();
    if (!modal.classList.contains('project-clad-edit-project-modal--open')) {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
      return;
    }
    modal.classList.remove('project-clad-edit-project-modal--open');
    if (ms <= 0) {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
      return;
    }
    editProjectModalCloseTimer = window.setTimeout(function () {
      editProjectModalCloseTimer = null;
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }, ms);
  }

  function pcMemberRolePanel(details) {
    return details.querySelector('.project-clad-member-role-select__panel');
  }
  function pcMemberRoleList(details) {
    return details.querySelector('.project-clad-member-role-select__list');
  }

  function pcAnimateMemberRoleOpen(details) {
    var panel = pcMemberRolePanel(details);
    var list = pcMemberRoleList(details);
    if (!panel || !list) return;
    var target = list.scrollHeight;
    panel.style.overflow = 'hidden';
    panel.style.transition = 'height ' + PC_ROLE_PANEL_MS / 1000 + 's ' + PC_ROLE_PANEL_EASE;
    panel.style.height = '0px';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        panel.style.height = target + 'px';
      });
    });
    function settle() {
      if (details.open) panel.style.height = 'auto';
    }
    function onEnd(ev) {
      if (ev.propertyName !== 'height') return;
      clearTimeout(tid);
      settle();
    }
    var tid = setTimeout(settle, PC_ROLE_PANEL_MS + 100);
    panel.addEventListener('transitionend', onEnd, { once: true });
  }

  function pcAnimateMemberRoleClose(details, done) {
    var panel = pcMemberRolePanel(details);
    var list = pcMemberRoleList(details);
    if (!panel || !list) {
      done();
      return;
    }
    var h = list.scrollHeight;
    panel.style.overflow = 'hidden';
    panel.style.transition = 'height ' + PC_ROLE_PANEL_MS / 1000 + 's ' + PC_ROLE_PANEL_EASE;
    if (panel.style.height === 'auto' || panel.style.height === '') {
      panel.style.height = h + 'px';
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        panel.style.height = '0px';
      });
    });
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      panel.removeEventListener('transitionend', onEnd);
      clearTimeout(tid);
      panel.style.transition = '';
      panel.style.height = '';
      done();
    }
    function onEnd(ev) {
      if (ev.propertyName !== 'height') return;
      finish();
    }
    panel.addEventListener('transitionend', onEnd);
    var tid = setTimeout(finish, PC_ROLE_PANEL_MS + 100);
  }

  function pcBindMemberRoleSelect(details) {
    var sum = details.querySelector('summary.project-clad-member-role-select__trigger');
    if (!(sum instanceof HTMLElement)) return;
    sum.addEventListener('click', function (e) {
      e.preventDefault();
      if (details.open) {
        pcAnimateMemberRoleClose(details, function () {
          details.open = false;
        });
      } else {
        var p = pcMemberRolePanel(details);
        if (p) {
          p.style.transition = 'none';
          p.style.height = '0px';
        }
        details.open = true;
        if (p) {
          void p.offsetHeight;
          p.style.transition = '';
        }
        pcAnimateMemberRoleOpen(details);
      }
    });
  }

  document.querySelectorAll('[data-projectclad-member-role-select]').forEach(function (el) {
    if (!(el instanceof HTMLDetailsElement)) return;
    syncMemberRoleSelect(el);
    pcBindMemberRoleSelect(el);
    el.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t instanceof HTMLInputElement && t.name === 'role') {
        syncMemberRoleSelect(el);
        if (el.open) {
          pcAnimateMemberRoleClose(el, function () {
            el.open = false;
          });
        } else {
          el.open = false;
        }
      }
    });
  });

  document.addEventListener(
    'pointerdown',
    function (e) {
      var t = e.target;
      if (!(t instanceof Node)) return;
      document.querySelectorAll('details[data-projectclad-member-role-select][open]').forEach(function (d) {
        if (!(d instanceof HTMLDetailsElement)) return;
        if (d.contains(t)) return;
        pcAnimateMemberRoleClose(d, function () {
          d.open = false;
        });
      });
    },
    true,
  );

  const memberMessage = document.querySelector('[data-projectclad-member-message]');
  const setMemberMessage = (text) => {
    if (memberMessage) {
      memberMessage.textContent = text || '';
    }
  };
  const closePricingModal = () => {
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
          const row = inp.closest('[data-projectclad-item-row]');
          const priceInp = row && row.querySelector('[data-projectclad-unit-price-input]');
          const entry = { itemId: itemId, quantity: qty };
          if (priceInp instanceof HTMLInputElement) {
            var rawP = priceInp.value.trim().replace(/,/g, '');
            if (rawP !== '') {
              var p = parseFloat(rawP);
              if (!isNaN(p) && p >= 0) entry.unitPrice = p;
            }
          }
          itemUpdates.push(entry);
        }
      });
      let jobName = '';
      const nameInput = details?.querySelector?.('[data-projectclad-job-name-input]');
      if (nameInput instanceof HTMLInputElement) {
        jobName = nameInput.value.trim();
      }
      let purchaseOrderNumber = '';
      const poInput = details?.querySelector?.('[data-projectclad-purchase-order-input]');
      if (poInput instanceof HTMLInputElement) {
        purchaseOrderNumber = poInput.value.trim();
      }
      try {
        const res = await fetch(window.location.pathname + window.location.search, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intent: 'save-order-edit', jobId, jobName: jobName, purchaseOrderNumber: purchaseOrderNumber, removeItemIds: [], itemUpdates: itemUpdates, deleteJob: deleteJob }),
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
      if (modal instanceof HTMLElement) modal.style.display = 'none';
      editingJobId = null;
      editPendingDeleteJobId = null;
      if (jobId) editRemovedItemIds[jobId] = [];
      window.location.reload();
    }
  });

  if (rejectForm instanceof HTMLFormElement) {
    rejectForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const errEl = rejectForm.querySelector('[data-projectclad-reject-form-error]');
      if (errEl) errEl.textContent = '';
      const reason = rejectReasonInput instanceof HTMLTextAreaElement ? rejectReasonInput.value.trim() : '';
      if (!reason) {
        if (errEl) errEl.textContent = 'Please enter a rejection reason.';
        return;
      }
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

  const isAddMemberPopoverOpen = (popover) =>
    popover instanceof HTMLElement &&
    popover.classList.contains('project-clad-add-member-popover--open');

  function clearAddMemberPopoverMobileLayout(pop) {
    if (!(pop instanceof HTMLElement)) return;
    pop.style.removeProperty('position');
    pop.style.removeProperty('top');
    pop.style.removeProperty('left');
    pop.style.removeProperty('right');
    pop.style.removeProperty('width');
    pop.style.removeProperty('max-width');
    pop.style.removeProperty('transform');
  }

  function applyAddMemberPopoverMobileLayout(pop, toggle) {
    if (!(pop instanceof HTMLElement) || !(toggle instanceof HTMLElement)) return;
    clearAddMemberPopoverMobileLayout(pop);
    if (window.matchMedia && window.matchMedia('(min-width: 750px)').matches) return;
    var rect = toggle.getBoundingClientRect();
    var vw = window.innerWidth;
    var margin = 12;
    var maxW = Math.min(352, vw - margin * 2);
    var left = rect.left + rect.width / 2 - maxW / 2;
    left = Math.max(margin, Math.min(left, vw - margin - maxW));
    var top = rect.bottom + 8;
    pop.style.setProperty('position', 'fixed', 'important');
    pop.style.setProperty('top', top + 'px', 'important');
    pop.style.setProperty('left', left + 'px', 'important');
    pop.style.setProperty('width', maxW + 'px', 'important');
    pop.style.setProperty('right', 'auto', 'important');
    pop.style.setProperty('transform', 'none', 'important');
  }

  var pcAddMemberResizeTimer = null;
  window.addEventListener('resize', function () {
    var pop = document.querySelector('[data-projectclad-add-member-popover]');
    var tgl = document.querySelector('[data-projectclad-add-member-popover-toggle]');
    if (!isAddMemberPopoverOpen(pop)) return;
    if (pcAddMemberResizeTimer) clearTimeout(pcAddMemberResizeTimer);
    pcAddMemberResizeTimer = setTimeout(function () {
      applyAddMemberPopoverMobileLayout(pop, tgl);
    }, 60);
  });

  const openAddMemberPopover = (popover, toggle) => {
    if (!(popover instanceof HTMLElement)) return;
    popover.classList.add('project-clad-add-member-popover--open');
    popover.setAttribute('aria-hidden', 'false');
    if (toggle instanceof HTMLElement) {
      toggle.setAttribute('aria-expanded', 'true');
    }
    applyAddMemberPopoverMobileLayout(popover, toggle);
  };

  const closeAddMemberPopover = (popover, toggle) => {
    if (!(popover instanceof HTMLElement)) return;
    clearAddMemberPopoverMobileLayout(popover);
    popover.classList.remove('project-clad-add-member-popover--open');
    popover.setAttribute('aria-hidden', 'true');
    if (toggle instanceof HTMLElement) {
      toggle.setAttribute('aria-expanded', 'false');
    }
  };

  document.addEventListener('click', (event) => {
    var tOnow = event.target;
    if (tOnow && tOnow.nodeType === 3 && tOnow.parentElement) {
      tOnow = tOnow.parentElement;
    }
    var onowBtn =
      tOnow && tOnow.closest && tOnow.closest('[data-projectclad-order-now-submit]');
    if (onowBtn instanceof HTMLButtonElement && !onowBtn.disabled) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (
        !window.confirm(
          'Please ensure all delivery details are accurate. You can update delivery information under "Edit Project Details", and modify order-specific information in "Edit Order."',
        )
      ) {
        return;
      }
      var onowJobId = onowBtn.getAttribute('data-job-id') || '';
      if (!onowJobId) return;
      var onowHasDel = onowBtn.getAttribute('data-has-delivery') === '1';
      var onowMethod = onowHasDel ? 'delivery' : 'pickup';
      var onowPath = window.location.pathname + window.location.search;
      onowBtn.disabled = true;
      fetch(onowPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          intent: 'confirm-order-now',
          jobId: onowJobId,
          fulfillmentMethod: onowMethod,
        }),
      })
        .then(function (res) {
          return res.text().then(function (text) {
            return { res: res, text: text };
          });
        })
        .then(function (o) {
          var payload = null;
          try {
            payload = o.text ? JSON.parse(o.text) : null;
          } catch (e) {}
          if (payload && payload.redirectTo) {
            window.location.href = payload.redirectTo;
            return;
          }
          var errLine = (payload && payload.error) || null;
          if (!o.res.ok || errLine) {
            window.alert(errLine || 'Unable to confirm order.');
            onowBtn.disabled = false;
            return;
          }
          window.location.reload();
        })
        .catch(function () {
          window.alert('Unable to confirm order.');
          onowBtn.disabled = false;
        });
      return;
    }
    const addMemberToggle = event.target?.closest?.('[data-projectclad-add-member-popover-toggle]');
    if (addMemberToggle instanceof HTMLElement) {
      event.preventDefault();
      event.stopPropagation();
      const pop = document.querySelector('[data-projectclad-add-member-popover]');
      if (pop instanceof HTMLElement) {
        const open = isAddMemberPopoverOpen(pop);
        if (open) {
          closeAddMemberPopover(pop, addMemberToggle);
        } else {
          openAddMemberPopover(pop, addMemberToggle);
          const email = document.getElementById('member-email-header');
          if (email instanceof HTMLElement) setTimeout(function() { email.focus(); }, 30);
        }
      }
      return;
    }

    const editProjectBtn = event.target?.closest?.('[data-projectclad-edit-project-details]');
    if (editProjectBtn instanceof HTMLElement) {
      event.preventDefault();
      const popOver = document.querySelector('[data-projectclad-add-member-popover]');
      const popToggle = document.querySelector('[data-projectclad-add-member-popover-toggle]');
      if (popOver instanceof HTMLElement) {
        closeAddMemberPopover(popOver, popToggle);
      }
      openEditProjectModal();
    }
    const editProjectCancel = event.target?.closest?.('[data-projectclad-edit-project-cancel]');
    if (editProjectCancel) {
      closeEditProjectModal();
    }
    if (event.target?.closest?.('[data-projectclad-edit-project-modal]') === event.target) {
      closeEditProjectModal();
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

    const addMemberPopoverEl = document.querySelector('[data-projectclad-add-member-popover]');
    if (isAddMemberPopoverOpen(addMemberPopoverEl)) {
      if (!event.target?.closest?.('[data-projectclad-add-member-popover]') && !event.target?.closest?.('[data-projectclad-add-member-popover-toggle]')) {
        const tt = document.querySelector('[data-projectclad-add-member-popover-toggle]');
        closeAddMemberPopover(addMemberPopoverEl, tt);
      }
    }
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const pop = document.querySelector('[data-projectclad-add-member-popover]');
    const tgl = document.querySelector('[data-projectclad-add-member-popover-toggle]');
    if (isAddMemberPopoverOpen(pop)) {
      closeAddMemberPopover(pop, tgl);
      return;
    }
    const editProjModal = document.querySelector('[data-projectclad-edit-project-modal]');
    if (
      editProjModal instanceof HTMLElement &&
      editProjModal.classList.contains('project-clad-edit-project-modal--open')
    ) {
      closeEditProjectModal();
    }
  });

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
    const roleRadio = form.querySelector('input[name="role"]:checked');

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
    } else if (roleRadio instanceof HTMLInputElement) {
      params.set('role', roleRadio.value);
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
        closePricingModal();
        window.location.reload();
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

        </div>
      </main>
      <script
        dangerouslySetInnerHTML={{ __html: PROJECT_CLAD_CURSOR_GLOW_SCRIPT }}
      />
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
  window.addEventListener('pageshow', function(ev) {
    if (ev.persisted) window.location.reload();
  });
})();
          `,
        }}
      />
    </>
  );
}

export const links: LinksFunction = () => [];
