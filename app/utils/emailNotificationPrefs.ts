export const EMAIL_NOTIFICATION_KINDS = [
  "cartSave",
  "projectStatus",
  "orderPlacedCustomer",
  "orderPlacedShop",
  "fulfillmentOwner",
  "fulfillmentFinance",
  "approvalRequest",
  "approvalApproved",
  "approvalRejected",
  "projectDeleteBackup",
] as const;

export type EmailNotificationKind = (typeof EMAIL_NOTIFICATION_KINDS)[number];

export type EmailNotificationPrefs = Record<EmailNotificationKind, boolean>;

export const DEFAULT_EMAIL_NOTIFICATION_PREFS: EmailNotificationPrefs = {
  cartSave: true,
  projectStatus: true,
  orderPlacedCustomer: true,
  orderPlacedShop: true,
  fulfillmentOwner: true,
  fulfillmentFinance: true,
  approvalRequest: true,
  approvalApproved: true,
  approvalRejected: true,
  projectDeleteBackup: true,
};

function isBool(v: unknown): v is boolean {
  return v === true || v === false;
}

/** Parses stored JSON; unknown keys ignored, missing keys filled from defaults. */
export function parseEmailNotificationPrefsJson(
  raw: string | null | undefined,
): EmailNotificationPrefs {
  const out: EmailNotificationPrefs = { ...DEFAULT_EMAIL_NOTIFICATION_PREFS };
  if (!raw?.trim()) return out;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (!obj || typeof obj !== "object") return out;
    for (const k of EMAIL_NOTIFICATION_KINDS) {
      if (isBool(obj[k])) {
        out[k] = obj[k];
      }
    }
  } catch {
    /* keep defaults */
  }
  return out;
}

export function serializeEmailNotificationPrefs(
  prefs: EmailNotificationPrefs,
): string {
  return JSON.stringify(prefs);
}

export function isEmailNotificationEnabled(
  prefs: EmailNotificationPrefs,
  kind: EmailNotificationKind,
): boolean {
  return prefs[kind] !== false;
}
