/**
 * Who receives customer-facing mail for Order now / reorder / invoice / delivered.
 * Staff and app admins place orders on behalf of the project owner — those
 * notifications go to the owner, not the staff account that clicked the button.
 */
import prisma from "../db.server";
import {
  getCustomerRowFromFetchedMap,
  getCustomersByIds,
  resolvePlacerNotifyEmail,
  type CustomerInfo,
} from "./adminCustomers.server";
import { dedupeEmailAddresses } from "./email.server";
import {
  customerIdsMatch,
  customerNumericIdsForAdminApi,
} from "./projectAccess.server";
import { STOREFRONT_ORDER_CONFIRMED_ACTIVITY } from "./projectActivity.shared";
import { hasStaffStorefrontTag } from "./customerTags.server";

export type OrderConfirmedActivityPayload = {
  /** Fallback when Shopify has no email on the customer profile. */
  notifyEmail?: string;
  /** Staff placed the order for the project owner. */
  placedOnBehalf?: boolean;
  /** Customer who should receive lifecycle mail (project owner). */
  customerCustomerId?: string;
};

function dedupeCustomerIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const t = id.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export function parseOrderConfirmedActivityPayload(
  payload: unknown,
): OrderConfirmedActivityPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const row = payload as Record<string, unknown>;
  const notifyEmail =
    typeof row.notifyEmail === "string" ? row.notifyEmail.trim() : "";
  const customerCustomerId =
    typeof row.customerCustomerId === "string"
      ? row.customerCustomerId.trim()
      : "";
  const placedOnBehalf = row.placedOnBehalf === true;
  if (!notifyEmail && !placedOnBehalf && !customerCustomerId) {
    return null;
  }
  return {
    ...(notifyEmail ? { notifyEmail } : {}),
    ...(placedOnBehalf ? { placedOnBehalf: true } : {}),
    ...(customerCustomerId ? { customerCustomerId } : {}),
  };
}

/** True when staff/admin is placing for someone else's project (not the owner). */
export function staffPlacesOrderOnBehalf(
  ownerCustomerId: string,
  actorCustomerId: string,
  viewerIsAppAdmin: boolean,
  actorTags?: string[],
): boolean {
  if (customerIdsMatch(ownerCustomerId, actorCustomerId)) return false;
  return viewerIsAppAdmin || hasStaffStorefrontTag(actorTags);
}

/**
 * Activity payload + customer id for Order now / reorder confirmation mail.
 */
export async function buildOrderConfirmedNotifyContext(args: {
  shop: string;
  ownerCustomerId: string;
  actorCustomerId: string;
  actorProxyEmail?: string | null;
  viewerIsAppAdmin: boolean;
  actorTags?: string[];
}): Promise<{
  payload: OrderConfirmedActivityPayload | undefined;
  customerCustomerId: string;
}> {
  const onBehalf = staffPlacesOrderOnBehalf(
    args.ownerCustomerId,
    args.actorCustomerId,
    args.viewerIsAppAdmin,
    args.actorTags,
  );
  const customerCustomerId = onBehalf
    ? args.ownerCustomerId
    : args.actorCustomerId;

  const notifyEmail = await resolvePlacerNotifyEmail(
    args.shop,
    customerCustomerId,
    onBehalf ? null : args.actorProxyEmail,
  );

  const payload: OrderConfirmedActivityPayload = {};
  if (notifyEmail) payload.notifyEmail = notifyEmail;
  if (onBehalf) {
    payload.placedOnBehalf = true;
    payload.customerCustomerId = args.ownerCustomerId;
  }

  return {
    payload: Object.keys(payload).length > 0 ? payload : undefined,
    customerCustomerId,
  };
}

/**
 * Customer Shopify ids + extra fallback emails for invoice, delivered, reminders.
 */
export async function resolveOrderLifecycleCustomerRecipients(args: {
  shop: string;
  projectId: string;
  jobId: string;
  ownerCustomerId: string;
}): Promise<{
  customerIds: string[];
  extraNotifyEmails: string[];
}> {
  const placerRow = await prisma.projectActivityEvent.findFirst({
    where: {
      projectId: args.projectId,
      jobId: args.jobId,
      type: STOREFRONT_ORDER_CONFIRMED_ACTIVITY,
    },
    orderBy: { createdAt: "desc" },
    select: { actorCustomerId: true, payload: true },
  });
  const payload = parseOrderConfirmedActivityPayload(placerRow?.payload);
  const placerCustomerId = placerRow?.actorCustomerId?.trim() || null;

  if (payload?.placedOnBehalf && payload.customerCustomerId) {
    const extra = payload.notifyEmail?.includes("@")
      ? [payload.notifyEmail]
      : [];
    return {
      customerIds: [payload.customerCustomerId],
      extraNotifyEmails: dedupeEmailAddresses(extra),
    };
  }

  const customerIds = dedupeCustomerIds(
    placerCustomerId
      ? [args.ownerCustomerId, placerCustomerId]
      : [args.ownerCustomerId],
  );
  const extra = payload?.notifyEmail?.includes("@") ? [payload.notifyEmail] : [];
  return {
    customerIds,
    extraNotifyEmails: dedupeEmailAddresses(extra),
  };
}

/** Resolve profile emails (+ optional payload fallback) for lifecycle customer mail. */
export async function resolveOrderLifecycleCustomerEmails(args: {
  shop: string;
  projectId: string;
  jobId: string;
  ownerCustomerId: string;
}): Promise<{
  emails: string[];
  ownerName: string;
  ownerEmail: string;
}> {
  const { customerIds, extraNotifyEmails } =
    await resolveOrderLifecycleCustomerRecipients(args);

  const fetchKeys = Array.from(
    new Set(customerIds.flatMap((id) => customerNumericIdsForAdminApi(id))),
  );

  let customerInfoMap: Record<string, CustomerInfo> = {};
  try {
    customerInfoMap = await getCustomersByIds(
      args.shop,
      fetchKeys.length > 0 ? fetchKeys : customerIds,
    );
  } catch (err) {
    console.warn(
      "[orderCustomerNotify] customer lookup failed:",
      err instanceof Error ? err.message : err,
    );
  }

  const ownerRow = getCustomerRowFromFetchedMap(
    args.ownerCustomerId,
    customerInfoMap,
  );
  const ownerName =
    [ownerRow?.firstName, ownerRow?.lastName].filter(Boolean).join(" ").trim() ||
    "—";
  const ownerEmail = ownerRow?.email?.trim() || "—";

  const emails = dedupeEmailAddresses([
    ...customerIds
      .map((id) =>
        getCustomerRowFromFetchedMap(id, customerInfoMap)?.email?.trim(),
      )
      .filter((e): e is string => Boolean(e)),
    ...extraNotifyEmails,
  ]);

  return { emails, ownerName, ownerEmail };
}
