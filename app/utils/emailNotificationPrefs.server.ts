import prisma from "../db.server";
import { shopStringFilter } from "./projectAccess.server";
import {
  DEFAULT_EMAIL_NOTIFICATION_PREFS,
  parseEmailNotificationSettingsJson,
  type EmailNotificationPrefs,
  type EmailNotificationSettings,
} from "./emailNotificationPrefs";

export * from "./emailNotificationPrefs";

export async function getEmailNotificationSettings(
  shop: string,
): Promise<EmailNotificationSettings> {
  try {
    const row = await prisma.shopSettings.findFirst({
      where: { shop: shopStringFilter(shop) },
      select: { emailNotificationPrefsJson: true },
    });
    return parseEmailNotificationSettingsJson(row?.emailNotificationPrefsJson);
  } catch {
    return {
      prefs: { ...DEFAULT_EMAIL_NOTIFICATION_PREFS },
      financeMutedEmails: [],
    };
  }
}

export async function getEmailNotificationPrefs(
  shop: string,
): Promise<EmailNotificationPrefs> {
  return (await getEmailNotificationSettings(shop)).prefs;
}

export async function getFinanceMutedEmails(shop: string): Promise<string[]> {
  return (await getEmailNotificationSettings(shop)).financeMutedEmails;
}
