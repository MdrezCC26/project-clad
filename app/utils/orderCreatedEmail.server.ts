import prisma from "../db.server";
import { getCustomersByIds } from "./adminCustomers.server";
import {
  dedupeEmailAddresses,
  isEmailConfigured,
  sendEmail,
} from "./email.server";
import {
  buildVariantPresentation,
  parseVariantSnapshot,
  resolveVariantDisplayInfo,
  type VariantDisplayInfo,
} from "./variantInfo.server";

function formatMoney(amount: number): string {
  if (Number.isNaN(amount)) return "$0.00";
  return `$${amount.toFixed(2)}`;
}

function propertiesBlock(
  props?: { name: string; value: string }[] | null,
): string {
  if (!props?.length) return "";
  const lines = props
    .filter((p) => p.name && !String(p.name).startsWith("__"))
    .map((p) => `      · ${p.name}: ${p.value}`);
  return lines.length ? `\n      Properties:\n${lines.join("\n")}` : "";
}

async function collectRecipientEmails(
  shop: string,
  ownerCustomerId: string,
  actorCustomerId: string,
): Promise<string[]> {
  const fromEnv =
    process.env.PROJECTCLAD_ORDER_NOTIFY_EMAIL?.split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const list: string[] = [...fromEnv];
  const ids = Array.from(new Set([ownerCustomerId, actorCustomerId]));
  try {
    const info = await getCustomersByIds(shop, ids);
    for (const id of ids) {
      const e = info[id]?.email?.trim();
      if (e) list.push(e);
    }
  } catch {
    // Owner/actor lookup failed; still notify env addresses if any.
  }
  return dedupeEmailAddresses(list);
}

