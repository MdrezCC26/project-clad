import prisma from "../db.server";
import { getCsvForProjectIds } from "./exportProjectsCsv.server";
import { isEmailConfigured } from "./email.server";
import {
  getEmailNotificationPrefs,
  isEmailNotificationEnabled,
} from "./emailNotificationPrefs.server";
import { sendTransactionalEmail } from "./transactionalEmail.server";

const PROJECT_DELETE_BACKUP_EMAIL = "michaeldrezin@canadiancladding.ca";

/** Email a CSV backup (when enabled), then delete the project. */
export async function deleteStorefrontProject(args: {
  shop: string;
  projectId: string;
  projectName: string;
}): Promise<void> {
  const { shop, projectId, projectName } = args;

  if (isEmailConfigured()) {
    const deleteNotifyPrefs = await getEmailNotificationPrefs(shop);
    if (isEmailNotificationEnabled(deleteNotifyPrefs, "projectDeleteBackup")) {
      try {
        const csv = await getCsvForProjectIds(shop, [projectId]);
        await sendTransactionalEmail({
          shop,
          to: PROJECT_DELETE_BACKUP_EMAIL,
          subject: `Project export: ${projectName}`,
          text: `Your project "${projectName}" has been deleted.`,
          extraAttachments: [
            {
              filename: `projectclad-${projectName.replace(/[^a-z0-9-_]/gi, "-")}.csv`,
              content: csv,
            },
          ],
        });
      } catch {
        // Still delete the project even if email fails
      }
    }
  }

  await prisma.project.delete({ where: { id: projectId } });
}
