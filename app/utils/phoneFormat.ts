/**
 * North American phone display: `(123) 456-7890`.
 *
 * Shared by the server (normalising on save, rendering stored values) and by the browser mask
 * in `app/client-scripts/project-main.js`, which reimplements `formatPhoneNumber` for the
 * as-you-type case. The two must agree, or a saved number would reflow the moment it is edited.
 */

/** Digits only, with a North American country code dropped. Empty when the input is not a NANP number. */
export function nanpLocalDigits(raw: string | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return "";
}

/**
 * Anything that is not a complete 10-digit number comes back trimmed but otherwise untouched:
 * extensions, international numbers and half-typed values all read better as the person wrote
 * them than forced into a mask that does not fit.
 */
export function formatPhoneNumber(raw: string | null | undefined): string {
  const trimmed = String(raw ?? "").trim();
  const local = nanpLocalDigits(trimmed);
  if (!local) return trimmed;
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

/** `tel:` target — digits only, so the dialler never sees the mask punctuation. */
export function phoneTelHref(raw: string | null | undefined): string {
  const local = nanpLocalDigits(raw);
  if (local) return `tel:+1${local}`;
  return `tel:${String(raw ?? "").replace(/[^\d+]/g, "")}`;
}
