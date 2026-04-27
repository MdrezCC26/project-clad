/**
 * Allow-list for finance-only actions that use `PROJECT_CLAD_FINANCE_EMAIL`.
 * Only emails listed (comma-separated) may pass. If the env var
 * is unset or empty, NO ONE can download — failing closed is the safest
 * default for an export that surfaces line-level pricing + customer addresses.
 *
 * Matching: case-insensitive, trimmed, exact.
 */

function parseAllowList(): string[] {
  const raw = process.env.PROJECT_CLAD_FINANCE_EMAIL ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isFinanceEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allow = parseAllowList();
  if (allow.length === 0) return false;
  return allow.includes(email.trim().toLowerCase());
}

export function financeAllowListConfigured(): boolean {
  return parseAllowList().length > 0;
}
