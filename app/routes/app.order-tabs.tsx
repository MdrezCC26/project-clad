import { useMemo } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { shopStringFilter } from "../utils/projectAccess.server";

type StartedStatus = "draft" | "pending_review" | "ready_to_order";

type QueueRow = {
  id: string;
  projectId: string;
  projectName: string;
  jobName: string;
  orderName: string | null;
  orderNumber: number | null;
  status: string;
  createdAt: string;
};

type LoaderData = {
  shop: string;
  started: QueueRow[];
  paid: QueueRow[];
};

const STARTED_STATUSES: readonly StartedStatus[] = [
  "draft",
  "pending_review",
  "ready_to_order",
];

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticate.admin(request);
  const baseWhere = { project: { shop: shopStringFilter(session.shop) } };

  const [startedJobs, paidJobs] = await Promise.all([
    prisma.job.findMany({
      where: {
        ...baseWhere,
        orderLifecycleStatus: { in: [...STARTED_STATUSES] },
      },
      orderBy: { createdAt: "asc" },
      include: {
        project: { select: { id: true, name: true } },
        orderLink: { select: { orderName: true } },
      },
    }),
    prisma.job.findMany({
      where: { ...baseWhere, orderLifecycleStatus: "paid" },
      orderBy: { paidAt: "desc" },
      include: {
        project: { select: { id: true, name: true } },
        orderLink: { select: { orderName: true } },
      },
    }),
  ]);

  const mapRow = (job: (typeof startedJobs)[number]): QueueRow => ({
    id: job.id,
    projectId: job.project.id,
    projectName: job.project.name,
    jobName: job.name,
    orderName: job.orderLink?.orderName ?? null,
    orderNumber: job.orderNumber ?? null,
    status: job.orderLifecycleStatus,
    createdAt: job.createdAt.toISOString(),
  });

  return {
    shop: session.shop,
    started: startedJobs.map(mapRow),
    paid: paidJobs.map(mapRow),
  };
};

function QueueSection({
  title,
  rows,
  shop,
}: {
  title: string;
  rows: QueueRow[];
  shop: string;
}) {
  const storefrontProjectBase = useMemo(
    () => `https://${shop}/apps/project-clad/project`,
    [shop],
  );

  return (
    <s-section heading={title}>
      {rows.length === 0 ? (
        <s-paragraph>No orders in this section.</s-paragraph>
      ) : (
        <s-stack direction="block" gap="base">
          {rows.map((row) => (
            <div
              key={row.id}
              style={{
                border: "1px solid rgba(0,0,0,0.12)",
                borderRadius: 8,
                padding: "12px 16px",
              }}
            >
              <p style={{ margin: 0, fontWeight: 600 }}>
                {row.orderNumber != null ? `#${row.orderNumber} · ` : ""}
                {row.projectName}
                <span style={{ fontWeight: 400, opacity: 0.85 }}>
                  {" "}
                  — {row.jobName}
                  {row.orderName ? ` (${row.orderName})` : ""}
                </span>
              </p>
              <p style={{ margin: "4px 0 0", fontSize: "0.9em", opacity: 0.85 }}>
                {new Date(row.createdAt).toLocaleString()} · Status:{" "}
                <strong>{row.status}</strong>
                {" · "}
                <a
                  href={`${storefrontProjectBase}?id=${encodeURIComponent(row.projectId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open project
                </a>
              </p>
            </div>
          ))}
        </s-stack>
      )}
    </s-section>
  );
}

export default function OrderTabsPage() {
  const { started, paid, shop } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Orders">
      <QueueSection
        title='Started orders (not yet "Ordered")'
        rows={started}
        shop={shop}
      />
      <QueueSection title="Paid orders" rows={paid} shop={shop} />
    </s-page>
  );
}
