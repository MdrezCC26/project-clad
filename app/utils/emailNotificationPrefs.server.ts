import prisma from "../db.server";
import { shopStringFilter } from "./projectAccess.server";
import {
  DEFAULT_EMAIL_NOTIFICATION_PREFS,
  parseEmailNotificationPrefsJson,
  type EmailNotificationPrefs,
} from "./emailNotificationPrefs";

export * from "./emailNotificationPrefs";

export async function getEmailNotificationPrefs(
  shop: string,
): Promise<EmailNotificationPrefs> {
  try {
    const row = await prisma.shopSettings.findFirst({
      where: { shop: shopStringFilter(shop) },
      select: { emailNotificationPrefsJson: true },
    });
    return parseEmailNotificationPrefsJson(row?.emailNotificationPrefsJson);
  } catch {
    return { ...DEFAULT_EMAIL_NOTIFICATION_PREFS };
  }
}
