import crypto from "node:crypto";
import type { ProjectRole } from "@prisma/client";
import prisma from "../db.server";

/**
 * One stable magic link per project: the token is created on first share and kept;
 * later calls only update the role granted by that link (view vs edit).
 */
export async function upsertProjectShareInvite(
  projectId: string,
  role: ProjectRole,
): Promise<{ shareLinkPath: string }> {
  const row = await prisma.projectShareToken.upsert({
    where: { projectId },
    create: {
      projectId,
      token: crypto.randomBytes(16).toString("hex"),
      role,
    },
    update: { role },
  });
  return { shareLinkPath: `/apps/project-clad/share/${row.token}` };
}
