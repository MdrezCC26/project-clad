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

/**
 * Pulls 10–20 digit IDs from pasted text (plain IDs, Admin URLs, CSV, etc.).
 */
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

async function customerIdInShopSettingsAdminList(
  shop: string,
  customerId: string,
): Promise<boolean> {
  const row = await prisma.shopSettings.findFirst({
    where: { shop: shopStringFilter(shop) },
    select: { appAdminCustomerIds: true },
  });
  if (!row?.appAdminCustomerIds?.trim()) {
    return false;
  }
  return allowlistRawMatchesCustomer(row.appAdminCustomerIds, customerId);
}

export async function viewerHasAdminTag(
  shop: string,
  customerId: string,
): Promise<boolean> {
  if (process.env.PROJECTCLAD_DEBUG_STAFF === "1") {
    const key = customerIdDigitKey(customerId);
    console.info(
      "[ProjectClad staff] shop=%s viewerDigitKey=%s",
      shop,
      key || "(empty)",
    );
  }

  if (customerIdInEnvAdminAllowlist(customerId)) {
    return true;
  }

  if (await customerIdInShopSettingsAdminList(shop, customerId)) {
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
