import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  CSSProperties,
  ReactNode,
} from "react";
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
import type { ProjectStorefrontStatus } from "@prisma/client";
import { requireAppProxyCustomer, mergeAppProxyParamsFromRequest } from "../utils/appProxy.server";
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
  resolvePlacerNotifyEmail,
} from "../utils/adminCustomers.server";
import {
  customerEmailInConfiguredList,
  getViewerCompanyContext,
  hasStaffStorefrontTag,
  hasTag,
  normalizeStorefrontCustomerId,
  viewerHasAdminTag,
} from "../utils/customerTags.server";
import {
  canAdminProjectMembers,
  canEditProject,
  canViewProjectViaCompany,
  customerIdsMatch,
  isProjectMember,
  isProjectOwner,
  shopStringFilter,
} from "../utils/projectAccess.server";
import { verifyPassword } from "../utils/passwords.server";
import { getThemeStyles } from "../utils/themeAssets.server";
import { PROJECT_CLAD_CURSOR_GLOW_SCRIPT } from "../utils/projectCladCursorGlowScript";
import { projectCladProxyStylesHref } from "../utils/projectCladProxyStyles.server";
import {
  projectCladInlineConfigScript,
  projectCladScriptSrc,
} from "../utils/projectCladProxyScripts.server";
import { buildShopBrandingUrls } from "../utils/shopBrandingAssets.server";
import { ProjectCladStorefrontFooter } from "../components/ProjectCladStorefrontFooter";
import { ProjectCladStorefrontNav } from "../components/ProjectCladStorefrontNav";
import { getStorefrontAppNav } from "../utils/storefrontAppNav";
import { STOREFRONT_ORDER_CONFIRMED_ACTIVITY } from "../utils/projectActivity.shared";
import {
  sendOrderPlacedEmails,
  sendProjectStatusNotificationEmail,
} from "../utils/orderCreatedEmail.server";
import { notifyOrderNowStaff } from "../utils/orderNowStaffPush.server";
import { notifyMissionControl, notifyMissionControlRemove } from "../utils/missionControl.server";
import { sendFulfillmentPackageEmails } from "../utils/fulfillmentNotify.server";
import { readFormUploadedImage } from "../utils/uploadedImageFile.server";
import {
  deletePurchaseOrderPdf,
  isSafePurchaseOrderPdfStorageKey,
  readFormUploadedPdf,
  savePurchaseOrderPdf,
  validateUploadedPurchaseOrderPdf,
} from "../utils/purchaseOrderPdfStorage.server";
import { createBackupDraftOrderForJob, settleBackupDraftOrderOnPaidBestEffort } from "../utils/shopifyDraftOrder.server";
import { ensureJobOrderNumberForShop } from "../utils/jobOrderNumber.server";
import {
  CANADIAN_CLADDING_STOREFRONT_LOGO_URL,
  buildCanadianCladdingLogoSrcSet,
} from "../utils/canadianCladdingStorefrontLogo";
import {
  isPrePlacedOrderLifecycle,
  jobCountsTowardProjectSubtotal,
  prePlacedOrderHeaderChipLabel,
} from "../utils/orderLifecycle.shared";
import {
  addDaysToCalendarYmd,
  formatOrderDeliveryFootline,
  isOttawaDeliveryWindowValidForDate,
  isYmdBeforeMin,
  minPreferredDeliveryYmd,
  OTTAWA_DELIVERY_HOUR_WINDOWS,
  PREFERRED_DELIVERY_CALENDAR_TIMEZONE,
  PREFERRED_DELIVERY_MIN_DAY_OFFSET_FROM_TODAY,
} from "../utils/preferredDeliveryFormat";
import { buildSignedFulfillmentPhotoUrl } from "../utils/fulfillmentPhotoSignedUrl.server";
import {
  deleteFulfillmentPhoto,
  isSafeFulfillmentPhotoStorageKey,
  saveFulfillmentPhoto,
} from "../utils/fulfillmentPhotoStorage.server";
import {
  ORDER_DISPLAY_TAX_RATE,
  orderTaxFromSubtotal,
  orderTotalWithTax,
} from "../utils/orderDisplayTax";
import {
  jobNameForOrderSummary,
  jobPurchaseOrderDisplay,
} from "../utils/jobNameDisplay";
import { resolveColourCatalogueLine } from "../utils/colourCatalogue";
import { duplicateUploadPartMirrorsForCopiedJobItem } from "../utils/uploadPartMirror.server";
import { upsertProjectShareInvite } from "../utils/projectShareInvite.server";
import {
  JobDeliveryAddressFields,
  JobDeliveryModeRadios,
  ProjectReceiveModeRadios,
} from "../components/JobDeliveryFields";
import {
  deliveryFeeForJob,
  hasCompleteShipToDetails,
  jobDeliveryPrismaData,
  jobIsDeliveryForDisplay,
  normalizeJobDeliveryMode,
  resolveJobDelivery,
  isOrderDeliveryPlanLocked,
  isReorderEligibleOrderLifecycle,
  isJobDeliverySchemaError,
  type JobDeliveryMode,
} from "../utils/jobDelivery";
import { getShopDeliveryFee } from "../utils/shopDeliveryFee.server";
import {
  computeDeliveredPercent,
  deliveryPhaseHasProgress,
  formatPhaseDeliveredUnitsLabel,
  mapPhasesToViews,
  parsePhasesJson,
  parseDeliveryPlanReference,
  serializeDeliveryPlanReference,
  validatePlannedQuantities,
  totalDeliveryFeesFromPhases,
  isJobFullyDelivered,
  buildPhasesFromAtATime,
  parseAtATimeDeliveryPayload,
  inferBatchByItemFromPhases,
  normalizeDeliveryPlanMode,
  type DeliveryPhaseView,
  type DeliveryPlanMode,
  type PhaseSaveInput,
} from "../utils/jobDeliveryPhases";
import {
  ensureJobDeliveryPhases,
  recordPhaseDeliveredQuantities,
  spawnNextFulfillmentPhaseIfNeeded,
  ensureOpenFulfillmentPhase,
  jobHasFulfillmentProgress,
  jobNeedsOpenFulfillmentPhaseSync,
  resetJobDeliveryPhasesProgress,
} from "../utils/jobDeliveryPhases.server";

declare global {
  interface Window {
    __pcShareCopyInitialized?: boolean;
    __pcHandleExportOrderPdf?: (btn: HTMLButtonElement) => void;
  }
}

