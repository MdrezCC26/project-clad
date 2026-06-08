import prisma from "../db.server";
import {
  getCustomerRowFromFetchedMap,
  getCustomersByIds,
} from "./adminCustomers.server";
import { buildSignedFulfillmentPhotoUrl } from "./fulfillmentPhotoSignedUrl.server";
import { STOREFRONT_ORDER_CONFIRMED_ACTIVITY } from "./projectActivity.shared";
import {
  buildVariantPresentation,
  parseOrderLineCapture,
  parseVariantSnapshot,
  resolveVariantDisplayInfo,
} from "./variantInfo.server";

/**
 * Push order/project snapshots to Mission Control (LAN ops dashboard).
 *
 * Env (Project Clad host):
 *   MISSION_CONTROL_URL=http://<lan-server>:4000
 *   MISSION_CONTROL_INGEST_KEY=<same as MC API INGEST_API_KEY>
 *
 * Never throws — MC outages must not block storefront/admin flows.
 */

type McStatus =
  | "draft"
  | "submitted"
  | "ready_to_order"
  | "ordered"
  | "delivered"
  | "paid";

function mapStatus(pcStatus: string): McStatus {
  switch (pcStatus) {
    case "pending_review":
      return "submitted";
    case "draft":
    case "ready_to_order":
    case "ordered":
    case "delivered":
    case "paid":
      return pcStatus;
    default:
      return "ordered";
  }
}

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatShipAddress(project: {
  shipAddress1: string | null;
  shipAddress2: string | null;
  shipCity: string | null;
  shipProvince: string | null;
  shipPostal: string | null;
  shipCountry: string | null;
}): string | null {
  const parts = [
    project.shipAddress1,
    project.shipAddress2,
    [project.shipCity, project.shipProvince].filter(Boolean).join(", "),
    project.shipPostal,
    project.shipCountry,
  ]
    .map((p) => (p ?? "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function toCustomFields(customData: unknown): { name: string; value: string }[] {
  if (Array.isArray(customData)) {
    return customData
      .filter((r) => r && typeof r === "object")
      .map((r) => {
        const row = r as Record<string, unknown>;
        return {
          name: String(row.name ?? row.label ?? row.key ?? ""),
          value: String(row.value ?? row.val ?? ""),
        };
      })
      .filter((f) => f.name);
  }
  if (customData && typeof customData === "object") {
    return Object.entries(customData as Record<string, unknown>).map(([name, value]) => ({
      name,
      value: String(value),
    }));
  }
  return [];
}

function fieldSummary(title: string, fields: { name: string; value: string }[]): string {
  const head = fields.slice(0, 4).map((f) => f.value).filter(Boolean);
  return [title, ...head].join(" · ");
}

function clampIn(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function normalizeGauge(raw: string | null | undefined): string {
  if (!raw) return "24ga";
  const m = String(raw).match(/\d+/);
  return m ? `${m[0]}ga` : "24ga";
}

function toNum(v: unknown): number {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function geometryFromCustomData(customData: { name: string; value: string }[]) {
  const map = new Map(customData.map((f) => [f.name.trim().toLowerCase(), f.value]));
  const gauge = normalizeGauge(map.get("gauge"));
  const colorRaw = (map.get("color") ?? "").toString().trim();
  let girth = toNum(map.get("girth"));
  if (!girth) {
    let sum = 0;
    for (const [k, v] of map) if (/^l\d+$/.test(k)) sum += toNum(v);
    girth = sum;
  }
  const length = toNum(map.get("length"));
  return {
    gauge,
    color: colorRaw || null,
    girthIn: clampIn(girth, 0, 48),
    lengthIn: clampIn(length, 0, 120),
  };
}

async function loadJobForMissionControl(jobId: string) {
  return prisma.job.findUnique({
    where: { id: jobId },
    include: {
      project: { include: { members: true } },
      items: { orderBy: { sortOrder: "asc" } },
      orderLink: true,
    },
  });
}

async function buildIngestPayload(job: NonNullable<Awaited<ReturnType<typeof loadJobForMissionControl>>>) {
  const shop = job.project.shop;
  const variantIds = job.items.map((i) => i.variantId);
  let live: Awaited<ReturnType<typeof resolveVariantDisplayInfo>>["info"] = {};
  if (variantIds.length) {
    try {
      const resolved = await resolveVariantDisplayInfo(shop, variantIds);
      live = resolved.info;
    } catch {
      /* snapshots only */
    }
  }

  const memberIds = Array.from(
    new Set([job.project.ownerCustomerId, ...job.project.members.map((m) => m.customerId)]),
  );
  let customerInfo: Awaited<ReturnType<typeof getCustomersByIds>> = {};
  try {
    customerInfo = await getCustomersByIds(shop, memberIds);
  } catch {
    /* owner/member snapshots may be id-only */
  }

  const ownerRow = getCustomerRowFromFetchedMap(job.project.ownerCustomerId, customerInfo);
  const owner = {
    id: job.project.ownerCustomerId,
    email: ownerRow?.email ?? null,
    firstName: ownerRow?.firstName ?? null,
    lastName: ownerRow?.lastName ?? null,
    phone: ownerRow?.phone ?? null,
  };

  const members = job.project.members
    .filter((m) => m.customerId !== job.project.ownerCustomerId)
    .map((m) => {
      const row = getCustomerRowFromFetchedMap(m.customerId, customerInfo);
      return {
        id: m.customerId,
        email: row?.email ?? null,
        firstName: row?.firstName ?? null,
        lastName: row?.lastName ?? null,
        phone: row?.phone ?? null,
      };
    });

  const confirmed = await prisma.projectActivityEvent.findFirst({
    where: { jobId: job.id, type: STOREFRONT_ORDER_CONFIRMED_ACTIVITY },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });

  const deliveryPhotoUrl = job.fulfillmentPhotoStorageKey
    ? buildSignedFulfillmentPhotoUrl({ jobId: job.id, shop })
    : null;

  const shipAddress = formatShipAddress(job.project);
  const status = mapStatus(job.orderLifecycleStatus);

  const lines = job.items.map((item) => {
    const customData = toCustomFields(item.customData);
    const geo = geometryFromCustomData(customData);
    const snap = parseVariantSnapshot(item.variantSnapshot);
    const orderLineCapture = parseOrderLineCapture(item.orderLineCapture);
    const pres = buildVariantPresentation({
      shop,
      variantId: item.variantId,
      live: live[item.variantId],
      snapshot: snap,
    });
    const title =
      pres.source === "unknown" && orderLineCapture
        ? orderLineCapture.displayLabel
        : pres.displayName;
    const unitPriceCents = Math.round(Number(item.priceSnapshot) * 100);

    return {
      id: item.id,
      title,
      sku: snap?.sku ?? item.catalogSku ?? null,
      quantity: item.quantity,
      unitPriceCents,
      customData,
      displaySummary: fieldSummary(title, customData),
      gauge: geo.gauge,
      color: geo.color,
      girthIn: geo.girthIn,
      lengthIn: geo.lengthIn,
    };
  });

  return {
    event: `job.${job.orderLifecycleStatus}`,
    sentAt: new Date().toISOString(),
    project: {
      id: job.project.id,
      name: job.project.name,
      companyName: job.project.companyName ?? null,
      storefrontStatus: job.project.storefrontStatus,
      shipAddress,
      createdAt: iso(job.project.createdAt) ?? new Date().toISOString(),
      ownerCustomerId: job.project.ownerCustomerId,
      owner,
      members,
    },
    order: {
      jobId: job.id,
      orderNumber: job.orderNumber,
      shopifyOrderName: job.orderLink?.orderName ?? null,
      title: job.name,
      company: job.project.companyName ?? null,
      status,
      currency: "CAD",
      scheduledDeliveryDate: job.scheduledDeliveryDate ?? null,
      shipAddress,
      createdAt: iso(job.createdAt) ?? new Date().toISOString(),
      orderedAt: iso(confirmed?.createdAt),
      deliveredAt: iso(job.completedAt),
      paidAt: iso(job.paidAt),
      deliveryPhotoUrl,
    },
    lines,
  };
}

/** Load fresh job state and POST to Mission Control ingest. Returns true when MC accepted the payload. */
export async function pushOrderToMissionControl(jobId: string): Promise<boolean> {
  const base = process.env.MISSION_CONTROL_URL?.trim();
  const key = process.env.MISSION_CONTROL_INGEST_KEY?.trim();
  if (!base || !key) {
    console.log(
      "[mission-control] skip — set MISSION_CONTROL_URL and MISSION_CONTROL_INGEST_KEY on the Project Clad host.",
    );
    return false;
  }

  const job = await loadJobForMissionControl(jobId);
  if (!job) {
    console.warn("[mission-control] job not found:", jobId);
    return false;
  }

  const payload = await buildIngestPayload(job);

  const res = await fetch(`${base.replace(/\/+$/, "")}/ingest/project-clad`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mc-ingest-key": key },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[mission-control] push failed ${res.status}: ${body.slice(0, 600)}`);
    return false;
  }

  return true;
}

/** Fire-and-forget wrapper for action handlers. */
export function notifyMissionControl(jobId: string): void {
  void pushOrderToMissionControl(jobId).catch((err) => {
    console.error(
      "[mission-control] push error:",
      err instanceof Error ? err.message : String(err),
    );
  });
}
