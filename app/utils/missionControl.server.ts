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
import {
  computeDeliveredPercent,
  mapPhasesToViews,
  totalDeliveryFeesFromPhases,
} from "./jobDeliveryPhases";
import { resolveJobDelivery } from "./jobDelivery";
import { orderTaxFromSubtotal } from "./orderDisplayTax";
import { getShopDeliveryFee } from "./shopDeliveryFee.server";

/**
 * Push order/project snapshots to Mission Control (LAN ops dashboard).
 *
 * Env (Project Clad host):
 *   MISSION_CONTROL_INGEST_KEY=<same as MC INGEST_API_KEY>  (required for MC pull sync)
 *   MISSION_CONTROL_URL=http://<lan-server>:4000            (optional instant push)
 *   MISSION_CONTROL_SHOPS=rnc2a0-d3.myshopify.com           (comma-separated; default live store)
 *   MISSION_CONTROL_ALLOW_DEV=1                             (optional — allow dev shop pushes)
 *
 * LAN autosync: Mission Control polls GET /api/mission-control-sync on this host.
 * Never throws — MC outages must not block storefront/admin flows.
 */

type McStatus =
  | "draft"
  | "submitted"
  | "ready_to_order"
  | "ordered"
  | "delivered"
  | "invoiced"
  | "paid";