type JobItemView = {
  id: string;
  /** Line sequence within the job (1-based). */
  sortOrder: number;
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

/** Protocol-relative and absolute http(s) URLs from line properties / calc payload. */
function normalizeHttpUrl(url: string): string | null {
  const t = url.trim();
  if (!t) return null;
  if (t.startsWith("//")) return `https:${t}`;
  if (/^https?:\/\//i.test(t)) return t;
  return null;
}

/** Cart / Files URLs usually end in `.pdf`; `<img>` cannot preview PDFs. */
function isLikelyPdfUrl(url: string): boolean {
  const normalized = normalizeHttpUrl(url) ?? url.trim();
  if (!/^https?:\/\//i.test(normalized)) return false;
  try {
    const u = new URL(normalized);
    return /\.pdf(\?|$)/i.test(u.pathname);
  } catch {
    return /\.pdf(\?|$)/i.test(normalized);
  }
}

function isLikelyImageMediaUrl(url: string): boolean {
  const normalized = normalizeHttpUrl(url);
  if (!normalized || isLikelyPdfUrl(normalized)) return false;
  try {
    const path = new URL(normalized).pathname.toLowerCase();
    if (/\.(png|jpe?g|gif|webp|avif|svg|bmp)(\?|$)/i.test(path)) return true;
    if (/\/cdn\/shop\/files\//i.test(path)) return true;
  } catch {
    return /\.(png|jpe?g|gif|webp)(\?|$)/i.test(normalized);
  }
  return true;
}

function urlsMatchForDisplay(a: string, b: string): boolean {
  const na = normalizeHttpUrl(a);
  const nb = normalizeHttpUrl(b);
  if (!na || !nb) return false;
  return na.replace(/\/$/, "").toLowerCase() === nb.replace(/\/$/, "").toLowerCase();
}

function isReferenceImagePropertyName(name: string): boolean {
  const n = name.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  return (
    (n.includes("reference") && n.includes("image")) ||
    n === "referenceimage" ||
    n === "ref image"
  );
}

function extractReferenceImageFromProperties(
  properties: { name: string; value: string }[] | null | undefined,
): string | null {
  if (!properties?.length) return null;
  for (const p of properties) {
    if (!isReferenceImagePropertyName(p.name)) continue;
    const href = normalizeHttpUrl((p.value || "").trim());
    if (href && !isLikelyPdfUrl(href)) return href;
  }
  return null;
}

function shouldSuppressUrlPropertyInChips(
  propName: string,
  url: string,
  item: JobItemView,
): boolean {
  if (isReferenceImagePropertyName(propName)) return true;
  const nameLower = propName.trim().toLowerCase();
  if (nameLower === "file" || nameLower === "image" || nameLower === "upload") {
    return true;
  }
  if (item.imageUrl && urlsMatchForDisplay(url, item.imageUrl)) return true;
  return false;
}

function renderOrderLinePropertyMediaBlock(
  key: string,
  label: string,
  rawUrl: string,
): ReactNode | null {
  const href = normalizeHttpUrl(rawUrl);
  if (!href) return null;

  if (isLikelyPdfUrl(href)) {
    return (
      <div key={key} className="project-clad-order-card-prop-block">
        <strong>{label}:</strong>
        <div className="project-clad-upload-url-pdf">
          <a
            href={href}
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

  if (isLikelyImageMediaUrl(href) || isReferenceImagePropertyName(label)) {
    return (
      <div key={key} className="project-clad-order-card-prop-block">
        <strong>{label}:</strong>
        <div>
          <img
            src={href}
            alt={label}
            className="project-clad-order-card-prop-img"
            draggable={false}
          />
        </div>
      </div>
    );
  }

  return (
    <div key={key} className="project-clad-order-card-prop-block">
      <strong>{label}:</strong>{" "}
      <a href={href} target="_blank" rel="noopener noreferrer">
        Open link
      </a>
    </div>
  );
}

/* ------------------------------------------------------------------
 * Order finance action-row icons (Save / Order now / Edit / lifecycle).
 * Stroke + fill inherit from `currentColor` on `.project-clad-order-action__icon`.
 * ------------------------------------------------------------------ */
const PC_ICON_SVG_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
};

/** Action-bar face icons: outlined floppy, forward arrow, pencil (product mockups). */
const PC_SAVE_ICON = (
  <svg {...PC_ICON_SVG_PROPS}>
    <path d="M17.5 3H6.5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7.5L17.5 3z" />
    <path d="M14 3v4h4" />
    <path d="M8 13h8" />
    <path d="M8 17h5" />
  </svg>
);

const PC_ORDER_NOW_ICON = (
  <svg {...PC_ICON_SVG_PROPS}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </svg>
);

const PC_EDIT_ICON = (
  <svg {...PC_ICON_SVG_PROPS}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z" />
  </svg>
);

const PC_CHECK_ICON = (
  <svg {...PC_ICON_SVG_PROPS}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const PC_PO_PDF_UPLOAD_ICON = (
  <svg {...PC_ICON_SVG_PROPS} strokeWidth={2}>
    <path d="M12 19V5" />
    <path d="m5 12 7-7 7 7" />
    <path d="M5 21h14" />
  </svg>
);

const PC_PACKAGE_ICON = (
  <svg {...PC_ICON_SVG_PROPS}>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <path d="M3.27 6.96 12 12.01l8.73-5.05" />
    <path d="M12 22.08V12" />
  </svg>
);

const PC_HOURGLASS_ICON = (
  <svg {...PC_ICON_SVG_PROPS}>
    <path d="M5 22h14" />
    <path d="M5 2h14" />
    <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
    <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
  </svg>
);

const PC_SEND_ICON = (
  <svg {...PC_ICON_SVG_PROPS}>
    <path d="m22 2-11 11" />
    <path d="M22 2 15 22 11 13 2 9z" />
  </svg>
);

const PC_LOCK_ICON = (
  <svg {...PC_ICON_SVG_PROPS}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const PC_DELIVERY_OPTIONS_ICON = (
  <svg {...PC_ICON_SVG_PROPS}>
    <path d="M3 7h11v8H3z" />
    <path d="M14 10h4l3 3v2h-7V10z" />
    <circle cx="7" cy="17" r="2" />
    <circle cx="17" cy="17" r="2" />
  </svg>
);

type OrderActionSpec =
  | {
      key: string;
      kind: "status";
      icon: ReactNode;
      label: string;
      description: string;
      tone?: "go" | "edit";
    }
  | {
      key: string;
      kind: "button";
      icon: ReactNode;
      label: string;
      description: string;
      tone?: "go" | "edit";
      buttonProps: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> &
        Record<`data-${string}`, string | undefined>;
    }
  | {
      key: string;
      kind: "link";
      icon: ReactNode;
      label: string;
      description: string;
      tone?: "go" | "edit";
      anchorProps: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children"> &
        Record<`data-${string}`, string | undefined>;
    }
  | {
      key: string;
      kind: "ajaxForm";
      icon: ReactNode;
      label: string;
      description: string;
      tone?: "go" | "edit";
      intent: "cancel-approval-request" | "submit-for-approval";
      jobId: string;
      awaiting: boolean;
    };

function mergeDescribedBy(
  existing: string | undefined,
  id: string,
): string | undefined {
  if (!existing?.trim()) return id;
  const parts = existing.trim().split(/\s+/);
  if (parts.includes(id)) return existing.trim();
  return `${existing.trim()} ${id}`;
}

function renderOrderAction(
  spec: OrderActionSpec,
  ctx: { jobId: string; projectId: string },
): ReactNode {
  const toneClass = `project-clad-order-action--tone-${spec.tone ?? "edit"}`;
  const descId = `project-clad-order-action-desc-${ctx.jobId}-${spec.key}`;
  const desc = (
    <span id={descId} className="project-clad-sr-only">
      {spec.description}
    </span>
  );
  const visual = (
    <>
      <span className="project-clad-order-action__icon" aria-hidden="true">
        {spec.icon}
      </span>
      <span className="project-clad-order-action__label">{spec.label}</span>
    </>
  );

  if (spec.kind === "status") {
    return (
      <div
        key={spec.key}
        className={`project-clad-order-action project-clad-order-action--status ${toneClass}`}
        role="status"
        aria-describedby={descId}
      >
        {desc}
        {visual}
      </div>
    );
  }

  if (spec.kind === "button") {
    const {
      className: bpClass,
      type,
      "aria-describedby": btnDescribedBy,
      ...restBp
    } = spec.buttonProps;
    return (
      <button
        key={spec.key}
        type={type ?? "button"}
        className={["project-clad-order-action", toneClass, bpClass]
          .filter(Boolean)
          .join(" ")}
        aria-describedby={mergeDescribedBy(btnDescribedBy, descId)}
        {...restBp}
      >
        {desc}
        {visual}
      </button>
    );
  }

  if (spec.kind === "link") {
    const {
      className: aClass,
      "aria-describedby": aDescribedBy,
      ...restA
    } = spec.anchorProps;
    return (
      <a
        key={spec.key}
        className={["project-clad-order-action", toneClass, aClass]
          .filter(Boolean)
          .join(" ")}
        aria-describedby={mergeDescribedBy(aDescribedBy, descId)}
        {...restA}
      >
        {desc}
        {visual}
      </a>
    );
  }

  const { intent, jobId, awaiting } = spec;
  return (
    <form
      key={spec.key}
      method="get"
      action="/apps/project-clad/api/project-actions"
      className="project-clad-order-action-form"
      data-projectclad-ajax
      data-projectclad-intent={intent}
      data-projectclad-project-id={ctx.projectId}
      onPointerDownCapture={(event) => event.stopPropagation()}
    >
      <input type="hidden" name="jobId" value={jobId} />
      {desc}
      <button
        type="submit"
        className={`project-clad-order-action ${toneClass}`}
        title={awaiting ? "Cancel review request" : "Send for review"}
        aria-label={
          awaiting ? "Cancel review request" : "Send for review"
        }
        aria-describedby={descId}
      >
        {visual}
      </button>
      <span
        className="project-clad-muted"
        data-projectclad-form-message
        style={{ display: "none" }}
      />
    </form>
  );
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

/* The product-drawing lightbox is implemented as a vanilla inline `<script>`
   block at the bottom of the page render — see the
   `data-projectclad-line-thumb-preview` script. The triggers below carry
   `data-pc-image-src` / `data-pc-image-alt` data attrs that the script reads.
   It lives outside React because this route is served via the Shopify app
   proxy where client-side hydration is unreliable and most other interactive
   behavior on the page (order-now, edit-project, etc.) is also implemented as
   inline scripts for the same reason. */

/** Thumbnail only (line # sits in the thumb column wrapper in the parent row). */
function OrderLineThumbMedia({ item }: { item: JobItemView }) {
  const isUploadPart = item.displayName.toLowerCase().includes("upload part");
  const href = isUploadPart
    ? item.uploadPartFileUrl || item.imageUrl
    : item.productUrl;
  const showPdfThumb =
    isUploadPart &&
    Boolean(item.uploadPartFileUrl && isLikelyPdfUrl(item.uploadPartFileUrl));

  const thumbInner = showPdfThumb ? (
    <PdfThumbIcon label="PDF attachment" />
  ) : item.imageUrl ? (
    <img
      src={item.imageUrl}
      alt={item.imageAlt || item.displayName}
      className="project-clad-thumb"
      draggable={false}
    />
  ) : (
    <span className="project-clad-thumb project-clad-thumb--placeholder" />
  );

  /* When the line has a real product image (and isn't a PDF upload), the thumb
     becomes a button that the inline-script lightbox listens for via
     `data-projectclad-line-thumb-preview` + `data-pc-image-*`. No React click
     handler — see the inline script at the bottom of the page render. */
  if (item.imageUrl && !showPdfThumb) {
    return (
      <button
        type="button"
        className="project-clad-order-line-thumbwrap project-clad-order-card-thumb-frame project-clad-order-line-thumb-preview"
        data-projectclad-line-thumb-preview=""
        data-pc-image-src={item.imageUrl}
        data-pc-image-alt={item.imageAlt || item.displayName}
        aria-label={`Expand product drawing for ${item.displayName}`}
      >
        {thumbInner}
      </button>
    );
  }

  const inner = href ? (
    <a
      href={href}
      target={isUploadPart ? "_blank" : undefined}
      rel={isUploadPart ? "noopener noreferrer" : undefined}
      className="project-clad-order-line-thumbwrap project-clad-order-card-thumb-frame"
      onClick={(event) => event.stopPropagation()}
    >
      {thumbInner}
    </a>
  ) : (
    <div className="project-clad-order-line-thumbwrap project-clad-order-card-thumb-frame">
      {thumbInner}
    </div>
  );

  return inner;
}

type OrderLineSpecRow = { label: string; value: ReactNode };

function normalizeOrderSpecKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s_-]+/g, "_");
}

function titleCaseWords(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function formatGirthDisplay(value: string): string {
  const t = value.trim();
  if (/["']|in\b/i.test(t)) return t;
  return `${t}"`;
}

function formatValuesUsedDisplay(lengthUsed?: string, angleUsed?: string): string | null {
  const l = lengthUsed?.trim();
  const a = angleUsed?.trim();
  if (!l && !a) return null;
  const lengthLabel = l ? (/l$/i.test(l) ? l.toUpperCase() : `${l}L`) : null;
  const angleLabel = a ? (/a$/i.test(a) ? a.toUpperCase() : `${a}A`) : null;
  if (lengthLabel && angleLabel) return `${lengthLabel} - ${angleLabel}`;
  return lengthLabel || angleLabel;
}

function collectOrderLineSpecMap(properties: { name: string; value: string }[]): {
  map: Map<string, string>;
  calcParseError: string | null;
} {
  const map = new Map<string, string>();
  let calcParseError: string | null = null;

  const calcPayload = properties.find((p) => p.name === "__ooCalcPayload");
  if (calcPayload?.value) {
    try {
      const parsed = JSON.parse(calcPayload.value) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) {
        if (value == null) continue;
        const v = String(value).trim();
        if (!v) continue;
        const nk = normalizeOrderSpecKey(key);
        if (nk === "product_price") continue;
        map.set(nk, v);
      }
    } catch {
      calcParseError = calcPayload.value;
    }
  }

  for (const p of properties) {
    const rawName = p.name.trim();
    const v = (p.value || "").trim();
    if (!rawName || rawName.startsWith("__oo") || rawName.startsWith("_")) continue;
    const nk = normalizeOrderSpecKey(rawName);
    if (!map.has(nk)) map.set(nk, v || rawName);
  }

  return { map, calcParseError };
}

function getOrderLineSpecValue(item: JobItemView, key: string): string {
  if (!item.properties?.length) return "";
  const normalized = normalizeOrderSpecKey(key);
  for (const prop of item.properties) {
    if (normalizeOrderSpecKey(prop.name) === normalized) {
      return (prop.value || "").trim();
    }
  }
  return "";
}

function formatGaugeLabel(value: string): string {
  const t = value.trim();
  if (!t) return "";
  return /\bgauge\b/i.test(t) ? t : `${t} Gauge`;
}

function orderLineDisplayNameWithGauge(item: JobItemView): string {
  const base = item.displayName.trim();
  const gaugeLabel = formatGaugeLabel(getOrderLineSpecValue(item, "gauge"));
  if (!gaugeLabel) return base;
  if (base.toLowerCase().includes(gaugeLabel.toLowerCase())) return base;
  return `${base} - ${gaugeLabel}`;
}

function isCustomDimensionLineSpec(map: Map<string, string>): boolean {
  return (
    map.has("shape_type") ||
    (map.has("l1") && map.has("l2")) ||
    map.has("a1") ||
    map.has("a2")
  );
}

function CustomDimensionLineSpecs({ map }: { map: Map<string, string> }) {
  const rows: Array<{ label: string; value: string; extra?: boolean }> = [];

  for (let i = 1; i <= 12; i += 1) {
    const value = map.get(`l${i}`);
    if (!value) continue;
    rows.push({ label: `L${i}`, value });
  }
  for (let i = 1; i <= 12; i += 1) {
    const value = map.get(`a${i}`);
    if (!value) continue;
    rows.push({ label: `A${i}`, value });
  }

  const additionalDetails = map.get("additional_details");
  if (additionalDetails) {
    rows.push({
      label: "Additional Details",
      value: additionalDetails,
      extra: true,
    });
  }

  if (!rows.length) return null;

  return (
    <div className="project-clad-order-custom-specs">
      {rows.map((row) => (
        <div
          key={row.label}
          className={
            row.extra
              ? "project-clad-order-custom-spec project-clad-order-custom-spec--extra"
              : "project-clad-order-custom-spec"
          }
        >
          <span className="project-clad-order-custom-spec__label">
            {row.label}
          </span>
          <span className="project-clad-order-custom-spec__value">
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function resolveFinishSpecRow(
  map: Map<string, string>,
  consumed: Set<string>,
): OrderLineSpecRow | null {
  for (const key of ["color", "colour", "finish", "paint", "coating"]) {
    const value = map.get(key);
    if (!value) continue;
    consumed.add(key);
    const cat = resolveColourCatalogueLine(value);
    const display = cat?.display ?? titleCaseWords(value);
    const hex = cat?.hex;
    return {
      label: "Finish",
      value: (
        <span className="project-clad-order-spec-grid__finish">
          {hex ? (
            <span
              className="project-clad-order-spec-grid__swatch"
              style={{ backgroundColor: hex }}
              aria-hidden
            />
          ) : null}
          <span>{display}</span>
        </span>
      ),
    };
  }

  for (const [key, value] of map) {
    if (consumed.has(key)) continue;
    const cat = resolveColourCatalogueLine(value || key.replace(/_/g, " "));
    if (!cat) continue;
    consumed.add(key);
    return {
      label: "Finish",
      value: (
        <span className="project-clad-order-spec-grid__finish">
          <span
            className="project-clad-order-spec-grid__swatch"
            style={{ backgroundColor: cat.hex }}
            aria-hidden
          />
          <span>{cat.display}</span>
        </span>
      ),
    };
  }

  return null;
}

function buildStructuredOrderLineSpecGrid(
  map: Map<string, string>,
): { left: OrderLineSpecRow[]; right: OrderLineSpecRow[]; consumed: Set<string> } | null {
  const consumed = new Set<string>();

  const profile = map.get("profile");
  const gauge = map.get("gauge");
  const shapeType = map.get("shape_type");
  const girth = map.get("girth");

  const lengthParts: string[] = [];
  for (let i = 1; i <= 12; i++) {
    const key = `l${i}`;
    if (!map.has(key)) break;
    lengthParts.push(map.get(key)!);
    consumed.add(key);
  }

  const angleParts: string[] = [];
  for (let i = 1; i <= 12; i++) {
    const key = `a${i}`;
    if (!map.has(key)) break;
    const raw = map.get(key)!;
    angleParts.push(/°/.test(raw) ? raw : `${raw}°`);
    consumed.add(key);
  }

  const hasSheetCustomSignals =
    profile != null ||
    shapeType != null ||
    girth != null ||
    gauge != null ||
    lengthParts.length > 0 ||
    angleParts.length > 0;

  if (!hasSheetCustomSignals) return null;

  const left: OrderLineSpecRow[] = [];
  const right: OrderLineSpecRow[] = [];

  if (profile) {
    left.push({ label: "Profile", value: titleCaseWords(profile) });
    consumed.add("profile");
  }
  if (gauge) {
    left.push({ label: "Gauge", value: gauge });
    consumed.add("gauge");
  }
  if (lengthParts.length) {
    left.push({ label: "Lengths", value: lengthParts.join(" - ") });
  }

  const finishRow = resolveFinishSpecRow(map, consumed);
  if (finishRow) left.push(finishRow);

  if (shapeType) {
    right.push({ label: "Shape", value: shapeType.toUpperCase() });
    consumed.add("shape_type");
  }
  if (girth) {
    right.push({ label: "Girth", value: formatGirthDisplay(girth) });
    consumed.add("girth");
  }
  if (angleParts.length) {
    right.push({ label: "Angles", value: angleParts.join(" - ") });
  }

  const valuesUsed = formatValuesUsedDisplay(
    map.get("length_values_used"),
    map.get("angle_values_used"),
  );
  if (valuesUsed) {
    right.push({ label: "Values used", value: valuesUsed });
    consumed.add("length_values_used");
    consumed.add("angle_values_used");
  }

  if (!left.length && !right.length) return null;
  return { left, right, consumed };
}

const ORDER_SPEC_GRID_SKIP_KEYS = new Set([
  "product_price",
  "reference_image",
  "referenceimage",
]);

function humanizeOrderSpecKey(normalizedKey: string): string {
  if (/^[la]\d+$/i.test(normalizedKey)) return `${normalizedKey.toUpperCase()} =`;
  return normalizedKey.replace(/_/g, " ");
}

function OrderLineSpecGrid({
  left,
  right,
}: {
  left: OrderLineSpecRow[];
  right: OrderLineSpecRow[];
}) {
  const renderCol = (rows: OrderLineSpecRow[], side: "left" | "right") => (
    <div className="project-clad-order-spec-grid__col" data-side={side}>
      {rows.map((row, index) => (
        <div key={`${side}-${row.label}-${index}`} className="project-clad-order-spec-grid__row">
          <span className="project-clad-order-spec-grid__label">{row.label}</span>
          <span className="project-clad-order-spec-grid__value">{row.value}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="project-clad-order-spec-grid">
      {left.length ? renderCol(left, "left") : null}
      {right.length ? renderCol(right, "right") : null}
    </div>
  );
}

function pushOrderLinePropertyDisplay(
  key: string,
  label: string,
  rawValue: string,
  item: JobItemView,
  chips: ReactNode[],
  blocks: ReactNode[],
): void {
  const v = rawValue.trim();
  if (!v) return;

  const mediaHref = normalizeHttpUrl(v);
  if (mediaHref) {
    if (shouldSuppressUrlPropertyInChips(label, v, item)) {
      if (!item.imageUrl || !urlsMatchForDisplay(v, item.imageUrl)) {
        const block = renderOrderLinePropertyMediaBlock(key, label, v);
        if (block) blocks.push(block);
      }
      return;
    }
    const block = renderOrderLinePropertyMediaBlock(key, label, v);
    if (block) {
      blocks.push(block);
      return;
    }
  }

  const nameLower = label.trim().toLowerCase();
  if (nameLower === "color") {
    const cat = resolveColourCatalogueLine(v);
    if (cat) {
      chips.push(
        <span
          key={key}
          className="project-clad-order-card-chip project-clad-order-card-chip--colour"
          title={v}
        >
          <span
            className="project-clad-order-card-colour-swatch"
            style={{ backgroundColor: cat.hex }}
            aria-hidden
          />
          <span className="project-clad-order-card-chip__v project-clad-order-card-chip__v--colour">
            {cat.display}
          </span>
        </span>,
      );
      return;
    }
  }

  chips.push(
    <span key={key} className="project-clad-order-card-chip">
      <span className="project-clad-order-card-chip__k">{label}</span>
      <span className="project-clad-order-card-chip__v">{v}</span>
    </span>,
  );
}

function OrderLinePropertyChips({ item }: { item: JobItemView }) {
  if (!item.properties?.length) return null;

  const chips: ReactNode[] = [];
  const blocks: ReactNode[] = [];
  const { map, calcParseError } = collectOrderLineSpecMap(item.properties);
  const customDimensionSpecs = isCustomDimensionLineSpec(map) ? (
    <CustomDimensionLineSpecs map={map} />
  ) : null;
  const calcParseNote = calcParseError ? (
    <p className="project-clad-order-card-sub project-clad-muted" style={{ margin: "0.2rem 0 0" }}>
      <strong>Details:</strong> {calcParseError}
    </p>
  ) : null;
  const showRawCalculatorInputs =
    item.properties.some((p) => p.name === "__ooCalcPayload") ||
    map.has("shape_type") ||
    (map.has("l1") && map.has("l2")) ||
    map.has("a1");
  let structuredGridToRender: ReturnType<typeof buildStructuredOrderLineSpecGrid> = null;

  if (customDimensionSpecs) {
    let extraIndex = 0;
    for (const [key, value] of map) {
      if (
        ORDER_SPEC_GRID_SKIP_KEYS.has(key) ||
        key === "shape_type" ||
        key === "gauge" ||
        key === "additional_details" ||
        /^[la]\d+$/i.test(key)
      ) {
        continue;
      }
      if (isReferenceImagePropertyName(key.replace(/_/g, " "))) continue;
      pushOrderLinePropertyDisplay(
        `custom-extra-${key}-${extraIndex++}`,
        humanizeOrderSpecKey(key),
        value,
        item,
        chips,
        blocks,
      );
    }
  } else if (showRawCalculatorInputs) {
    let extraIndex = 0;
    for (const [key, value] of map) {
      if (ORDER_SPEC_GRID_SKIP_KEYS.has(key)) continue;
      if (isReferenceImagePropertyName(key.replace(/_/g, " "))) continue;
      pushOrderLinePropertyDisplay(
        `all-${key}-${extraIndex++}`,
        humanizeOrderSpecKey(key),
        value,
        item,
        chips,
        blocks,
      );
    }
  } else {
    const structuredGrid = buildStructuredOrderLineSpecGrid(map);
    const consumed = structuredGrid?.consumed ?? new Set<string>();
    structuredGridToRender = structuredGrid;

    if (structuredGrid) {
      for (const [key, value] of map) {
        if (consumed.has(key) || ORDER_SPEC_GRID_SKIP_KEYS.has(key)) continue;
        if (isReferenceImagePropertyName(key.replace(/_/g, " "))) continue;
        pushOrderLinePropertyDisplay(
          `extra-${key}`,
          humanizeOrderSpecKey(key),
          value,
          item,
          chips,
          blocks,
        );
      }
    } else {
      let extraIndex = 0;
      for (const [key, value] of map) {
        if (ORDER_SPEC_GRID_SKIP_KEYS.has(key)) continue;
        pushOrderLinePropertyDisplay(
          `all-${key}-${extraIndex++}`,
          humanizeOrderSpecKey(key),
          value,
          item,
          chips,
          blocks,
        );
      }
    }
  }

  if (!customDimensionSpecs && !chips.length && !blocks.length && !calcParseNote) return null;

  return (
    <>
      {calcParseNote}
      {customDimensionSpecs}
      {structuredGridToRender ? (
        <OrderLineSpecGrid left={structuredGridToRender.left} right={structuredGridToRender.right} />
      ) : null}
      {chips.length > 0 ? <div className="project-clad-order-card-specs">{chips}</div> : null}
      {blocks.length > 0 ? <div className="project-clad-order-card-prop-blocks">{blocks}</div> : null}
    </>
  );
}

function OrderLineDetailsColumn({
  item,
  reorderOpen,
}: {
  item: JobItemView;
  /** When set, show Reorder control (opens modal → creates new ordered job). */
  reorderOpen?: { itemId: string; defaultQty: number; lineLabel: string } | null;
}) {
  const isUploadPart = item.displayName.toLowerCase().includes("upload part");
  const href = isUploadPart
    ? item.uploadPartFileUrl || item.imageUrl
    : item.productUrl;
  const showPdfThumb =
    isUploadPart &&
    Boolean(item.uploadPartFileUrl && isLikelyPdfUrl(item.uploadPartFileUrl));
  const displayName = orderLineDisplayNameWithGauge(item);
  const nameText =
    item.quantity === 0 ? `${displayName} (Removed)` : displayName;

  /* When the line has a product image, the title is a button picked up by the
     inline-script lightbox via `data-projectclad-line-thumb-preview` +
     `data-pc-image-*`. No React click handler — see the inline script at the
     bottom of the page render. */
  const titleEl =
    item.imageUrl && !showPdfThumb ? (
    <button
      type="button"
      className="project-clad-order-line-titlelink project-clad-order-line-titlebtn"
      data-projectclad-line-thumb-preview=""
      data-pc-image-src={item.imageUrl}
      data-pc-image-alt={item.imageAlt || displayName}
    >
      <span data-projectclad-item-name data-display-name={displayName}>
        {nameText}
      </span>
    </button>
  ) : href ? (
    <a
      href={href}
      target={isUploadPart ? "_blank" : undefined}
      rel={isUploadPart ? "noopener noreferrer" : undefined}
      className="project-clad-order-line-titlelink"
      onClick={(event) => event.stopPropagation()}
    >
      <span data-projectclad-item-name data-display-name={displayName}>
        {nameText}
      </span>
    </a>
  ) : (
    <span
      className="project-clad-order-line-title"
      data-projectclad-item-name
      data-display-name={displayName}
    >
      {nameText}
    </span>
  );

  const sku = item.orderLineCapture?.sku?.trim();
  const subtitle =
    sku && item.variantDisplaySource !== "unknown" ? (
      <p className="project-clad-order-card-sub">SKU {sku}</p>
    ) : isUploadPart ? (
      <p className="project-clad-order-card-sub">Customer-supplied file</p>
    ) : null;

  return (
    <div className="project-clad-order-card-details">
      <div className="project-clad-order-card-name-row">{titleEl}</div>
      {subtitle}
      {item.variantDisplaySource === "snapshot" ? (
        <p className="project-clad-order-card-snapshot-note project-clad-muted">
          Saved product name (Shopify did not return this variant; name is from a previous sync).
        </p>
      ) : null}
      <OrderLinePropertyChips item={item} />
      {reorderOpen ? (
        <div className="project-clad-order-line-reorder-wrap">
          <button
            type="button"
            className="project-clad-button project-clad-order-line-reorder-btn"
            data-projectclad-reorder-open
            data-item-id={reorderOpen.itemId}
            data-default-qty={String(reorderOpen.defaultQty)}
            data-line-label={reorderOpen.lineLabel}
            onClick={(event) => event.stopPropagation()}
          >
            Reorder
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Colspan for order line + summary rows (must match thead column count). */
function orderLinesTableColSpan(canEditLineActions: boolean) {
  return canEditLineActions ? 5 : 4;
}

/** Order created timestamp under the order title (same YYYY.MM.DD as Created fact). */
function formatJobCreatedMmDdYyyy(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}.${mm}.${dd}`;
}

type JobView = {
  id: string;
  name: string;
  orderNumber: number | null;
  createdAt: string;
  isLocked: boolean;
  workOrderStatus: string | null;
  completedAt: string | null;
  paidAt: string | null;
  receiptSnapshot: unknown | null;
  orderName: string | null;
  /** Cart / customer "PURCHASE ORDER #" (not Shopify `orderName`). */
  purchaseOrderNumber: string | null;
  /** Per-order on-site contact name (required before placing). Autofilled from project default at create time. */
  siteContactName: string | null;
  /** Per-order on-site contact phone (required before placing). Autofilled from project default at create time. */
  siteContactPhone: string | null;
  items: JobItemView[];
  subtotal: number;
  orderLifecycleStatus: string;
  scheduledDeliveryDate: string | null;
  scheduledDeliveryWindow: string | null;
  fulfillmentMethod: string | null;
  deliveryMode: JobDeliveryMode;
  shipAddress1: string | null;
  shipCity: string | null;
  shipProvince: string | null;
  shipPostal: string | null;
  shipCountry: string | null;
  hasFulfillmentPhoto: boolean;
  fulfillmentPhotoUrl: string | null;
  hasPurchaseOrderPdf: boolean;
  purchaseOrderPdfFileName: string | null;
  purchaseOrderPdfUrl: string | null;
  deliveryPhases: DeliveryPhaseView[];
  deliveredPercent: number;
  deliveryPlanMode: string | null;
  deliveryBatchByItemJson: string | null;
};

/**
 * Orders list sort. Mirrors the typed pattern used by the Projects list
 * (`ProjectsSortKey` + `sortFilteredProjects` in `apps.project-clad.projects.tsx`):
 * one key per button, no per-button direction toggle. We duplicate the pattern
 * inline rather than extract a shared hook because the comparators are tied to
 * each list's row shape (projects compare `jobCount` / `isOwner`; orders compare
 * `subtotal` / `orderLifecycleStatus`) — a generic abstraction would be pure tax.
 */
type OrdersSortKey =
  | "recent"
  | "oldest"
  | "name-asc"
  | "name-desc"
  | "total-desc"
  | "total-asc"
  | "status";

/**
 * Status sort: active/in-progress orders bubble up; delivered (the spec's
 * "DELIVERED last") sinks to the bottom. Ties broken by recency so newest
 * still wins inside a status group.
 */
function statusRankForSort(job: JobView): number {
  switch (job.orderLifecycleStatus) {
    case "draft":
      return 0;
    case "pending_review":
      return 1;
    case "ordered":
      return 2;
    case "paid":
      return 3;
    case "delivered":
      return 4;
    default:
      return 5;
  }
}

function sortFilteredJobs(list: JobView[], sort: OrdersSortKey): JobView[] {
  const out = [...list];
  if (sort === "recent") {
    out.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return out;
  }
  if (sort === "oldest") {
    out.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    return out;
  }
  if (sort === "name-asc") {
    out.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
    return out;
  }
  if (sort === "name-desc") {
    out.sort((a, b) =>
      b.name.localeCompare(a.name, undefined, { sensitivity: "base" }),
    );
    return out;
  }
  if (sort === "total-desc") {
    out.sort((a, b) => {
      const diff = Number(b.subtotal) - Number(a.subtotal);
      if (diff !== 0) return diff;
      return (
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });
    return out;
  }
  if (sort === "total-asc") {
    out.sort((a, b) => {
      const diff = Number(a.subtotal) - Number(b.subtotal);
      if (diff !== 0) return diff;
      return (
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });
    return out;
  }
  if (sort === "status") {
    out.sort((a, b) => {
      const r = statusRankForSort(a) - statusRankForSort(b);
      if (r !== 0) return r;
      return (
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });
    return out;
  }
  return out;
}

function jobMatchesOrderSearch(job: JobView, qRaw: string): boolean {
  const q = qRaw.trim().toLowerCase();
  if (!q) return true;
  const parts = q.split(/\s+/).filter(Boolean);
  const hay = [
    job.name,
    job.orderName || "",
    job.orderNumber != null ? String(job.orderNumber) : "",
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
  /** Normalized owner company key stamped at project creation; null for legacy/no-tag owners. */
  ownerCompanyKey: string | null;
  /** Owner toggle: hides the project from the Company scope for coworker viewers. */
  visibleToCompany: boolean;
  storefrontStatus: ProjectStorefrontStatus;
  createdAt: string;
  shipAddress1: string | null;
  shipCity: string | null;
  shipProvince: string | null;
  shipPostal: string | null;
  shipCountry: string | null;
  /** Project default: delivery (+fee) vs store pickup (no address required on project). */
  receiveMode: "delivery" | "pickup";
  /** Default site contact autofilled into NEW jobs. Editable per-order on the job tile. */
  defaultSiteContactName: string | null;
  defaultSiteContactPhone: string | null;
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

const formatPrice = (value: string | number) => {
  const num = Number(value || 0);
  if (Number.isNaN(num)) return "$0.00";
  return `$${num.toFixed(2)}`;
};

/** Full-width row under the line grid when the variant cannot be resolved (mockup-style notice). */
function OrderLineUnknownVariantNotice({ item }: { item: JobItemView }) {
  if (item.variantDisplaySource !== "unknown") return null;
  return (
    <div
      className="project-clad-order-card-notice project-clad-order-card-notice--warn"
      role="status"
    >
      <span
        className="project-clad-order-card-notice__icon"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </span>
      <p className="project-clad-order-card-notice__body project-clad-order-line-unavailable-notice">
        <strong className="project-clad-order-card-notice__title">
          Heads up
        </strong>
        <span className="project-clad-order-card-notice__sep" aria-hidden="true">
          {" — "}
        </span>
        this variant was previously unavailable. We&apos;ve regenerated it from the specs above.
      </p>
    </div>
  );
}

/**
 * Two-column finance panel rendered inside each order's `<tfoot>`. Mirrors the
 * "order-summary-neumorphic" mockup: pressed info capsules on the left (delivery
 * method, PO#, qty, optional Shopify ref) and a single sunken finance card on
 * the right with Subtotal → Tax → Delivery → Total + a tax meta footnote.
 *
 * Action buttons (Order Now / Edit) are rendered elsewhere — this component is
 * purely the summary block, so it works identically for the "no items yet" and
 * "with items" cases.
 */
function OrderFinancePanel({
  jobSubtotal,
  jobDisplayTax,
  jobDeliveryFeeAmount,
  jobTotalWithDisplayTax,
  totalQty,
  preferredDeliveryLine,
  poFooterDisplay,
  orderFootShopify,
  pricingUnlocked,
  taxRatePercent,
  shipProvince,
  isDelivery,
  deliveryAddress,
  siteContactName,
  siteContactPhone,
  jobId,
  canEditSiteContact,
  canEditPurchaseOrder,
  projectId,
  projectFormActionUrl,
  hasPurchaseOrderPdf,
  purchaseOrderPdfFileName,
  purchaseOrderPdfUrl,
  actionsSlot,
  paymentSummaryPdfActions,
}: {
  jobSubtotal: number;
  jobDisplayTax: number;
  jobDeliveryFeeAmount: number;
  jobTotalWithDisplayTax: number;
  totalQty: number;
  preferredDeliveryLine: string | null | undefined;
  poFooterDisplay: string;
  orderFootShopify: ReactNode | null;
  pricingUnlocked: boolean | undefined;
  taxRatePercent: number;
  shipProvince: string | null | undefined;
  /**
   * True when this order will ship (job.fulfillmentMethod === "delivery" or the
   * project defaults to delivery). Drives whether we render the "Delivery Address"
   * row vs the pickup row — and swaps the Free/$fee badge accordingly.
   */
  isDelivery: boolean;
  /**
   * Assembled one-line address (address1, city, province, postal, country).
   * Computed live from the current project each render, so adding an address
   * AFTER the order exists will start surfacing it without needing a write.
   */
  deliveryAddress: string | null;
  /** Per-order on-site contact (required before ordering). Edited in the order tile. */
  siteContactName: string | null;
  siteContactPhone: string | null;
  /** Job id — needed so the editable inputs carry the right `data-job-id`. */
  jobId: string;
  /**
   * When true, the Site Contact + Phone capsules render as inline-editable inputs
   * (the value sits inside an `<input>` styled to match the capsule). The Save
   * button POSTs them via `save-order-edit` using `data-projectclad-site-contact-*`.
   */
  canEditSiteContact: boolean;
  /**
   * When true, the Purchase Order # capsule renders as an inline-editable input —
   * same pattern as Site Contact; Save posts `data-projectclad-purchase-order-input`.
   */
  canEditPurchaseOrder: boolean;
  /** Project id for native multipart PO PDF upload/remove forms. */
  projectId: string;
  /** Signed app-proxy form action (shop + customer params). */
  projectFormActionUrl: string;
  hasPurchaseOrderPdf: boolean;
  purchaseOrderPdfFileName: string | null;
  purchaseOrderPdfUrl: string | null;
  /**
   * Optional buttons (Order Now / Edit Order / etc) rendered INSIDE the right column
   * below the Payment Summary card so they read as part of the same finance section
   * instead of floating below the whole panel.
   */
  actionsSlot?: ReactNode;
  /**
   * Packing slip + invoice PDF controls shown on the same row as the Payment Summary
   * heading (title left, icons right).
   */
  paymentSummaryPdfActions?: ReactNode;
}) {
  const hiddenPrice = (
    <button
      type="button"
      className="project-clad-hidden-link"
      data-projectclad-show-price
    >
      Hidden
    </button>
  );

  const trimmedAddress = deliveryAddress?.trim() || "";
  const showAddressRow = isDelivery;
  const deliveryLabel = showAddressRow ? "Delivery Address" : "Delivery Method";
  const trimmedContactName = siteContactName?.trim() || "";
  const trimmedContactPhone = siteContactPhone?.trim() || "";
  const hasContactName = trimmedContactName.length > 0;
  const hasContactPhone = trimmedContactPhone.length > 0;
  const pickupValue = preferredDeliveryLine?.trim() || "In store pickup";
  const deliveryValue = showAddressRow
    ? trimmedAddress || "Address not provided yet"
    : pickupValue;
  const addressEmpty = showAddressRow && !trimmedAddress;
  const poRaw = (poFooterDisplay ?? "").trim();
  const hasPo = poRaw.length > 0 && poRaw !== "—";
  const provinceLabel = shipProvince?.trim()
    ? `HST ${shipProvince.trim()} ${taxRatePercent}%`
    : `HST ${taxRatePercent}%`;

  return (
    <div className="project-clad-order-finance">
      <div className="project-clad-order-finance__left">
        <p className="project-clad-order-finance__label">Contact &amp; Delivery</p>
        <div className="project-clad-order-finance__list">
          <div className="project-clad-order-finance__row">
            <span className="project-clad-order-finance__icon" aria-hidden="true">
              {showAddressRow ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l1-5h16l1 5" />
                  <path d="M3 9h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9z" />
                  <path d="M8 13h8" />
                </svg>
              )}
            </span>
            <span className="project-clad-order-finance__text">
              <span className="project-clad-order-finance__k">{deliveryLabel}</span>
              <span
                className={
                  addressEmpty
                    ? "project-clad-order-finance__v project-clad-order-finance__v--empty"
                    : "project-clad-order-finance__v"
                }
              >
                {deliveryValue}
              </span>
            </span>
          </div>

          <div className="project-clad-order-finance__row">
            <span className="project-clad-order-finance__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="8" y1="13" x2="16" y2="13" />
                <line x1="8" y1="17" x2="13" y2="17" />
              </svg>
            </span>
            <span className="project-clad-order-finance__text">
              <span className="project-clad-order-finance__k">Purchase Order #</span>
              {/*
               * Purchase Order # is OPTIONAL — no `required`, no red glow,
               * no Order Now gate. The badge / placeholder still surface
               * status, but the user can place orders without it.
               */}
              {canEditPurchaseOrder ? (
                <input
                  id={`projectclad-purchase-order-${jobId}`}
                  type="text"
                  defaultValue={hasPo ? poRaw : ""}
                  data-projectclad-purchase-order-input
                  data-job-id={jobId}
                  data-original-purchase-order={hasPo ? poRaw : ""}
                  placeholder="Optional"
                  aria-label="Purchase order number"
                  autoComplete="off"
                  className="project-clad-order-finance__input"
                />
              ) : (
                <span
                  className={
                    hasPo
                      ? "project-clad-order-finance__v"
                      : "project-clad-order-finance__v project-clad-order-finance__v--empty"
                  }
                >
                  {hasPo ? poRaw : "Not set"}
                </span>
              )}
              <OrderPoPdfControls
                jobId={jobId}
                actionUrl={projectFormActionUrl}
                canEdit={canEditPurchaseOrder}
                hasPurchaseOrderPdf={hasPurchaseOrderPdf}
                purchaseOrderPdfFileName={purchaseOrderPdfFileName}
                purchaseOrderPdfUrl={purchaseOrderPdfUrl}
              />
            </span>
            {hasPo ? (
              <span
                className="project-clad-order-finance__check"
                aria-label="Provided"
                title="Provided"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            ) : null}
          </div>

          <div className="project-clad-order-finance__row">
            <span className="project-clad-order-finance__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </span>
            <span className="project-clad-order-finance__text">
              <span className="project-clad-order-finance__k">Contact</span>
              {canEditSiteContact ? (
                <input
                  id={`projectclad-site-contact-name-${jobId}`}
                  type="text"
                  defaultValue={trimmedContactName}
                  data-projectclad-site-contact-name-input
                  data-job-id={jobId}
                  data-original-site-contact-name={trimmedContactName}
                  placeholder="Required"
                  aria-label="Site contact name"
                  autoComplete="name"
                  required
                  className={
                    hasContactName
                      ? "project-clad-order-finance__input"
                      : "project-clad-order-finance__input project-clad-order-finance__input--required"
                  }
                />
              ) : (
                <span
                  className={
                    hasContactName
                      ? "project-clad-order-finance__v"
                      : "project-clad-order-finance__v project-clad-order-finance__v--empty project-clad-order-finance__v--required"
                  }
                >
                  {hasContactName ? trimmedContactName : "Required"}
                </span>
              )}
            </span>
            {hasContactName ? (
              <span
                className="project-clad-order-finance__check"
                aria-label="Provided"
                title="Provided"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            ) : (
              <span className="project-clad-order-finance__badge">
                Required
              </span>
            )}
          </div>

          <div className="project-clad-order-finance__row">
            <span className="project-clad-order-finance__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </span>
            <span className="project-clad-order-finance__text">
              <span className="project-clad-order-finance__k">Phone Number</span>
              {canEditSiteContact ? (
                <input
                  id={`projectclad-site-contact-phone-${jobId}`}
                  type="tel"
                  inputMode="tel"
                  defaultValue={trimmedContactPhone}
                  data-projectclad-site-contact-phone-input
                  data-job-id={jobId}
                  data-original-site-contact-phone={trimmedContactPhone}
                  placeholder="Required"
                  aria-label="Site contact phone"
                  autoComplete="tel"
                  required
                  className={
                    hasContactPhone
                      ? "project-clad-order-finance__input"
                      : "project-clad-order-finance__input project-clad-order-finance__input--required"
                  }
                />
              ) : (
                <span
                  className={
                    hasContactPhone
                      ? "project-clad-order-finance__v"
                      : "project-clad-order-finance__v project-clad-order-finance__v--empty project-clad-order-finance__v--required"
                  }
                >
                  {hasContactPhone ? (
                    <a
                      className="project-clad-order-finance__phone"
                      href={`tel:${trimmedContactPhone.replace(/\s+/g, "")}`}
                    >
                      {trimmedContactPhone}
                    </a>
                  ) : (
                    "Required"
                  )}
                </span>
              )}
            </span>
            {hasContactPhone ? (
              <span
                className="project-clad-order-finance__check"
                aria-label="Provided"
                title="Provided"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            ) : (
              <span className="project-clad-order-finance__badge">
                Required
              </span>
            )}
          </div>

          <div className="project-clad-order-finance__row">
            <span className="project-clad-order-finance__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            </span>
            <span className="project-clad-order-finance__text">
              <span className="project-clad-order-finance__k">Total Order Quantity</span>
              <span className="project-clad-order-finance__v">
                {totalQty} {totalQty === 1 ? "unit" : "units"}
                <span className="project-clad-order-finance__v-sep" aria-hidden="true">
                  ·
                </span>
                <span className="project-clad-order-finance__v-secondary">
                  {totalQty * 10} linear ft
                </span>
              </span>
            </span>
          </div>

          {orderFootShopify ? (
            <div className="project-clad-order-finance__row">
              <span className="project-clad-order-finance__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="21" r="1" />
                  <circle cx="20" cy="21" r="1" />
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                </svg>
              </span>
              <span className="project-clad-order-finance__text">
                <span className="project-clad-order-finance__k">Shopify Order</span>
                <span className="project-clad-order-finance__v">{orderFootShopify}</span>
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="project-clad-order-finance__right">
        {paymentSummaryPdfActions ? (
          <div className="project-clad-order-finance__payment-summary-head">
            <p className="project-clad-order-finance__label">Payment Summary</p>
            <div
              className="project-clad-order-finance__payment-summary-pdf"
              role="group"
              aria-label="Order PDF exports"
            >
              {paymentSummaryPdfActions}
            </div>
          </div>
        ) : (
          <p className="project-clad-order-finance__label">Payment Summary</p>
        )}
        <div className="project-clad-order-finance__card">
          <div className="project-clad-order-finance__fin project-clad-order-finance__fin--muted">
            <span className="project-clad-order-finance__fin-k">Subtotal</span>
            <span
              className="project-clad-order-finance__fin-v"
              data-projectclad-price
              data-price={jobSubtotal.toFixed(2)}
            >
              {pricingUnlocked ? formatPrice(jobSubtotal.toFixed(2)) : hiddenPrice}
            </span>
          </div>
          <div className="project-clad-order-finance__fin project-clad-order-finance__fin--muted">
            <span className="project-clad-order-finance__fin-k">Delivery</span>
            <span
              className="project-clad-order-finance__fin-v"
              data-projectclad-price
              data-price={jobDeliveryFeeAmount.toFixed(2)}
            >
              {pricingUnlocked
                ? formatPrice(jobDeliveryFeeAmount.toFixed(2))
                : hiddenPrice}
            </span>
          </div>
          <div className="project-clad-order-finance__fin project-clad-order-finance__fin--muted">
            <span className="project-clad-order-finance__fin-k">
              Tax ({taxRatePercent}%)
            </span>
            <span
              className="project-clad-order-finance__fin-v"
              data-projectclad-price
              data-price={jobDisplayTax.toFixed(2)}
            >
              {pricingUnlocked ? formatPrice(jobDisplayTax.toFixed(2)) : hiddenPrice}
            </span>
          </div>
          <div className="project-clad-order-finance__divider" />
          <div className="project-clad-order-finance__fin project-clad-order-finance__fin--total">
            <span className="project-clad-order-finance__fin-k">Total</span>
            <span
              className="project-clad-order-finance__fin-v"
              data-projectclad-price
              data-price={jobTotalWithDisplayTax.toFixed(2)}
            >
              {pricingUnlocked
                ? formatPrice(jobTotalWithDisplayTax.toFixed(2))
                : hiddenPrice}
            </span>
          </div>
          <div className="project-clad-order-finance__tax-meta">
            CAD · incl. {provinceLabel}
          </div>
        </div>
        {actionsSlot ? (
          <div className="project-clad-order-finance__actions">{actionsSlot}</div>
        ) : null}
      </div>
    </div>
  );
}

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

function findActiveDeliveryPhaseId(phases: DeliveryPhaseView[]): string {
  return phases.find((p) => !p.hasPhoto)?.id ?? "";
}

function deliveredQtyForItem(
  phases: DeliveryPhaseView[],
  itemId: string,
  excludePhaseId?: string,
): number {
  let sum = 0;
  for (const phase of phases) {
    if (excludePhaseId && phase.id === excludePhaseId) continue;
    for (const line of phase.lines) {
      if (line.jobItemId === itemId) {
        sum += Math.max(0, line.quantityDelivered);
      }
    }
  }
  return sum;
}

function StaffOrderLifecycleForm({
  job,
  projectId,
  idPrefix,
  allowDeliveredWithoutPhoto = false,
}: {
  job: JobView;
  projectId: string;
  idPrefix: string;
  /** App admins may mark Delivered without a fulfillment photo. */
  allowDeliveredWithoutPhoto?: boolean;
}) {
  const canSelectDelivered =
    job.hasFulfillmentPhoto || allowDeliveredWithoutPhoto;
  const deliveredLabel = job.hasFulfillmentPhoto
    ? "Delivered"
    : allowDeliveredWithoutPhoto
      ? "Delivered (no photo)"
      : "Delivered (photo required)";
  return (
    <Form
      method="post"
      action={`/apps/project-clad/project?id=${encodeURIComponent(projectId)}`}
      className="project-clad-staff-fulfillment-status-form"
    >
      <input type="hidden" name="intent" value="staff-set-order-lifecycle" />
      <input type="hidden" name="jobId" value={job.id} />
      <div className="project-clad-staff-fulfillment-status-row">
        <label
          className="project-clad-staff-fulfillment__label--tile"
          htmlFor={`project-clad-staff-status-${idPrefix}`}
        >
          Order status
        </label>
        <select
          id={`project-clad-staff-status-${idPrefix}`}
          name="lifecycleStatus"
          defaultValue={job.orderLifecycleStatus}
          className="project-clad-staff-fulfillment__status"
        >
          <option value="draft">New</option>
          <option value="pending_review">Review</option>
          <option value="ready_to_order">Order now</option>
          <option value="ordered">Ordered</option>
          <option value="delivered" disabled={!canSelectDelivered}>
            {deliveredLabel}
          </option>
          <option value="paid">Order complete</option>
        </select>
        <button type="submit" className="project-clad-button">
          Apply
        </button>
      </div>
      <p className="project-clad-muted project-clad-staff-fulfillment-status-hint">
        Setting status to <strong>Order now</strong> (or earlier) clears recorded
        deliveries so you can start over. Or use <strong>Reset delivery progress</strong>{" "}
        below.
      </p>
    </Form>
  );
}

function OrderDeliveryDocumentsPanel({ job }: { job: JobView }) {
  const documentPhases = job.deliveryPhases.filter((p) =>
    deliveryPhaseHasProgress(p),
  );
  if (documentPhases.length === 0) {
    return (
      <p className="project-clad-muted" style={{ margin: 0 }}>
        No deliveries recorded yet.
      </p>
    );
  }
  return (
    <div className="project-clad-delivery-docs">
      <p className="project-clad-muted project-clad-delivery-docs__intro">
        Each row is one confirmed delivery drop. View the delivery photo for
        quantities delivered on that drop ({job.deliveredPercent}% of order
        delivered so far).
      </p>
    <table className="project-clad-table project-clad-delivery-docs-table">
      <thead>
        <tr>
          <th>Delivery</th>
          <th>Confirmed</th>
          <th>Qty this drop</th>
          <th>Photo</th>
        </tr>
      </thead>
      <tbody>
        {documentPhases.map((p) => {
          const confirmedDate = p.deliveredAt
            ? p.deliveredAt.slice(0, 10)
            : "—";
          const unitsLabel = formatPhaseDeliveredUnitsLabel(p);
          const isConfirmed = p.hasPhoto;
          return (
            <tr key={p.id}>
              <td>
                Delivery {p.sequence}
                {!isConfirmed ? (
                  <span className="project-clad-muted"> · awaiting photo</span>
                ) : null}
              </td>
              <td>{confirmedDate}</td>
              <td className="project-clad-delivery-docs-table__qty">
                {unitsLabel !== "—" ? (
                  <span>{unitsLabel}</span>
                ) : (
                  <span className="project-clad-muted">—</span>
                )}
              </td>
              <td className="project-clad-delivery-docs-table__links">
                {p.photoUrl ? (
                  <a
                    href={p.photoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-projectclad-view-delivery-photo=""
                    data-job-id={job.id}
                    data-phase-id={p.id}
                  >
                    View photo
                  </a>
                ) : (
                  <span className="project-clad-muted">—</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

function StaffPhaseDeliveryPanel({
  job,
  projectId,
  canResetDelivery,
}: {
  job: JobView;
  projectId: string;
  canResetDelivery: boolean;
}) {
  const phases = job.deliveryPhases;
  const openPhase =
    phases.find((p) => p.id === findActiveDeliveryPhaseId(phases)) ?? null;
  const actionUrl = `/apps/project-clad/project?id=${encodeURIComponent(projectId)}`;
  const hasRecordedDelivery = phases.some((p) => deliveryPhaseHasProgress(p));

  if (phases.length === 0) return null;

  const lineByItem = new Map(
    (openPhase?.lines ?? []).map((l) => [l.jobItemId, l]),
  );
  const confirmedCount = phases.filter((p) => p.hasPhoto).length;

  const canSubmitFulfillment = Boolean(openPhase && !openPhase.hasPhoto);

  /** Any open phase without a photo must be confirmed with photo + qty (not qty-only). */
  const confirmDeliveryWithPhoto = canSubmitFulfillment;

  return (
    <div className="project-clad-staff-phase-delivery">
      {canResetDelivery && hasRecordedDelivery ? (
        <Form
          method="post"
          action={actionUrl}
          className="project-clad-staff-delivery-reset-form"
          data-projectclad-confirm="Reset all delivery progress for this order? Delivered quantities, photos, and documents will be cleared so you can record deliveries again."
        >
          <input type="hidden" name="intent" value="reset-order-delivery" />
          <input type="hidden" name="jobId" value={job.id} />
          <button type="submit" className="project-clad-button project-clad-button--danger">
            Reset delivery progress
          </button>
        </Form>
      ) : null}
      <p className="project-clad-delivery-fulfillment-progress" role="status">
        {job.deliveredPercent}% delivered
        {confirmedCount > 0
          ? ` · ${confirmedCount} deliver${confirmedCount === 1 ? "y" : "ies"} confirmed`
          : null}
      </p>
      <div className="project-clad-delivery-drop-card">
        <p className="project-clad-staff-fulfillment__label--tile">
          Mark what arrived
        </p>
        {canSubmitFulfillment ? (
          <form
            method="post"
            action={actionUrl}
            encType={confirmDeliveryWithPhoto ? "multipart/form-data" : undefined}
            className={[
              "project-clad-stack",
              confirmDeliveryWithPhoto
                ? "project-clad-staff-fulfillment-photo-form"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <input
              type="hidden"
              name="intent"
              value={
                confirmDeliveryWithPhoto
                  ? "upload-phase-fulfillment-photo"
                  : "record-phase-delivery"
              }
            />
            <input type="hidden" name="jobId" value={job.id} />
            <input type="hidden" name="phaseId" value={openPhase?.id ?? ""} />
            <table className="project-clad-table" style={{ fontSize: "0.9rem" }}>
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Remaining</th>
                  <th>Qty this delivery</th>
                </tr>
              </thead>
              <tbody>
                {job.items.map((item) => {
                  const phaseLine = lineByItem.get(item.id);
                  const alreadyElsewhere = deliveredQtyForItem(
                    phases,
                    item.id,
                    openPhase?.id,
                  );
                  const remaining = Math.max(0, item.quantity - alreadyElsewhere);
                  const maxQty = remaining;
                  return (
                    <tr key={item.id}>
                      <td>{item.displayName}</td>
                      <td>{remaining}</td>
                      <td>
                        {maxQty > 0 ? (
                          <input
                            type="number"
                            name={`qty_${item.id}`}
                            min={0}
                            max={maxQty}
                            step={1}
                            defaultValue={
                              phaseLine?.quantityDelivered &&
                              phaseLine.quantityDelivered > 0
                                ? phaseLine.quantityDelivered
                                : 0
                            }
                            className="project-clad-preferred-delivery-input"
                            style={{ width: "4.5rem" }}
                            aria-label={`Qty delivered this trip for ${item.displayName}`}
                          />
                        ) : (
                          <span className="project-clad-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {confirmDeliveryWithPhoto ? (
              <>
                <p className="project-clad-muted" style={{ marginBottom: 6 }}>
                  Upload a delivery photo to confirm this delivery (sends
                  invoice email).
                </p>
                <input
                  type="file"
                  name="photo"
                  accept="image/*"
                  required
                  className="project-clad-staff-fulfillment__file-input"
                />
              </>
            ) : null}
            {/* Plain submit: the enclosing form posts multipart natively, which is the
                path that actually runs in production and the only one where the required
                photo input is validated. A click handler calling preventDefault would run
                before that validation and could submit the delivery with no photo. */}
            <button type="submit" className="project-clad-button">
              {confirmDeliveryWithPhoto
                ? "Confirm delivery"
                : "Save delivered qty"}
            </button>
          </form>
        ) : (
          <p className="project-clad-muted" style={{ margin: 0 }}>
            {job.deliveredPercent >= 100
              ? "All items have been delivered."
              : "No open delivery to record. Reload the page and try again."}
          </p>
        )}
      </div>
    </div>
  );
}

function OrderDeliveryFulfillmentSection({
  job,
  projectId,
  viewerIsAdmin,
  viewerCanFulfill,
}: {
  job: JobView;
  projectId: string;
  viewerIsAdmin: boolean;
  viewerCanFulfill: boolean;
}) {
  if (!viewerCanFulfill) {
    const confirmedCount = job.deliveryPhases.filter((p) => p.hasPhoto).length;
    return (
      <div className="project-clad-delivery-fulfillment-section">
        <p className="project-clad-delivery-fulfillment-progress" role="status">
          {job.deliveredPercent}% delivered
          {confirmedCount > 0
            ? ` · ${confirmedCount} deliver${confirmedCount === 1 ? "y" : "ies"} confirmed`
            : null}
        </p>
        <OrderDeliveryDocumentsPanel job={job} />
      </div>
    );
  }

  return (
    <div className="project-clad-delivery-fulfillment-section">
      <StaffOrderLifecycleForm
        job={job}
        projectId={projectId}
        idPrefix={`delivery-modal-${job.id}`}
        allowDeliveredWithoutPhoto={viewerIsAdmin}
      />
      {job.deliveryPhases.length > 0 ? (
        <StaffPhaseDeliveryPanel
          job={job}
          projectId={projectId}
          canResetDelivery={viewerCanFulfill}
        />
      ) : null}
      {job.orderLifecycleStatus === "ordered" &&
      !viewerIsAdmin &&
      job.deliveryPhases.length <= 1 ? (
        <StaffFulfillmentPhotoUpload job={job} projectId={projectId} />
      ) : null}
      {job.orderLifecycleStatus === "delivered" ? (
        <Form
          method="post"
          action={`/apps/project-clad/project?id=${projectId}`}
        >
          <input type="hidden" name="intent" value="staff-mark-order-paid" />
          <input type="hidden" name="jobId" value={job.id} />
          <button type="submit" className="project-clad-button">
            Mark paid
          </button>
        </Form>
      ) : null}
    </div>
  );
}

function OrderPoPdfUploadTrigger({
  inputId,
  title,
}: {
  inputId: string;
  title: string;
}) {
  return (
    <label
      htmlFor={inputId}
      className="project-clad-order-po-pdf__upload"
      title={title}
      aria-label={title}
    >
      {PC_PO_PDF_UPLOAD_ICON}
    </label>
  );
}

function truncatePoPdfDisplayName(name: string, max = 32): string {
  const trimmed = name.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function OrderPoPdfViewCheck({
  url,
  fileName,
}: {
  url: string;
  fileName?: string | null;
}) {
  const displayName = (fileName ?? "").trim() || "PO PDF";
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="project-clad-order-po-pdf__view-check"
      data-projectclad-no-transition
      aria-label={`View ${displayName}`}
      title={`View ${displayName}`}
    >
      {PC_CHECK_ICON}
    </a>
  );
}

function OrderPoPdfControls({
  jobId,
  actionUrl,
  canEdit,
  hasPurchaseOrderPdf,
  purchaseOrderPdfFileName,
  purchaseOrderPdfUrl,
}: {
  jobId: string;
  actionUrl: string;
  canEdit: boolean;
  hasPurchaseOrderPdf: boolean;
  purchaseOrderPdfFileName: string | null;
  purchaseOrderPdfUrl: string | null;
}) {
  const inputId = `project-clad-po-pdf-${jobId}`;
  const displayName = truncatePoPdfDisplayName(
    (purchaseOrderPdfFileName ?? "").trim() || "purchase-order.pdf",
  );

  if (!canEdit) {
    if (hasPurchaseOrderPdf && purchaseOrderPdfUrl) {
      return (
        <div className="project-clad-order-po-pdf">
          <OrderPoPdfViewCheck
            url={purchaseOrderPdfUrl}
            fileName={purchaseOrderPdfFileName}
          />
          <span className="project-clad-order-po-pdf__filename" title={displayName}>
            {displayName}
          </span>
        </div>
      );
    }
    return (
      <div className="project-clad-order-po-pdf">
        <span className="project-clad-order-po-pdf__empty">No PO document</span>
      </div>
    );
  }

  return (
    <div className="project-clad-order-po-pdf">
      {hasPurchaseOrderPdf && purchaseOrderPdfUrl ? (
        <>
          <OrderPoPdfViewCheck
            url={purchaseOrderPdfUrl}
            fileName={purchaseOrderPdfFileName}
          />
          <span className="project-clad-order-po-pdf__filename" title={displayName}>
            {displayName}
          </span>
        </>
      ) : (
        <span className="project-clad-order-po-pdf__empty">Upload PO Here</span>
      )}
      <form
        method="post"
        action={actionUrl}
        encType="multipart/form-data"
        className="project-clad-order-po-pdf__upload-form"
        data-projectclad-po-pdf-upload-form
      >
        <input type="hidden" name="intent" value="upload-order-po-pdf" />
        <input type="hidden" name="jobId" value={jobId} />
        <input
          type="file"
          id={inputId}
          name="file"
          accept="application/pdf,.pdf"
          className="project-clad-order-po-pdf__file-input"
          data-projectclad-po-pdf-file
        />
        <OrderPoPdfUploadTrigger
          inputId={inputId}
          title={hasPurchaseOrderPdf ? "Replace PO PDF" : "Upload PO PDF"}
        />
      </form>
      {hasPurchaseOrderPdf ? (
        <form
          method="post"
          action={actionUrl}
          className="project-clad-order-po-pdf__remove-form"
          data-projectclad-confirm="Remove the uploaded PO PDF from this order?"
        >
          <input type="hidden" name="intent" value="remove-order-po-pdf" />
          <input type="hidden" name="jobId" value={jobId} />
          <button type="submit" className="project-clad-order-po-pdf__remove">
            Remove
          </button>
        </form>
      ) : null}
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

/** Delivery fields for the edit-project modal (submitted with project details in one native form). */
function EditProjectDeliveryAddressFields({
  shipAddress1,
  shipCity,
  shipProvince,
  shipPostal,
}: {
  shipAddress1: string | null;
  shipCity: string | null;
  shipProvince: string | null;
  shipPostal: string | null;
}) {
  const provinceDefault = defaultCanadaProvinceCode(shipProvince);
  return (
    <>
      <label htmlFor="edit-ship-address1">Address</label>
      <input
        id="edit-ship-address1"
        name="shipAddress1"
        type="text"
        defaultValue={shipAddress1 ?? ""}
        placeholder="Leave blank for store pickup"
        autoComplete="street-address"
        className="project-clad-pricing-password-input"
      />
      <div className="project-clad-form-grid">
        <div className="project-clad-form-grid__cell">
          <label htmlFor="edit-ship-city">City</label>
          <input
            id="edit-ship-city"
            name="shipCity"
            type="text"
            defaultValue={shipCity ?? ""}
            autoComplete="address-level2"
            className="project-clad-pricing-password-input"
          />
        </div>
        <div className="project-clad-form-grid__cell">
          <label htmlFor="edit-ship-postal">Postal</label>
          <input
            id="edit-ship-postal"
            name="shipPostal"
            type="text"
            defaultValue={shipPostal ?? ""}
            autoComplete="postal-code"
            className="project-clad-pricing-password-input"
          />
        </div>
      </div>
      <div className="project-clad-form-grid">
        <div className="project-clad-form-grid__cell">
          <label htmlFor="edit-ship-province">Province</label>
          <select
            id="edit-ship-province"
            name="shipProvince"
            defaultValue={provinceDefault}
            className="project-clad-pricing-password-input"
          >
            <option value="">—</option>
            {CANADA_PROVINCE_OPTIONS.map(({ code, label }) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="project-clad-form-grid__cell">
          <label htmlFor="edit-ship-country">Country</label>
          <select
            id="edit-ship-country"
            name="shipCountry"
            defaultValue="Canada"
            className="project-clad-pricing-password-input"
          >
            <option value="">—</option>
            <option value="Canada">Canada</option>
          </select>
        </div>
      </div>
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

const redirectToProject = (
  request: Request,
  projectId: string,
  shop: string,
  extraParams?: Record<string, string>,
) => {
  const origin = getStorefrontOriginForAppProxyRedirect(request, shop);
  const qs = new URLSearchParams({ id: projectId });
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      if (v !== undefined && v !== "") qs.set(k, v);
    }
  }
  return redirect(`${origin}${storefrontProjectActionPath}?${qs.toString()}`);
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
      const reorderFrom = String(p.reorderedFromJobName || "").trim();
      if (reorderFrom) {
        return `New order ${jn} (reorder from ${reorderFrom})`;
      }
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
    case "project_owner_transferred":
      return "Project ownership transferred";
    default:
      return ev.type.replace(/_/g, " ");
  }
}

/**
 * App-proxy HTML is SSR'd (often on a UTC host). `toLocaleString(undefined)`
 * would show server timezone — pin Eastern so comment/activity times match
 * Canadian Cladding local time (same as order emails).
 */
const PROJECT_DISPLAY_TIMEZONE = PREFERRED_DELIVERY_CALENDAR_TIMEZONE;

function formatProjectDisplayDateTime(
  iso: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    timeZone: PROJECT_DISPLAY_TIMEZONE,
    ...options,
  });
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
  const when = formatProjectDisplayDateTime(createdAt, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const msg = body.replace(/\s+/g, " ").trim();
  const full = `${name} - ${when}: ${msg}`;
  return (
    <div
      className="project-clad-activity-feed__comment-line project-clad-comments-card__inner"
      title={full}
    >
      <div className="project-clad-comments-card__header">
        <span className="project-clad-activity-feed__comment-line-name project-clad-comments-card__name">
          {name}
        </span>
        <time className="project-clad-comments-card__time project-clad-muted" dateTime={createdAt}>
          {when}
        </time>
      </div>
      <div className="project-clad-activity-feed__comment-line-msg project-clad-comments-card__body">
        {msg}
      </div>
    </div>
  );
}

function shortLocaleActivityTime(iso: string) {
  return formatProjectDisplayDateTime(iso, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function projectActivityRowVisualKind(ev: ActivityFeedItem): "success" | "info" | "neutral" {
  const t = ev.type;
  if (
    t === STOREFRONT_ORDER_CONFIRMED_ACTIVITY ||
    t === "order_paid" ||
    t === "order_approved" ||
    t === "order_approved_work_queue"
  ) {
    return "success";
  }
  if (
    t === "order_created" ||
    t === "approval_requested" ||
    t === "job_item_variant_swapped"
  ) {
    return "info";
  }
  return "neutral";
}

function ProjectCcV2ActivityRow({
  item,
  viewerIsAdmin,
}: {
  item: Extract<ProjectTimelineItem, { kind: "activity" }>;
  viewerIsAdmin: boolean;
}) {
  const title =
    formatActivitySummary(item) +
    (item.visibility === "admin" && viewerIsAdmin ? " · Internal" : "");
  const actor = item.actorLabel?.trim() || "System";
  const meta = `${actor} · ${shortLocaleActivityTime(item.createdAt)}`;
  const kind = projectActivityRowVisualKind(item);
  const tip = `${title} — ${meta}`;
  return (
    <li
      className={`project-clad-cc-v2-activity-row project-clad-cc-v2-activity-row--${kind}`}
      title={tip}
    >
      <span className="project-clad-cc-v2-activity-row__icon" aria-hidden="true">
        {kind === "success" ? (
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M20 6L9 17l-5-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : kind === "info" ? (
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 5v14M5 12h14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="2.75" fill="currentColor" />
          </svg>
        )}
      </span>
      <div className="project-clad-cc-v2-activity-row__body">
        <p className="project-clad-cc-v2-activity-row__title">{title}</p>
        <p className="project-clad-cc-v2-activity-row__meta">{meta}</p>
      </div>
    </li>
  );
}

function MemberRoleSelect({
  idPrefix,
  defaultValue = "edit",
  rolePrompt,
}: {
  idPrefix: string;
  defaultValue?: "edit" | "view";
  /** Shown until the user selects a role (add-member UX). */
  rolePrompt?: string;
}) {
  const editId = `${idPrefix}-role-edit`;
  const viewId = `${idPrefix}-role-view`;
  const summaryLabel = defaultValue === "edit" ? "Edit" : "View only";
  return (
    <details
      className="project-clad-member-role-select"
      data-projectclad-member-role-select
      id={`${idPrefix}-role-widget`}
      {...(rolePrompt
        ? ({ "data-projectclad-role-prompt": rolePrompt } as const)
        : {})}
    >
      <summary className="project-clad-member-role-select__trigger">
        <span className="project-clad-member-role-select__value" data-role-label>
          {rolePrompt ?? summaryLabel}
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
  const proxyStylesHref = projectCladProxyStylesHref(request);
  const proxyScriptSrcs = {
    main: projectCladScriptSrc(request, "project-main.js"),
    customerSearch: projectCladScriptSrc(request, "project-customer-search.js"),
    pageTransitions: projectCladScriptSrc(
      request,
      "project-page-transitions.js",
    ),
    lineImageLightbox: projectCladScriptSrc(
      request,
      "project-line-image-lightbox.js",
    ),
    ordersSort: projectCladScriptSrc(request, "project-orders-sort.js"),
    poPdfUpload: projectCladScriptSrc(request, "project-po-pdf-upload.js"),
    projectsLinkNav: projectCladScriptSrc(
      request,
      "project-projects-link-nav.js",
    ),
    bannerDismiss: projectCladScriptSrc(request, "pc-banner-dismiss.js"),
    dirtyGuard: projectCladScriptSrc(request, "pc-dirty-guard.js"),
  };
  const { shop, customerId: viewerCustomerId, customerEmail } =
    requireAppProxyCustomer(request);
  /* The only two values `project-main.js` cannot have baked in at build time. */
  const proxyScriptConfig = projectCladInlineConfigScript({
    shop,
    pricingCookie: PRICING_COOKIE,
  });
  const customerId = viewerCustomerId as string;
  const [themeStyles, settings] = await Promise.all([
    getThemeStyles(shop),
    prisma.shopSettings.findFirst({
      where: { shop: shopStringFilter(shop) },
    }),
  ]);
  const projectId = getProjectId(request);

  if (!projectId) {
    const listParams = new URLSearchParams(new URL(request.url).search);
    listParams.delete("id");
    listParams.delete("sort");
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
    settings,
  );

  const project = await prisma.project.findFirst({
    where: { id: projectId, shop: shopStringFilter(shop) },
    include: {
      jobs: {
        orderBy: { sortOrder: "asc" },
        include: {
          items: { orderBy: { sortOrder: "asc" } },
          orderLink: true,
          deliveryPhases: {
            orderBy: { sequence: "asc" },
            include: { lines: true },
          },
        },
      },
      members: true,
    },
  });

  if (!project) {
    throw projectMissingHtmlResponse(request, shop, projectId);
  }

  const shopDeliveryFee = await getShopDeliveryFee(shop, settings);
  const projectDeliveryCtxForEnsure = {
    receiveMode: project.receiveMode,
    shipAddress1: project.shipAddress1,
    shipCity: project.shipCity,
    shipProvince: project.shipProvince,
    shipPostal: project.shipPostal,
    shipCountry: project.shipCountry,
  };
  /**
   * Rendering a project used to repair every order's delivery-phase graph, costing several
   * queries plus a write transaction per order on every page view. The repairs still happen, but
   * whether each one is needed is now decided from the graph already loaded above, so the steady
   * state (nothing to repair) issues no queries at all.
   */
  let phaseGraphChanged = false;
  for (const job of project.jobs) {
    const resolved = resolveJobDelivery(job, projectDeliveryCtxForEnsure, shopDeliveryFee);
    const isDelivery = resolved.method === "delivery";

    if (job.deliveryPhases.length === 0) {
      await ensureJobDeliveryPhases(job, shopDeliveryFee, resolved);
      if (isDelivery) {
        await ensureOpenFulfillmentPhase(job.id);
      }
      phaseGraphChanged = true;
    } else if (isDelivery && jobNeedsOpenFulfillmentPhaseSync(job)) {
      await ensureOpenFulfillmentPhase(job.id);
      phaseGraphChanged = true;
    }

    /* Repair orders marked delivered without a confirmed phase photo (legacy qty-only saves). */
    const hasConfirmedPhase = job.deliveryPhases.some((p) =>
      Boolean(p.fulfillmentPhotoStorageKey),
    );
    const awaitingPhoto = job.deliveryPhases.some(
      (p) => !p.fulfillmentPhotoStorageKey && !p.deliveredAt,
    );
    if (
      awaitingPhoto &&
      !hasConfirmedPhase &&
      !job.fulfillmentPhotoStorageKey &&
      (job.orderLifecycleStatus === "delivered" ||
        job.orderLifecycleStatus === "paid")
    ) {
      const wasPaid = job.orderLifecycleStatus === "paid";
      await prisma.job.update({
        where: { id: job.id },
        data: {
          orderLifecycleStatus: "ordered",
          completedAt: null,
          ...(wasPaid ? { paidAt: null } : {}),
        },
      });
      job.orderLifecycleStatus = "ordered";
      job.completedAt = null;
      if (wasPaid) {
        job.paidAt = null;
      }
    }
  }
  /* The project query above already loaded every phase with its lines. Re-read only when a repair
     actually changed the graph. */
  type PhaseWithLines = (typeof project.jobs)[number]["deliveryPhases"][number];
  const phasesByJobId = new Map<string, PhaseWithLines[]>();
  if (phaseGraphChanged) {
    const phaseRows = await prisma.jobDeliveryPhase.findMany({
      where: { jobId: { in: project.jobs.map((j) => j.id) } },
      include: { lines: true },
      orderBy: [{ jobId: "asc" }, { sequence: "asc" }],
    });
    for (const p of phaseRows) {
      const list = phasesByJobId.get(p.jobId) ?? [];
      list.push(p);
      phasesByJobId.set(p.jobId, list);
    }
  } else {
    for (const job of project.jobs) {
      phasesByJobId.set(job.id, job.deliveryPhases);
    }
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

  const isMember = isProjectMember(project, customerId, viewerIsAppAdmin);

  const viewerCompanyCtx = isMember
    ? { tags: [], displayNames: [], keys: [] as string[] }
    : await getViewerCompanyContext(shop, customerId);
  const viaCompany =
    !isMember &&
    canViewProjectViaCompany(
      { ownerCompanyKey: project.ownerCompanyKey, visibleToCompany: project.visibleToCompany },
      viewerCompanyCtx.keys,
    );

  if (!isMember && !viaCompany) {
    throw new Response("Unauthorized", { status: 403 });
  }

  const isOwner = isProjectOwner(project, customerId);
  /* Company-only viewers are read-only — explicit membership is required for edit. */
  const canEdit = isMember && canEditProject(project, customerId, viewerIsAppAdmin);
  const ownerCompanyForShare = canEdit
    ? await getViewerCompanyContext(shop, project.ownerCustomerId)
    : { tags: [] as string[], displayNames: [] as string[], keys: [] as string[] };

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

  /* Per-order CSV export (finance allowlist). Set PROJECTCLAD_CSV_EXPORT_EMAILS
     to one address or a comma-list. Legacy PROJECTCLAD_ACOMBA_EXPORT_EMAILS
     is still read if the new var is unset. Unset = nobody can export. */
  const csvExportEmailAllowlist =
    process.env.PROJECTCLAD_CSV_EXPORT_EMAILS?.trim() ||
    process.env.PROJECTCLAD_ACOMBA_EXPORT_EMAILS?.trim();
  const canExportOrderCsv =
    Boolean(csvExportEmailAllowlist) &&
    customerEmailInConfiguredList(viewerEmailResolved, csvExportEmailAllowlist);

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
    /* Only the switcher label is rendered; full rows include card image data URLs. */
    select: { id: true, name: true },
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
        catalogProductId: item.catalogProductId,
        catalogSku: item.catalogSku,
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
      /* Most recent first so take(200) is the latest 200 — asc+take would drop new comments after 200 older rows. */
      orderBy: { createdAt: "desc" },
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
    ownerCompanyKey: project.ownerCompanyKey ?? null,
    visibleToCompany: project.visibleToCompany,
    storefrontStatus: project.storefrontStatus,
    createdAt: project.createdAt.toISOString(),
    shipAddress1: project.shipAddress1 ?? null,
    shipCity: project.shipCity ?? null,
    shipProvince: project.shipProvince ?? null,
    shipPostal: project.shipPostal ?? null,
    shipCountry: project.shipCountry ?? null,
    receiveMode: receiveModeForUi,
    defaultSiteContactName: project.defaultSiteContactName ?? null,
    defaultSiteContactPhone: project.defaultSiteContactPhone ?? null,
    jobs: project.jobs.map((job) => {
      const jobSubtotal = job.items.reduce((sum, item) => {
        const price = Number(item.priceSnapshot || 0);
        return sum + price * item.quantity;
      }, 0);
      const phaseEntities = phasesByJobId.get(job.id) ?? [];
      const deliveryPhases = mapPhasesToViews(phaseEntities).map((p) => {
        const entity = phaseEntities.find((e) => e.id === p.id);
        const hasPhasePhoto = Boolean(entity?.fulfillmentPhotoStorageKey);
        const mayViewPhasePhoto =
          hasPhasePhoto &&
          (canEdit ||
            viewerCanFulfill ||
            !hasNATag ||
            viewerIsAppAdmin ||
            job.orderLifecycleStatus === "delivered" ||
            job.orderLifecycleStatus === "paid");
        return {
          ...p,
          photoUrl: mayViewPhasePhoto
            ? (buildSignedFulfillmentPhotoUrl({
                jobId: job.id,
                shop,
                phaseId: p.id,
              }) ??
                mergeAppProxyParamsFromRequest(
                  `/apps/project-clad/fulfillment-photo?jobId=${encodeURIComponent(job.id)}&phaseId=${encodeURIComponent(p.id)}`,
                  request,
                ))
            : null,
          packingSlipUrl: hasPhasePhoto
            ? mergeAppProxyParamsFromRequest(
                `/apps/project-clad/phase-document?id=${encodeURIComponent(project.id)}&jobId=${encodeURIComponent(job.id)}&phaseId=${encodeURIComponent(p.id)}&mode=packing`,
                request,
              )
            : null,
          invoiceUrl: hasPhasePhoto
            ? mergeAppProxyParamsFromRequest(
                `/apps/project-clad/phase-document?id=${encodeURIComponent(project.id)}&jobId=${encodeURIComponent(job.id)}&phaseId=${encodeURIComponent(p.id)}&mode=invoice`,
                request,
              )
            : null,
        };
      });
      const deliveredPercent = computeDeliveredPercent(job.items, deliveryPhases);
      return {
        id: job.id,
        name: job.name,
        orderNumber: job.orderNumber ?? null,
        createdAt: job.createdAt.toISOString(),
        isLocked: job.isLocked || Boolean(job.orderLink),
        workOrderStatus: job.workOrderStatus ?? null,
        completedAt: job.completedAt?.toISOString() ?? null,
        paidAt: job.paidAt?.toISOString() ?? null,
        receiptSnapshot: job.receiptSnapshot ?? null,
        orderName: job.orderLink?.orderName ?? null,
        purchaseOrderNumber: job.purchaseOrderNumber ?? null,
        siteContactName: job.siteContactName ?? null,
        siteContactPhone: job.siteContactPhone ?? null,
        subtotal: jobSubtotal,
        orderLifecycleStatus: job.orderLifecycleStatus,
        scheduledDeliveryDate: job.scheduledDeliveryDate ?? null,
        scheduledDeliveryWindow: job.scheduledDeliveryWindow ?? null,
        fulfillmentMethod: job.fulfillmentMethod ?? null,
        deliveryMode: normalizeJobDeliveryMode(job.deliveryMode),
        shipAddress1: job.shipAddress1 ?? null,
        shipCity: job.shipCity ?? null,
        shipProvince: job.shipProvince ?? null,
        shipPostal: job.shipPostal ?? null,
        shipCountry: job.shipCountry ?? null,
        hasFulfillmentPhoto:
          Boolean(job.fulfillmentPhotoStorageKey) ||
          phaseEntities.some((p) => Boolean(p.fulfillmentPhotoStorageKey)),
        fulfillmentPhotoUrl: job.fulfillmentPhotoStorageKey
          ? !hasNATag ||
            viewerIsAppAdmin ||
            job.orderLifecycleStatus === "delivered" ||
            job.orderLifecycleStatus === "paid"
            ? (buildSignedFulfillmentPhotoUrl({ jobId: job.id, shop }) ??
              `/apps/project-clad/fulfillment-photo?jobId=${encodeURIComponent(job.id)}`)
            : null
          : null,
        hasPurchaseOrderPdf: Boolean(job.purchaseOrderPdfStorageKey),
        purchaseOrderPdfFileName: job.purchaseOrderPdfFileName ?? null,
        purchaseOrderPdfUrl: job.purchaseOrderPdfStorageKey
          ? mergeAppProxyParamsFromRequest(
              `/apps/project-clad/po-pdf?jobId=${encodeURIComponent(job.id)}`,
              request,
            )
          : null,
        deliveryPhases,
        deliveredPercent,
        deliveryPlanMode: job.deliveryPlanMode ?? null,
        deliveryBatchByItemJson: job.deliveryBatchByItemJson ?? null,
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
                const href = normalizeHttpUrl((p.value || "").trim());
                return Boolean(href);
              });
              if (uploadProp) {
                const raw = normalizeHttpUrl(uploadProp.value.trim())!;
                uploadPartFileUrl = raw;
                if (!isLikelyPdfUrl(raw)) {
                  customImageUrl = raw;
                }
              }
            }
          }

          const referenceImageUrl = extractReferenceImageFromProperties(properties);

          const imageUrl =
            customImageUrl ||
            referenceImageUrl ||
            (isUploadPartLine && uploadPartFileUrl && isLikelyPdfUrl(uploadPartFileUrl)
              ? null
              : pres.imageUrl || null);

          return {
            id: item.id,
            sortOrder: item.sortOrder,
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
      if (!jobCountsTowardProjectSubtotal(job.orderLifecycleStatus)) {
        return sum;
      }
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
  const navAccountFirstName = navName || null;
  const navAccountInitial = navName
    ? navName.charAt(0).toUpperCase()
    : customerEmail?.trim()
      ? customerEmail.trim().charAt(0).toUpperCase()
      : null;

  /* When the viewer arrived via a company-tag match only, pick the label that matches
     the owner's key so the banner reads naturally (e.g. "Shared via Acme Inc."). */
  const projectCompanyLabel = (() => {
    if (!viaCompany || !project.ownerCompanyKey) return null;
    const idx = viewerCompanyCtx.keys.indexOf(project.ownerCompanyKey);
    return idx >= 0
      ? viewerCompanyCtx.displayNames[idx] ?? project.companyName ?? null
      : project.companyName ?? null;
  })();

  return {
    proxyStylesHref,
    proxyScriptSrcs,
    proxyScriptConfig,
    project: payload,
    otherProjects: otherProjects.map((other) => ({
      id: other.id,
      name: other.name,
    })),
    canViewPricing: !hideAddToCart || hasPricingAccess(request),
    canEdit,
    canEditLineUnitPrices,
    canExportOrderCsv,
    isOwner,
    canAdminMembers,
    hideAddToCart,
    viaCompany,
    viaCompanyLabel: projectCompanyLabel,
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
    ...buildShopBrandingUrls({ request, shop, settings }),
    viewerCanFulfill,
    viewerHasNATag: hasNATag,
    shopDeliveryFee,
    storefrontAppNav: getStorefrontAppNav(settings),
    navAccountInitial,
    navAccountFirstName,
    /** Owner's Shopify B2B company — for org-visibility toggle when `ownerCompanyKey` is not yet on the project. */
    ownerCompanyForShare: {
      hasB2bCompany: ownerCompanyForShare.keys.length > 0,
      displayName: ownerCompanyForShare.displayNames[0] ?? null,
      firstKey: ownerCompanyForShare.keys[0] ?? null,
    },
    projectFormActionUrl: mergeAppProxyParamsFromRequest(
      `${storefrontProjectActionPath}?id=${encodeURIComponent(project.id)}`,
      request,
    ),
    /* First selectable preferred-delivery date, as `YYYY-MM-DD`. Computed here rather
       than in the component because this route is served through the app proxy and
       never hydrates — anything derived in an effect would leave the date inputs with
       no `min` at all. Same call the `save-order-schedule` action validates with, so
       the greyed-out days and the server rule cannot drift apart. */
    preferredDeliveryDateMinYmd: minPreferredDeliveryYmd(
      PREFERRED_DELIVERY_MIN_DAY_OFFSET_FROM_TODAY,
    ),
  };
};

/*
 * Copy for the non-blocking `?notifyWarning=` banner. A failed notification never rolls the
 * mutation back, so every one of these has to start by confirming that the thing the user did
 * actually happened, then say what did not.
 */
const ORDER_PLACED_CUSTOMER_MAIL_WARNING =
  "Your order was placed, but we could not email your confirmation. The order itself is safe — contact us if you need a copy.";
const REORDER_MAIL_WARNING =
  "The reorder was created, but its confirmation email did not go out. The order itself is safe — contact us if you need a copy.";

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
    /* Not surfaced to the user: this is a background snapshot of state the page already shows,
       sent on nearly every project edit, so a banner here would fire constantly and train
       people to ignore it. The log carries enough to find the project and the trigger. */
    console.error(
      `[project] status email failed (shop=${args.shop} project=${args.projectId} headline="${args.headline}"):`,
      err instanceof Error ? err.message : err,
    );
  }
}

function parseShipToFromFormData(formData: FormData) {
  const trim = (k: string) => String(formData.get(k) || "").trim();
  return {
    shipAddress1: trim("shipAddress1") || null,
    shipCity: trim("shipCity") || null,
    shipProvince: trim("shipProvince") || null,
    shipPostal: trim("shipPostal") || null,
    shipCountry: trim("shipCountry") || "Canada",
  };
}

/** Create an empty job (shared by `create-job` and Edit project save). */
async function createEmptyJobOnProject(args: {
  shop: string;
  projectId: string;
  customerId: string;
  name: string;
  purchaseOrderNumber: string;
  deliveryMode?: JobDeliveryMode;
  ship?: ReturnType<typeof parseShipToFromFormData>;
}): Promise<"duplicate" | "created"> {
  const { shop, projectId, customerId, name, purchaseOrderNumber } = args;
  const deliveryMode = args.deliveryMode ?? "inherit";
  const ship = args.ship ?? parseShipToFromFormData(new FormData());
  const deliveryPayload = jobDeliveryPrismaData(deliveryMode, ship);
  const existingNames = await prisma.job.findMany({
    where: { projectId },
    select: { name: true },
  });
  const normalizedName = name.toLowerCase();
  if (
    existingNames.some((job) => job.name.toLowerCase() === normalizedName)
  ) {
    return "duplicate";
  }

  const maxOrder = await prisma.job.aggregate({
    where: { projectId },
    _max: { sortOrder: true },
  });
  const nextSortOrder = (maxOrder._max.sortOrder ?? 0) + 1;

  const projectDefaults = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      defaultSiteContactName: true,
      defaultSiteContactPhone: true,
    },
  });

  const newJob = await prisma.job.create({
    data: {
      projectId,
      name,
      sortOrder: nextSortOrder,
      purchaseOrderNumber: purchaseOrderNumber.trim() || null,
      siteContactName: projectDefaults?.defaultSiteContactName ?? null,
      siteContactPhone: projectDefaults?.defaultSiteContactPhone ?? null,
      ...deliveryPayload,
    },
  });

  const { logProjectActivity } = await import("../utils/projectActivity.server");
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

  return "created";
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { logProjectActivity } = await import("../utils/projectActivity.server");
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
      /** When `"json"`, save-order-edit returns `{ ok: true }` instead of redirect (fetch + app proxy). */
      responseMode?: string;
      jobId?: string;
      jobName?: string;
      purchaseOrderNumber?: string;
      /** Per-order site contact name. Omitted = leave as-is; "" = clear. */
      siteContactName?: string | null;
      /** Per-order site contact phone. Omitted = leave as-is; "" = clear. */
      siteContactPhone?: string | null;
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
      const siteContactNameRaw =
        typeof payload.siteContactName === "string"
          ? payload.siteContactName.trim()
          : null;
      const siteContactPhoneRaw =
        typeof payload.siteContactPhone === "string"
          ? payload.siteContactPhone.trim()
          : null;
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
          const hasStructuralEdits =
            deleteJob ||
            removeItemIds.length > 0 ||
            itemUpdates.length > 0;

          /*
           * Linked / locked orders: line items + delete are frozen, but
           * merchants still need to backfill PO #, site contact name, and
           * phone after delivery (records / driver callbacks). Previously
           * the entire `save-order-edit` branch was skipped whenever
           * `isLocked`, so the inline Save POST succeeded at
           * the HTTP layer (redirect) while persisting zero DB rows — the
           * UI looked editable but nothing ever committed.
           */
          if (isLocked && hasStructuralEdits) {
            return Response.json(
              {
                error:
                  "This order is locked against line-item changes. You can still update purchase order #, site contact name, and phone from the order summary — remove line edits or delete-order flags from your save request.",
              },
              { status: 403 },
            );
          }

          if (!isLocked || !hasStructuralEdits) {
            let didChange = false;
            const jobTitleForMessage = job.name;

            if (deleteJob) {
              await prisma.job.delete({ where: { id: jobId } });
              didChange = true;
              notifyMissionControlRemove(jobId, shop);
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
              if (!isLocked && removeItemIds.length) {
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
              /* Site contact: only consider as a change when client actually sent
                 the field (string or null). undefined => leave as-is. */
              const siteContactNameProvided = payload.siteContactName !== undefined;
              const siteContactPhoneProvided = payload.siteContactPhone !== undefined;
              const nextSiteContactName = siteContactNameProvided
                ? siteContactNameRaw && siteContactNameRaw.length > 0
                  ? siteContactNameRaw
                  : null
                : job.siteContactName;
              const nextSiteContactPhone = siteContactPhoneProvided
                ? siteContactPhoneRaw && siteContactPhoneRaw.length > 0
                  ? siteContactPhoneRaw
                  : null
                : job.siteContactPhone;
              const siteContactNameChanged =
                siteContactNameProvided &&
                nextSiteContactName !== (job.siteContactName ?? null);
              const siteContactPhoneChanged =
                siteContactPhoneProvided &&
                nextSiteContactPhone !== (job.siteContactPhone ?? null);
              if (
                nameChanged ||
                poChanged ||
                siteContactNameChanged ||
                siteContactPhoneChanged
              ) {
                await prisma.job.update({
                  where: { id: jobId },
                  data: {
                    ...(nameChanged ? { name: jobName } : {}),
                    ...(poChanged ? { purchaseOrderNumber: nextPo } : {}),
                    ...(siteContactNameChanged
                      ? { siteContactName: nextSiteContactName }
                      : {}),
                    ...(siteContactPhoneChanged
                      ? { siteContactPhone: nextSiteContactPhone }
                      : {}),
                  },
                });
                didChange = true;

                /* Reverse cascade: when a job's site contact is filled in and the
                   project still has no default, promote the job's value up to the
                   project so future blank orders inherit it. We never overwrite
                   an existing project-level default — owners can change those
                   explicitly from the Edit project modal. */
                const projectDefaultNameBlank =
                  !project.defaultSiteContactName?.trim();
                const projectDefaultPhoneBlank =
                  !project.defaultSiteContactPhone?.trim();
                const liftName =
                  siteContactNameChanged &&
                  Boolean(nextSiteContactName?.trim()) &&
                  projectDefaultNameBlank;
                const liftPhone =
                  siteContactPhoneChanged &&
                  Boolean(nextSiteContactPhone?.trim()) &&
                  projectDefaultPhoneBlank;
                if (liftName || liftPhone) {
                  await prisma.project.update({
                    where: { id: projectId },
                    data: {
                      ...(liftName
                        ? { defaultSiteContactName: nextSiteContactName }
                        : {}),
                      ...(liftPhone
                        ? { defaultSiteContactPhone: nextSiteContactPhone }
                        : {}),
                    },
                  });
                }
              }
              if (!isLocked) {
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
              }
              if (didChange) {
                const metadataOnly =
                  isLocked ||
                  (!removeItemIds.length && !itemUpdates.length);
                notifyMissionControl(jobId);
                await emailProjectStatusSnapshot({
                  shop,
                  projectId,
                  actorCustomerId: customerId,
                  headline: "Order updated on project page",
                  introLines: metadataOnly
                    ? [
                        `Someone updated reference or contact details on order "${jobTitleForMessage}" (purchase order #, site contact name, or phone).`,
                        "Open the project link below to review the current order.",
                      ]
                    : [
                        `Someone edited order "${jobTitleForMessage}" (quantities, line unit prices, name, or removed lines).`,
                        "Open the project link below to review the current order contents.",
                      ],
                });
              }
            }
          }
        }
      }

      /*
       * Storefront inline "Save" uses `fetch()` + JSON. Following Remix
       * `redirect()` across the Shopify app proxy is brittle (opaque
       * responses, HTML 200s, etc.). When the client asks for JSON ack,
       * return a tiny JSON body so the browser can reliably reload.
       *
       * Also honor `?pcJson=1` on the request URL so we still return JSON
       * if a proxy strips or alters the JSON body but preserves the query.
       */
      const saveAckFromQuery =
        new URL(request.url).searchParams.get("pcJson") === "1";
      if (
        String(payload.responseMode || "").toLowerCase() === "json" ||
        saveAckFromQuery
      ) {
        return Response.json(
          { ok: true as const },
          {
            status: 200,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
            },
          },
        );
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

      const jobForDelivery = await prisma.job.findFirst({
        where: { id: jobId, projectId },
      });
      if (!jobForDelivery) {
        return Response.json({ error: "Order not found." }, { status: 404 });
      }
      const resolvedDelivery = resolveJobDelivery(jobForDelivery, project);
      const fulfillmentMethod = resolvedDelivery.method;

      if (
        fulfillmentMethod === "delivery" &&
        !resolvedDelivery.addressLine
      ) {
        return Response.json(
          {
            error:
              "Set delivery options for this order (address required) before placing.",
          },
          { status: 400 },
        );
      }

      /* Per-order site contact is required for ALL fulfillment methods so
         the warehouse / driver / counter has a real human + phone to call.
         Order Now may send the latest typed values (so users need not Save first). */
      const payloadContactName =
        typeof payload.siteContactName === "string"
          ? payload.siteContactName.trim()
          : "";
      const payloadContactPhone =
        typeof payload.siteContactPhone === "string"
          ? payload.siteContactPhone.trim()
          : "";
      const contactPatch: {
        siteContactName?: string;
        siteContactPhone?: string;
      } = {};
      if (payloadContactName) contactPatch.siteContactName = payloadContactName;
      if (payloadContactPhone) contactPatch.siteContactPhone = payloadContactPhone;
      if (Object.keys(contactPatch).length > 0) {
        await prisma.job.update({
          where: { id: jobId },
          data: contactPatch,
        });
      }
      const siteContactNameOk = Boolean(
        (contactPatch.siteContactName ?? job.siteContactName)?.trim(),
      );
      const siteContactPhoneOk = Boolean(
        (contactPatch.siteContactPhone ?? job.siteContactPhone)?.trim(),
      );
      if (!siteContactNameOk || !siteContactPhoneOk) {
        return Response.json(
          {
            error:
              "Add a site contact name and phone number on this order before placing it.",
          },
          { status: 400 },
        );
      }

      /* Purchase Order # is OPTIONAL — finance no longer blocks Order Now
         on its absence. (Site contact name + phone are still required
         above so the warehouse / driver can reach someone on delivery.) */

      try {
        await prisma.$transaction(async (tx) => {
          const fresh = await tx.job.findFirst({
            where: { id: jobId, projectId },
            select: { orderNumber: true },
          });
          if (!fresh) {
            throw new Error("Order not found.");
          }
          let nextOrderNumber = fresh.orderNumber;
          if (nextOrderNumber == null) {
            const rows = await tx.$queryRaw<Array<{ nextval: bigint | number }>>`
              SELECT nextval('"Job_orderNumber_seq"') AS nextval
            `;
            const raw = rows[0]?.nextval;
            const parsed =
              typeof raw === "bigint" ? Number(raw) : Number(raw ?? Number.NaN);
            if (!Number.isFinite(parsed)) {
              throw new Error("Could not allocate order number.");
            }
            nextOrderNumber = parsed;
          }
          await tx.job.update({
            where: { id: jobId },
            data: {
              orderLifecycleStatus: "ordered",
              fulfillmentMethod,
              orderNumber: nextOrderNumber,
            },
          });
        });
      } catch (e) {
        const detail =
          e instanceof Error ? e.message : "Database error while confirming order.";
        console.error("[project-clad] confirm-order-now prisma error:", e);
        return Response.json({ error: detail }, { status: 500 });
      }

      const notifyEmail = await resolvePlacerNotifyEmail(
        shop,
        customerId,
        customerEmail,
      );
      await logProjectActivity({
        projectId,
        jobId,
        type: STOREFRONT_ORDER_CONFIRMED_ACTIVITY,
        visibility: "member",
        actorCustomerId: customerId,
        payload: notifyEmail ? { notifyEmail } : undefined,
      }).catch((err: unknown) => {
        /* The order is placed; a missing timeline row must not fail it. Logged because a
           lost `storefront_order_confirmed` row is what later suppresses the delivered
           email to the person who placed the order. */
        console.error(
          `[project] order-confirmed activity log failed (project=${projectId} job=${jobId}):`,
          err instanceof Error ? err.message : err,
        );
      });

      /* Silent backup draft order in Shopify admin. Best-effort: never blocks Order now. */
      console.log(
        "[project-clad] backup draft order: starting for job",
        jobId,
        "shop",
        shop,
      );
      try {
        const backup = await createBackupDraftOrderForJob({
          shop,
          jobId,
          deliveryFeeAmount: resolvedDelivery.fee,
        });
        if (backup.ok) {
          console.log(
            "[project-clad] backup draft order: created",
            backup.draftOrderId,
            backup.reused ? "(reused existing)" : "",
          );
        } else {
          console.error(
            "[project-clad] backup draft order failed:",
            backup.error,
            backup.userErrors ?? "",
          );
          await logProjectActivity({
            projectId,
            jobId,
            type: "shopify_draft_backup_failed",
            visibility: "admin",
            actorCustomerId: customerId,
            payload: { error: backup.error },
          }).catch((logErr: unknown) => {
            console.error(
              `[project] draft-backup-failed activity log failed (project=${projectId} job=${jobId}):`,
              logErr instanceof Error ? logErr.message : logErr,
            );
          });
        }
      } catch (err) {
        console.error(
          "[project-clad] backup draft order threw:",
          err instanceof Error ? err.message : err,
        );
      }

      /*
       * A notification that does not go out must never undo the order — it is already
       * committed above. It must not be invisible either, so the mail task reports back what
       * happened and the ack carries a non-blocking warning for the reloaded page.
       */
      /* Run in parallel: SMTP can be slow; phone push (ntfy) should not wait on email. */
      const [orderPlacedMailTask] = await Promise.allSettled([
        (async (): Promise<string | null> => {
          try {
            const mail = await sendOrderPlacedEmails({
              shop,
              projectId,
              jobId,
              fulfillmentMethod,
              actorCustomerId: customerId,
            });
            if (mail.customerFailed) {
              return ORDER_PLACED_CUSTOMER_MAIL_WARNING;
            }
            if (mail.shopFailed) {
              return "Your order was placed, but our notification email did not go out. Please contact us to confirm we received it.";
            }
            return null;
          } catch (err) {
            console.error(
              `[project] order placed email failed (shop=${shop} project=${projectId} job=${jobId}):`,
              err instanceof Error ? err.message : err,
            );
            return ORDER_PLACED_CUSTOMER_MAIL_WARNING;
          }
        })(),
        (async () => {
          try {
            /* Await so the ntfy/webhook fetch finishes before the response. */
            await notifyOrderNowStaff({ shop, projectId, jobId });
          } catch (err) {
            console.error(
              "[project] order now staff push failed:",
              err instanceof Error ? err.message : err,
            );
          }
        })(),
        (async () => {
          try {
            notifyMissionControl(jobId);
          } catch (err) {
            console.error(
              "[project] mission control push failed:",
              err instanceof Error ? err.message : err,
            );
          }
        })(),
      ]);
      const orderPlacedEmailWarning =
        orderPlacedMailTask.status === "fulfilled"
          ? orderPlacedMailTask.value
          : null;
      return Response.json({
        ok: true,
        ...(orderPlacedEmailWarning
          ? { emailWarning: orderPlacedEmailWarning }
          : {}),
      });
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

  if (intent === "save-order-delivery") {
    const saveDeliveryAckFromQuery =
      new URL(request.url).searchParams.get("pcJson") === "1";
    const jsonDeliverySave = declaresJson || saveDeliveryAckFromQuery;

    if (!canEdit && !viewerCanFulfill) {
      if (jsonDeliverySave) {
        return Response.json({ error: "You cannot edit delivery for this project." }, { status: 403 });
      }
      throw new Response("Forbidden", { status: 403 });
    }
    const jobId = String(formData.get("jobId") || "");
    const job = await prisma.job.findFirst({
      where: { id: jobId, projectId },
    });
    if (!job) {
      return Response.json({ error: "Order not found." }, { status: 404 });
    }
    if (isOrderDeliveryPlanLocked(job.orderLifecycleStatus)) {
      return Response.json(
        {
          error:
            "Delivery options cannot be changed after the order has been fully delivered.",
        },
        { status: 400 },
      );
    }
    try {
    const deliveryMode = normalizeJobDeliveryMode(
      String(formData.get("deliveryMode") || ""),
    );
    const ship = parseShipToFromFormData(formData);
    if (deliveryMode === "delivery" && !hasCompleteShipToDetails(ship)) {
      const projectShip = {
        shipAddress1: project.shipAddress1,
        shipCity: project.shipCity,
        shipProvince: project.shipProvince,
        shipPostal: project.shipPostal,
      };
      if (!hasCompleteShipToDetails(projectShip)) {
        return Response.json(
          {
            error:
              "Enter a complete delivery address for this order, or choose store pickup.",
          },
          { status: 400 },
        );
      }
    }
    const deliveryPayload = jobDeliveryPrismaData(deliveryMode, ship);
    const planMode = normalizeDeliveryPlanMode(
      String(formData.get("deliveryPlanMode") || ""),
    );
    let dateRaw = "";
    let windowRaw = "";
    if (planMode === "single") {
      dateRaw = String(formData.get("scheduledDeliveryDate") || "").trim();
      windowRaw = String(formData.get("scheduledDeliveryWindow") || "").trim();
    } else if (planMode === "recurring") {
      dateRaw = String(formData.get("deliveryRecurringStartDate") || "").trim();
      windowRaw = String(
        formData.get("deliveryRecurringStartWindow") || "",
      ).trim();
    }
    /*
     * Minimum delivery date, enforced here rather than only in the browser. The date inputs
     * carry a `min`, but this page never hydrates and the modal posts through `fetch`, so the
     * attribute is advisory: it is computed at render time (stale on a tab left open past
     * Ottawa midnight) and absent entirely for any non-browser submit. Same helper and same
     * constant as the `min` the loader renders and as the rule in `save-order-schedule`, so
     * the three cannot drift apart.
     *
     * Only a *changed* date is checked. The modal repopulates whatever is already stored, so
     * rejecting an unchanged (and by now past) date would block edits to the address or the
     * delivery plan on every older order.
     */
    if (
      dateRaw !== (job.scheduledDeliveryDate ?? "") &&
      dateRaw &&
      isYmdBeforeMin(
        dateRaw,
        minPreferredDeliveryYmd(PREFERRED_DELIVERY_MIN_DAY_OFFSET_FROM_TODAY),
      )
    ) {
      return Response.json(
        {
          error:
            "The delivery date cannot be today or tomorrow on the Ottawa (Eastern) calendar. Pick a later date.",
        },
        { status: 400 },
      );
    }
    await prisma.job.update({
      where: { id: jobId },
      data: {
        ...deliveryPayload,
        scheduledDeliveryDate: dateRaw || null,
        scheduledDeliveryWindow: windowRaw || null,
      },
    });

    const shopFee = await getShopDeliveryFee(shop);
    const jobAfter = await prisma.job.findUnique({
      where: { id: jobId },
      include: { items: true, deliveryPhases: { include: { lines: true } } },
    });
    if (jobAfter) {
      const resolvedAfter = resolveJobDelivery(
        jobAfter,
        project,
        shopFee,
      );
      await ensureJobDeliveryPhases(jobAfter, shopFee, resolvedAfter);
      const itemIds = new Set(jobAfter.items.map((i) => i.id));

      let phasesInput: PhaseSaveInput[] | null = null;
      if (planMode === "recurring" && resolvedAfter.method === "delivery") {
        const batchRaw = String(formData.get("deliveryBatchJson") || "").trim();
        const atATimePayload = batchRaw
          ? parseAtATimeDeliveryPayload(batchRaw, itemIds)
          : null;
        if (!atATimePayload) {
          return Response.json(
            {
              error:
                jobAfter.items.length === 0
                  ? "Add line items to this order before setting a delivery plan."
                  : "Enter a valid quantity per delivery for each line.",
            },
            { status: 400 },
          );
        }
        const { batchByItem: batch, repeatIntervalDays, repeatEndDate } =
          atATimePayload;
        for (const item of jobAfter.items) {
          if (batch[item.id] > item.quantity) {
            return Response.json(
              {
                error: `Quantity per delivery cannot exceed ordered qty (${item.quantity}) on a line.`,
              },
              { status: 400 },
            );
          }
        }
        if (!repeatIntervalDays || repeatIntervalDays < 1) {
          return Response.json(
            {
              error: "Choose how often deliveries repeat.",
            },
            { status: 400 },
          );
        }
        if (!dateRaw.trim()) {
          return Response.json(
            {
              error:
                "Choose a date for the first recurring delivery.",
            },
            { status: 400 },
          );
        }
        const schedule = {
          scheduledDeliveryDate: dateRaw,
          scheduledDeliveryWindow: windowRaw,
          repeatIntervalDays,
          repeatEndDate,
        };
        if (
          dateRaw &&
          windowRaw &&
          repeatIntervalDays &&
          repeatIntervalDays >= 1
        ) {
          const phaseCount = buildPhasesFromAtATime(
            jobAfter.items,
            batch,
            schedule,
          ).length;
          for (let seq = 1; seq <= phaseCount; seq += 1) {
            const dropDate = addDaysToCalendarYmd(
              dateRaw,
              repeatIntervalDays * (seq - 1),
            );
            if (!dropDate) continue;
            if (repeatEndDate && dropDate > repeatEndDate) break;
            if (
              !isOttawaDeliveryWindowValidForDate(
                windowRaw,
                dropDate,
                new Date(),
              )
            ) {
              return Response.json(
                {
                  error: `Delivery ${seq}: time window is not valid for ${dropDate}.`,
                },
                { status: 400 },
              );
            }
          }
        }
        phasesInput = buildPhasesFromAtATime(jobAfter.items, batch, schedule);
      } else {
        phasesInput = buildPhasesFromAtATime(
          jobAfter.items,
          Object.fromEntries(
            jobAfter.items.map((i) => [i.id, i.quantity]),
          ),
          {
            scheduledDeliveryDate: dateRaw,
            scheduledDeliveryWindow: windowRaw,
          },
        );
      }

      if (phasesInput && resolvedAfter.method === "delivery") {
        const planErr = validatePlannedQuantities(jobAfter.items, phasesInput);
        if (planErr) {
          return Response.json({ error: planErr }, { status: 400 });
        }
      }

      const batchPersistRaw =
        planMode === "recurring" && resolvedAfter.method === "delivery"
          ? String(formData.get("deliveryBatchJson") || "").trim() || null
          : null;
      const batchPayload =
        batchPersistRaw && phasesInput
          ? parseAtATimeDeliveryPayload(
              batchPersistRaw,
              new Set(jobAfter.items.map((i) => i.id)),
            )
          : null;

      if (phasesInput && resolvedAfter.method === "delivery") {
        const referenceJson = serializeDeliveryPlanReference({
          planMode,
          referencePhases: phasesInput,
          batchPayload,
        });
        try {
          await prisma.job.update({
            where: { id: jobId },
            data: {
              deliveryPlanMode: planMode,
              deliveryBatchByItemJson: referenceJson,
            },
          });
        } catch (planMetaErr) {
          if (!isJobDeliverySchemaError(planMetaErr)) {
            throw planMetaErr;
          }
        }
      } else if (resolvedAfter.method === "delivery") {
        try {
          await prisma.job.update({
            where: { id: jobId },
            data: { deliveryPlanMode: planMode },
          });
        } catch (planMetaErr) {
          if (!isJobDeliverySchemaError(planMetaErr)) {
            throw planMetaErr;
          }
        }
      }

      if (resolvedAfter.method === "delivery") {
        await ensureOpenFulfillmentPhase(jobId);
      }
    }

    notifyMissionControl(jobId);
    if (jsonDeliverySave) {
      return Response.json({ ok: true as const });
    }
    return redirectToProject(request, projectId, shop);
    } catch (e) {
      console.error(
        "[save-order-delivery]",
        e instanceof Error ? e.message : e,
      );
      const msg =
        e instanceof Error ? e.message : "Could not save delivery options.";
      if (jsonDeliverySave) {
        return Response.json({ error: msg }, { status: 500 });
      }
      throw e;
    }
  }

  if (intent === "record-phase-delivery") {
    if (!viewerIsAppAdmin) {
      throw new Response("Forbidden", { status: 403 });
    }
    const recordAckFromQuery =
      new URL(request.url).searchParams.get("pcJson") === "1";
    const recordJsonAck = declaresJson || recordAckFromQuery;
    const jobId = String(formData.get("jobId") || "");
    const phaseId = String(formData.get("phaseId") || "");
    const linesJson = String(formData.get("deliveredLinesJson") || "").trim();
    const job = await prisma.job.findFirst({
      where: { id: jobId, projectId },
      include: { items: true },
    });
    if (!job) {
      return Response.json({ error: "Order not found." }, { status: 404 });
    }
    let lines: { jobItemId: string; quantityDelivered: number }[] = [];
    try {
      const parsed = JSON.parse(linesJson) as unknown;
      if (!Array.isArray(parsed)) throw new Error("bad");
      for (const row of parsed) {
        if (!row || typeof row !== "object") throw new Error("bad");
        const r = row as Record<string, unknown>;
        lines.push({
          jobItemId: String(r.jobItemId || "").trim(),
          quantityDelivered: Math.floor(Number(r.quantityDelivered)),
        });
      }
    } catch {
      return Response.json({ error: "Invalid delivered quantities." }, { status: 400 });
    }
    try {
      const result = await recordPhaseDeliveredQuantities({
        phaseId,
        jobId,
        lines,
      });
      notifyMissionControl(jobId);
      if (recordJsonAck) {
        return Response.json({ ok: true as const, ...result });
      }
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "Save failed." },
        { status: 400 },
      );
    }
    return redirectToProject(request, projectId, shop);
  }

  if (intent === "upload-phase-fulfillment-photo") {
    if (!viewerCanFulfill) {
      throw new Response("Forbidden", { status: 403 });
    }
    const fulfillmentAckFromQuery =
      new URL(request.url).searchParams.get("pcFulfillment") === "1";
    const failFulfillment = (message: string, status = 400) => {
      if (fulfillmentAckFromQuery) {
        return Response.json({ error: message }, { status });
      }
      return redirectToProject(request, projectId, shop, {
        fulfillmentError: message,
      });
    };

    const jobId = String(formData.get("jobId") || "");
    const phaseId = String(formData.get("phaseId") || "");
    const job = await prisma.job.findFirst({
      where: { id: jobId, projectId },
      include: {
        items: true,
        deliveryPhases: { include: { lines: true }, orderBy: { sequence: "asc" } },
      },
    });
    if (!job) {
      return failFulfillment("Order not found.", 404);
    }
    const phase = job.deliveryPhases.find((p) => p.id === phaseId);
    if (!phase) {
      return failFulfillment("Delivery phase not found.", 404);
    }
    if (phase.fulfillmentPhotoStorageKey || phase.deliveredAt) {
      return failFulfillment(
        "This delivery was already confirmed. Refresh the page to record the next delivery.",
      );
    }
    const phaseAwaitingPhoto =
      !phase.fulfillmentPhotoStorageKey && !phase.deliveredAt;
    const blockedPreOrderStatuses = [
      "draft",
      "pending_review",
      "ready_to_order",
    ] as const;
    if (
      !phaseAwaitingPhoto ||
      (blockedPreOrderStatuses as readonly string[]).includes(
        job.orderLifecycleStatus,
      )
    ) {
      return failFulfillment(
        "This delivery cannot be confirmed yet. Reload the page and try again.",
      );
    }
    const hasQtyFields = job.items.some((item) =>
      formData.has(`qty_${item.id}`),
    );
    if (hasQtyFields) {
      const lines = job.items.map((item) => ({
        jobItemId: item.id,
        quantityDelivered: Math.floor(
          Number(formData.get(`qty_${item.id}`)) || 0,
        ),
      }));
      const totalDelivered = lines.reduce(
        (sum, line) => sum + Math.max(0, line.quantityDelivered),
        0,
      );
      if (totalDelivered <= 0) {
        return failFulfillment("Enter at least one quantity for this delivery.");
      }
      try {
        await recordPhaseDeliveredQuantities({ phaseId, jobId, lines });
      } catch (e) {
        return failFulfillment(
          e instanceof Error ? e.message : "Invalid delivered quantities.",
        );
      }
    }
    const uploaded = await readFormUploadedImage(formData, "photo");
    if (!uploaded) {
      return failFulfillment("Photo file is required.");
    }
    if (uploaded.size > 8 * 1024 * 1024) {
      return failFulfillment("Photo must be 8MB or smaller.");
    }
    const orig = uploaded.name.toLowerCase();
    const ext = orig.endsWith(".png")
      ? ".png"
      : orig.endsWith(".webp")
        ? ".webp"
        : ".jpg";
    const shopDir = shop.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const storageKey = `${shopDir}/${jobId}-phase-${phase.sequence}-${Date.now()}${ext}`;
    if (!isSafeFulfillmentPhotoStorageKey(storageKey)) {
      return failFulfillment("Invalid path");
    }
    try {
      await saveFulfillmentPhoto(storageKey, uploaded.buffer);
    } catch (err) {
      console.error(
        "[project] fulfillment photo save failed:",
        err instanceof Error ? err.message : err,
      );
      return failFulfillment(
        "Could not save the delivery photo. Reload and try again, or contact support if this continues.",
      );
    }

    await prisma.jobDeliveryPhase.update({
      where: { id: phaseId },
      data: {
        fulfillmentPhotoStorageKey: storageKey,
        deliveredAt: new Date(),
      },
    });

    const refreshedJob = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        items: true,
        deliveryPhases: { include: { lines: true }, orderBy: { sequence: "asc" } },
      },
    });
    const phaseViews = mapPhasesToViews(refreshedJob?.deliveryPhases ?? []);
    const fullyDelivered = refreshedJob
      ? isJobFullyDelivered(refreshedJob.items, phaseViews)
      : false;

    await prisma.job.update({
      where: { id: jobId },
      data: {
        fulfillmentPhotoStorageKey: storageKey,
        ...(fullyDelivered && refreshedJob
          ? {
              orderLifecycleStatus: "delivered" as const,
              ...(job.completedAt ? {} : { completedAt: new Date() }),
            }
          : {}),
      },
    });

    /* The delivery is recorded either way — a notification that did not go out must not undo
       it — but staff need to know nobody was told, because they are the ones who will be
       asked "why didn't I get an email?". */
    let notifyWarning = "";
    if (!phase.fulfillmentNotifiedAt) {
      try {
        await sendFulfillmentPackageEmails({
          shop,
          projectId,
          jobId,
          phaseId,
        });
        await prisma.jobDeliveryPhase.update({
          where: { id: phaseId },
          data: { fulfillmentNotifiedAt: new Date() },
        });
      } catch (err) {
        notifyWarning =
          "Delivery recorded, but the customer and finance notification email could not be sent. Let them know another way.";
        console.error(
          `[project] phase fulfillment notify failed (shop=${shop} project=${projectId} job=${jobId} phase=${phaseId}):`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (!fullyDelivered) {
      await spawnNextFulfillmentPhaseIfNeeded(jobId);
      await ensureOpenFulfillmentPhase(jobId);
    }

    notifyMissionControl(jobId);
    if (fulfillmentAckFromQuery) {
      return Response.json({
        ok: true as const,
        ...(notifyWarning ? { warning: notifyWarning } : {}),
      });
    }
    return redirectToProject(request, projectId, shop, {
      ...(notifyWarning ? { notifyWarning } : {}),
    });
  }

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
    if (!staffOverride && isOrderDeliveryPlanLocked(job.orderLifecycleStatus)) {
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
    const job = await prisma.job.findFirst({
      where: { id: jobId, projectId },
    });
    if (!job) {
      throw new Response("Order not found", { status: 404 });
    }
    if (
      job.orderLifecycleStatus !== "ordered" &&
      job.orderLifecycleStatus !== "delivered"
    ) {
      throw new Response(
        "Photo upload is only allowed while the order is in Ordered status.",
        { status: 400 },
      );
    }
    const uploaded = await readFormUploadedImage(formData, "photo");
    if (!uploaded) {
      throw new Response("Photo file is required.", { status: 400 });
    }
    if (uploaded.size > 8 * 1024 * 1024) {
      throw new Response("Photo must be 8MB or smaller.", { status: 400 });
    }
    const orig = uploaded.name.toLowerCase();
    const ext = orig.endsWith(".png")
      ? ".png"
      : orig.endsWith(".webp")
        ? ".webp"
        : ".jpg";
    const shopDir = shop.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const storageKey = `${shopDir}/${jobId}-${Date.now()}${ext}`;
    if (!isSafeFulfillmentPhotoStorageKey(storageKey)) {
      throw new Response("Invalid path", { status: 400 });
    }
    await saveFulfillmentPhoto(storageKey, uploaded.buffer);

    await prisma.job.update({
      where: { id: jobId },
      data: {
        fulfillmentPhotoStorageKey: storageKey,
        orderLifecycleStatus: "delivered",
        ...(job.completedAt ? {} : { completedAt: new Date() }),
      },
    });

    let photoNotifyWarning = "";
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
        photoNotifyWarning =
          "Photo uploaded and the order marked delivered, but the customer and finance notification email could not be sent. Let them know another way.";
        console.error(
          `[project] fulfillment notify failed (shop=${shop} project=${projectId} job=${jobId}):`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    notifyMissionControl(jobId);
    return redirectToProject(request, projectId, shop, {
      ...(photoNotifyWarning ? { notifyWarning: photoNotifyWarning } : {}),
    });
  }

  if (intent === "upload-order-po-pdf") {
    const jobId = String(formData.get("jobId") || "");
    const poPdfRedirect = () =>
      redirectToProject(request, projectId, shop, { job: jobId });
    if (!canEdit) {
      throw new Response("Forbidden", { status: 403 });
    }
    const job = await prisma.job.findFirst({
      where: { id: jobId, projectId },
    });
    if (!job) {
      throw new Response("Order not found", { status: 404 });
    }
    const uploaded = await readFormUploadedPdf(formData, "file");
    if (!uploaded) {
      throw new Response("PDF file is required.", { status: 400 });
    }
    const validationError = validateUploadedPurchaseOrderPdf(uploaded);
    if (validationError) {
      throw new Response(validationError, { status: 400 });
    }
    const shopDir = shop.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const storageKey = `${shopDir}/${jobId}-po-${Date.now()}.pdf`;
    if (!isSafePurchaseOrderPdfStorageKey(storageKey)) {
      throw new Response("Invalid path", { status: 400 });
    }
    const previousKey = job.purchaseOrderPdfStorageKey;
    await savePurchaseOrderPdf(storageKey, uploaded.buffer);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        purchaseOrderPdfStorageKey: storageKey,
        purchaseOrderPdfFileName: uploaded.name.trim() || "purchase-order.pdf",
      },
    });
    if (previousKey && previousKey !== storageKey) {
      await deletePurchaseOrderPdf(previousKey);
    }
    const { logProjectActivity } = await import("../utils/projectActivity.server");
    await logProjectActivity({
      projectId,
      jobId,
      type: "order_po_pdf_uploaded",
      visibility: "member",
      actorCustomerId: customerId,
      payload: { fileName: uploaded.name.trim() || "purchase-order.pdf" },
    });
    return poPdfRedirect();
  }

  if (intent === "remove-order-po-pdf") {
    if (!canEdit) {
      throw new Response("Forbidden", { status: 403 });
    }
    const jobId = String(formData.get("jobId") || "");
    const job = await prisma.job.findFirst({
      where: { id: jobId, projectId },
    });
    if (!job) {
      throw new Response("Order not found", { status: 404 });
    }
    const previousKey = job.purchaseOrderPdfStorageKey;
    if (previousKey) {
      await deletePurchaseOrderPdf(previousKey);
    }
    await prisma.job.update({
      where: { id: jobId },
      data: {
        purchaseOrderPdfStorageKey: null,
        purchaseOrderPdfFileName: null,
      },
    });
    const { logProjectActivity } = await import("../utils/projectActivity.server");
    await logProjectActivity({
      projectId,
      jobId,
      type: "order_po_pdf_removed",
      visibility: "member",
      actorCustomerId: customerId,
      payload: {},
    });
    return redirectToProject(request, projectId, shop, { job: jobId });
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
    notifyMissionControl(jobId);
    settleBackupDraftOrderOnPaidBestEffort(shop, jobId);
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
      include: {
        deliveryPhases: { include: { lines: true }, orderBy: { sequence: "asc" } },
      },
    });
    if (!job) {
      throw new Response("Order not found", { status: 404 });
    }

    const hasDeliveryProgress = jobHasFulfillmentProgress(job.deliveryPhases);
    const isLifecycleRegression =
      next === "draft" ||
      next === "pending_review" ||
      next === "ready_to_order" ||
      (next === "ordered" &&
        (job.orderLifecycleStatus === "delivered" ||
          job.orderLifecycleStatus === "paid" ||
          job.orderLifecycleStatus === "ready_to_order" ||
          job.orderLifecycleStatus === "pending_review" ||
          job.orderLifecycleStatus === "draft"));
    if (hasDeliveryProgress && isLifecycleRegression) {
      await resetJobDeliveryPhasesProgress({ jobId, shop });
      job.fulfillmentPhotoStorageKey = null;
      job.fulfillmentNotifiedAt = null;
    }

    if (
      next === "delivered" &&
      !viewerIsAppAdmin &&
      !job.fulfillmentPhotoStorageKey &&
      !job.deliveryPhases.some((p) => Boolean(p.fulfillmentPhotoStorageKey))
    ) {
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

    const removeFulfillmentPhotoFromStorage = async (key: string) => {
      if (!isSafeFulfillmentPhotoStorageKey(key)) return;
      await deleteFulfillmentPhoto(key);
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
      await removeFulfillmentPhotoFromStorage(storageKeyToRemove);
    }

    let lifecycleNotifyWarning = "";
    if (next === "delivered") {
      const post = await prisma.job.findFirst({
        where: { id: jobId, projectId },
        select: { fulfillmentNotifiedAt: true },
      });
      if (post && !post.fulfillmentNotifiedAt) {
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
          lifecycleNotifyWarning =
            "Status set to Delivered, but the customer and finance notification email could not be sent. Let them know another way.";
          console.error(
            `[project] staff-set-order-lifecycle delivered notify failed (shop=${shop} project=${projectId} job=${jobId}):`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }

    if (next === "ordered") {
      const numberResult = await ensureJobOrderNumberForShop(shop, jobId);
      if (!numberResult.ok) {
        console.error(
          "[project] staff-set-order-lifecycle order number assign failed:",
          jobId,
          numberResult.error,
        );
      }
    }

    notifyMissionControl(jobId);
    if (next === "paid") {
      settleBackupDraftOrderOnPaidBestEffort(shop, jobId);
    }
    return redirectToProject(request, projectId, shop, {
      ...(lifecycleNotifyWarning
        ? { notifyWarning: lifecycleNotifyWarning }
        : {}),
    });
  }

  if (intent === "reset-order-delivery") {
    if (!viewerCanFulfill) {
      throw new Response("Forbidden", { status: 403 });
    }
    const jobId = String(formData.get("jobId") || "");
    const job = await prisma.job.findFirst({
      where: { id: jobId, projectId },
      include: {
        deliveryPhases: { include: { lines: true }, orderBy: { sequence: "asc" } },
      },
    });
    if (!job) {
      throw new Response("Order not found", { status: 404 });
    }
    if (!jobHasFulfillmentProgress(job.deliveryPhases)) {
      return redirectToProject(request, projectId, shop);
    }
    await resetJobDeliveryPhasesProgress({ jobId, shop });
    if (
      job.orderLifecycleStatus === "delivered" ||
      job.orderLifecycleStatus === "paid"
    ) {
      await prisma.job.update({
        where: { id: jobId },
        data: {
          orderLifecycleStatus: "ordered",
          completedAt: null,
          paidAt: null,
        },
      });
      const numberResult = await ensureJobOrderNumberForShop(shop, jobId);
      if (!numberResult.ok) {
        console.error(
          "[project] reset-order-delivery order number assign failed:",
          jobId,
          numberResult.error,
        );
      }
    }
    notifyMissionControl(jobId);
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

    const purchaseOrderNumber = String(
      formData.get("purchaseOrderNumber") || "",
    ).trim();

    const created = await createEmptyJobOnProject({
      shop,
      projectId,
      customerId,
      name,
      purchaseOrderNumber,
    });

    if (created === "duplicate") {
      return Response.json(
        { jobError: "This order already exists." },
        { status: 400 },
      );
    }

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

    notifyMissionControlRemove(jobId, shop);

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
        const targetDefaults = await prisma.project.findFirst({
          where: { id: targetProjectId, shop: shopStringFilter(shop) },
          select: { defaultSiteContactName: true, defaultSiteContactPhone: true },
        });
        const copyJob = await prisma.job.create({
          data: {
            projectId: targetProjectId,
            name: `${job.name} (Copy)`,
            purchaseOrderNumber: job.purchaseOrderNumber ?? undefined,
            siteContactName:
              job.siteContactName?.trim() ||
              targetDefaults?.defaultSiteContactName ||
              null,
            siteContactPhone:
              job.siteContactPhone?.trim() ||
              targetDefaults?.defaultSiteContactPhone ||
              null,
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

  if (intent === "reorder-from-complete-line") {
    if (!canEdit) {
      throw new Response("Forbidden", { status: 403 });
    }

    const sourceItemId = String(formData.get("sourceItemId") || "").trim();
    const quantity = Math.floor(Number(formData.get("quantity")));
    const requestedOrderName = String(formData.get("orderName") || "").trim();
    const reorderTargetMode = String(
      formData.get("reorderTargetMode") || "same",
    ).trim();
    const reorderTargetProjectIdRaw = String(
      formData.get("reorderTargetProjectId") || "",
    ).trim();
    const reorderNewProjectName = String(
      formData.get("reorderNewProjectName") || "",
    ).trim();
    const reorderNewProjectNumber = String(
      formData.get("reorderNewProjectNumber") || "",
    ).trim();
    const reorderNewCompanyName = String(
      formData.get("reorderNewCompanyName") || "",
    ).trim();
    if (
      !sourceItemId ||
      !Number.isFinite(quantity) ||
      quantity < 1 ||
      quantity > 99_999
    ) {
      throw new Response("Invalid item or quantity.", { status: 400 });
    }

    const sourceItem = await prisma.jobItem.findFirst({
      where: { id: sourceItemId },
      include: { job: true },
    });

    if (!sourceItem || sourceItem.job.projectId !== projectId) {
      throw new Response("Item not found", { status: 404 });
    }

    if (!isReorderEligibleOrderLifecycle(sourceItem.job.orderLifecycleStatus)) {
      throw new Response(
        "Reorder is only available from delivered or paid orders.",
        { status: 403 },
      );
    }

    if (!String(sourceItem.variantId || "").trim()) {
      throw new Response("This line has no variant to reorder.", {
        status: 400,
      });
    }

    let targetProjectId = projectId;
    let targetProjectNameForEmail = project.name;
    if (reorderTargetMode === "existing") {
      if (!reorderTargetProjectIdRaw) {
        throw new Response("Select a destination project.", { status: 400 });
      }
      const targetProject = await prisma.project.findFirst({
        where: {
          id: reorderTargetProjectIdRaw,
          shop: shopStringFilter(shop),
        },
        include: { members: true },
      });
      if (!targetProject) {
        throw new Response("Destination project not found.", { status: 404 });
      }
      const canEditTarget = canEditProject(
        targetProject,
        customerId,
        viewerIsAppAdmin,
      );
      if (!canEditTarget) {
        throw new Response("Forbidden", { status: 403 });
      }
      targetProjectId = targetProject.id;
      targetProjectNameForEmail = targetProject.name;
    } else if (reorderTargetMode === "new") {
      if (!reorderNewProjectName) {
        throw new Response("New project name is required.", { status: 400 });
      }
      const createdProject = await prisma.project.create({
        data: {
          shop: shop.trim(),
          name: reorderNewProjectName,
          ownerCustomerId: project.ownerCustomerId,
          poNumber: reorderNewProjectNumber || undefined,
          companyName: reorderNewCompanyName || project.companyName || undefined,
          ownerCompanyKey: project.ownerCompanyKey ?? undefined,
          visibleToCompany: false,
          receiveMode: project.receiveMode ?? "pickup",
          defaultSiteContactName: project.defaultSiteContactName ?? undefined,
          defaultSiteContactPhone: project.defaultSiteContactPhone ?? undefined,
        },
      });
      targetProjectId = createdProject.id;
      targetProjectNameForEmail = createdProject.name;
    }

    const snap = parseOrderLineCapture(sourceItem.orderLineCapture);
    const vs = parseVariantSnapshot(sourceItem.variantSnapshot);
    const label =
      snap?.displayLabel?.trim() ||
      [vs?.productTitle, vs?.variantTitle].filter(Boolean).join(" — ") ||
      "Line";
    const short = label.replace(/\s+/g, " ").trim().slice(0, 56);
    const ordRef =
      sourceItem.job.orderNumber != null
        ? `#${sourceItem.job.orderNumber}`
        : "order";
    let baseName = requestedOrderName || `Reorder ${ordRef} — ${short}`;
    if (baseName.length > 180) {
      baseName = `${baseName.slice(0, 177)}…`;
    }

    const existingNames = await prisma.job.findMany({
      where: { projectId: targetProjectId },
      select: { name: true },
    });
    const taken = new Set(
      existingNames.map((j) => j.name.trim().toLowerCase()),
    );
    let name = baseName;
    let suffix = 2;
    while (taken.has(name.trim().toLowerCase())) {
      name = `${baseName} (${suffix})`;
      suffix += 1;
      if (suffix > 500) {
        throw new Response("Could not allocate a unique order name.", {
          status: 500,
        });
      }
    }

    const maxOrder = await prisma.job.aggregate({
      where: { projectId },
      _max: { sortOrder: true },
    });
    const nextSortOrder = (maxOrder._max.sortOrder ?? 0) + 1;

    const fulfillmentMethod: "pickup" | "delivery" =
      sourceItem.job.fulfillmentMethod === "delivery"
        ? "delivery"
        : "pickup";

    const { newJobId, newItemId } = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ nextval: bigint | number }>>`
        SELECT nextval('"Job_orderNumber_seq"') AS nextval
      `;
      const raw = rows[0]?.nextval;
      const parsed =
        typeof raw === "bigint" ? Number(raw) : Number(raw ?? Number.NaN);
      if (!Number.isFinite(parsed)) {
        throw new Error("Could not allocate order number.");
      }

      const newJob = await tx.job.create({
        data: {
          projectId: targetProjectId,
          name,
          sortOrder: nextSortOrder,
          orderLifecycleStatus: "ordered",
          orderNumber: parsed,
          fulfillmentMethod,
          siteContactName: sourceItem.job.siteContactName ?? null,
          siteContactPhone: sourceItem.job.siteContactPhone ?? null,
          purchaseOrderNumber: sourceItem.job.purchaseOrderNumber ?? undefined,
          // PO PDF is not copied to reorders in v1 (only the PO # text is carried over).
          isLocked: false,
        },
      });

      const newItem = await tx.jobItem.create({
        data: {
          jobId: newJob.id,
          variantId: sourceItem.variantId,
          quantity,
          priceSnapshot: sourceItem.priceSnapshot,
          sortOrder: 1,
          variantSnapshot: sourceItem.variantSnapshot ?? undefined,
          customData: sourceItem.customData ?? undefined,
          orderLineCapture: sourceItem.orderLineCapture ?? undefined,
          catalogProductId: sourceItem.catalogProductId ?? undefined,
          catalogSku: sourceItem.catalogSku ?? undefined,
        },
      });

      return { newJobId: newJob.id, newItemId: newItem.id };
    });

    try {
      await duplicateUploadPartMirrorsForCopiedJobItem({
        shop,
        oldItem: {
          id: sourceItem.id,
          customData: sourceItem.customData,
          uploadPartMirrorKeysJson: sourceItem.uploadPartMirrorKeysJson,
        },
        newJobItemId: newItemId,
      });
    } catch (mirrorErr) {
      console.error(
        "[project-clad] reorder upload-part mirror duplicate failed:",
        mirrorErr instanceof Error ? mirrorErr.message : mirrorErr,
      );
    }

    await logProjectActivity({
      projectId: targetProjectId,
      jobId: newJobId,
      type: "order_created",
      visibility: "member",
      actorCustomerId: customerId,
      payload: {
        jobName: name,
        reorderedFromJobName: sourceItem.job.name,
      },
    });

    const reorderNotifyEmail = await resolvePlacerNotifyEmail(
      shop,
      customerId,
      customerEmail,
    );
    await logProjectActivity({
      projectId: targetProjectId,
      jobId: newJobId,
      type: STOREFRONT_ORDER_CONFIRMED_ACTIVITY,
      visibility: "member",
      actorCustomerId: customerId,
      payload: reorderNotifyEmail ? { notifyEmail: reorderNotifyEmail } : undefined,
    }).catch((err: unknown) => {
      console.error(
        `[project] reorder order-confirmed activity log failed (project=${targetProjectId} job=${newJobId}):`,
        err instanceof Error ? err.message : err,
      );
    });

    notifyMissionControl(newJobId);

    await emailProjectStatusSnapshot({
      shop,
      projectId: targetProjectId,
      actorCustomerId: customerId,
      headline: "Reorder from completed order",
      introLines: [
        `New order "${name}" was created with ${quantity} unit(s), copied from completed order "${sourceItem.job.name}".`,
        targetProjectId === projectId
          ? "It is marked as ordered and appears in your project."
          : `It is marked as ordered and appears on project "${targetProjectNameForEmail}".`,
      ],
    });

    try {
      await createBackupDraftOrderForJob({
        shop,
        jobId: newJobId,
        deliveryFeeAmount:
          fulfillmentMethod === "delivery"
            ? await getShopDeliveryFee(shop)
            : 0,
      });
    } catch (err) {
      console.error("[project-clad] reorder backup draft failed:", err);
    }

    const [reorderMailTask] = await Promise.allSettled([
      (async (): Promise<string | null> => {
        try {
          const mail = await sendOrderPlacedEmails({
            shop,
            projectId: targetProjectId,
            jobId: newJobId,
            fulfillmentMethod,
            actorCustomerId: customerId,
          });
          return mail.customerFailed || mail.shopFailed
            ? REORDER_MAIL_WARNING
            : null;
        } catch (e) {
          console.error(
            `[project] reorder order-placed email failed (shop=${shop} project=${targetProjectId} job=${newJobId}):`,
            e instanceof Error ? e.message : e,
          );
          return REORDER_MAIL_WARNING;
        }
      })(),
      (async () => {
        try {
          await notifyOrderNowStaff({
            shop,
            projectId: targetProjectId,
            jobId: newJobId,
          });
        } catch (e) {
          console.error("[project] reorder staff push failed:", e);
        }
      })(),
    ]);

    if (targetProjectId !== projectId) {
      await emailProjectStatusSnapshot({
        shop,
        projectId,
        actorCustomerId: customerId,
        headline: "Reorder copied to another project",
        introLines: [
          `A reorder from completed order "${sourceItem.job.name}" was created on "${targetProjectNameForEmail}" as "${name}".`,
          "Open the project link below to review this source project.",
        ],
      });
    }

    const reorderEmailWarning =
      reorderMailTask.status === "fulfilled" ? reorderMailTask.value : null;
    return redirectToProject(request, targetProjectId, shop, {
      ...(reorderEmailWarning ? { notifyWarning: reorderEmailWarning } : {}),
    });
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
    if (!isProjectOwner(project, customerId)) {
      throw new Response("Forbidden", { status: 403 });
    }

    const role = String(formData.get("role") || "view");
    const inviteRole = role === "edit" ? "edit" : "view";
    const { shareLinkPath } = await upsertProjectShareInvite(projectId, inviteRole);

    return { shareLink: shareLinkPath };
  }

  if (intent === "add-member") {
    if (!canAdminMembers) {
      return Response.json(
        { memberError: "Only project admins can add members." },
        { status: 200 },
      );
    }

    const email = String(formData.get("email") || "").trim();
    /* Optional fast-path from the typeahead — we already know the Shopify customer id
       so we can skip the email lookup (saves a round-trip and works for customers whose
       email is partial/unknown to the requester). */
    const memberCustomerIdFromClient = String(
      formData.get("memberCustomerId") || "",
    ).trim();
    const role = String(formData.get("role") || "view");

    if (!email && !memberCustomerIdFromClient) {
      return Response.json(
        { memberError: "Email is required." },
        { status: 200 },
      );
    }

    let memberCustomerId: string | null = memberCustomerIdFromClient || null;
    if (!memberCustomerId) {
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

  if (intent === "transfer-project-owner") {
    const isOwner = isProjectOwner(project, customerId);
    if (!isOwner && !viewerIsAppAdmin) {
      return Response.json(
        { memberError: "Only the project owner can transfer ownership." },
        { status: 200 },
      );
    }
    const memberCustomerId = String(formData.get("memberCustomerId") || "").trim();
    if (!memberCustomerId) {
      return Response.json(
        { memberError: "Select a member to make owner." },
        { status: 200 },
      );
    }
    const { transferProjectOwner } = await import(
      "../utils/transferProjectOwner.server"
    );
    const result = await transferProjectOwner({
      shop,
      projectId,
      previousOwnerCustomerId: project.ownerCustomerId,
      newOwnerCustomerId: memberCustomerId,
    });
    if (!result.ok) {
      return Response.json({ memberError: result.error }, { status: 200 });
    }
    await logProjectActivity({
      projectId,
      actorCustomerId: customerId,
      type: "project_owner_transferred",
      visibility: "member",
      payload: {
        previousOwnerCustomerId: project.ownerCustomerId,
        newOwnerCustomerId: memberCustomerId,
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
    const defaultSiteContactName =
      String(formData.get("defaultSiteContactName") || "").trim() || null;
    const defaultSiteContactPhone =
      String(formData.get("defaultSiteContactPhone") || "").trim() || null;
    /* Checkbox presence pattern: the form posts a companion `visibleToCompanyRendered=1`
       hidden input whenever the toggle was on-screen. Without that flag we skip writing
       this column (older/legacy project pages without the toggle remain untouched). */
    const visibleToCompanyRendered =
      formData.get("visibleToCompanyRendered") === "1";
    const visibleToCompany = visibleToCompanyRendered
      ? formData.get("visibleToCompany") === "1"
      : undefined;

    if (!name) {
      return redirectToProject(request, projectId, shop, {
        projectEditError: "name",
      });
    }

    let ownerCompanyKeyToSet: string | undefined;
    if (visibleToCompanyRendered && visibleToCompany) {
      if (!project.ownerCompanyKey?.trim()) {
        const ownerCtx = await getViewerCompanyContext(shop, project.ownerCustomerId);
        const k = ownerCtx.keys[0];
        if (k) ownerCompanyKeyToSet = k;
      }
    }

    await prisma.project.update({
      where: { id: projectId },
      data: {
        name,
        poNumber,
        companyName,
        defaultSiteContactName,
        defaultSiteContactPhone,
        ...(visibleToCompany !== undefined ? { visibleToCompany } : {}),
        ...(ownerCompanyKeyToSet ? { ownerCompanyKey: ownerCompanyKeyToSet } : {}),
      },
    });

    /* Cascade project-level defaults into any blank job-level site contact fields.
       "Blank" = null OR empty string. Existing per-order overrides are preserved. */
    if (defaultSiteContactName) {
      await prisma.job.updateMany({
        where: {
          projectId,
          OR: [{ siteContactName: null }, { siteContactName: "" }],
        },
        data: { siteContactName: defaultSiteContactName },
      });
    }
    if (defaultSiteContactPhone) {
      await prisma.job.updateMany({
        where: {
          projectId,
          OR: [{ siteContactPhone: null }, { siteContactPhone: "" }],
        },
        data: { siteContactPhone: defaultSiteContactPhone },
      });
    }

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
    const ship = parseShipToFromFormData(formData);
    const receiveModeRaw = String(formData.get("projectReceiveMode") || "")
      .trim()
      .toLowerCase();
    let receiveMode: "pickup" | "delivery" =
      receiveModeRaw === "delivery" ? "delivery" : "pickup";

    if (receiveMode === "delivery" && !hasCompleteShipToDetails(ship)) {
      return redirectToProject(request, projectId, shop, {
        projectEditError: "address",
      });
    }

    await prisma.project.update({
      where: { id: projectId },
      data: {
        receiveMode,
        shipAddress1: receiveMode === "delivery" ? ship.shipAddress1 : null,
        shipAddress2: null,
        shipCity: receiveMode === "delivery" ? ship.shipCity : null,
        shipProvince: receiveMode === "delivery" ? ship.shipProvince : null,
        shipPostal: receiveMode === "delivery" ? ship.shipPostal : null,
        shipCountry: receiveMode === "delivery" ? ship.shipCountry : null,
      },
    });

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

  if (intent === "update-project-details-and-delivery") {
    if (!canEdit) {
      throw new Response("Forbidden", { status: 403 });
    }

    const name = String(formData.get("projectName") || "").trim();
    const poNumber = String(formData.get("poNumber") || "").trim() || null;
    const companyName = String(formData.get("companyName") || "").trim() || null;
    const defaultSiteContactName =
      String(formData.get("defaultSiteContactName") || "").trim() || null;
    const defaultSiteContactPhone =
      String(formData.get("defaultSiteContactPhone") || "").trim() || null;
    const visibleToCompanyRendered =
      formData.get("visibleToCompanyRendered") === "1";
    const visibleToCompany = visibleToCompanyRendered
      ? formData.get("visibleToCompany") === "1"
      : undefined;

    const ship = parseShipToFromFormData(formData);
    const receiveModeRaw = String(formData.get("projectReceiveMode") || "")
      .trim()
      .toLowerCase();
    const receiveMode: "pickup" | "delivery" =
      receiveModeRaw === "delivery" ? "delivery" : "pickup";

    /* Both of these used to redirect exactly like a successful save, so the page reloaded
       with nothing changed and no explanation. */
    if (!name) {
      return redirectToProject(request, projectId, shop, {
        projectEditError: "name",
      });
    }

    if (receiveMode === "delivery" && !hasCompleteShipToDetails(ship)) {
      return redirectToProject(request, projectId, shop, {
        projectEditError: "address",
      });
    }

    let ownerCompanyKeyToSet: string | undefined;
    if (visibleToCompanyRendered && visibleToCompany) {
      if (!project.ownerCompanyKey?.trim()) {
        const ownerCtx = await getViewerCompanyContext(shop, project.ownerCustomerId);
        const k = ownerCtx.keys[0];
        if (k) ownerCompanyKeyToSet = k;
      }
    }

    const deliveryData =
      receiveMode === "delivery"
        ? {
            receiveMode: "delivery" as const,
            shipAddress1: ship.shipAddress1,
            shipAddress2: null,
            shipCity: ship.shipCity,
            shipProvince: ship.shipProvince,
            shipPostal: ship.shipPostal,
            shipCountry: ship.shipCountry,
          }
        : {
            receiveMode: "pickup" as const,
            shipAddress1: ship.shipAddress1,
            shipAddress2: null,
            shipCity: ship.shipCity,
            shipProvince: ship.shipProvince,
            shipPostal: ship.shipPostal,
            shipCountry: ship.shipCountry || null,
          };

    await prisma.project.update({
      where: { id: projectId },
      data: {
        name,
        poNumber,
        companyName,
        defaultSiteContactName,
        defaultSiteContactPhone,
        ...(visibleToCompany !== undefined ? { visibleToCompany } : {}),
        ...(ownerCompanyKeyToSet ? { ownerCompanyKey: ownerCompanyKeyToSet } : {}),
        ...deliveryData,
      },
    });

    if (defaultSiteContactName) {
      await prisma.job.updateMany({
        where: {
          projectId,
          OR: [{ siteContactName: null }, { siteContactName: "" }],
        },
        data: { siteContactName: defaultSiteContactName },
      });
    }
    if (defaultSiteContactPhone) {
      await prisma.job.updateMany({
        where: {
          projectId,
          OR: [{ siteContactPhone: null }, { siteContactPhone: "" }],
        },
        data: { siteContactPhone: defaultSiteContactPhone },
      });
    }

    const newOrderJobName = String(formData.get("newOrderJobName") || "").trim();
    if (newOrderJobName) {
      const newOrderPurchaseOrderNumber = String(
        formData.get("newOrderPurchaseOrderNumber") || "",
      ).trim();
      const newOrderDeliveryMode = normalizeJobDeliveryMode(
        String(formData.get("newOrderDeliveryMode") || "inherit"),
      );
      const newJobResult = await createEmptyJobOnProject({
        shop,
        projectId,
        customerId,
        name: newOrderJobName,
        purchaseOrderNumber: newOrderPurchaseOrderNumber,
        deliveryMode: newOrderDeliveryMode,
        ship: parseShipToFromFormData(formData),
      });
      if (newJobResult === "duplicate") {
        await emailProjectStatusSnapshot({
          shop,
          projectId,
          actorCustomerId: customerId,
          headline: "Project settings updated",
          introLines: [
            "Project details and/or delivery settings were changed on the project page.",
            "Open the project link below to review the updated information.",
          ],
        });
        return redirectToProject(request, projectId, shop, {
          pcNewOrderError: "duplicate",
        });
      }
    }

    await emailProjectStatusSnapshot({
      shop,
      projectId,
      actorCustomerId: customerId,
      headline: "Project settings updated",
      introLines: [
        "Project details and/or delivery settings were changed on the project page.",
        "Open the project link below to review the updated information.",
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

function storefrontBrowseLinksFromNav(
  links: readonly { label: string; url: string }[],
): { shopUrl: string; customPartUrl: string } {
  const shopFallback = "/collections/main-products";
  const customFallback = "/pages/custompart";
  const upper = (s: string) => s.toUpperCase();
  let shopUrl = shopFallback;
  let customPartUrl = customFallback;
  const shopHit = links.find(
    (l) =>
      upper(l.label).includes("SHOP") || /\/collections\//i.test(l.url.trim()),
  );
  const customHit = links.find(
    (l) =>
      upper(l.label).includes("CUSTOM") ||
      /custompart|custom-part|pages\/custom/i.test(l.url.trim()),
  );
  if (shopHit?.url.trim()) shopUrl = shopHit.url.trim();
  if (customHit?.url.trim()) customPartUrl = customHit.url.trim();
  return { shopUrl, customPartUrl };
}

export default function ProjectDetailPage() {
  const {
    proxyStylesHref,
    proxyScriptSrcs,
    proxyScriptConfig,
    project,
    otherProjects,
    canViewPricing,
    canEdit,
    canEditLineUnitPrices,
    canExportOrderCsv,
    isOwner,
    canAdminMembers,
    hideAddToCart,
    viaCompany,
    viaCompanyLabel,
    approvalRequests,
    projectTimeline,
    viewerIsAdmin,
    memberLookupError,
    variantLookupError,
    shop,
    storefrontAppNav,
    logoUrl,
    backgroundLogoUrl,
    themeStyles,
    viewerCanFulfill,
    viewerHasNATag,
    shopDeliveryFee,
    navAccountInitial,
    navAccountFirstName,
    ownerCompanyForShare,
    projectFormActionUrl,
    preferredDeliveryDateMinYmd,
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

  const projectDeliveryCtx = {
    receiveMode: project.receiveMode,
    shipAddress1: project.shipAddress1,
    shipCity: project.shipCity,
    shipProvince: project.shipProvince,
    shipPostal: project.shipPostal,
    shipCountry: project.shipCountry,
  };

  const feeForJob = (job: JobView) => {
    const resolved = resolveJobDelivery(job, projectDeliveryCtx, shopDeliveryFee);
    if (resolved.method !== "delivery") return 0;
    return totalDeliveryFeesFromPhases(
      job.deliveryPhases,
      resolved,
      shopDeliveryFee,
    );
  };

  const [orderNowSubmittingJobId, setOrderNowSubmittingJobId] = useState<
    string | null
  >(null);

  const actionData = useActionData<typeof action>();

  const pricingUnlocked =
    canViewPricing ||
    (actionData &&
      typeof actionData === "object" &&
      "pricingUnlocked" in actionData &&
      Boolean(actionData.pricingUnlocked));
  const memberError =
    actionData && typeof actionData === "object" && "memberError" in actionData
      ? (actionData.memberError as string)
      : null;
  const location = useLocation();
  const projectsListHref = useMemo(() => {
    const q = new URLSearchParams(location.search);
    [
      "id",
      "job",
      "sort",
      "signature",
      "shop",
      "path_prefix",
      "timestamp",
      "logged_in_customer_id",
      "logged_in_customer_email",
    ].forEach((key) => q.delete(key));
    const s = q.toString();
    return `/apps/project-clad/projects${s ? `?${s}` : ""}`;
  }, [location.search]);

  const browseHref = useMemo(
    () => storefrontBrowseLinksFromNav(storefrontAppNav.links),
    [storefrontAppNav.links],
  );

  const projectCommentTimeline = useMemo(
    () =>
      projectTimeline.filter(
        (i): i is Extract<ProjectTimelineItem, { kind: "comment" }> =>
          i.kind === "comment",
      ),
    [projectTimeline],
  );
  const projectActivityTimeline = useMemo(
    () =>
      projectTimeline.filter(
        (i): i is Extract<ProjectTimelineItem, { kind: "activity" }> =>
          i.kind === "activity",
      ),
    [projectTimeline],
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedJobId = searchParams.get("job");
  const orderListSearchQ = (searchParams.get("q") || "").trim();

  /* Initial sort = "recent" (newest first). The interactive sort lives in an
     inline <script> at the bottom of the page render that reorders the DOM
     directly — see `data-pc-orders-sort` + the comments next to the script.
     Reason: this route is served via the Shopify app proxy where React does
     not hydrate, so `useState` cannot drive the order of cards. The same
     pattern is used for the line-image lightbox and every other interactive
     control on this page. */
  const visibleJobs = useMemo(() => {
    const filtered = orderListSearchQ
      ? project.jobs.filter((job) =>
          jobMatchesOrderSearch(job, orderListSearchQ),
        )
      : project.jobs;
    return sortFilteredJobs(filtered, "recent");
  }, [project.jobs, orderListSearchQ]);

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

  const projectOrderDeliveryFeesTotal = project.jobs.reduce((sum, job) => {
    if (!jobCountsTowardProjectSubtotal(job.orderLifecycleStatus)) {
      return sum;
    }
    return sum + feeForJob(job);
  }, 0);
  /** Line items plus all per-order delivery fees (matches order payment summaries). */
  const projectSubtotalForDisplay =
    project.subtotal + projectOrderDeliveryFeesTotal;
  const projectTaxableForDisplay = projectSubtotalForDisplay;
  const projectDisplayTax = orderTaxFromSubtotal(projectTaxableForDisplay, {
    pricesIncludeTax: false,
  });
  const projectTotalWithDisplayTax = orderTotalWithTax(projectTaxableForDisplay, {
    pricesIncludeTax: false,
  });

  const isOrderAwaitingApproval = (jobId: string) => {
    if (hasProjectLevelApprovalPending) return true;
    if (getApprovalStatus(jobId, "") === "awaiting") return true;
    return project.jobs.some(
      (j) => j.id === jobId && j.orderLifecycleStatus === "pending_review",
    );
  };

  /**
   * Customer-facing order lifecycle control (middle slot in Save / lifecycle / Edit).
   */
  const renderOrderLifecycleActionCard = (job: JobView): OrderActionSpec => {
    const ls = job.orderLifecycleStatus;
    const approval = getApprovalStatus(job.id, "");
    const viewerUsesNAReviewFlow = viewerHasNATag === true;
    const skipReviewOrderFlow = !viewerUsesNAReviewFlow || viewerIsAdmin;
    if (ls === "paid") {
      return {
        key: "lifecycle",
        kind: "status",
        icon: PC_CHECK_ICON,
        label: "Paid",
        description: "Paid in full.",
        tone: "go",
      };
    }
    if (ls === "delivered") {
      return {
        key: "lifecycle",
        kind: "status",
        icon: PC_CHECK_ICON,
        label: "Delivered",
        description: "Awaiting payment.",
        tone: "go",
      };
    }
    if (ls === "ordered") {
      return {
        key: "lifecycle",
        kind: "status",
        icon: PC_PACKAGE_ICON,
        label: "Ordered",
        description: "Awaiting fulfillment.",
        tone: "go",
      };
    }
    if (
      (ls === "ready_to_order" &&
        (approval === "approved" || skipReviewOrderFlow)) ||
      (ls === "draft" && skipReviewOrderFlow)
    ) {
      const hasSiteContact = Boolean(
        job.siteContactName?.trim() && job.siteContactPhone?.trim(),
      );
      // PO is OPTIONAL — only Site Contact gates Order now.
      const canPlaceOrder = hasSiteContact;
      const isSubmitting = orderNowSubmittingJobId === job.id;
      const missingCopy = !hasSiteContact
        ? "Add site contact & phone first."
        : null;
      const resolvedOnow = resolveJobDelivery(job, projectDeliveryCtx);
      const deliveryHint =
        resolvedOnow.method === "pickup"
          ? "Store pickup · no delivery fee."
          : `Delivery · $${shopDeliveryFee.toFixed(2)} fee per phase.`;
      const description =
        missingCopy ?? (canPlaceOrder ? deliveryHint : "Place order; invoice emailed.");
      return {
        key: "lifecycle",
        kind: "button",
        icon: PC_ORDER_NOW_ICON,
        label: isSubmitting ? "Placing…" : "Order now",
        description,
        tone: "go",
        buttonProps: {
          "data-projectclad-order-now-submit": "",
          "data-job-id": job.id,
          "data-has-delivery": resolvedOnow.method === "delivery" ? "1" : "0",
          "data-has-site-contact": hasSiteContact ? "1" : "0",
          disabled: !canPlaceOrder || isSubmitting,
          "aria-busy": isSubmitting ? "true" : undefined,
          title: !canPlaceOrder
            ? missingCopy ?? undefined
            : isSubmitting
              ? "Placing order…"
              : "Confirm & Pay",
          "aria-label": isSubmitting ? "Placing order" : "Confirm and pay",
        },
      };
    }
    if (
      viewerUsesNAReviewFlow &&
      ls !== "ready_to_order" &&
      ls !== "ordered" &&
      ls !== "delivered" &&
      ls !== "paid"
    ) {
      const awaiting = approval === "awaiting";
      const intent = awaiting
        ? "cancel-approval-request"
        : "submit-for-approval";
      return {
        key: "lifecycle",
        kind: "ajaxForm",
        icon: awaiting ? PC_HOURGLASS_ICON : PC_SEND_ICON,
        label: awaiting ? "Confirming" : "Send for review",
        description: awaiting
          ? "Awaiting admin approval."
          : "Send for admin review.",
        tone: "go",
        intent,
        jobId: job.id,
        awaiting,
      };
    }
    return {
      key: "lifecycle",
      kind: "status",
      icon: PC_HOURGLASS_ICON,
      label: orderLifecycleLabel(ls),
      description: "No action available.",
    };
  };

  /** Compact status chip shown in the order tile's top-right summary header. */
  const renderOrderLifecycleHeaderAction = (job: JobView) => {
    const ls = job.orderLifecycleStatus;
    if (ls === "ordered") {
      const pct = job.deliveredPercent ?? 0;
      if (pct > 0 && pct < 100) {
        return (
          <span className="project-clad-order-lifecycle-chip project-clad-order-lifecycle-chip--partial">
            {pct}% Delivered
          </span>
        );
      }
      return (
        <span className="project-clad-order-lifecycle-chip project-clad-order-lifecycle-chip--complete">
          Ordered
        </span>
      );
    }
    if (ls === "delivered") {
      return (
        <span className="project-clad-order-lifecycle-chip project-clad-order-lifecycle-chip--complete">
          Delivered
        </span>
      );
    }
    if (ls === "paid") {
      return (
        <span className="project-clad-order-lifecycle-chip project-clad-order-lifecycle-chip--complete">
          Order Complete
        </span>
      );
    }
    if (isPrePlacedOrderLifecycle(ls)) {
      const label = prePlacedOrderHeaderChipLabel(ls);
      if (!label) return null;
      const chipClass =
        ls === "ready_to_order"
          ? "project-clad-order-lifecycle-chip project-clad-order-lifecycle-chip--ready"
          : "project-clad-order-lifecycle-chip project-clad-order-lifecycle-chip--quote";
      return <span className={chipClass}>{label}</span>;
    }
    return null;
  };

  useEffect(() => {
    if (!actionData || typeof actionData !== "object") return;
    if ("pricingUnlocked" in actionData && actionData.pricingUnlocked) {
      document.cookie = createPricingCookie();
    }
  }, [actionData]);

  /**
   * Order now lives in <summary>; use capture on document + stopImmediatePropagation so the
   * browser still delivers the interaction, then confirm() and POST confirm-order-now (→ ordered).
   * Handler is gated to `[data-projectclad-order-now-submit]` only — it never intercepts other
   * orders UI (sort, create order, lightbox, etc.).
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
          'Please ensure delivery details are correct. Use Delivery options on this order or Edit project for defaults before placing.',
        )
      ) {
        return;
      }
      const hasDelivery = btn.getAttribute("data-has-delivery") === "1";
      const fulfillmentMethod = hasDelivery ? "delivery" : "pickup";
      const detailsEl = document.querySelector(
        'details.project-clad-order-row[data-job-id="' +
          jobId.replace(/"/g, "") +
          '"]',
      );
      const nameInput = detailsEl?.querySelector?.(
        "[data-projectclad-site-contact-name-input]",
      );
      const phoneInput = detailsEl?.querySelector?.(
        "[data-projectclad-site-contact-phone-input]",
      );
      const siteContactName =
        nameInput instanceof HTMLInputElement ? nameInput.value.trim() : "";
      const siteContactPhone =
        phoneInput instanceof HTMLInputElement ? phoneInput.value.trim() : "";
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
              siteContactName,
              siteContactPhone,
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
    return () => {
      document.removeEventListener("click", onCaptureClick, true);
    };
  }, [location.pathname, location.search]);

  const inlineStyles = themeStyles?.styles || [];
  const utilityAddMemberControl = canAdminMembers ? (
    <span className="project-clad-utility-add-member">
      <button
        type="button"
        className="cc-app-header__topbar-button project-clad-storefront-nav__icon-btn--add-member"
        data-projectclad-add-member-popover-toggle
        aria-expanded="false"
        aria-controls="projectclad-add-member-utility-popover"
      >
        Add member
      </button>
      <div
        id="projectclad-add-member-utility-popover"
        className="project-clad-add-member-popover project-clad-add-member-popover--utility"
        data-projectclad-add-member-popover
        aria-hidden="true"
      >
        <Form
          id="projectclad-add-member-utility-form"
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
          <input type="hidden" name="memberCustomerId" defaultValue="" />
          <label htmlFor="member-email-utility">Add member</label>
          <div
            className="project-clad-member-typeahead"
            data-projectclad-member-typeahead
          >
            <input
              id="member-email-utility"
              name="email"
              type="email"
              placeholder="Name or email"
              required
              autoComplete="off"
              className="project-clad-flat-input"
              data-projectclad-member-typeahead-input
            />
            <ul
              className="project-clad-member-typeahead__list"
              role="listbox"
              hidden
              data-projectclad-member-typeahead-list
            />
          </div>
          <label htmlFor="member-role-utility-role-edit">Role</label>
          <MemberRoleSelect
            idPrefix="member-role-utility"
            defaultValue="edit"
            rolePrompt="Select role"
          />
          <button
            type="submit"
            className="project-clad-button project-clad-reject-modal-btn"
          >
            Add member
          </button>
          <span
            className="project-clad-muted"
            data-projectclad-form-message
            role="status"
            aria-live="polite"
          />
        </Form>
      </div>
    </span>
  ) : null;

  return (
    <>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Onest:wght@300;400;500;600;700&display=swap"
      />
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
          <div className="project-clad-modal__header-row">
            <h2 id="reject-modal-title">Reject order</h2>
            <button
              type="button"
              className="project-clad-modal-close"
              data-projectclad-reject-cancel
              aria-label="Close"
            >
              ×
            </button>
          </div>
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
          <div className="project-clad-modal__header-row">
            <h2 id="pricing-modal-title">Show price</h2>
            <button
              type="button"
              className="project-clad-modal-close"
              data-projectclad-pricing-modal-cancel
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <Form
            method="post"
            action="#"
            className="project-clad-inline-form project-clad-pricing-form"
            data-projectclad-ajax
            data-projectclad-intent="unlock-pricing"
            data-projectclad-project-id={project.id}
          >
            <input type="hidden" name="intent" value="unlock-pricing" />
            <label
              className="project-clad-sr-only"
              htmlFor="projectclad-pricing-password"
            >
              Password to view price
            </label>
            <input
              id="projectclad-pricing-password"
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
        data-projectclad-reorder-modal
        role="dialog"
        aria-modal="true"
        aria-labelledby="reorder-modal-title"
        style={{ display: "none" }}
      >
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- modal card: stop mousedown so backdrop logic ignores inner surface */}
        <div
          className="project-clad-card project-clad-modal project-clad-reject-modal"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="project-clad-modal__header-row">
            <h2 id="reorder-modal-title" data-projectclad-reorder-modal-title>
              Reorder
            </h2>
            <button
              type="button"
              className="project-clad-modal-close"
              data-projectclad-reorder-cancel
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <p className="project-clad-muted">
            Choose quantity, destination, and order name. A new order will be created and marked{" "}
            <strong>ordered</strong>, using the same product, price, and line
            details as this completed line.
          </p>
          <Form
            method="post"
            action={`${storefrontProjectActionPath}?id=${encodeURIComponent(project.id)}`}
            className="project-clad-reject-form"
          >
            <input type="hidden" name="id" value={project.id} />
            <input type="hidden" name="intent" value="reorder-from-complete-line" />
            <input
              type="hidden"
              name="sourceItemId"
              id="projectclad-reorder-source-item-id"
              defaultValue=""
            />
            <label htmlFor="projectclad-reorder-order-name">Order name</label>
            <input
              id="projectclad-reorder-order-name"
              name="orderName"
              type="text"
              defaultValue=""
              className="project-clad-pricing-password-input"
              placeholder="Optional"
            />
            <label htmlFor="projectclad-reorder-qty">Quantity</label>
            <input
              id="projectclad-reorder-qty"
              name="quantity"
              type="number"
              min={1}
              max={99999}
              step={1}
              required
              defaultValue={1}
              className="project-clad-pricing-password-input"
              inputMode="numeric"
              aria-label="Quantity for reorder"
            />
            <fieldset className="project-clad-fieldset">
              <legend>Save to</legend>
              <label>
                <input
                  type="radio"
                  name="reorderTargetMode"
                  value="same"
                  defaultChecked
                  data-projectclad-reorder-target-mode
                />{" "}
                This project
              </label>
              <label>
                <input
                  type="radio"
                  name="reorderTargetMode"
                  value="existing"
                  data-projectclad-reorder-target-mode
                  disabled={otherProjects.length === 0}
                />{" "}
                Existing project
              </label>
              <label>
                <input
                  type="radio"
                  name="reorderTargetMode"
                  value="new"
                  data-projectclad-reorder-target-mode
                />{" "}
                New project
              </label>
            </fieldset>
            <div data-projectclad-reorder-existing-wrap style={{ display: "none" }}>
              <label htmlFor="projectclad-reorder-target-project">Choose project</label>
              <select
                id="projectclad-reorder-target-project"
                name="reorderTargetProjectId"
                className="project-clad-pricing-password-input"
                defaultValue={otherProjects[0]?.id || ""}
              >
                {otherProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div data-projectclad-reorder-new-wrap style={{ display: "none" }}>
              <label htmlFor="projectclad-reorder-new-project-name">New project name</label>
              <input
                id="projectclad-reorder-new-project-name"
                name="reorderNewProjectName"
                type="text"
                className="project-clad-pricing-password-input"
                placeholder="Required for new project"
              />
              <label htmlFor="projectclad-reorder-new-project-number">Project # (optional)</label>
              <input
                id="projectclad-reorder-new-project-number"
                name="reorderNewProjectNumber"
                type="text"
                className="project-clad-pricing-password-input"
                placeholder="Optional"
              />
              <label htmlFor="projectclad-reorder-new-company-name">Company name (optional)</label>
              <input
                id="projectclad-reorder-new-company-name"
                name="reorderNewCompanyName"
                type="text"
                className="project-clad-pricing-password-input"
                placeholder="Optional"
              />
            </div>
            <div className="project-clad-actions project-clad-reject-modal-actions">
              <button type="submit" className="project-clad-button project-clad-reject-modal-btn">
                Reorder
              </button>
              <button
                type="button"
                className="project-clad-button project-clad-reject-modal-btn"
                data-projectclad-reorder-cancel
              >
                Cancel
              </button>
            </div>
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
          className="project-clad-card project-clad-modal project-clad-reject-modal project-clad-edit-project-modal__card"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="project-clad-edit-project-modal__header">
            <h2 id="edit-project-modal-title">Edit project</h2>
            <button
              type="button"
              className="project-clad-modal-close"
              data-projectclad-edit-project-close
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="project-clad-edit-project-modal__layout">
            <form
              id="projectclad-edit-project-main-form"
              method="post"
              action={`/apps/project-clad/project?id=${encodeURIComponent(project.id)}`}
              data-projectclad-edit-project-main-form
              data-projectclad-project-id={project.id}
              className="project-clad-inline-form project-clad-pricing-form project-clad-edit-project-modal__main-form"
            >
              <input
                type="hidden"
                name="intent"
                value="update-project-details-and-delivery"
              />

              <div className="project-clad-edit-modal__section project-clad-edit-project-modal__cell-details">
                <p className="project-clad-edit-project-modal__panel-label">
                  Project details
                </p>
              <div className="project-clad-form-grid">
                <div className="project-clad-form-grid__cell">
                  <label htmlFor="edit-project-name">Name</label>
                  <input
                    id="edit-project-name"
                    name="projectName"
                    type="text"
                    defaultValue={project.name}
                    required
                    className="project-clad-pricing-password-input"
                  />
                </div>
                <div className="project-clad-form-grid__cell">
                  <label htmlFor="edit-project-po">Project #</label>
                  <input
                    id="edit-project-po"
                    name="poNumber"
                    type="text"
                    defaultValue={project.poNumber || ""}
                    placeholder="Optional"
                    className="project-clad-pricing-password-input"
                  />
                </div>
              </div>

              <label htmlFor="edit-project-company">Company</label>
              <input
                id="edit-project-company"
                name="companyName"
                type="text"
                defaultValue={project.companyName || ""}
                placeholder="Optional"
                className="project-clad-pricing-password-input"
              />

              {(project.ownerCompanyKey || ownerCompanyForShare.hasB2bCompany) && (
                <>
                  <input
                    type="hidden"
                    name="visibleToCompanyRendered"
                    value="1"
                  />
                  {(() => {
                    /* Prefer the human-typed company name on the project; fall back to
                       a humanized version of the normalized ownerCompanyKey so the
                       toggle still reads naturally if the field is blank. */
                    const companyDisplay =
                      (project.companyName && project.companyName.trim()) ||
                      (project.ownerCompanyKey
                        ? project.ownerCompanyKey
                            .split(/[-_\s]+/)
                            .filter(Boolean)
                            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                            .join(" ")
                        : (ownerCompanyForShare.displayName &&
                            ownerCompanyForShare.displayName.trim()) ||
                          (ownerCompanyForShare.firstKey
                            ? ownerCompanyForShare.firstKey
                                .split(/[-_\s]+/)
                                .filter(Boolean)
                                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                                .join(" ")
                            : "my company"));
                    return (
                      <label
                        className="project-clad-inline-checkbox project-clad-share-toggle"
                        title="When on, anyone at this company can view (read-only) this project. Editing still requires being added as a member."
                      >
                        <input
                          type="checkbox"
                          name="visibleToCompany"
                          value="1"
                          defaultChecked={project.visibleToCompany}
                        />
                        <span className="project-clad-share-toggle__text">
                          Visible to others at{" "}
                          <strong>{companyDisplay}</strong>
                        </span>
                      </label>
                    );
                  })()}
                </>
              )}

              <div className="project-clad-form-grid">
                <div className="project-clad-form-grid__cell">
                  <label htmlFor="edit-project-default-contact-name">
                    Site contact
                  </label>
                  <input
                    id="edit-project-default-contact-name"
                    name="defaultSiteContactName"
                    type="text"
                    defaultValue={project.defaultSiteContactName || ""}
                    placeholder="Name (optional)"
                    className="project-clad-pricing-password-input"
                    autoComplete="name"
                  />
                </div>
                <div className="project-clad-form-grid__cell">
                  <label htmlFor="edit-project-default-contact-phone">
                    Site phone
                  </label>
                  <input
                    id="edit-project-default-contact-phone"
                    name="defaultSiteContactPhone"
                    type="tel"
                    inputMode="tel"
                    defaultValue={project.defaultSiteContactPhone || ""}
                    placeholder="Phone (optional)"
                    className="project-clad-pricing-password-input"
                    autoComplete="tel"
                  />
                </div>
              </div>

              </div>

              <div className="project-clad-edit-modal__section project-clad-edit-project-modal__cell-delivery">
                <p className="project-clad-edit-project-modal__panel-label">
                  Default delivery (project)
                </p>
                <ProjectReceiveModeRadios
                  name="projectReceiveMode"
                  defaultMode={project.receiveMode}
                />
                <div
                  data-projectclad-edit-project-delivery-address
                  className="project-clad-delivery-address-panel"
                  hidden
                >
                  <EditProjectDeliveryAddressFields
                    shipAddress1={project.shipAddress1}
                    shipCity={project.shipCity}
                    shipProvince={project.shipProvince}
                    shipPostal={project.shipPostal}
                  />
                </div>
              </div>

              {canEdit ? (
                <div className="project-clad-edit-modal__section project-clad-edit-project-modal__cell-new-order">
                  <p className="project-clad-edit-project-modal__panel-label">New order</p>
                  {/*
                    Create order: GET /apps/project-clad/api/project-actions?intent=create-job&jobName&purchaseOrderNumber
                    (same API as other data-projectclad-ajax forms). Save changes still POSTs newOrderJobName on the
                    main form to batch-create with update-project-details-and-delivery — both paths are intentional.
                  */}
                  <JobDeliveryModeRadios
                    name="newOrderDeliveryMode"
                    defaultMode="inherit"
                  />
                  <div
                    className="project-clad-edit-project-modal__new-order-address"
                    data-projectclad-new-order-delivery-address
                    hidden
                  >
                    <JobDeliveryAddressFields
                      idPrefix="edit-new-order"
                      shipAddress1={null}
                      shipCity={null}
                      shipProvince={null}
                      shipPostal={null}
                    />
                  </div>
                  <div className="project-clad-edit-project-modal__new-order-fields">
                    <div className="project-clad-edit-project-modal__new-order-field">
                      <label htmlFor="edit-project-new-order-name">Order name</label>
                      <input
                        id="edit-project-new-order-name"
                        name="newOrderJobName"
                        type="text"
                        placeholder="e.g. Front elevation, Phase 2…"
                        autoComplete="off"
                        className="project-clad-pricing-password-input"
                      />
                    </div>
                    <div className="project-clad-edit-project-modal__new-order-field">
                      <label htmlFor="edit-project-new-order-po">
                        Purchase order #{" "}
                        <span className="project-clad-muted">(optional)</span>
                      </label>
                      <input
                        id="edit-project-new-order-po"
                        name="newOrderPurchaseOrderNumber"
                        type="text"
                        placeholder="e.g. customer PO or internal ref"
                        autoComplete="off"
                        className="project-clad-pricing-password-input"
                      />
                    </div>
                  </div>
                  <div className="project-clad-edit-project-modal__new-order-actions">
                    <div className="project-clad-edit-project-modal__footer-actions">
                      <button
                        type="button"
                        className="project-clad-button project-clad-reject-modal-btn project-clad-edit-project-modal__btn-primary"
                        data-projectclad-edit-project-create-order
                      >
                        Create order
                      </button>
                      <button
                        type="button"
                        className="project-clad-button project-clad-reject-modal-btn project-clad-edit-project-modal__btn-secondary"
                        data-projectclad-edit-project-new-order-clear
                      >
                        Clear
                      </button>
                    </div>
                    <span
                      className="project-clad-muted project-clad-approval-msg project-clad-edit-project-modal__new-order-message"
                      data-projectclad-edit-project-new-order-message
                      role="status"
                      aria-live="polite"
                    />
                  </div>
                </div>
              ) : null}

              <div className="project-clad-edit-project-modal__cell-footer project-clad-edit-project-modal__footer-bar">
                <div className="project-clad-edit-project-modal__footer-actions">
                  <button
                    type="button"
                    className="project-clad-button project-clad-reject-modal-btn project-clad-edit-project-modal__btn-secondary"
                    data-projectclad-edit-project-cancel
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="project-clad-button project-clad-reject-modal-btn project-clad-edit-project-modal__btn-primary"
                  >
                    Save changes
                  </button>
                </div>
              </div>
            </form>

            <section className="project-clad-edit-modal__section project-clad-edit-project-modal__cell-members">
              <p className="project-clad-edit-project-modal__panel-label">
                Members
              </p>
              {isOwner || viewerIsAdmin ? (
                <p className="project-clad-muted" style={{ margin: "0 0 0.5rem" }}>
                  Use <strong>Make owner</strong> to transfer this project to an
                  existing member. You will remain on the project as an editor.
                </p>
              ) : null}
              {memberLookupError ? (
                <p className="project-clad-muted" style={{ margin: 0 }}>
                  {memberLookupError}
                </p>
              ) : null}
              {!memberLookupError && project.members.length === 0 ? (
                <p className="project-clad-muted" style={{ margin: 0 }}>
                  No members on this project.
                </p>
              ) : !memberLookupError ? (
                <ul className="project-clad-member-list">
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
                    const isOwnerMember = member.role === "owner";
                    const canTransferOwner = isOwner || viewerIsAdmin;
                    const memberLabel = fullName || member.email || "member";
                    return (
                      <li
                        key={member.customerId}
                        className="project-clad-member-row"
                      >
                        <div className="project-clad-member-row__main">
                          <span className="project-clad-member-row__name">
                            {fullName || member.email || "—"}
                          </span>
                          {member.email && fullName && (
                            <span className="project-clad-member-row__email">
                              {member.email}
                            </span>
                          )}
                        </div>
                        <span
                          className={`project-clad-member-row__role${isOwnerMember ? " project-clad-member-row__role--owner" : ""}`}
                        >
                          {roleLabel}
                        </span>
                        {(canAdminMembers || canTransferOwner) && (
                          <div className="project-clad-member-row__actions">
                            {canTransferOwner && !isOwnerMember ? (
                              <Form
                                method="post"
                                action={`https://${shop}/apps/project-clad/project?id=${project.id}`}
                                data-projectclad-confirm={`Make ${memberLabel} the project owner? You will stay on the project as an editor.`}
                                data-projectclad-member-form
                                data-projectclad-member-intent="transfer-project-owner"
                                data-projectclad-project-id={project.id}
                                data-projectclad-member-id={member.customerId}
                                data-projectclad-ajax
                                data-projectclad-intent="transfer-project-owner"
                                style={{ margin: 0 }}
                              >
                                <input
                                  type="hidden"
                                  name="intent"
                                  value="transfer-project-owner"
                                />
                                <input
                                  type="hidden"
                                  name="memberCustomerId"
                                  value={member.customerId}
                                />
                                <button
                                  type="submit"
                                  className="project-clad-button project-clad-reject-modal-btn"
                                  aria-label={`Make ${memberLabel} project owner`}
                                >
                                  Make owner
                                </button>
                              </Form>
                            ) : null}
                            {canAdminMembers && !isOwnerMember ? (
                              <Form
                                method="post"
                                action={`https://${shop}/apps/project-clad/project?id=${project.id}`}
                                data-projectclad-confirm="Remove this member?"
                                data-projectclad-member-form
                                data-projectclad-member-intent="remove-member"
                                data-projectclad-project-id={project.id}
                                data-projectclad-member-id={member.customerId}
                                data-projectclad-ajax
                                data-projectclad-intent="remove-member"
                                style={{ margin: 0 }}
                              >
                                <input
                                  type="hidden"
                                  name="intent"
                                  value="remove-member"
                                />
                                <input
                                  type="hidden"
                                  name="memberCustomerId"
                                  value={member.customerId}
                                />
                                <button
                                  type="submit"
                                  className="project-clad-button project-clad-reject-modal-btn"
                                  aria-label={`Remove ${memberLabel}`}
                                >
                                  Remove
                                </button>
                              </Form>
                            ) : null}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {canAdminMembers ? (
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
                <input type="hidden" name="memberCustomerId" defaultValue="" />
                <div className="project-clad-form-grid">
                  <div className="project-clad-form-grid__cell">
                    <label htmlFor="member-email-modal">Add member</label>
                    <div
                      className="project-clad-member-typeahead"
                      data-projectclad-member-typeahead
                    >
                      <input
                        id="member-email-modal"
                        name="email"
                        type="email"
                        placeholder="Name or email"
                        required
                        autoComplete="off"
                        className="project-clad-flat-input"
                        data-projectclad-member-typeahead-input
                      />
                      <ul
                        className="project-clad-member-typeahead__list"
                        role="listbox"
                        hidden
                        data-projectclad-member-typeahead-list
                      />
                    </div>
                  </div>
                  <div className="project-clad-form-grid__cell">
                    <label htmlFor="member-role-modal-role-edit">Role</label>
                    <MemberRoleSelect
                      idPrefix="member-role-modal"
                      defaultValue="edit"
                      rolePrompt="Select role"
                    />
                  </div>
                </div>
              </Form>
            ) : null}
            {canAdminMembers || isOwner ? (
              <div className="project-clad-edit-modal__section-footer project-clad-edit-project-modal__member-actions">
                {canAdminMembers ? (
                  <span
                    className="project-clad-muted"
                    data-projectclad-member-message
                  >
                    {memberError || ""}
                  </span>
                ) : (
                  <span className="project-clad-muted" aria-hidden="true" />
                )}
                <div className="project-clad-edit-project-modal__member-actions__buttons">
                  {isOwner ? (
                    <Form
                      method="post"
                      action={`https://${shop}/apps/project-clad/project?id=${project.id}`}
                      className="project-clad-inline-form project-clad-edit-project-modal__share-form"
                      data-projectclad-ajax
                      data-projectclad-intent="share-project"
                      data-projectclad-project-id={project.id}
                    >
                      <input type="hidden" name="intent" value="share-project" />
                      <input type="hidden" name="role" value="view" />
                      <button
                        type="submit"
                        className="project-clad-button project-clad-reject-modal-btn project-clad-edit-project-modal__share-btn"
                        data-projectclad-share-submit
                        title="Copy the invite link for this project (one stable link per project)"
                      >
                        Copy share link
                      </button>
                    </Form>
                  ) : null}
                  {canAdminMembers ? (
                    <button
                      type="submit"
                      form="projectclad-add-member-form"
                      className="project-clad-button project-clad-reject-modal-btn"
                      data-projectclad-busy-label="Adding…"
                    >
                      Add member
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {!canAdminMembers && !isOwner ? (
              canEdit ? (
                <p className="project-clad-muted" style={{ margin: 0 }}>
                  Only the project owner can copy the share invite link.
                </p>
              ) : (
                <p className="project-clad-muted" style={{ margin: 0 }}>
                  You have view-only access to this project.
                </p>
              )
            ) : null}
            </section>

            {canAdminMembers ? (
              <section className="project-clad-edit-modal__danger project-clad-edit-project-modal__cell-danger project-clad-edit-project-modal__danger-row">
                <div className="project-clad-edit-project-modal__danger-copy">
                  <p className="project-clad-edit-modal__danger-title">
                    Danger zone
                  </p>
                  <p className="project-clad-edit-modal__danger-text">
                    Deleting removes this project and all its orders. Cannot be undone.
                  </p>
                </div>
                <button
                  type="button"
                  className="project-clad-button project-clad-button--danger project-clad-reject-modal-btn project-clad-edit-project-modal__danger-delete"
                  data-projectclad-delete-project-open
                  aria-label="Delete this project and all of its orders"
                >
                  Delete
                </button>
              </section>
            ) : null}
          </div>

          <div
            className="project-clad-edit-project-modal__unsaved-backdrop"
            data-projectclad-edit-project-unsaved-modal
            role="presentation"
            aria-hidden="true"
            style={{ display: "none" }}
          >
            <div
              className="project-clad-edit-project-modal__unsaved-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-project-unsaved-title"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="project-clad-modal__header-row project-clad-edit-project-modal__unsaved-head">
                <h2
                  id="edit-project-unsaved-title"
                  className="project-clad-edit-project-modal__unsaved-title"
                >
                  Unsaved changes
                </h2>
                <button
                  type="button"
                  className="project-clad-modal-close"
                  data-projectclad-edit-project-unsaved-cancel
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <p className="project-clad-edit-project-modal__unsaved-body">
                You have unsaved changes. Save before closing?
              </p>
              <div className="project-clad-edit-project-modal__unsaved-actions">
                <button
                  type="button"
                  className="project-clad-button project-clad-reject-modal-btn project-clad-edit-project-modal__btn-primary"
                  data-projectclad-edit-project-unsaved-save
                >
                  Save
                </button>
                <button
                  type="button"
                  className="project-clad-button project-clad-reject-modal-btn project-clad-edit-project-modal__btn-secondary"
                  data-projectclad-edit-project-unsaved-discard
                >
                  Discard
                </button>
                <button
                  type="button"
                  className="project-clad-button project-clad-reject-modal-btn project-clad-edit-project-modal__btn-secondary"
                  data-projectclad-edit-project-unsaved-cancel
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
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
            <div className="project-clad-modal__header-row">
              <h2 id="edit-save-title-js">Save changes?</h2>
              <button
                type="button"
                className="project-clad-modal-close"
                data-projectclad-edit-save-close
                aria-label="Close"
              >
                ×
              </button>
            </div>
            {/* Filled by project-main.js when the save is refused (locked order, permissions,
                network). Empty and hidden until then; the modal stays open so the edits behind
                it survive, because nothing reloads on a failed save. */}
            <p
              className="project-clad-muted project-clad-approval-msg"
              style={{ color: "#b71c1c" }}
              data-projectclad-edit-save-message
              role="alert"
              hidden
            />
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
        data-projectclad-order-delivery-modal
        data-project-receive-mode={project.receiveMode}
        data-project-ship-address1={project.shipAddress1 ?? ""}
        data-project-ship-city={project.shipCity ?? ""}
        data-project-ship-province={project.shipProvince ?? ""}
        data-project-ship-postal={project.shipPostal ?? ""}
        data-project-ship-country={project.shipCountry ?? "Canada"}
        data-delivery-fee={String(shopDeliveryFee)}
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-delivery-modal-title"
        style={{ display: "none" }}
      >
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          className="project-clad-card project-clad-modal project-clad-reject-modal project-clad-order-delivery-modal"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="project-clad-modal__header-row">
            <h2 id="order-delivery-modal-title">Delivery &amp; status</h2>
            <button
              type="button"
              className="project-clad-modal-close"
              data-projectclad-order-delivery-close
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <nav
            className="project-clad-delivery-modal-tabs"
            data-projectclad-delivery-modal-tabs
            aria-label="Delivery sections"
          >
            <button
              type="button"
              className="project-clad-delivery-modal-tabs__btn is-active"
              data-projectclad-delivery-tab="plan"
            >
              Plan
            </button>
            <button
              type="button"
              className="project-clad-delivery-modal-tabs__btn"
              data-projectclad-delivery-tab="fulfillment"
            >
              Fulfillment
            </button>
            <button
              type="button"
              className="project-clad-delivery-modal-tabs__btn"
              data-projectclad-delivery-tab="documents"
            >
              Documents
            </button>
          </nav>
          <div className="project-clad-order-delivery-modal__body">
          <div
            className="project-clad-delivery-modal-tab-panel"
            data-projectclad-delivery-tab-panel="plan"
          >
          <form
            data-projectclad-order-delivery-form
            data-pc-delivery-date-min={preferredDeliveryDateMinYmd}
            data-pc-ottawa-windows={JSON.stringify(OTTAWA_DELIVERY_HOUR_WINDOWS)}
            className="project-clad-inline-form project-clad-pricing-form"
          >
            <input type="hidden" name="intent" value="save-order-delivery" />
            <input type="hidden" name="id" value={project.id} />
            <input
              type="hidden"
              name="jobId"
              data-projectclad-order-delivery-job-id
              value=""
            />
            <JobDeliveryModeRadios name="deliveryMode" defaultMode="inherit" />
            <div
              className="project-clad-order-delivery-modal__address"
              data-projectclad-order-delivery-address-wrap
              hidden
            >
              <JobDeliveryAddressFields
                idPrefix="order-delivery"
                shipAddress1={null}
                shipCity={null}
                shipProvince={null}
                shipPostal={null}
              />
            </div>
            <div
              className="project-clad-order-delivery-modal__phases project-clad-delivery-plan"
              data-projectclad-delivery-phases-wrap
              hidden
            >
              <p className="project-clad-delivery-plan__heading">Delivery plan</p>
              <fieldset className="project-clad-delivery-plan-mode">
                <legend className="project-clad-sr-only">Delivery plan mode</legend>
                <label className="project-clad-delivery-plan-mode__option">
                  <input
                    type="radio"
                    name="deliveryPlanMode"
                    value="single"
                    defaultChecked
                    data-projectclad-delivery-plan-mode
                  />
                  <span className="project-clad-delivery-plan-mode__label">
                    Full Delivery
                  </span>
                </label>
                <label className="project-clad-delivery-plan-mode__option">
                  <input
                    type="radio"
                    name="deliveryPlanMode"
                    value="recurring"
                    data-projectclad-delivery-plan-mode
                  />
                  <span className="project-clad-delivery-plan-mode__label">
                    Recurring Partial Delivery
                  </span>
                </label>
              </fieldset>
              <div
                className="project-clad-delivery-plan__panel project-clad-order-delivery-modal__schedule"
                data-projectclad-order-delivery-preferred-schedule
              >
                <p className="project-clad-delivery-plan__section-title">
                  Preferred delivery (Ottawa)
                </p>
                <div
                  className="project-clad-preferred-delivery-row"
                  role="group"
                  aria-label="Preferred delivery day and time"
                >
                  <div className="project-clad-preferred-delivery-field project-clad-preferred-delivery-field--date">
                    <input
                      type="date"
                      name="scheduledDeliveryDate"
                      data-projectclad-order-delivery-date
                      min={preferredDeliveryDateMinYmd}
                      className="project-clad-preferred-delivery-input"
                      aria-label="Delivery day"
                    />
                  </div>
                  <span className="project-clad-preferred-delivery-between">
                    between
                  </span>
                  <div className="project-clad-preferred-delivery-field project-clad-preferred-delivery-field--time">
                    <select
                      name="scheduledDeliveryWindow"
                      data-projectclad-order-delivery-window
                      className="project-clad-preferred-delivery-input"
                      aria-label="Delivery time"
                      disabled
                    >
                      <option value="">Select a day first…</option>
                      {OTTAWA_DELIVERY_HOUR_WINDOWS.map((w) => (
                        <option key={w} value={w}>
                          {w}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div data-projectclad-delivery-fee-anchor-single />
              </div>
              <div
                className="project-clad-delivery-plan__panel project-clad-delivery-plan__panel--recurring"
                data-projectclad-delivery-recurring-panel
                hidden
              >
                <div className="project-clad-delivery-plan__section">
                  <p className="project-clad-delivery-plan__section-title">
                    Quantities per delivery
                  </p>
                  <div
                    data-projectclad-delivery-batch-list
                    className="project-clad-delivery-batch-list"
                  />
                  <div data-projectclad-delivery-fee-anchor-recurring>
                    <div
                      className="project-clad-muted project-clad-order-delivery-modal__fee project-clad-delivery-fee-preview"
                      data-projectclad-delivery-fee-preview
                    >
                      <p
                        className="project-clad-delivery-fee-preview__rate"
                        data-projectclad-delivery-fee-rate
                      />
                      <p
                        className="project-clad-delivery-fee-preview__total"
                        data-projectclad-delivery-fee-total
                        hidden
                      />
                    </div>
                  </div>
                </div>
                <div className="project-clad-delivery-plan__section">
                  <p className="project-clad-delivery-plan__section-title">
                    First delivery (Ottawa)
                  </p>
                  <div
                    className="project-clad-preferred-delivery-row"
                    role="group"
                    aria-label="First recurring delivery day and time"
                  >
                    <div className="project-clad-preferred-delivery-field project-clad-preferred-delivery-field--date">
                      <input
                        type="date"
                        name="deliveryRecurringStartDate"
                        data-projectclad-delivery-recurring-start-date
                        min={preferredDeliveryDateMinYmd}
                        className="project-clad-preferred-delivery-input"
                        aria-label="First delivery day"
                      />
                    </div>
                    <span className="project-clad-preferred-delivery-between">
                      between
                    </span>
                    <div className="project-clad-preferred-delivery-field project-clad-preferred-delivery-field--time">
                      <select
                        name="deliveryRecurringStartWindow"
                        data-projectclad-delivery-recurring-start-window
                        className="project-clad-preferred-delivery-input"
                        aria-label="First delivery time"
                        disabled
                      >
                        <option value="">Select a day first…</option>
                        {OTTAWA_DELIVERY_HOUR_WINDOWS.map((w) => (
                          <option key={w} value={w}>
                            {w}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                <div
                  className="project-clad-delivery-plan__section"
                  data-projectclad-delivery-recurring-schedule
                >
                  <p className="project-clad-delivery-plan__section-title">
                    Repeat schedule
                  </p>
                  <div className="project-clad-delivery-recurring-schedule__grid">
                    <label className="project-clad-delivery-recurring-schedule__field">
                      <span>Repeat every</span>
                      <select
                        name="deliveryRepeatIntervalDays"
                        data-projectclad-delivery-repeat-interval
                        className="project-clad-preferred-delivery-input"
                        defaultValue="7"
                      >
                        <option value="1">Every day</option>
                        <option value="2">Every 2 days</option>
                        <option value="3">Every 3 days</option>
                        <option value="7">Every 7 days</option>
                        <option value="14">Every 14 days</option>
                        <option value="21">Every 21 days</option>
                        <option value="30">Every 30 days</option>
                      </select>
                    </label>
                    <label className="project-clad-delivery-recurring-schedule__field">
                      <span>End by (optional)</span>
                      <input
                        type="date"
                        name="deliveryRepeatEndDate"
                        data-projectclad-delivery-repeat-end
                        min={preferredDeliveryDateMinYmd}
                        className="project-clad-preferred-delivery-input"
                        aria-label="Last scheduled delivery date"
                      />
                    </label>
                  </div>
                </div>
              </div>
              <p
                className="project-clad-delivery-plan__preview project-clad-muted"
                data-projectclad-delivery-phase-preview
                role="status"
              />
              <input
                type="hidden"
                name="deliveryPhasesJson"
                data-projectclad-delivery-phases-json
                value=""
              />
              <input
                type="hidden"
                name="deliveryBatchJson"
                data-projectclad-delivery-batch-json
                value=""
              />
            </div>
            <p
              className="project-clad-muted project-clad-approval-msg"
              data-projectclad-order-delivery-message
              role="status"
            />
            <p
              className="project-clad-muted project-clad-delivery-plan-locked-note"
              data-projectclad-delivery-plan-locked-note
              hidden
              role="status"
            >
              Delivery plan is locked after the order has been fully delivered.
              Use Fulfillment or Documents for delivery progress and paperwork.
            </p>
            <div className="project-clad-actions project-clad-reject-modal-actions">
              <button
                type="button"
                className="project-clad-button project-clad-reject-modal-btn"
                data-projectclad-order-delivery-save
              >
                Save plan
              </button>
              <button
                type="button"
                className="project-clad-button project-clad-reject-modal-btn"
                data-projectclad-order-delivery-cancel
              >
                Close
              </button>
            </div>
          </form>
          </div>
          <div
            className="project-clad-delivery-modal-tab-panel"
            data-projectclad-delivery-tab-panel="fulfillment"
            hidden
          >
            {project.jobs.map((job) => (
              <div
                key={job.id}
                data-projectclad-delivery-fulfillment-job={job.id}
                hidden
              >
                <OrderDeliveryFulfillmentSection
                  job={job}
                  projectId={project.id}
                  viewerIsAdmin={viewerIsAdmin}
                  viewerCanFulfill={viewerCanFulfill}
                />
              </div>
            ))}
            <div className="project-clad-actions project-clad-reject-modal-actions">
              <button
                type="button"
                className="project-clad-button project-clad-reject-modal-btn"
                data-projectclad-order-delivery-cancel
              >
                Close
              </button>
            </div>
          </div>
          <div
            className="project-clad-delivery-modal-tab-panel"
            data-projectclad-delivery-tab-panel="documents"
            hidden
          >
            {project.jobs.map((job) => (
              <div
                key={job.id}
                data-projectclad-delivery-documents-job={job.id}
                hidden
              >
                <OrderDeliveryDocumentsPanel job={job} />
              </div>
            ))}
            <div className="project-clad-actions project-clad-reject-modal-actions">
              <button
                type="button"
                className="project-clad-button project-clad-reject-modal-btn"
                data-projectclad-order-delivery-cancel
              >
                Close
              </button>
            </div>
          </div>
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
            <div className="project-clad-modal__header-row">
              <h2 id="delete-project-modal-title">Delete this project</h2>
              <button
                type="button"
                className="project-clad-modal-close"
                data-projectclad-delete-project-cancel
                aria-label="Close"
              >
                ×
              </button>
            </div>
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
      <link rel="stylesheet" href={proxyStylesHref} />
      <main
        className={`project-clad-page project-clad-page--detail project-clad-page--projects project-clad-page--cc-v2 cc-store-neu${backgroundLogoUrl ? " project-clad-page--card-bg-logo" : ""}`}
        data-pc-na-workflow={viewerHasNATag === true ? "1" : "0"}
        style={
          backgroundLogoUrl
            ? {
                ["--project-clad-bg-logo" as string]: `url("${backgroundLogoUrl}")`,
              }
            : undefined
        }
      >
        {/* Sticky header hit-testing: see project-clad-proxy.css (avoid pointer-events:none on this wrapper — orders shell must receive clicks). */}
        <header className="project-clad-header project-clad-header--fullbleed">
          <ProjectCladStorefrontNav
              logoSrc={logoUrl}
              logoHref="/"
              logoAlt="Canadian Cladding"
              links={storefrontAppNav.links}
              cartUrl={storefrontAppNav.cartUrl}
              searchUrl={storefrontAppNav.searchUrl}
              accountUrl={storefrontAppNav.accountUrl}
              accountInitial={navAccountInitial}
              accountFirstName={navAccountFirstName}
              inAppSearch="orders"
              inAppSearchQuery={orderListSearchQ}
              onInAppSearchQueryChange={(query) => {
                setSearchParams(
                  (prev) => {
                    const next = new URLSearchParams(prev);
                    const t = (query || "").trim();
                    if (t) next.set("q", t);
                    else next.delete("q");
                    return next;
                  },
                  { replace: true },
                );
              }}
              htmlTemplateHeader
              htmlTemplateNavActive="projects"
              hideTrailingIcons={true}
              utilityBarExtra={utilityAddMemberControl}
            />
          </header>
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
                data-pc-dismiss-banner="scheduleDateError"
              >
                Dismiss
              </button>
            </div>
          ) : null}
          {searchParams.get("projectEditError") ? (
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
                {searchParams.get("projectEditError") === "address" ? (
                  <>
                    Your project was <strong>not saved</strong>. Delivery needs a complete address
                    (street, city, province and postal code) — fill in the missing fields in Edit
                    project, or switch the project to store pickup.
                  </>
                ) : (
                  <>
                    Your project was <strong>not saved</strong>. A project name is required — enter
                    one in Edit project and save again.
                  </>
                )}
              </p>
              <button
                type="button"
                className="project-clad-button project-clad-reject-modal-btn"
                style={{ marginTop: "0.65rem" }}
                data-pc-dismiss-banner="projectEditError"
              >
                Dismiss
              </button>
            </div>
          ) : null}
          {/*
            Non-blocking: the mutation itself succeeded, only the notification email did not
            go out. Styled amber to separate it from the red "nothing was saved" banners, but
            still role="alert" so it is announced and so the shared dismiss handler (which
            looks for the enclosing [role="alert"]) removes the whole banner.
          */}
          {searchParams.get("notifyWarning") ? (
            <div
              role="alert"
              className="project-clad-card"
              style={{
                marginBottom: "1rem",
                padding: "0.85rem 1rem",
                borderColor: "#b26a00",
                background: "rgba(178, 106, 0, 0.08)",
              }}
            >
              <p style={{ margin: 0, fontSize: "0.92rem", lineHeight: 1.45 }}>
                {searchParams.get("notifyWarning")}
              </p>
              <button
                type="button"
                className="project-clad-button project-clad-reject-modal-btn"
                style={{ marginTop: "0.65rem" }}
                data-pc-dismiss-banner="notifyWarning"
              >
                Dismiss
              </button>
            </div>
          ) : null}
          {searchParams.get("pcNewOrderError") === "duplicate" ? (
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
                An order with that name <strong>already exists</strong>. Pick a different order name
                in Edit project and save again.
              </p>
              <button
                type="button"
                className="project-clad-button project-clad-reject-modal-btn"
                style={{ marginTop: "0.65rem" }}
                data-pc-dismiss-banner="pcNewOrderError"
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
                data-pc-dismiss-banner="scheduleLocked"
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
                data-pc-dismiss-banner="scheduleWindowNeedsDate"
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
                data-pc-dismiss-banner="scheduleWindowPastError"
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
                You cannot set status to <strong>delivered</strong> until a
                fulfillment photo is uploaded.
                {viewerIsAdmin
                  ? " As an app admin, choose “Delivered (no photo)” under Order status to override."
                  : null}
              </p>
              <button
                type="button"
                className="project-clad-button project-clad-reject-modal-btn"
                style={{ marginTop: "0.65rem" }}
                data-pc-dismiss-banner="statusPhotoRequired"
              >
                Dismiss
              </button>
            </div>
          ) : null}
          {searchParams.get("fulfillmentError") ? (
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
                {searchParams.get("fulfillmentError")}
              </p>
              <button
                type="button"
                className="project-clad-button project-clad-reject-modal-btn"
                style={{ marginTop: "0.65rem" }}
                data-pc-dismiss-banner="fulfillmentError"
              >
                Dismiss
              </button>
            </div>
          ) : null}

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
                      data-projectclad-busy-label="Approving…"
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

          {viaCompany && (
            <section
              className="project-clad-section project-clad-shared-via-company"
              role="status"
            >
              <div className="project-clad-card project-clad-shared-via-company__card">
                <p className="project-clad-muted project-clad-shared-via-company__text">
                  {viaCompanyLabel
                    ? `You have read-only access to this project because you're tagged with "${viaCompanyLabel}". Ask the owner to add you as a member to make changes.`
                    : "You have read-only access to this project through a shared company tag. Ask the owner to add you as a member to make changes."}
                </p>
              </div>
            </section>
          )}

          <section className="project-clad-section">
            <div className="project-clad-card project-clad-orders-shell">
              <div
                className="project-clad-orders-page-banner"
                data-projectclad-project-meta-print-banner
                role="region"
                aria-labelledby="project-clad-project-meta-name"
                aria-describedby="project-clad-delivery-summary"
              >
                <nav
                  className="project-clad-orders-page-crumb"
                  aria-label="Breadcrumb"
                >
                  {/* `data-projectclad-projects-link` is wired to a dedicated
                      inline-script handler at the bottom of the page so the
                      navigation works on the storefront app proxy where React
                      doesn't hydrate AND can't be wedged by upstream
                      capture-phase interceptors. The plain href + theme SPA
                      handler is left as a no-JS fallback. */}
                  <a
                    href={projectsListHref}
                    data-projectclad-projects-link
                    data-projectclad-no-transition
                  >
                    Projects
                  </a>
                  <span className="project-clad-orders-page-crumb__sep" aria-hidden="true">
                    ›
                  </span>
                  <span className="project-clad-orders-page-crumb__here">
                    {project.name}
                  </span>
                </nav>

                <div className="project-clad-orders-page-header">
                  <div className="project-clad-orders-page-header__top">
                    <div className="project-clad-orders-page-name-block">
                      <h1
                        id="project-clad-project-meta-name"
                        className="project-clad-orders-page-name"
                      >
                        {project.name}
                      </h1>
                      <div className="project-clad-orders-page-name-num">
                        #{project.poNumber || "—"}
                      </div>
                    </div>
                    <img
                      className="project-clad-orders-page-print-logo"
                      src={
                        CANADIAN_CLADDING_STOREFRONT_LOGO_URL.startsWith("//")
                          ? `https:${CANADIAN_CLADDING_STOREFRONT_LOGO_URL}`
                          : CANADIAN_CLADDING_STOREFRONT_LOGO_URL
                      }
                      srcSet={buildCanadianCladdingLogoSrcSet(
                        CANADIAN_CLADDING_STOREFRONT_LOGO_URL,
                      )}
                      sizes="160px"
                      alt="Canadian Cladding"
                      width={160}
                      height={48}
                      decoding="async"
                    />
                    {canEdit ? (
                      <div className="project-clad-orders-page-status-stack">
                        <button
                          type="button"
                          className="project-clad-orders-page-edit-project"
                          data-projectclad-edit-project-details
                        >
                          Edit project
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className="project-clad-orders-page-facts">
                    <div className="project-clad-orders-page-fact">
                      <span className="project-clad-orders-page-fact-label">
                        Company
                      </span>
                      <span className="project-clad-orders-page-fact-value">
                        {project.companyName || "—"}
                      </span>
                    </div>
                    <div className="project-clad-orders-page-fact">
                      <span className="project-clad-orders-page-fact-label">
                        Created
                      </span>
                      <span className="project-clad-orders-page-fact-value">
                        {(() => {
                          const d = new Date(project.createdAt);
                          const y = d.getFullYear();
                          const m = String(d.getMonth() + 1).padStart(2, "0");
                          const day = String(d.getDate()).padStart(2, "0");
                          return `${y}.${m}.${day}`;
                        })()}
                      </span>
                    </div>
                    <div className="project-clad-orders-page-fact">
                      <span className="project-clad-orders-page-fact-label">
                        Delivery
                      </span>
                      <span
                        className="project-clad-orders-page-fact-value"
                        id="project-clad-delivery-summary"
                      >
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
                              return [
                                ...lines,
                                project.shipCountry || "Canada",
                              ].join(", ");
                            })()}
                      </span>
                    </div>
                    <div className="project-clad-orders-page-fact project-clad-orders-page-fact--price-total">
                      <span className="project-clad-orders-page-fact-label">
                        Total
                      </span>
                      <span
                        className="project-clad-orders-page-fact-value"
                        data-projectclad-price
                        data-price={projectSubtotalForDisplay.toFixed(2)}
                      >
                        {pricingUnlocked
                          ? formatPrice(projectSubtotalForDisplay)
                          : "—"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="project-clad-orders-page-section-bar">
                <h2 className="project-clad-orders-page-section-title">
                  Orders{" "}
                  <span className="project-clad-orders-page-section-meta">
                    {project.jobs.length} total
                  </span>
                </h2>
                {project.jobs.length > 1 ? (
                  <div
                    className="project-clad-orders-page-sort"
                    role="region"
                    aria-label="Sort orders"
                    data-projectclad-orders-sort-cluster
                  >
                    <span className="project-clad-orders-page-sort__label">
                      Sort
                    </span>
                    <nav
                      className="project-clad-orders-page-sort__chips"
                      aria-label="Sort orders list"
                    >
                      {(
                        [
                          { key: "recent", label: "Recent" },
                          { key: "oldest", label: "Oldest" },
                          { key: "name-asc", label: "Name A–Z" },
                          { key: "name-desc", label: "Name Z–A" },
                          { key: "total-desc", label: "Total: High to Low" },
                          { key: "total-asc", label: "Total: Low to High" },
                          { key: "status", label: "Status" },
                        ] as const
                      ).map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          data-pc-orders-sort={key}
                          className={`project-clad-orders-page-sort__chip${key === "recent" ? " is-active" : ""}`}
                          data-projectclad-no-transition
                        >
                          {label}
                        </button>
                      ))}
                    </nav>
                  </div>
                ) : null}
              </div>
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
                    const resolvedJobDelivery = resolveJobDelivery(
                      job,
                      projectDeliveryCtx,
                    );
                    const jobDeliveryFeeAmount = feeForJob(job);
                    const jobTaxableForDisplay =
                      job.subtotal + jobDeliveryFeeAmount;
                    const jobDisplayTax = orderTaxFromSubtotal(
                      jobTaxableForDisplay,
                      {
                        pricesIncludeTax: false,
                      },
                    );
                    const jobTotalWithDisplayTax = orderTotalWithTax(
                      jobTaxableForDisplay,
                      {
                        pricesIncludeTax: false,
                      },
                    );
                    const jobIsDelivery = resolvedJobDelivery.method === "delivery";
                    const jobDeliveryAddress = resolvedJobDelivery.addressLine;
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
                    /*
                     * The fulfillment / delivery status line (e.g. "In store pickup",
                     * "Delivery Mon Jun 10, AM", "Delivered - Jun 10"). Lifted out of the
                     * actions IIFE so we can also embed it in the sunken totals tile
                     * (under the Delivery row) — keeps all purchasing info together.
                     */
                    const preferredDeliveryLine = formatOrderDeliveryFootline({
                      orderLifecycleStatus: job.orderLifecycleStatus,
                      paidAt: job.paidAt,
                      completedAt: job.completedAt,
                      scheduledDeliveryDate: job.scheduledDeliveryDate,
                      scheduledDeliveryWindow: job.scheduledDeliveryWindow,
                      fulfillmentMethod: job.fulfillmentMethod,
                      projectReceiveMode: project.receiveMode,
                    });
                    /*
                     * Lifted out of the actions IIFE so we can render the
                     * Order now / Edit order buttons INSIDE the OrderFinancePanel
                     * (right column, below the Payment Summary card) — that way the
                     * CTAs read as part of the same finance section instead of
                     * floating in whitespace below it.
                     */
                    const awaitingForActions = isOrderAwaitingApproval(job.id);
                    const showEditOrderButtonForActions =
                      (canEdit || viewerCanFulfill) &&
                      !job.isLocked &&
                      (!awaitingForActions || viewerCanFulfill);
                    /* Save: POST current PO / site contact / phone (+ order name
                     * from the summary). Locked Shopify-linked orders still allow
                     * those fields; line items stay frozen server-side.
                     * Click handling lives in the page inline script (same pattern as
                     * Edit order) so saves work even if React event delegation fails. */
                    const showSaveFieldsBtn = Boolean(canEdit);
                    const orderFinanceActions: OrderActionSpec[] = [];
                    if (showSaveFieldsBtn) {
                      orderFinanceActions.push({
                        key: "save",
                        kind: "button",
                        icon: PC_SAVE_ICON,
                        label: "Save",
                        description: "Save PO, site contact & phone.",
                        tone: "go",
                        buttonProps: {
                          "data-projectclad-save-fields-btn": "",
                          "data-job-id": job.id,
                          title: "Save details",
                          "aria-label": "Save details",
                        },
                      });
                    }
                    if (canEdit) {
                      orderFinanceActions.push(
                        renderOrderLifecycleActionCard(job),
                      );
                    }
                    if (showEditOrderButtonForActions) {
                      orderFinanceActions.push({
                        key: "edit",
                        kind: "button",
                        icon: PC_EDIT_ICON,
                        label: "Edit order",
                        description: "Change items or quantities.",
                        tone: "edit",
                        buttonProps: {
                          "data-projectclad-edit-order": "",
                          "data-job-id": job.id,
                          "data-project-id": project.id,
                          title: "Open editor",
                          "aria-label": "Open editor",
                        },
                      });
                    }
                    const deliveryOptionsLocked = isOrderDeliveryPlanLocked(
                      job.orderLifecycleStatus,
                    );
                    const deliveryOptionsDescription = deliveryOptionsLocked
                      ? "Delivery plan is locked after the order has been fully delivered."
                      : job.orderLifecycleStatus === "ordered" &&
                          (job.deliveredPercent ?? 0) > 0 &&
                          (job.deliveredPercent ?? 0) < 100
                        ? "Update plan · completed deliveries stay as recorded"
                        : resolvedJobDelivery.method === "pickup"
                        ? "Store pickup · no delivery fee"
                        : resolvedJobDelivery.fee > 0
                          ? `Delivery · $${shopDeliveryFee.toFixed(2)} per phase`
                          : "Delivery · add address";
                    const canEditDeliveryPlan =
                      (canEdit || viewerCanFulfill) && !deliveryOptionsLocked;
                    orderFinanceActions.push({
                        key: "delivery-options",
                        kind: "button",
                        icon: PC_DELIVERY_OPTIONS_ICON,
                        label: "Delivery & status",
                        description: deliveryOptionsDescription,
                        tone: "edit",
                        buttonProps: {
                          "data-projectclad-delivery-options": "",
                          "data-job-id": job.id,
                          "data-delivery-mode": job.deliveryMode,
                          "data-ship-address1": job.shipAddress1 ?? "",
                          "data-ship-city": job.shipCity ?? "",
                          "data-ship-province": job.shipProvince ?? "",
                          "data-ship-postal": job.shipPostal ?? "",
                          "data-ship-country": job.shipCountry ?? "",
                          "data-scheduled-date": job.scheduledDeliveryDate ?? "",
                          "data-scheduled-window":
                            job.scheduledDeliveryWindow ?? "",
                          "data-order-lifecycle": job.orderLifecycleStatus,
                          "data-delivered-percent": String(
                            job.deliveredPercent ?? 0,
                          ),
                          "data-plan-locked": deliveryOptionsLocked ? "1" : "0",
                          "data-can-edit-plan": canEditDeliveryPlan ? "1" : "0",
                          "data-staff-fulfillment": viewerCanFulfill ? "1" : "0",
                          title: canEditDeliveryPlan
                            ? "Delivery plan, fulfillment, and documents"
                            : "View delivery plan, progress, and documents",
                          "aria-label": "Delivery & status for this order",
                        },
                      });
                    const orderFinanceActionsSlot =
                      orderFinanceActions.length > 0 ? (
                        <div className="project-clad-order-actions-stack">
                          <div
                            className="project-clad-action-row"
                            style={
                              {
                                "--pc-action-row-cols":
                                  orderFinanceActions.length,
                              } as CSSProperties
                            }
                          >
                            {orderFinanceActions.map((spec) =>
                              renderOrderAction(spec, {
                                jobId: job.id,
                                projectId: project.id,
                              }),
                            )}
                          </div>
                        </div>
                      ) : null;
                    const paymentSummaryPdfActionsSlot = (
                      <>
                        {/*
                         * PDF exports (also passed into OrderFinancePanel header row):
                         * - Packing slip (no pricing) is always available.
                         * - Invoice (with pricing) appears once delivered/paid.
                         */}
                        <button
                          type="button"
                          className="project-clad-order-export-pdf"
                          data-projectclad-export-order-pdf
                          data-print-mode="packing"
                          data-job-id={job.id}
                          title="Export packing slip (without prices)"
                          aria-label="Export packing slip PDF"
                        >
                          <svg
                            className="project-clad-order-export-pdf__icon"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <rect x="5" y="3" width="14" height="18" rx="2" />
                            <line x1="8" y1="8" x2="16" y2="8" />
                            <line x1="8" y1="12" x2="13" y2="12" />
                            <rect x="8" y="15" width="4" height="4" rx="0.5" />
                          </svg>
                        </button>
                        {viewerIsAdmin ||
                        job.orderLifecycleStatus === "delivered" ||
                        job.orderLifecycleStatus === "paid" ? (
                          <button
                            type="button"
                            className="project-clad-order-export-pdf project-clad-order-export-pdf--invoice"
                            data-projectclad-export-order-pdf
                            data-print-mode="invoice"
                            data-job-id={job.id}
                            title="Print order with prices"
                            aria-label="Print order with prices"
                          >
                            <svg
                              className="project-clad-order-export-pdf__icon"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M14 2H6a2 2 0 0 0-2 2v16l3-2 3 2 3-2 3 2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                              <line x1="8" y1="12" x2="16" y2="12" />
                              <line x1="8" y1="16" x2="16" y2="16" />
                            </svg>
                          </button>
                        ) : null}
                      </>
                    );
                    return (
                  <div
                    key={job.id}
                    className="project-clad-order-row-shell"
                    data-projectclad-order-row=""
                    data-pc-order-created-ms={new Date(job.createdAt).getTime()}
                    data-pc-order-name={(job.name || "").toLowerCase()}
                    data-pc-order-subtotal={Number(job.subtotal) || 0}
                    data-pc-order-status-rank={statusRankForSort(job)}
                  >
                  <details
                    id={`job-${job.id}`}
                    data-pc-phase-plan={encodeURIComponent(
                      JSON.stringify({
                        ...(() => {
                          const itemRows = job.items.map((item) => ({
                            id: item.id,
                            quantity: item.quantity,
                          }));
                          const planRef = parseDeliveryPlanReference(
                            job.deliveryBatchByItemJson,
                            job.deliveryPlanMode,
                            itemRows,
                            job.deliveryPhases,
                            {
                              scheduledDeliveryDate: job.scheduledDeliveryDate,
                              scheduledDeliveryWindow:
                                job.scheduledDeliveryWindow,
                            },
                          );
                          const batchFallback = inferBatchByItemFromPhases(
                            itemRows,
                            planRef.referencePhases.map((ph, idx) => ({
                              id: `ref-${idx}`,
                              sequence: ph.sequence,
                              scheduledDeliveryDate:
                                ph.scheduledDeliveryDate || null,
                              scheduledDeliveryWindow:
                                ph.scheduledDeliveryWindow || null,
                              deliveryFeeAmount: 0,
                              hasPhoto: false,
                              deliveredAt: null,
                              photoUrl: null,
                              packingSlipUrl: null,
                              invoiceUrl: null,
                              lines: ph.lines.map((l) => ({
                                jobItemId: l.jobItemId,
                                quantityPlanned: l.quantityPlanned,
                                quantityDelivered: 0,
                              })),
                            })),
                          );
                          return {
                            planMode: planRef.planMode,
                            batchByItem:
                              planRef.batchPayload?.batchByItem ?? batchFallback,
                            repeatIntervalDays:
                              planRef.batchPayload?.repeatIntervalDays ?? null,
                            repeatEndDate:
                              planRef.batchPayload?.repeatEndDate ?? null,
                            phases: planRef.referencePhases,
                          };
                        })(),
                        items: job.items.map((item) => ({
                          id: item.id,
                          quantity: item.quantity,
                          label: item.displayName,
                        })),
                      }),
                    )}
                    data-job-id={job.id}
                    open={selectedJobId === job.id}
                    className={
                      [
                        "project-clad-order-row",
                        "project-clad-details",
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
                  >
                    <summary className="project-clad-summary">
                      <div className="project-clad-summary-row project-clad-order-summary-head-row">
                        <div className="project-clad-order-summary-padded">
                          <div className="project-clad-order-summary-name-block">
                            <h3 className="project-clad-title project-clad-order-summary-name">
                              {jobSummaryDisplayName}
                            </h3>
                            {/* Screen: `#1174 · 2026.05.07` under the title.
                                Print: same row as the title, fact-style columns
                                (label over value) matching Company / Created. */}
                            <div className="project-clad-order-summary-id-row">
                              {job.orderNumber != null ? (
                                <>
                                  <div className="project-clad-order-summary-meta-fact project-clad-order-summary-meta-fact--order-no">
                                    <span className="project-clad-order-summary-meta-fact__label">
                                      Order number
                                    </span>
                                    <span className="project-clad-orders-page-name-num project-clad-order-summary-order-no project-clad-order-summary-meta-fact__value">
                                      #{job.orderNumber}
                                    </span>
                                  </div>
                                  <span
                                    aria-hidden="true"
                                    className="project-clad-order-summary-id-row__sep"
                                  >
                                    ·
                                  </span>
                                </>
                              ) : null}
                              <div className="project-clad-order-summary-meta-fact project-clad-order-summary-meta-fact--date">
                                <span className="project-clad-order-summary-meta-fact__label">
                                  Date ordered
                                </span>
                                <time
                                  className="project-clad-order-created-date project-clad-order-summary-id-row__date project-clad-order-summary-meta-fact__value"
                                  dateTime={job.createdAt}
                                >
                                  {formatJobCreatedMmDdYyyy(job.createdAt)}
                                </time>
                              </div>
                            </div>
                          </div>
                          {canExportOrderCsv ? (
                            <div className="project-clad-order-summary-title-meta">
                              <a
                                className="project-clad-order-export-csv"
                                href={`/apps/project-clad/api/export-csv?jobId=${encodeURIComponent(job.id)}`}
                                data-projectclad-export-order-csv
                                data-job-id={job.id}
                                title="Export CSV"
                                aria-label="Export CSV"
                                download
                              >
                                <svg
                                  className="project-clad-order-export-csv__icon"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden="true"
                                >
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                  <polyline points="14 2 14 8 20 8" />
                                  <line x1="8" y1="13" x2="16" y2="13" />
                                  <line x1="8" y1="17" x2="13" y2="17" />
                                </svg>
                              </a>
                            </div>
                          ) : null}
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
                          {/*
                           * The PURCHASE ORDER # input lives inline inside OrderFinancePanel
                           * (Contact & Delivery → Purchase Order # row), matching the Site
                           * Contact pattern. The save-order-edit handler queries
                           * `[data-projectclad-purchase-order-input]` within the entire
                           * <details> block, so the inline panel input is the single source
                           * of truth — no header-mode duplicate needed.
                           */}
                        </div>
                        <div className="project-clad-order-summary-head-end">
                          {/*
                           * Lifecycle chip / "Order again" button comes FIRST
                           * (left side of the cluster) so the status reads
                           * before the dollar amount: e.g. `DELIVERED
                           * SUBTOTAL: $1.00`. Mirrors how a receipt headline
                           * leads with state, then settles into the number.
                           */}
                          <div className="project-clad-order-summary-lifecycle-cluster">
                            {renderOrderLifecycleHeaderAction(job)}
                          </div>
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
                        </div>
                      </div>
                    </summary>
                    <div className="project-clad-stack" style={{ position: "relative" }}>
                      {job.items.length === 0 ? (
                        <div className="project-clad-order-empty-with-totals">
                          <p className="project-clad-muted" style={{ marginBottom: "0.75rem" }}>
                            No items saved. Add products from the{" "}
                            <a
                              href={browseHref.shopUrl}
                              className="project-clad-order-empty-browse-link"
                              data-projectclad-no-transition
                            >
                              shop
                            </a>{" "}
                            or{" "}
                            <a
                              href={browseHref.customPartUrl}
                              className="project-clad-order-empty-browse-link"
                              data-projectclad-no-transition
                            >
                              custom part
                            </a>{" "}
                            builder, then save to this order.
                          </p>
                          <OrderFinancePanel
                            jobSubtotal={job.subtotal}
                            jobDisplayTax={jobDisplayTax}
                            jobDeliveryFeeAmount={jobDeliveryFeeAmount}
                            jobTotalWithDisplayTax={jobTotalWithDisplayTax}
                            totalQty={totalQty}
                            preferredDeliveryLine={preferredDeliveryLine}
                            poFooterDisplay={poFooterDisplay}
                            orderFootShopify={orderFootShopify}
                            pricingUnlocked={pricingUnlocked}
                            taxRatePercent={Math.round(ORDER_DISPLAY_TAX_RATE * 100)}
                            shipProvince={project.shipProvince}
                            isDelivery={jobIsDelivery}
                            deliveryAddress={jobDeliveryAddress}
                            siteContactName={job.siteContactName}
                            siteContactPhone={job.siteContactPhone}
                            jobId={job.id}
                            canEditSiteContact={Boolean(canEdit)}
                            canEditPurchaseOrder={Boolean(canEdit)}
                            projectId={project.id}
                            projectFormActionUrl={projectFormActionUrl}
                            hasPurchaseOrderPdf={job.hasPurchaseOrderPdf}
                            purchaseOrderPdfFileName={job.purchaseOrderPdfFileName}
                            purchaseOrderPdfUrl={job.purchaseOrderPdfUrl}
                            actionsSlot={orderFinanceActionsSlot}
                            paymentSummaryPdfActions={paymentSummaryPdfActionsSlot}
                          />
                        </div>
                      ) : (
                      <div className="project-clad-table-x-scroll">
                      <table className="project-clad-table project-clad-orders-table">
                          <thead className="project-clad-sr-only">
                            <tr>
                              <th>Product</th>
                              <th>Details</th>
                              <th>Quantity</th>
                              <th>Price</th>
                              {canEdit && !job.isLocked && <th>Actions</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {job.items.map((item) => {
                              const lineColSpan = orderLinesTableColSpan(
                                Boolean(canEdit && !job.isLocked),
                              );
                              const unitN = Number(item.priceSnapshot);
                              const lineTotalDisplay = Number.isFinite(unitN)
                                ? (unitN * item.quantity).toFixed(2)
                                : "0.00";
                              const showLineActions = Boolean(canEdit && !job.isLocked);
                              return (
                              <tr
                                key={item.id}
                                data-projectclad-item-row
                                data-item-id={item.id}
                                data-job-id={job.id}
                              >
                                <td
                                  colSpan={lineColSpan}
                                  className="project-clad-order-line-full-cell"
                                >
                                  <div className="project-clad-order-line-tile project-clad-order-line-tile--line-item">
                                    <div
                                      className={[
                                        "project-clad-order-line-tile__grid",
                                        showLineActions
                                          ? "project-clad-order-line-tile__grid--with-actions"
                                          : "",
                                      ]
                                        .filter(Boolean)
                                        .join(" ")}
                                    >
                                      <div className="project-clad-order-line-tile__col project-clad-order-line-tile__col--thumb">
                                        <div className="project-clad-order-line-body">
                                          <div className="project-clad-order-line-tile__row">
                                            <span
                                              className="project-clad-order-line-num"
                                              aria-label={`Line ${item.sortOrder}`}
                                            >
                                              {item.sortOrder}
                                            </span>
                                            <OrderLineThumbMedia item={item} />
                                          </div>
                                        </div>
                                      </div>
                                      <div className="project-clad-order-line-tile__col project-clad-order-line-tile__col--details">
                                        <OrderLineDetailsColumn
                                          item={item}
                                          reorderOpen={
                                            canEdit &&
                                            isReorderEligibleOrderLifecycle(
                                              job.orderLifecycleStatus,
                                            ) &&
                                            item.quantity > 0 &&
                                            String(item.variantId || "").trim()
                                              ? {
                                                  itemId: item.id,
                                                  defaultQty: item.quantity,
                                                  lineLabel: item.displayName,
                                                }
                                              : null
                                          }
                                        />
                                      </div>
                                      <div
                                        className="project-clad-order-line-tile__col project-clad-order-line-tile__col--qty project-clad-table-right"
                                        data-projectclad-order-line-qty-col
                                      >
                                        <span className="project-clad-normal-view project-clad-order-card-qty-wrap">
                                          <span className="project-clad-order-card-qty-label">QTY:</span>
                                          <span className="project-clad-order-card-qty">{item.quantity}</span>
                                        </span>
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
                                      </div>
                                      <div
                                        className="project-clad-order-line-tile__col project-clad-order-line-tile__col--price project-clad-table-right"
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
                                          <div className="project-clad-order-card-price-stack project-clad-normal-view">
                                            <div className="project-clad-order-card-price-unit-block">
                                              <span
                                                className="project-clad-order-card-price-unit-label"
                                                aria-hidden="true"
                                              >
                                                Unit cost
                                              </span>
                                              <span className="project-clad-order-card-price-unit">
                                                {formatPrice(item.priceSnapshot)}
                                              </span>
                                              <span className="project-clad-order-card-price-each">
                                                per unit
                                              </span>
                                            </div>
                                            <div className="project-clad-order-card-price-line">
                                              <span className="project-clad-order-card-price-total-label">
                                                Total
                                              </span>{" "}
                                              <strong>{formatPrice(lineTotalDisplay)}</strong>
                                            </div>
                                          </div>
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
                                                // Non-pricing-staff path: no inline note
                                                // in the Edit order form — the locked input
                                                // itself communicates that prices aren't
                                                // editable here.
                                                null
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
                                      </div>
                                      {canEdit && !job.isLocked ? (
                                        <div className="project-clad-order-line-tile__col project-clad-order-line-tile__col--actions project-clad-table-right">
                                          <div className="project-clad-stack">
                                            <div className="project-clad-normal-view" data-projectclad-item-actions />
                                            <div className="project-clad-edit-view" style={{ display: "none" }} data-projectclad-item-actions>
                                              <div
                                                style={{
                                                  display: "flex",
                                                  gap: "0.5rem",
                                                  marginBottom: "0.5rem",
                                                }}
                                              >
                                                <button
                                                  type="button"
                                                  className="project-clad-button"
                                                  data-projectclad-item-move
                                                  data-direction="up"
                                                  data-item-id={item.id}
                                                  data-job-id={job.id}
                                                  aria-label={`Move ${item.displayName} up`}
                                                >
                                                  Move up
                                                </button>
                                                <button
                                                  type="button"
                                                  className="project-clad-button"
                                                  data-projectclad-item-move
                                                  data-direction="down"
                                                  data-item-id={item.id}
                                                  data-job-id={job.id}
                                                  aria-label={`Move ${item.displayName} down`}
                                                >
                                                  Move down
                                                </button>
                                              </div>
                                              <Form
                                                method="post"
                                                action={`/apps/project-clad/project?id=${project.id}`}
                                                style={{ display: "inline" }}
                                                data-projectclad-confirm="Are you sure you want to remove this item?"
                                              >
                                                <input type="hidden" name="intent" value="delete-item" />
                                                <input type="hidden" name="itemId" value={item.id} />
                                                <button type="submit" className="project-clad-button">
                                                  Remove
                                                </button>
                                              </Form>
                                            </div>
                                          </div>
                                        </div>
                                      ) : null}
                                      <OrderLineUnknownVariantNotice item={item} />
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            );
                            })}
                          </tbody>
                        <tfoot>
                          <tr className="project-clad-order-tfoot-row project-clad-order-tfoot-row--summary-block">
                            <td
                              colSpan={orderLinesTableColSpan(Boolean(canEdit && !job.isLocked))}
                              className="project-clad-order-tfoot-summary-cell"
                            >
                              <OrderFinancePanel
                                jobSubtotal={job.subtotal}
                                jobDisplayTax={jobDisplayTax}
                                jobDeliveryFeeAmount={jobDeliveryFeeAmount}
                                jobTotalWithDisplayTax={jobTotalWithDisplayTax}
                                totalQty={totalQty}
                                preferredDeliveryLine={preferredDeliveryLine}
                                poFooterDisplay={poFooterDisplay}
                                orderFootShopify={orderFootShopify}
                                pricingUnlocked={pricingUnlocked}
                                taxRatePercent={Math.round(ORDER_DISPLAY_TAX_RATE * 100)}
                                shipProvince={project.shipProvince}
                                isDelivery={jobIsDelivery}
                                deliveryAddress={jobDeliveryAddress}
                                siteContactName={job.siteContactName}
                                siteContactPhone={job.siteContactPhone}
                                jobId={job.id}
                                canEditSiteContact={Boolean(canEdit)}
                                canEditPurchaseOrder={Boolean(canEdit)}
                                projectId={project.id}
                                projectFormActionUrl={projectFormActionUrl}
                                hasPurchaseOrderPdf={job.hasPurchaseOrderPdf}
                                purchaseOrderPdfFileName={job.purchaseOrderPdfFileName}
                                purchaseOrderPdfUrl={job.purchaseOrderPdfUrl}
                                actionsSlot={orderFinanceActionsSlot}
                                paymentSummaryPdfActions={paymentSummaryPdfActionsSlot}
                              />
                            </td>
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
                            data-projectclad-busy-label="Approving…"
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
                      const awaiting = isOrderAwaitingApproval(job.id);
                      const showLineItemEditPanel = !awaiting || viewerCanFulfill;
                      return (
                    <div
                      className="project-clad-actions project-clad-order-actions"
                      data-projectclad-order-section
                      data-job-id={job.id}
                      style={{
                        flexDirection: "column",
                        alignItems: "stretch",
                        gap: "0.75rem",
                      }}
                    >
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
                    {/* Delivery photos: Documents tab → Photo column per confirmed delivery. */}
                    </div>
                  </details>
                  </div>
                );
                  })}
                </div>
              )}
              <div
                id="project-clad-comments"
                className="project-clad-cc-v2-bottom-grid"
                role="region"
                aria-label="Comments, activity, and project totals"
              >
                <div
                  className="project-clad-cc-v2-tile project-clad-cc-v2-tile--comments"
                  aria-labelledby="project-clad-cc-v2-comments-label"
                >
                  <p id="project-clad-cc-v2-comments-label" className="project-clad-cc-v2-tile__label">
                    Comments
                  </p>
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
                            placeholder="Write a comment"
                            aria-label="Write a comment"
                            style={{ width: "100%", maxWidth: "100%" }}
                          />
                        </div>
                      </div>
                      <button
                        type="submit"
                        className="project-clad-button project-clad-comments-post-btn"
                      >
                        Add comment
                      </button>
                    </div>
                  </Form>
                  <div className="project-clad-activity-feed__scroll project-clad-cc-v2-comments-scroll">
                    {projectCommentTimeline.length === 0 ? (
                      <p className="project-clad-muted">No comments yet.</p>
                    ) : (
                      <ul className="project-clad-activity-feed__list">
                        {projectCommentTimeline.map((item) => (
                          <li
                            key={`c-${item.id}`}
                            className="project-clad-activity-feed__comment-item project-clad-comments-card"
                          >
                            {item.deletedAt ? (
                              <p
                                className="project-clad-muted project-clad-comments-card__deleted"
                                style={{ fontStyle: "italic", margin: 0 }}
                              >
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
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div
                  className="project-clad-cc-v2-tile project-clad-cc-v2-tile--activity"
                  aria-labelledby="project-clad-cc-v2-activity-label"
                >
                  <p id="project-clad-cc-v2-activity-label" className="project-clad-cc-v2-tile__label">
                    Activity
                  </p>
                  <div className="project-clad-cc-v2-activity-scroll">
                    {projectActivityTimeline.length === 0 ? (
                      <p className="project-clad-muted">No activity yet.</p>
                    ) : (
                      <ul className="project-clad-cc-v2-activity-feed__list">
                        {projectActivityTimeline.map((item) => (
                          <ProjectCcV2ActivityRow
                            key={`a-${item.id}`}
                            item={item}
                            viewerIsAdmin={viewerIsAdmin}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="project-clad-cc-v2-tile project-clad-cc-v2-tile--totals project-clad-orders-shell__footer project-clad-project-totals-card">
                  <p className="project-clad-project-totals-card__heading">Your Project Total</p>
                  <div className="project-clad-summary-row project-clad-cc-v2-totals-line">
                    <div>
                      <h2
                        className="project-clad-title project-clad-project-footer-metric-label"
                        style={{ marginBottom: 0 }}
                      >
                        Project Subtotal
                      </h2>
                    </div>
                    <div
                      className="project-clad-summary-action"
                      data-projectclad-price
                      data-price={projectSubtotalForDisplay.toFixed(2)}
                    >
                      {pricingUnlocked ? (
                        formatPrice(projectSubtotalForDisplay.toFixed(2))
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
                  <div className="project-clad-summary-row project-clad-project-footer-tax-row project-clad-cc-v2-totals-line project-clad-cc-v2-totals-line--tax">
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
                  <div className="project-clad-summary-row project-clad-project-footer-total-row project-clad-cc-v2-totals-grand">
                    <div>
                      <h2
                        className="project-clad-title project-clad-project-footer-metric-label"
                        style={{ marginBottom: 0 }}
                      >
                        Project Total
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
              </div>
              {canEdit ? (
                <div className="project-clad-orders-shell__edit-project-footer">
                  <button
                    type="button"
                    className="project-clad-orders-page-edit-project project-clad-orders-shell__edit-project-footer-btn"
                    data-projectclad-edit-project-details
                  >
                    Edit project
                  </button>
                </div>
              ) : null}
            </div>
          </section>

          <script dangerouslySetInnerHTML={{ __html: proxyScriptConfig }} />
          <script src={proxyScriptSrcs.main} />

        </div>
        <ProjectCladStorefrontFooter
          logoSrc={logoUrl}
          logoAlt="Canadian Cladding"
          logoHref="/"
        />
      </main>
      <script
        dangerouslySetInnerHTML={{ __html: PROJECT_CLAD_CURSOR_GLOW_SCRIPT }}
      />
      <script src={proxyScriptSrcs.customerSearch} />
      <script src={proxyScriptSrcs.pageTransitions} />
      {/*
        Product-drawing lightbox (vanilla JS).

        Why this is an inline script and not a React component:
        the project-clad app proxy serves this route via the storefront
        (`projectclad.myshopify.com/apps/project-clad/...`). The browser
        receives the SSR HTML but Vite's module URLs resolve against the
        storefront origin and 404, so React never hydrates here. Every other
        interactive bit on this page (order-now, edit-project, member popover,
        etc.) is implemented as an inline `<script>` for the same reason.

        Triggers: any element with `data-projectclad-line-thumb-preview` and
        `data-pc-image-src` (+ optional `data-pc-image-alt`). The thumbnail
        button in `OrderLineThumbMedia` and the title button in
        `OrderLineDetailsColumn` both qualify.

        Behavior:
        - Click trigger → fade in fullscreen lightbox with the image
        - Close on backdrop click, ESC, or X button (top-right, 24px inset)
        - Click on the image itself does NOT close (stopPropagation on figure)
        - Body scroll locked while open; previous overflow restored on close
        - 180ms fade in/out via the `.is-open` class
        - Focus moves to close button on open, returns to opener on close

        DOM mounted on document.body so it escapes any stacking context. Uses
        the existing `.project-clad-line-image-lightbox*` styles in
        `app/styles/project-clad-proxy.css`.
      */}
      <script src={proxyScriptSrcs.lineImageLightbox} />
      {/*
        Orders-list interactive sort.

        Why this is an inline script and not React: this route is served via
        the Shopify app proxy where React doesn't hydrate, so useState can't
        drive the order of cards. We mirror the Projects-list pattern (see
        `app/routes/apps.project-clad.projects.tsx`) but adapted for the
        Orders shape. The default sort ("recent") is also applied
        server-side via `sortFilteredJobs(filtered, "recent")` so the SSR
        order matches the inline script's initial state — no flicker on load.

        Sort keys read straight off the row's data attributes:
          data-pc-order-created-ms     number  (Date.getTime())
          data-pc-order-name           string  (lowercased)
          data-pc-order-subtotal       number  (already a number from the wire)
          data-pc-order-status-rank    number  (0..4: draft → delivered, 5 = unknown)

        Reorders `.project-clad-order-row-shell` siblings inside the orders
        grid. Toggles `.is-active` on `[data-pc-orders-sort]` chips. No
        Array.prototype.sort key drift: ties broken by created-ms desc so the
        order is deterministic across renders.
      */}
      <script src={proxyScriptSrcs.ordersSort} />
      {/*
        PO PDF auto-upload (vanilla JS).

        React does not hydrate on the app-proxy project page, so file inputs
        cannot use onChange handlers. Submit the native multipart form as soon
        as the user picks a PDF.
      */}
      <script src={proxyScriptSrcs.poPdfUpload} />
      {/*
        Breadcrumb back-to-Projects link.

        Lives in its own inline script for the same hydration reason as the
        rest of the interactive bits on this page. Capture phase + explicit
        navigation so it cannot be undercut by the SPA-link transition
        handler or any other interceptor; the link also carries
        `data-projectclad-no-transition` so the SPA handler skips it
        entirely and we own the navigation here.
      */}
      <script src={proxyScriptSrcs.projectsLinkNav} />
      {/*
        Dismissible error banners (vanilla JS).

        One delegated click handler for every `data-pc-dismiss-banner` button above. It
        removes the banner and strips the query param that renders it, so a refresh does
        not bring it back and `role="alert"` does not re-announce it.
      */}
      <script src={proxyScriptSrcs.bannerDismiss} />
      {/*
        Unsaved-work guard (vanilla JS).

        This page hosts many independent forms at once and every mutation ends in a full
        reload, which used to wipe everything typed into the other forms. The guard tracks
        which forms are dirty, snapshots them to sessionStorage before any scripted reload
        and restores them afterwards, and arms a beforeunload prompt for departures the
        browser owns (tab close, back button, ordinary links).

        Loaded LAST on purpose: its document-level `submit` listener has to run after the
        ajax hub in `project-main.js` so it can tell a native submit (which navigates away
        now, and must be snapshotted here) from an ajax one (which preventDefaults and
        reloads through `pcReload` later).
      */}
      <script src={proxyScriptSrcs.dirtyGuard} />
    </>
  );
}

export const links: LinksFunction = () => [];
