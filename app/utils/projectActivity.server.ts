import type { Prisma } from "@prisma/client";
import prisma from "../db.server";

/** Logged when a customer confirms Order now or reorders (for delivery email recipients). */
export const STOREFRONT_ORDER_CONFIRMED_ACTIVITY = "storefront_order_confirmed";

export type ActivityVisibility = "member" | "admin";

export async function logProjectActivity(input: {
  projectId: string;
  jobId?: string | null;
  type: string;
  payload?: Record<string, unknown> | null;
  visibility: ActivityVisibility;
  actorCustomerId?: string | null;
}) {
  await prisma.projectActivityEvent.create({
    data: {
      projectId: input.projectId,
      jobId: input.jobId ?? null,
      type: input.type,
      payload: input.payload as Prisma.InputJsonValue | undefined,
      visibility: input.visibility,
      actorCustomerId: input.actorCustomerId ?? null,
    },
  });
}
