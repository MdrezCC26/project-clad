import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import { findCustomerIdByEmail } from "../utils/adminCustomers.server";

type MemberPayload = {
  intent?: "add" | "remove";
  projectId?: string;
  email?: string;
  role?: "edit" | "view";
  memberCustomerId?: string;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, customerId } = requireAppProxyCustomer(request, {
    jsonOnFail: true,
  });
  const payload = (await request.json()) as MemberPayload;
  const intent = payload.intent || "";
  const projectId = String(payload.projectId || "");

  if (!projectId) {
    return Response.json({ error: "Project is required." }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, shop },
    include: { members: true },
  });

  if (!project) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }

  const isOwner = project.ownerCustomerId === customerId;
  if (!isOwner) {
    return Response.json(
      { error: "Only the project owner can manage members." },
      { status: 403 },
    );
  }

  if (intent === "add") {
    const email = String(payload.email || "").trim();
    const role = payload.role === "edit" ? "edit" : "view";

    if (!email) {
      return Response.json({ error: "Email is required." }, { status: 400 });
    }

    let memberCustomerId: string | null = null;
    try {
      memberCustomerId = await findCustomerIdByEmail(shop, email);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Customer lookup failed.",
        },
        { status: 400 },
      );
    }

    if (!memberCustomerId) {
      return Response.json(
        { error: "No customer found with that email." },
        { status: 404 },
      );
    }

    if (memberCustomerId === project.ownerCustomerId) {
      return Response.json(
        { error: "This customer already owns the project." },
        { status: 400 },
      );
    }

    await prisma.projectMember.upsert({
      where: {
        projectId_customerId: {
          projectId,
          customerId: memberCustomerId,
        },
      },
      update: { role },
      create: {
        projectId,
        customerId: memberCustomerId,
        role,
      },
    });

    return Response.json({ ok: true });
  }

  if (intent === "remove") {
    const memberCustomerId = String(payload.memberCustomerId || "");
    if (!memberCustomerId || memberCustomerId === project.ownerCustomerId) {
      return Response.json({ error: "Invalid member." }, { status: 400 });
    }

    await prisma.projectMember.deleteMany({
      where: { projectId, customerId: memberCustomerId },
    });

    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unsupported action." }, { status: 400 });
};
