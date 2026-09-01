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
  /** Off by default (high volume). Enable in Admin → Automated email notifications. */
  projectStatus: false,
  orderPlacedCustomer: true,
  orderPlacedShop: true,
  fulfillmentOwner: true,
  fulfillmentFinance: true,
  approvalRequest: true,
  approvalApproved: true,
  approvalRejected: true,
  projectDeleteBackup: true,
};

export type EmailNotificationSettings = {
  prefs: EmailNotificationPrefs;
  /** Lowercased unique addresses muted from finance delivered mail. */
  financeMutedEmails: string[];
};

function isBool(v: unknown): v is boolean {
  return v === true || v === false;
}

function normalizeEmailList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const email = item.trim().toLowerCase();
    if (!email || !email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

/** Parses stored JSON; unknown keys ignored, missing keys filled from defaults. */
export function parseEmailNotificationSettingsJson(
  raw: string | null | undefined,
): EmailNotificationSettings {
  const prefs: EmailNotificationPrefs = {
    ...DEFAULT_EMAIL_NOTIFICATION_PREFS,
  };
  let financeMutedEmails: string[] = [];
  if (!raw?.trim()) {
    return { prefs, financeMutedEmails };
  }
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (!obj || typeof obj !== "object") {
      return { prefs, financeMutedEmails };
    }
    for (const k of EMAIL_NOTIFICATION_KINDS) {
      if (isBool(obj[k])) {
        prefs[k] = obj[k];
      }
    }
    financeMutedEmails = normalizeEmailList(obj.financeMutedEmails);
  } catch {
    /* keep defaults */
  }
  return { prefs, financeMutedEmails };
}

/** @deprecated Prefer parseEmailNotificationSettingsJson. */
export function parseEmailNotificationPrefsJson(
  raw: string | null | undefined,
): EmailNotificationPrefs {
  return parseEmailNotificationSettingsJson(raw).prefs;
}

export function serializeEmailNotificationSettings(
  settings: EmailNotificationSettings,
): string {
  return JSON.stringify({
    ...settings.prefs,
    financeMutedEmails: normalizeEmailList(settings.financeMutedEmails),
  });
}

/** @deprecated Prefer serializeEmailNotificationSettings. */
export function serializeEmailNotificationPrefs(
  prefs: EmailNotificationPrefs,
): string {
  return serializeEmailNotificationSettings({
    prefs,
    financeMutedEmails: [],
  });
}

export function isEmailNotificationEnabled(
  prefs: EmailNotificationPrefs,
  kind: EmailNotificationKind,
): boolean {
  return prefs[kind] !== false;
}

/** Build muted list: configured recipients that were not checked as “send”. */
export function financeMutedFromSendAllowList(args: {
  configured: string[];
  sendAllowList: string[];
}): string[] {
  const allow = new Set(
    args.sendAllowList.map((e) => e.trim().toLowerCase()).filter(Boolean),
  );
  return args.configured
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e && !allow.has(e));
}
