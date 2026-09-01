/**
 * Allow-list for finance-only actions.
 * Uses PROJECTCLAD_FINANCE_EMAIL (same list as finance delivered mail recipients,
 * before mute filtering). If unset, falls back to DEFAULT_FINANCE_EMAIL.
 *
 * Matching: case-insensitive, trimmed, exact.
 */
import {
  DEFAULT_FINANCE_EMAIL,
  listConfiguredFinanceEmails,
} from "./financeEmailRecipients.server";

export function isFinanceEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allow = listConfiguredFinanceEmails().map((e) => e.trim().toLowerCase());
  if (allow.length === 0) {
    return email.trim().toLowerCase() === DEFAULT_FINANCE_EMAIL.toLowerCase();
  }
  return allow.includes(email.trim().toLowerCase());
}

export function financeAllowListConfigured(): boolean {
  return listConfiguredFinanceEmails().length > 0;
}
