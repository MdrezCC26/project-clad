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
import { shopStringFilter } from "./projectAccess.server";
import { formatPreferredDeliveryDisplay } from "./preferredDeliveryFormat";

function formatMoney(amount: number): string {
  if (Number.isNaN(amount)) return "$0.00";
  return `$${amount.toFixed(2)}`;
}

const DEFAULT_FINANCE_EMAIL = "michaeldrezin@canadiancladding.ca";

function parseFinanceEmails(): string[] {
  const raw =
    process.env.PROJECTCLAD_FINANCE_EMAIL?.trim() || DEFAULT_FINANCE_EMAIL;
  return dedupeEmailAddresses(
    raw
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function shippingBlock(project: {
  shipAddress1: string | null;
  shipCity: string | null;
  shipProvince: string | null;
  shipPostal: string | null;
  shipCountry: string | null;
}): string {
  const lines = [
    project.shipAddress1,
    [
      project.shipCity,
      project.shipProvince,
      project.shipPostal,
    ]
      .filter(Boolean)
      .join(", "),
    project.shipCountry,
  ]
    .filter((l) => l && String(l).trim())
    .map((l) => String(l).trim());
  return lines.length ? ["Ship to:", ...lines.map((l) => `  ${l}`)].join("\n") : "Ship to: (not on file)";
}

/**
 * After fulfillment photo: same detail text to project owner and to finance (separate sends).
 * Idempotent caller should set fulfillmentNotifiedAt only after success.
 */
export async function sendFulfillmentPackageEmails(args: {
  shop: string;
  projectId: string;
  jobId: string;
}): Promise<void> {
  if (!isEmailConfigured()) {
    console.warn("[fulfillmentNotify] email not configured; skip send");
    return;
  }

  const project = await prisma.project.findFirst({
    where: { id: args.projectId, shop: shopStringFilter(args.shop) },
    include: {
      jobs: {
        where: { id: args.jobId },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });

  if (!project?.jobs.length) return;
  const job = project.jobs[0];

  const variantIds = job.items.map((i) => i.variantId);
  let live: Record<string, VariantDisplayInfo> = {};
  if (variantIds.length > 0) {
    try {
      const { info } = await resolveVariantDisplayInfo(args.shop, variantIds);
      live = info;
    } catch {
      /* snapshot only */
    }
  }

  let subtotal = 0;
  const lineTexts: string[] = [];
  job.items.forEach((row, index) => {
    const unit = Number(row.priceSnapshot);
    const lineTotal = unit * row.quantity;
    subtotal += lineTotal;
    const snap = parseVariantSnapshot(row.variantSnapshot);
    const pres = buildVariantPresentation({
      shop: args.shop,
      variantId: row.variantId,
      live: live[row.variantId],
      snapshot: snap,
    });
    lineTexts.push(
      `${index + 1}. ${pres.displayName} — Qty ${row.quantity} × ${formatMoney(unit)} = ${formatMoney(lineTotal)}`,
    );
  });

  const delivery = 0;
  const tax = 0;
  const total = subtotal + delivery + tax;

  const prefLine = formatPreferredDeliveryDisplay(
    job.scheduledDeliveryDate,
    job.scheduledDeliveryWindow,
  );
  const scheduleParts = prefLine ? [prefLine] : [];

  const projectUrl = `https://${args.shop}/apps/project-clad/project?id=${encodeURIComponent(args.projectId)}`;

  const body = [
    `Order fulfilled — ${job.name}`,
    ``,
    `Project: ${project.name}`,
    `Project ID: ${project.id}`,
    `Order ID: ${job.id}`,
    ...scheduleParts,
    ``,
    shippingBlock(project),
    ``,
    `Line items:`,
    lineTexts.join("\n") || "(none)",
    ``,
    `Subtotal: ${formatMoney(subtotal)}`,
    `Delivery: ${formatMoney(delivery)}`,
    `Tax: ${formatMoney(tax)}`,
    `Total: ${formatMoney(total)}`,
    ``,
    `View in Projects: ${projectUrl}`,
    ``,
  ].join("\n");

  const ownerId = project.ownerCustomerId;
  let ownerEmail: string | null = null;
  try {
    const info = await getCustomersByIds(args.shop, [ownerId]);
    ownerEmail = info[ownerId]?.email?.trim() || null;
  } catch {
    ownerEmail = null;
  }

  const subject = `ProjectClad: Order delivered — ${project.name} · ${job.name}`;

  const ownerNorm = ownerEmail?.trim().toLowerCase() ?? "";
  const financeTos = parseFinanceEmails();

  if (ownerEmail) {
    try {
      await sendEmail({ to: ownerEmail, subject, text: body });
    } catch (err) {
      console.error(
        "[fulfillmentNotify] owner send failed:",
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  }

  for (const to of financeTos) {
    const nt = to.trim().toLowerCase();
    if (nt && nt === ownerNorm) {
      continue;
    }
    try {
      await sendEmail({ to, subject: `${subject} [finance]`, text: body });
    } catch (err) {
      console.error(
        "[fulfillmentNotify] finance send failed:",
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  }
}
