/**
 * Finance delivered-mail recipient list from env, plus per-shop mutes
 * stored in ShopSettings.emailNotificationPrefsJson.
 */
import { dedupeEmailAddresses } from "./email.server";
import { getFinanceMutedEmails } from "./emailNotificationPrefs.server";

/** Fallback when PROJECTCLAD_FINANCE_EMAIL is unset or empty. */
export const DEFAULT_FINANCE_EMAIL = "michaeldrezin@canadiancladding.ca";

/** All addresses from env (or default) — before mute filtering. */
export function listConfiguredFinanceEmails(): string[] {
  const raw = process.env.PROJECTCLAD_FINANCE_EMAIL?.trim();
  if (raw) {
    const list = dedupeEmailAddresses(
      raw.split(/[,;]+/).map((s) => s.trim()).filter(Boolean),
    );
    if (list.length > 0) return list;
  }
  return [DEFAULT_FINANCE_EMAIL];
}

/** Configured finance addresses minus shop-level mutes. */
export async function resolveFinanceDeliveryRecipients(
  shop: string,
): Promise<string[]> {
  const configured = listConfiguredFinanceEmails();
  const muted = await getFinanceMutedEmails(shop);
  if (muted.length === 0) return configured;
  const mutedSet = new Set(muted.map((e) => e.trim().toLowerCase()));
  return configured.filter((e) => !mutedSet.has(e.trim().toLowerCase()));
}
