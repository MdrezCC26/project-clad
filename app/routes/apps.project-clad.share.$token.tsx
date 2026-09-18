import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import { shopStringFilter } from "../utils/projectAccess.server";

async function findValidShareToken(shop: string, token: string) {
  return prisma.projectShareToken.findFirst({
    where: {
      token,
      expiresAt: { gt: new Date() },
      project: { shop: shopStringFilter(shop) },
    },
    include: { project: true },
  });
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = requireAppProxyCustomer(request);
  const token = params.token ?? "";
  const shareToken = await findValidShareToken(shop, token);

  if (!shareToken) {
    throw new Response("Share link not found or expired", { status: 404 });
  }

  return {
    projectName: shareToken.project.name,
    role: shareToken.role,
    expiresAt: shareToken.expiresAt.toISOString(),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { shop, customerId } = requireAppProxyCustomer(request);
  const token = params.token ?? "";
  const shareToken = await findValidShareToken(shop, token);
  if (!shareToken) {
    throw new Response("Share link not found or expired", { status: 404 });
  }

  await prisma.projectMember.upsert({
    where: {
      projectId_customerId: {
        projectId: shareToken.projectId,
        customerId: customerId,
      },
    },
    update: { role: shareToken.role },
    create: {
      projectId: shareToken.projectId,
      customerId: customerId,
      role: shareToken.role,
    },
  });

  // Use the canonical project URL (not `/projects/:id`) so we always hit `apps.project-clad.project`.
  return redirect(
    `/apps/project-clad/project?id=${encodeURIComponent(shareToken.projectId)}`,
  );
};

export default function AcceptProjectShare() {
  const { projectName, role, expiresAt } = useLoaderData<typeof loader>();
  return (
    <main style={{ maxWidth: 560, margin: "3rem auto", padding: "0 1.25rem" }}>
      <h1>Join {projectName}</h1>
      <p>
        This invitation grants {role === "edit" ? "editing" : "view-only"}{" "}
        access to the project.
      </p>
      <p>This link expires {new Date(expiresAt).toLocaleString()}.</p>
      <Form method="post">
        <button type="submit">Accept project invitation</button>
      </Form>
    </main>
  );
}
