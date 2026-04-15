import prisma from "../db.server";
import {
  fetchCustomerTagsRest,
  getCustomersByIds,
} from "./adminCustomers.server";
import { shopStringFilter } from "./projectAccess.server";

export const hasTag = (tags: string[] | undefined, needle: string) =>
  (tags ?? []).some((t) => String(t).trim().toUpperCase() === needle.toUpperCase());

/** Shopify customer tag `admin` (any casing) — full app access for staff. */
export const hasAdminTag = (tags: string[] | undefined) => hasTag(tags, "ADMIN");

/** Also accepts `staff`, `projectclad_staff`, `projectclad-staff` (spacing/case flexible). */
export function hasStaffStorefrontTag(tags: string[] | undefined): boolean {
  if (!tags?.length) return false;
  return tags.some((t) => {
    const u = String(t)
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_");
    return (
      u === "ADMIN" ||
      u === "STAFF" ||
      u === "PROJECTCLAD_STAFF" ||
      u === "PROJECTCLADADMIN"
    );
  });
}

export function normalizeStorefrontCustomerId(customerId: string): string {
  return String(customerId).includes("/")
    ? String(customerId).split("/").pop() || customerId
    : customerId;
}

/** Digits-only key for comparing logged-in customer to allowlists (handles GID noise). */
export function customerIdDigitKey(customerId: string): string {
  return normalizeStorefrontCustomerId(customerId).replace(/\D/g, "");
}

/** Pulls 6–20 digit IDs from pasted text (plain IDs, Admin URLs, CSV, etc.). */
export function extractNumericCustomerIdsFromText(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of raw.matchAll(/\d{6,20}/g)) {
    const d = m[0];
    if (!seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

function normalizeStaffEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseGlobalStaffEmailsRaw(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((s) => normalizeStaffEmail(s))
    .filter(Boolean);
}

function emailMatchesGlobalStaffList(
  customerEmail: string | null | undefined,
  listRaw: string | null | undefined,
): boolean {
  if (!customerEmail?.trim() || !listRaw?.trim()) return false;
  const e = normalizeStaffEmail(customerEmail);
  return parseGlobalStaffEmailsRaw(listRaw).includes(e);
}

/** True if normalized `customerEmail` appears in `listRaw` (comma / newline / semicolon separated). */
export function customerEmailInConfiguredList(
  customerEmail: string | null | undefined,
  listRaw: string | null | undefined,
): boolean {
  return emailMatchesGlobalStaffList(customerEmail, listRaw);
}

function emailInGlobalStaffEnv(
  customerEmail: string | null | undefined,
): boolean {
  const raw = process.env.PROJECTCLAD_GLOBAL_STAFF_EMAILS?.trim();
  if (!raw) return false;
  return emailMatchesGlobalStaffList(customerEmail, raw);
}

function customerIdInEnvAdminAllowlist(customerId: string): boolean {
  const raw = process.env.PROJECTCLAD_APP_ADMIN_CUSTOMER_IDS?.trim();
  if (!raw) return false;
  const v = customerIdDigitKey(customerId);
  if (v.length < 6) return false;
  const listed = extractNumericCustomerIdsFromText(raw);
  return listed.includes(v);
}

function allowlistRawMatchesCustomer(
  allowlistRaw: string,
  customerId: string,
): boolean {
  const v = customerIdDigitKey(customerId);
  if (v.length < 6) return false;
  const listed = extractNumericCustomerIdsFromText(allowlistRaw);
  return listed.includes(v);
}

/**
 * Full storefront staff / “global” access: every project for the shop, edit rights.
 * Order: env emails → shop setting emails → env customer IDs → shop customer IDs → Shopify tags (API).
 *
 * @param customerEmail Signed `logged_in_customer_email` from the app proxy when present — enables access without Admin Customer API.
 */
export async function viewerHasAdminTag(
  shop: string,
  customerId: string,
  customerEmail?: string | null,
): Promise<boolean> {
  if (process.env.PROJECTCLAD_DEBUG_STAFF === "1") {
    const key = customerIdDigitKey(customerId);
    console.info(
      "[ProjectClad staff] shop=%s viewerDigitKey=%s email=%s",
      shop,
      key || "(empty)",
      customerEmail?.trim()
        ? normalizeStaffEmail(customerEmail)
        : "(none)",
    );
  }

  if (emailInGlobalStaffEnv(customerEmail)) {
    return true;
  }

  const staffRow = await prisma.shopSettings.findFirst({
    where: { shop: shopStringFilter(shop) },
    select: { appAdminCustomerIds: true, globalStaffEmails: true },
  });

  if (emailMatchesGlobalStaffList(customerEmail, staffRow?.globalStaffEmails)) {
    return true;
  }

  if (customerIdInEnvAdminAllowlist(customerId)) {
    return true;
  }

  if (
    staffRow?.appAdminCustomerIds &&
    allowlistRawMatchesCustomer(staffRow.appAdminCustomerIds, customerId)
  ) {
    return true;
  }

  const id = normalizeStorefrontCustomerId(customerId);
  const digitKey = customerIdDigitKey(customerId);
  let tags: string[] = [];
  try {
    const info = await getCustomersByIds(shop, [id]);
    const row =
      info[id] ??
      (digitKey ? info[digitKey] : undefined) ??
      (digitKey.length
        ? info[String(parseInt(digitKey, 10))]
        : undefined);
    tags = row?.tags ?? [];
  } catch {
    tags = [];
  }
  if (hasStaffStorefrontTag(tags)) {
    return true;
  }

  const restTags = await fetchCustomerTagsRest(shop, id);
  return hasStaffStorefrontTag(restTags);
}