function mapLifecycleStatus(pcStatus: string): McStatus {
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

/** Paid wins; else invoiced when customer invoice email was sent. */
function mapOrderStatus(job: {
  orderLifecycleStatus: string;
  paidAt: Date | null;
  invoiceEmailedAt: Date | null;
}): McStatus {
  if (job.orderLifecycleStatus === "paid" || job.paidAt) {
    return "paid";
  }
  if (job.invoiceEmailedAt) {
    return "invoiced";
  }
  return mapLifecycleStatus(job.orderLifecycleStatus);
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

type McJob = NonNullable<Awaited<ReturnType<typeof loadJobForMissionControl>>>;

/** Match project page order total: lines + confirmed delivery fees + 13% HST. */
async function orderMoneyForMissionControl(
  job: McJob,
  phaseViews: ReturnType<typeof mapPhasesToViews>,
): Promise<{
  subtotalCents: number;
  deliveryFeeCents: number;
  taxCents: number;
  totalCents: number;
}> {
  const shopDeliveryFee = await getShopDeliveryFee(job.project.shop);
  const projectCtx = {
    shipAddress1: job.project.shipAddress1,
    shipCity: job.project.shipCity,
    shipProvince: job.project.shipProvince,
    shipPostal: job.project.shipPostal,
    shipCountry: job.project.shipCountry,
    receiveMode: job.project.receiveMode,
  };
  const resolved = resolveJobDelivery(job, projectCtx, shopDeliveryFee);
  let deliveryFee = 0;
  if (resolved.method === "delivery") {
    deliveryFee = totalDeliveryFeesFromPhases(phaseViews, resolved, shopDeliveryFee);
  }
  const subtotalDollars = job.items.reduce(
    (s, item) => s + Number(item.priceSnapshot) * item.quantity,
    0,
  );
  const taxable = subtotalDollars + deliveryFee;
  const taxDollars = orderTaxFromSubtotal(taxable, { pricesIncludeTax: false });
  const totalDollars = subtotalDollars + deliveryFee + taxDollars;
  const toCents = (d: number) => Math.round(d * 100);
  return {
    subtotalCents: toCents(subtotalDollars),
    deliveryFeeCents: toCents(deliveryFee),
    taxCents: toCents(taxDollars),
    totalCents: toCents(totalDollars),
  };
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

function fieldSummary(
  title: string,
  customData: { name: string; value: string }[],
  geo: { gauge: string; color: string | null; lengthIn: number },
): string {
  const flat: { name: string; value: string }[] = [];
  for (const f of customData) {
    const name = f.name.trim();
    const val = f.value.trim();
    if (val.startsWith("{") && val.endsWith("}")) {
      try {
        const obj = JSON.parse(val) as Record<string, unknown>;
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          for (const [k, v] of Object.entries(obj)) {
            const s = String(v ?? "").trim();
            if (s && !s.startsWith("{")) flat.push({ name: String(k), value: s });
          }
          continue;
        }
      } catch {
        /* keep */
      }
    }
    if (val.startsWith("{")) continue;
    if (name) flat.push({ name, value: val });
  }

  const chunks = [title.trim() || "Part"];
  const meta = [geo.gauge, geo.color ?? ""].filter(Boolean);
  if (meta.length) chunks.push(meta.join(" "));

  const dimTokens: { order: number; text: string }[] = [];
  for (const f of flat) {
    const lower = f.name.toLowerCase();
    const val = f.value.trim();
    if (!val || val === "0") continue;
    const leg = /^l(\d+)$/.exec(lower);
    if (leg) {
      dimTokens.push({ order: Number.parseInt(leg[1], 10), text: `L${leg[1]}=${val}` });
      continue;
    }
    const angle = /^a(\d+)$/.exec(lower);
    if (angle) {
      dimTokens.push({
        order: 100 + Number.parseInt(angle[1], 10),
        text: `A${angle[1]}=${val}`,
      });
    }
  }
  if (dimTokens.length) {
    dimTokens.sort((a, b) => a.order - b.order);
    chunks.push(dimTokens.map((t) => t.text).join(" | "));
  }

  if (geo.lengthIn > 0) chunks.push(`${geo.lengthIn}"`);
  return chunks.join(" | ");
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

function parseShopList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Live production shop only — dev store pushes are skipped unless explicitly allowed. */
function shouldPushShop(shop: string): boolean {
  if (process.env.MISSION_CONTROL_ALLOW_DEV === "1") return true;
  const allowed = parseShopList(
    process.env.MISSION_CONTROL_SHOPS ?? "rnc2a0-d3.myshopify.com",
  );
  return allowed.includes(shop.trim().toLowerCase());
}

async function loadJobForMissionControl(jobId: string) {
  return prisma.job.findUnique({
    where: { id: jobId },
    include: {
      project: { include: { members: true } },
      items: { orderBy: { sortOrder: "asc" } },
      orderLink: true,
      deliveryPhases: {
        include: { lines: true },
        orderBy: { sequence: "asc" },
      },
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

  const phaseViews = mapPhasesToViews(job.deliveryPhases);
  const deliveredPercent = computeDeliveredPercent(job.items, phaseViews);
  const confirmedDeliveryCount = phaseViews.filter((p) => p.hasPhoto).length;
  const openPhase = phaseViews.find((p) => !p.hasPhoto) ?? null;

  const deliveredByItem = new Map<string, number>();
  for (const item of job.items) {
    deliveredByItem.set(item.id, 0);
  }
  for (const phase of job.deliveryPhases) {
    for (const line of phase.lines) {
      const prev = deliveredByItem.get(line.jobItemId) ?? 0;
      deliveredByItem.set(
        line.jobItemId,
        prev + Math.max(0, line.quantityDelivered),
      );
    }
  }

  const latestPhaseWithPhoto = [...job.deliveryPhases]
    .reverse()
    .find((p) => p.fulfillmentPhotoStorageKey);
  const deliveryPhotoUrl = latestPhaseWithPhoto
    ? buildSignedFulfillmentPhotoUrl({
        jobId: job.id,
        shop,
        phaseId: latestPhaseWithPhoto.id,
      })
    : job.fulfillmentPhotoStorageKey
      ? buildSignedFulfillmentPhotoUrl({ jobId: job.id, shop })
      : null;

  const shipAddress = formatShipAddress(job.project);
  const status = mapOrderStatus(job);

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
    const qtyDelivered = Math.min(
      item.quantity,
      deliveredByItem.get(item.id) ?? 0,
    );

    return {
      id: item.id,
      title,
      sku: snap?.sku ?? item.catalogSku ?? null,
      quantity: item.quantity,
      quantityDelivered: qtyDelivered,
      unitPriceCents,
      customData,
      displaySummary: fieldSummary(title, customData, geo),
      gauge: geo.gauge,
      color: geo.color,
      girthIn: geo.girthIn,
      lengthIn: geo.lengthIn,
    };
  });

  const money = await orderMoneyForMissionControl(job, phaseViews);

  return {
    event: `job.${status}`,
    sentAt: new Date().toISOString(),
    project: {
      id: job.project.id,
      shop: job.project.shop,
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
      subtotalCents: money.subtotalCents,
      deliveryFeeCents: money.deliveryFeeCents,
      taxCents: money.taxCents,
      totalCents: money.totalCents,
      scheduledDeliveryDate:
        openPhase?.scheduledDeliveryDate ?? job.scheduledDeliveryDate ?? null,
      scheduledDeliveryWindow:
        openPhase?.scheduledDeliveryWindow ?? job.scheduledDeliveryWindow ?? null,
      shipAddress,
      createdAt: iso(job.createdAt) ?? new Date().toISOString(),
      orderedAt: iso(confirmed?.createdAt),
      deliveredAt: iso(job.completedAt),
      invoicedAt: iso(job.invoiceEmailedAt),
      paidAt: iso(job.paidAt),
      deliveryPhotoUrl,
      deliveredPercent,
      deliveryPhaseCount: phaseViews.length,
      confirmedDeliveryCount,
      deliveryPhases: job.deliveryPhases.map((phase) => ({
        id: phase.id,
        sequence: phase.sequence,
        scheduledDeliveryDate: phase.scheduledDeliveryDate ?? null,
        scheduledDeliveryWindow: phase.scheduledDeliveryWindow ?? null,
        hasPhoto: Boolean(phase.fulfillmentPhotoStorageKey),
        deliveredAt: iso(phase.deliveredAt),
        deliveryPhotoUrl: phase.fulfillmentPhotoStorageKey
          ? buildSignedFulfillmentPhotoUrl({
              jobId: job.id,
              shop,
              phaseId: phase.id,
            })
          : null,
        lines: phase.lines.map((line) => ({
          jobItemId: line.jobItemId,
          quantityPlanned: line.quantityPlanned,
          quantityDelivered: line.quantityDelivered,
        })),
      })),
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

  if (!shouldPushShop(job.project.shop)) {
    console.log(
      `[mission-control] skip — shop ${job.project.shop} is not in MISSION_CONTROL_SHOPS (set MISSION_CONTROL_ALLOW_DEV=1 to push dev data).`,
    );
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
    console.error(
      `[mission-control] push failed ${res.status} job=${job.id} #${job.orderNumber ?? "?"}: ${body.slice(0, 600)}`,
    );
    return false;
  }

  console.log(
    `[mission-control] pushed job=${job.id} #${job.orderNumber ?? "?"} ${job.name} (${job.orderLifecycleStatus})`,
  );
  return true;
}

function mcApiConfig(): { base: string; key: string } | null {
  const base = process.env.MISSION_CONTROL_URL?.trim();
  const key = process.env.MISSION_CONTROL_INGEST_KEY?.trim();
  if (!base || !key) return null;
  return { base: base.replace(/\/+$/, ""), key };
}

/** Tell Mission Control to drop a deleted job. */
export async function removeOrderFromMissionControl(args: {
  jobId: string;
  shop: string;
}): Promise<boolean> {
  const cfg = mcApiConfig();
  if (!cfg) return false;

  if (!shouldPushShop(args.shop)) return false;

  const res = await fetch(`${cfg.base}/ingest/project-clad/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mc-ingest-key": cfg.key },
    body: JSON.stringify({
      shop: args.shop,
      jobId: args.jobId,
      sentAt: new Date().toISOString(),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[mission-control] delete failed ${res.status}: ${body.slice(0, 600)}`);
    return false;
  }

  return true;
}

/** After backfill: remove MC orders for this shop that no longer exist in Project Clad. */
export async function syncShopOrdersInMissionControl(
  shop: string,
  jobIds: string[],
): Promise<boolean> {
  const cfg = mcApiConfig();
  if (!cfg) return false;

  if (!shouldPushShop(shop)) return false;

  const res = await fetch(`${cfg.base}/ingest/project-clad/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mc-ingest-key": cfg.key },
    body: JSON.stringify({
      shop,
      jobIds,
      sentAt: new Date().toISOString(),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[mission-control] sync failed ${res.status}: ${body.slice(0, 600)}`);
    return false;
  }

  const data = (await res.json().catch(() => null)) as { pruned?: number } | null;
  if (data?.pruned) {
    console.log(`[mission-control] pruned ${data.pruned} stale order(s) for ${shop}`);
  }
  return true;
}

/** Fire-and-forget wrapper for action handlers. */
export function notifyMissionControlRemove(jobId: string, shop: string): void {
  void removeOrderFromMissionControl({ jobId, shop }).catch((err) => {
    console.error(
      "[mission-control] delete error:",
      err instanceof Error ? err.message : String(err),
    );
  });
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

const MC_EXPORT_STATUSES = [
  "draft",
  "pending_review",
  "ready_to_order",
  "ordered",
  "delivered",
  "paid",
] as const;

/** Verify the shared ingest key Mission Control sends when pulling sync data. */
export function verifyMissionControlIngestKey(request: Request): boolean {
  const key = request.headers.get("x-mc-ingest-key")?.trim();
  const expected = process.env.MISSION_CONTROL_INGEST_KEY?.trim();
  return Boolean(key && expected && key === expected);
}

async function listChangedMissionControlJobIds(
  shop: string,
  since: Date,
): Promise<string[]> {
  const ids = new Set<string>();

  const [datedJobs, activityJobs] = await Promise.all([
    prisma.job.findMany({
      where: {
        project: { shop },
        OR: [
          { completedAt: { gte: since } },
          { paidAt: { gte: since } },
          { invoiceEmailedAt: { gte: since } },
          { createdAt: { gte: since } },
          { deliveryPhases: { some: { updatedAt: { gte: since } } } },
        ],
      },
      select: { id: true },
    }),
    prisma.projectActivityEvent.findMany({
      where: {
        createdAt: { gte: since },
        jobId: { not: null },
        project: { shop },
      },
      select: { jobId: true },
      distinct: ["jobId"],
    }),
  ]);

  for (const job of datedJobs) ids.add(job.id);
  for (const row of activityJobs) {
    if (row.jobId) ids.add(row.jobId);
  }

  return [...ids];
}

async function listAllMissionControlJobIds(shop: string): Promise<string[]> {
  const jobs = await prisma.job.findMany({
    where: {
      project: { shop },
      orderLifecycleStatus: { in: [...MC_EXPORT_STATUSES] },
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  return jobs.map((job) => job.id);
}

/** Build ingest payloads for Mission Control pull sync (LAN dashboard polls this host). */
export async function exportMissionControlSync(args: {
  shop: string;
  since?: Date | null;
  full?: boolean;
}): Promise<{
  shop: string;
  jobIds: string[];
  orders: Awaited<ReturnType<typeof buildIngestPayload>>[];
  exportedAt: string;
  mode: "full" | "incremental";
}> {
  const shop = args.shop.trim();
  if (!shouldPushShop(shop)) {
    return {
      shop,
      jobIds: [],
      orders: [],
      exportedAt: new Date().toISOString(),
      mode: args.full ? "full" : "incremental",
    };
  }

  const full = Boolean(args.full || !args.since);
  const jobIds = full
    ? await listAllMissionControlJobIds(shop)
    : await listChangedMissionControlJobIds(shop, args.since!);

  const orders: Awaited<ReturnType<typeof buildIngestPayload>>[] = [];
  for (const jobId of jobIds) {
    const job = await loadJobForMissionControl(jobId);
    if (!job) continue;
    if (!MC_EXPORT_STATUSES.includes(job.orderLifecycleStatus)) continue;
    orders.push(await buildIngestPayload(job));
  }

  return {
    shop,
    jobIds: orders.map((order) => order.order.jobId),
    orders,
    exportedAt: new Date().toISOString(),
    mode: full ? "full" : "incremental",
  };
}
