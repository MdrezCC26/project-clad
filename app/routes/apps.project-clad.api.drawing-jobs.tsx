import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

function requireWorkerAuth(request: Request): { shop: string } {
  const auth = request.headers.get("Authorization");
  const key = process.env.DRAWING_WORKER_API_KEY;

  if (key && auth === `Bearer ${key}`) {
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop") || "";
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)) {
      throw Response.json({ error: "Missing or invalid shop param" }, { status: 400 });
    }
    return { shop };
  }

  if (process.env.NODE_ENV === "development" && !key) {
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop") || "";
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)) {
      throw Response.json({ error: "Missing or invalid shop param (dev: ?shop=xxx)" }, { status: 400 });
    }
    return { shop };
  }

  throw Response.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * GET ?shop=xxx&limit=10
 * Fetch pending drawing jobs for the worker to process.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = requireWorkerAuth(request);
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);

  const [jobs, gaugeConfigs] = await Promise.all([
    prisma.drawingJob.findMany({
      where: { shop, status: "pending" },
      orderBy: { createdAt: "asc" },
      take: limit,
    }),
    prisma.gaugeConfig.findMany({ where: { shop } }),
  ]);

  const gaugeToThickness = Object.fromEntries(
    gaugeConfigs.map((c) => [c.gauge, Number(c.thicknessInches)]),
  );

  const jobsWithThickness = jobs.map((j) => ({
    ...j,
    thicknessInches: gaugeToThickness[j.gauge] ?? null,
  }));

  return Response.json({ jobs: jobsWithThickness });
};

type UpdatePayload = {
  id: string;
  status: "processing" | "completed" | "failed";
  partNumber?: string;
  errorMsg?: string;
};

/**
 * PATCH - worker updates job status after processing
 * Body: { id, status, partNumber?, errorMsg? }
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = requireWorkerAuth(request);

  if (request.method !== "PATCH") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json()) as UpdatePayload;
  const { id, status, partNumber, errorMsg } = body;

  if (!id || !["processing", "completed", "failed"].includes(status)) {
    return Response.json({ error: "Invalid id or status" }, { status: 400 });
  }

  const existing = await prisma.drawingJob.findFirst({
    where: { id, shop },
  });

  if (!existing) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  const update: { status: string; partNumber?: string; errorMsg?: string; completedAt?: Date } = {
    status,
  };
  if (partNumber != null) update.partNumber = partNumber;
  if (errorMsg != null) update.errorMsg = errorMsg;
  if (status === "completed" || status === "failed") {
    update.completedAt = new Date();
  }

  const job = await prisma.drawingJob.update({
    where: { id },
    data: update,
  });

  return Response.json({ job });
};
