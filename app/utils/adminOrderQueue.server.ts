import prisma from "../db.server";
import { shopStringFilter } from "./projectAccess.server";

export type AdminOrderQueueJobRow = {
  id: string;
  name: string;
  orderNumber: number | null;
  createdAt: string;
  projectId: string;
  projectName: string;
  orderLifecycleStatus: "ordered" | "delivered";
  paidAt: string | null;
  orderName: string | null;
  hasFulfillmentPhoto: boolean;
};

export async function loadAdminOrderQueueJobs(
  shop: string,
  statuses: Array<"ordered" | "delivered">,
): Promise<AdminOrderQueueJobRow[]> {
  const jobs = await prisma.job.findMany({
    where: {
      project: { shop: shopStringFilter(shop) },
      orderLifecycleStatus: { in: statuses },
    },
    orderBy: { createdAt: "asc" },
    include: {
      project: { select: { id: true, name: true } },
      orderLink: { select: { orderName: true } },
    },
  });

  return jobs.map((job) => ({
    id: job.id,
    name: job.name,
    orderNumber: job.orderNumber ?? null,
    createdAt: job.createdAt.toISOString(),
    projectId: job.project.id,
    projectName: job.project.name,
    orderLifecycleStatus: job.orderLifecycleStatus as "ordered" | "delivered",
    paidAt: job.paidAt?.toISOString() ?? null,
    orderName: job.orderLink?.orderName ?? null,
    hasFulfillmentPhoto: Boolean(job.fulfillmentPhotoStorageKey),
  }));
}
