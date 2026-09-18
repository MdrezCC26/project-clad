import crypto from "node:crypto";
import type { ProjectRole } from "@prisma/client";
import prisma from "../db.server";

const SHARE_LINK_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** Creates a fresh three-day share link, invalidating the project's prior link. */
export async function upsertProjectShareInvite(
  projectId: string,
  role: ProjectRole,
): Promise<{ shareLinkPath: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SHARE_LINK_TTL_MS);
  const row = await prisma.projectShareToken.upsert({
    where: { projectId },
    create: {
      projectId,
      token,
      role,
      expiresAt,
    },
    update: { token, role, createdAt: now, expiresAt },
  });
  return {
    shareLinkPath: `/apps/project-clad/share/${row.token}`,
    expiresAt: row.expiresAt,
  };
}
