import type { ActionFunctionArgs } from "react-router";
import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";

type SaveJobPayload = {
  mode: "newProject" | "existingProject" | "existingJob";
  poNumber?: string;
  companyName?: string;
  projectName?: string;
  jobName?: string;
  projectId?: string;
  jobId?: string;
  quantityMode?: "add" | "replace";
  items?: {
    variantId: string;
    quantity: number;
    priceSnapshot: string | number;
  }[];
};

const normalizeItems = (items: SaveJobPayload["items"] = []) =>
  items
    .filter((item) => item && item.variantId && item.quantity > 0)
    .map((item) => ({
      variantId: String(item.variantId),
      quantity: Number(item.quantity),
      priceSnapshot: new Prisma.Decimal(item.priceSnapshot ?? 0),
    }));

const getNextSortOrder = async (jobId: string) => {
  const result = await prisma.jobItem.aggregate({
    where: { jobId },
    _max: { sortOrder: true },
  });
  return (result._max.sortOrder ?? 0) + 1;
};

const getNextJobSortOrder = async (projectId: string) => {
  const result = await prisma.job.aggregate({
    where: { projectId },
    _max: { sortOrder: true },
  });
  return (result._max.sortOrder ?? 0) + 1;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, customerId } = requireAppProxyCustomer(request, {
    jsonOnFail: true,
  });
  const payload = (await request.json()) as SaveJobPayload;
  const items = normalizeItems(payload.items);
  const poNumber = (payload.poNumber || "").trim();
  const companyName = (payload.companyName || "").trim();

  if (!items.length) {
    return Response.json({ error: "Cart has no items." }, { status: 400 });
  }

  if (!poNumber) {
    return Response.json({ error: "PO number is required." }, { status: 400 });
  }

  if (!companyName) {
    return Response.json(
      { error: "Company name is required." },
      { status: 400 },
    );
  }

  if (payload.mode === "newProject") {
    if (!payload.projectName || !payload.jobName) {
      return Response.json(
        { error: "Project name and order name are required." },
        { status: 400 },
      );
    }

    const project = await prisma.project.create({
      data: {
        shop,
        name: payload.projectName,
        ownerCustomerId: customerId,
        poNumber,
        companyName,
        members: {
          create: { customerId, role: "edit" },
        },
        jobs: {
          create: {
            name: payload.jobName,
            sortOrder: 1,
            items: {
              create: items.map((item, index) => ({
                ...item,
                sortOrder: index + 1,
              })),
            },
          },
        },
      },
      include: { jobs: true },
    });

    return Response.json({
      projectId: project.id,
      jobId: project.jobs[0]?.id,
    });
  }

  if (payload.mode === "existingProject") {
    if (!payload.projectId || !payload.jobName) {
      return Response.json(
        { error: "Select a project and order name." },
        { status: 400 },
      );
    }

    const project = await prisma.project.findFirst({
      where: {
        id: payload.projectId,
        shop,
        OR: [
          { ownerCustomerId: customerId },
          { members: { some: { customerId } } },
        ],
      },
      include: { members: true },
    });

    if (!project) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }

    const memberRole = project.members.find(
      (member) => member.customerId === customerId,
    )?.role;
    const canEdit =
      project.ownerCustomerId === customerId || memberRole === "edit";

    if (!canEdit) {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }

    const nextJobSortOrder = await getNextJobSortOrder(project.id);
    const job = await prisma.job.create({
      data: {
        projectId: project.id,
        name: payload.jobName,
        sortOrder: nextJobSortOrder,
        items: {
          create: items.map((item, index) => ({
            ...item,
            sortOrder: index + 1,
          })),
        },
      },
    });

    await prisma.project.update({
      where: { id: project.id },
      data: { poNumber, companyName },
    });

    return Response.json({ projectId: project.id, jobId: job.id });
  }

  if (payload.mode === "existingJob") {
    if (!payload.projectId || !payload.jobId) {
      return Response.json(
        { error: "Select a project and order." },
        { status: 400 },
      );
    }

    const project = await prisma.project.findFirst({
      where: {
        id: payload.projectId,
        shop,
        OR: [
          { ownerCustomerId: customerId },
          { members: { some: { customerId } } },
        ],
      },
      include: { members: true },
    });

    if (!project) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }

    const memberRole = project.members.find(
      (member) => member.customerId === customerId,
    )?.role;
    const canEdit =
      project.ownerCustomerId === customerId || memberRole === "edit";

    if (!canEdit) {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }

    const job = await prisma.job.findFirst({
      where: { id: payload.jobId, projectId: project.id },
      include: { items: true, orderLink: true },
    });

    if (!job) {
      return Response.json({ error: "Order not found." }, { status: 404 });
    }

    await prisma.project.update({
      where: { id: project.id },
      data: { poNumber, companyName },
    });

    const isLocked = job.isLocked || Boolean(job.orderLink);
    let targetJobId = job.id;
    let copied = false;

    if (isLocked) {
      const nextJobSortOrder = await getNextJobSortOrder(project.id);
      const copy = await prisma.job.create({
        data: {
          projectId: project.id,
          name: `${job.name} (Copy)`,
          isLocked: false,
          sortOrder: nextJobSortOrder,
          items: {
            create: job.items.map((item) => ({
              variantId: item.variantId,
              quantity: item.quantity,
              priceSnapshot: item.priceSnapshot,
              sortOrder: item.sortOrder,
            })),
          },
        },
      });

      targetJobId = copy.id;
      copied = true;
    }

    if (payload.quantityMode === "replace") {
      await prisma.$transaction([
        prisma.jobItem.deleteMany({ where: { jobId: targetJobId } }),
        prisma.jobItem.createMany({
          data: items.map((item, index) => ({
            jobId: targetJobId,
            variantId: item.variantId,
            quantity: item.quantity,
            priceSnapshot: item.priceSnapshot,
            sortOrder: index + 1,
          })),
        }),
      ]);
    } else {
      let nextSortOrder = await getNextSortOrder(targetJobId);
      for (const item of items) {
        const existing = await prisma.jobItem.findFirst({
          where: { jobId: targetJobId, variantId: item.variantId },
        });

        if (existing) {
          await prisma.jobItem.update({
            where: { id: existing.id },
            data: {
              quantity: existing.quantity + item.quantity,
              priceSnapshot: item.priceSnapshot,
            },
          });
        } else {
          await prisma.jobItem.create({
            data: {
              jobId: targetJobId,
              variantId: item.variantId,
              quantity: item.quantity,
              priceSnapshot: item.priceSnapshot,
              sortOrder: nextSortOrder,
            },
          });
          nextSortOrder += 1;
        }
      }
    }

    await prisma.approvalRequest.deleteMany({
      where: {
        projectId: project.id,
        jobId: targetJobId,
        itemId: "",
      },
    });

    return Response.json({
      projectId: project.id,
      jobId: targetJobId,
      copied,
    });
  }

  return Response.json({ error: "Unsupported mode." }, { status: 400 });
};
