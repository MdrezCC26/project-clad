import prisma from "../db.server";
import { getCustomersByIds } from "./adminCustomers.server";
import { getAdminVariantInfo } from "./adminVariants.server";

const escapeCell = (value: string) => {
  const safe = value.replace(/"/g, '""');
  return `"${safe}"`;
};

export async function getCsvForProjectIds(
  shop: string,
  projectIds: string[],
): Promise<string> {
  if (projectIds.length === 0) return "";

  const projects = await prisma.project.findMany({
    where: { shop, id: { in: projectIds } },
    include: { members: true, jobs: { include: { items: true } } },
    orderBy: { createdAt: "desc" },
  });

  const memberIds = projects.flatMap((project) => [
    project.ownerCustomerId,
    ...project.members.map((member) => member.customerId),
  ]);
  const customerInfo = await getCustomersByIds(shop, memberIds).catch(
    () => ({}),
  );

  const variantIds = projects.flatMap((project) =>
    project.jobs.flatMap((job) => job.items.map((item) => item.variantId)),
  );
  const variantInfo = await getAdminVariantInfo(shop, variantIds).catch(
    () => ({}),
  );

  const rows: string[] = [];
  rows.push(
    [
      "Project ID",
      "Project Name",
      "PO Number",
      "Company Name",
      "Owner Email",
      "Member Emails",
      "Order ID",
      "Order Name",
      "Item ID",
      "Variant ID",
      "Product",
      "Quantity",
      "Price Snapshot",
    ].join(","),
  );

  projects.forEach((project) => {
    const ownerEmail = customerInfo[project.ownerCustomerId]?.email || "";
    const memberEmails = project.members
      .filter((member) => member.customerId !== project.ownerCustomerId)
      .map((member) => customerInfo[member.customerId]?.email || "")
      .filter(Boolean)
      .join("; ");

    if (project.jobs.length === 0) {
      rows.push(
        [
          project.id,
          project.name,
          project.poNumber || "",
          project.companyName || "",
          ownerEmail,
          memberEmails,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ]
          .map((cell) => escapeCell(String(cell)))
          .join(","),
      );
      return;
    }

    project.jobs.forEach((job) => {
      if (job.items.length === 0) {
        rows.push(
          [
            project.id,
            project.name,
            project.poNumber || "",
            project.companyName || "",
            ownerEmail,
            memberEmails,
            job.id,
            job.name,
            "",
            "",
            "",
            "",
            "",
          ]
            .map((cell) => escapeCell(String(cell)))
            .join(","),
        );
        return;
      }

      job.items.forEach((item) => {
        const info = variantInfo[item.variantId];
        const productName = info
          ? info.title && info.title !== "Default Title"
            ? `${info.productTitle} — ${info.title}`
            : info.productTitle
          : `Variant ${item.variantId}`;
        rows.push(
          [
            project.id,
            project.name,
            project.poNumber || "",
            project.companyName || "",
            ownerEmail,
            memberEmails,
            job.id,
            job.name,
            item.id,
            item.variantId,
            productName,
            item.quantity,
            item.priceSnapshot.toString(),
          ]
            .map((cell) => escapeCell(String(cell)))
            .join(","),
        );
      });
    });
  });

  return `\ufeff${rows.join("\n")}`;
}