/** Full project: every order and line with labels, variant ids, qty, prices (for staff to replace bad variants). */
export async function buildFullProjectSnapshotText(
  shop: string,
  projectId: string,
): Promise<string> {
  const project = await prisma.project.findFirst({
    where: { id: projectId },
    include: {
      jobs: {
        orderBy: { sortOrder: "asc" },
        include: {
          items: { orderBy: { sortOrder: "asc" } },
          orderLink: true,
        },
      },
    },
  });

  if (!project) {
    return "(Project not found in database.)";
  }

  const variantIds = project.jobs.flatMap((j) =>
    j.items.map((i) => i.variantId),
  );
  let live: Record<string, VariantDisplayInfo> = {};
  if (variantIds.length > 0) {
    try {
      const { info } = await resolveVariantDisplayInfo(shop, variantIds);
      live = info;
    } catch {
      /* use snapshots only */
    }
  }

  const lines: string[] = [
    `── Full project snapshot: ${project.name} ──`,
    `Project ID: ${project.id}`,
    `Project #: ${project.poNumber ?? "—"} · Company: ${project.companyName ?? "—"}`,
    `Orders: ${project.jobs.length}`,
    "",
  ];

  for (const job of project.jobs) {
    const locked = job.isLocked || Boolean(job.orderLink);
    lines.push(
      `▸ ${job.name}  [order id: ${job.id}]${locked ? " 🔒 locked / linked to Shopify order" : ""}`,
    );
    if (job.items.length === 0) {
      lines.push(`   (no line items)`);
      lines.push("");
      continue;
    }
    for (let i = 0; i < job.items.length; i++) {
      const row = job.items[i];
      const props =
        row.customData && Array.isArray(row.customData)
          ? (row.customData as { name: string; value: string }[])
          : null;
      const snap = parseVariantSnapshot(row.variantSnapshot);
      const pres = buildVariantPresentation({
        shop,
        variantId: row.variantId,
        live: live[row.variantId],
        snapshot: snap,
      });
      const unit = Number(row.priceSnapshot);
      const sku = snap?.sku ? ` · SKU ${snap.sku}` : "";
      const vendor = snap?.vendor ? ` · Vendor ${snap.vendor}` : "";
      lines.push(
        `   ${i + 1}. ${pres.displayName}${sku}${vendor}`,
      );
      lines.push(
        `      Line id: ${row.id} · Variant id: ${row.variantId} · Qty ${row.quantity} · $${formatMoney(unit)} ea · Line $${formatMoney(unit * row.quantity)} · label source: ${pres.source}`,
      );
      const pb = propertiesBlock(props);
      if (pb) {
        for (const pl of pb.trim().split("\n")) {
          lines.push(pl);
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Any project change: headline + optional intro + full snapshot + link.
 * Recipients: PROJECTCLAD_ORDER_NOTIFY_EMAIL + owner + actor (when known).
 */
export async function sendProjectStatusNotificationEmail(args: {
  headline: string;
  shop: string;
  projectId: string;
  projectName: string;
  ownerCustomerId: string;
  actorCustomerId: string;
  introLines?: string[];
}): Promise<void> {
  if (!isEmailConfigured()) return;

  const recipients = await collectRecipientEmails(
    args.shop,
    args.ownerCustomerId,
    args.actorCustomerId,
  );
  if (recipients.length === 0) return;

  const projectUrl = `https://${args.shop}/apps/project-clad/project?id=${args.projectId}`;
  let snapshot: string;
  try {
    snapshot = await buildFullProjectSnapshotText(args.shop, args.projectId);
  } catch (err) {
    snapshot = `(Could not build snapshot: ${err instanceof Error ? err.message : String(err)})`;
  }

  const intro =
    args.introLines?.filter(Boolean).join("\n") ||
    `Project update: ${args.headline}`;

  const text = [
    intro,
    ``,
    `Open project: ${projectUrl}`,
    ``,
    snapshot,
    ``,
  ].join("\n");

  try {
    await sendEmail({
      to: recipients.join(", "),
      subject: `ProjectClad: ${args.headline} — ${args.projectName}`,
      text,
    });
  } catch (err) {
    console.error(
      "[projectStatusEmail] send failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Cart save: detailed lines for the affected order plus full project snapshot.
 */
export async function sendOrderCreatedNotificationEmail(args: {
  shop: string;
  projectId: string;
  projectName: string;
  jobId: string;
  jobName: string;
  headline?: string;
  poNumber?: string | null;
  companyName?: string | null;
  ownerCustomerId: string;
  actorCustomerId: string;
  jobItems: Array<{
    id: string;
    variantId: string;
    quantity: number;
    priceSnapshot: { toString(): string } | number | string;
    customData: unknown;
    variantSnapshot: unknown;
  }>;
}): Promise<void> {
  if (!isEmailConfigured()) return;

  const recipients = await collectRecipientEmails(
    args.shop,
    args.ownerCustomerId,
    args.actorCustomerId,
  );
  if (recipients.length === 0) return;

  const headline = args.headline ?? "New order saved from cart";

  const variantIds = args.jobItems.map((i) => i.variantId);
  let live: Record<string, VariantDisplayInfo> = {};
  try {
    const { info } = await resolveVariantDisplayInfo(args.shop, variantIds);
    live = info;
  } catch {
    // Labels fall back to snapshots only.
  }

  const lines = args.jobItems.map((row, index) => {
    const props =
      row.customData && Array.isArray(row.customData)
        ? (row.customData as { name: string; value: string }[])
        : null;
    const snap = parseVariantSnapshot(row.variantSnapshot);
    const pres = buildVariantPresentation({
      shop: args.shop,
      variantId: row.variantId,
      live: live[row.variantId],
      snapshot: snap,
    });
    const unit = Number(row.priceSnapshot?.toString?.() ?? row.priceSnapshot ?? 0);
    const lineTotal = unit * row.quantity;
    const skuPart = snap?.sku ? ` · SKU ${snap.sku}` : "";
    const vendorPart = snap?.vendor ? ` · Vendor ${snap.vendor}` : "";
    return [
      `${index + 1}. ${pres.displayName}${skuPart}${vendorPart}`,
      `   Variant ID: ${row.variantId} · Qty ${row.quantity} · Unit ${formatMoney(unit)} · Line ${formatMoney(lineTotal)} · Source: ${pres.source}`,
      propertiesBlock(props),
    ]
      .filter(Boolean)
      .join("\n");
  });

  const projectUrl = `https://${args.shop}/apps/project-clad/project?id=${args.projectId}`;

  let fullSnapshot: string;
  try {
    fullSnapshot = await buildFullProjectSnapshotText(args.shop, args.projectId);
  } catch (err) {
    fullSnapshot = `(Snapshot unavailable: ${err instanceof Error ? err.message : String(err)})`;
  }

  const text = [
    headline,
    ``,
    `Shop: ${args.shop}`,
    `Project: ${args.projectName}`,
    `Project ID: ${args.projectId}`,
    `Order: ${args.jobName}`,
    `Order ID: ${args.jobId}`,
    args.poNumber ? `Project #: ${args.poNumber}` : null,
    args.companyName ? `Company: ${args.companyName}` : null,
    ``,
    `Open project: ${projectUrl}`,
    ``,
    `Lines saved in this cart action:`,
    lines.join("\n\n"),
    ``,
    fullSnapshot,
    ``,
  ]
    .filter((l) => l != null)
    .join("\n");

  try {
    await sendEmail({
      to: recipients.join(", "),
      subject: `ProjectClad: ${headline} — ${args.projectName}`,
      text,
    });
  } catch (err) {
    console.error(
      "[orderCreatedEmail] send failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
