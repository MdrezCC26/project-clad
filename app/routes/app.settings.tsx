import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { authenticate, sessionStorage } from "../shopify.server";
import prisma from "../db.server";
import { hashPassword } from "../utils/passwords.server";
import {
  findCustomerIdByEmail,
  getCustomersByIds,
  listCustomers,
} from "../utils/adminCustomers.server";
import { getAdminVariantInfo } from "../utils/adminVariants.server";
import { getCsvForProjectIds } from "../utils/exportProjectsCsv.server";
import { listMediaImages } from "../utils/adminMedia.server";
import {
  getSmtpConfigStatus,
  isEmailConfigured,
  sendEmail,
} from "../utils/email.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await prisma.shopSettings.findUnique({
    where: { shop: session.shop },
  });
  const projects = await prisma.project.findMany({
    where: { shop: session.shop },
    include: {
      members: true,
      jobs: { include: { items: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const memberIds = projects.flatMap((project) => [
    project.ownerCustomerId,
    ...project.members.map((member) => member.customerId),
  ]);
  let customerInfo: Record<
    string,
    { email: string | null; firstName: string | null; lastName: string | null }
  > = {};
  let memberLookupError: string | null = null;
  try {
    customerInfo = await getCustomersByIds(session.shop, memberIds);
  } catch (error) {
    memberLookupError =
      error instanceof Error ? error.message : "Member lookup failed.";
  }
  const variantIds = projects.flatMap((project) =>
    project.jobs.flatMap((job) => job.items.map((item) => item.variantId)),
  );
  let variantInfo: Record<
    string,
    { title: string; productTitle: string }
  > = {};
  let variantLookupError: string | null = null;
  try {
    variantInfo = await getAdminVariantInfo(session.shop, variantIds);
  } catch (error) {
    variantLookupError =
      error instanceof Error ? error.message : "Product lookup failed.";
  }

  let customers: Array<{
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  }> = [];
  let customerListError: string | null = null;
  try {
    customers = await listCustomers(session.shop);
  } catch (error) {
    customerListError =
      error instanceof Error ? error.message : "Customer lookup failed.";
  }

  const sessions = await sessionStorage.findSessionsByShop(session.shop);
  const offlineSession = sessions.find((stored) => !stored.isOnline);

  const smtpStatus = getSmtpConfigStatus();
  const defaultNavButtons = [
    { label: "Projects", url: "/apps/project-clad/projects" },
    { label: "Store", url: "/" },
    { label: "Cart", url: "/cart" },
  ];
  let mediaImages: Array<{ id: string; url: string; alt: string | null }> = [];
  let mediaError: string | null = null;
  try {
    mediaImages = await listMediaImages(session.shop);
  } catch (err) {
    mediaError =
      err instanceof Error ? err.message : "Could not load media library.";
  }

  const navButtons = [
    {
      label: settings?.navButton1Label || defaultNavButtons[0].label,
      url: settings?.navButton1Url || defaultNavButtons[0].url,
    },
    {
      label: settings?.navButton2Label || defaultNavButtons[1].label,
      url: settings?.navButton2Url || defaultNavButtons[1].url,
    },
    {
      label: settings?.navButton3Label || defaultNavButtons[2].label,
      url: settings?.navButton3Url || defaultNavButtons[2].url,
    },
  ];

  return {
    hasPricingPassword: Boolean(settings?.pricingPasswordHash),
    storefrontTheme: settings?.storefrontTheme || "default",
    hasLogo: Boolean(settings?.logoDataUrl),
    mediaImages,
    mediaError,
    navButtons,
    emailConfigured: isEmailConfigured(),
    smtpStatus,
    shop: session.shop,
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      poNumber: project.poNumber,
      companyName: project.companyName,
      ownerCustomerId: project.ownerCustomerId,
      jobs: project.jobs.map((job) => ({
        id: job.id,
        name: job.name,
        isLocked: job.isLocked,
        items: job.items.map((item) => {
          const info = variantInfo[item.variantId];
          const displayName = info
            ? info.title && info.title !== "Default Title"
              ? `${info.productTitle} — ${info.title}`
              : info.productTitle
            : `Variant ${item.variantId}`;
          return {
            id: item.id,
            variantId: item.variantId,
            quantity: item.quantity,
            displayName,
          };
        }),
      })),
      members: [
        {
          customerId: project.ownerCustomerId,
          role: "owner" as const,
          email: customerInfo[project.ownerCustomerId]?.email || null,
          firstName: customerInfo[project.ownerCustomerId]?.firstName || null,
          lastName: customerInfo[project.ownerCustomerId]?.lastName || null,
        },
        ...project.members
          .filter((member) => member.customerId !== project.ownerCustomerId)
          .map((member) => ({
            customerId: member.customerId,
            role: member.role,
            email: customerInfo[member.customerId]?.email || null,
            firstName: customerInfo[member.customerId]?.firstName || null,
            lastName: customerInfo[member.customerId]?.lastName || null,
          })),
      ],
    })),
    grantedScopes: offlineSession?.scope || "",
    memberLookupError,
    variantLookupError,
    customers,
    customerListError,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const password = String(formData.get("pricingPassword") || "").trim();

  if (intent === "reset-sessions") {
    await prisma.session.deleteMany({ where: { shop: session.shop } });
    return { ok: true, sessionsCleared: true };
  }

  if (intent === "save-theme") {
    const theme = String(formData.get("storefrontTheme") || "default").trim();
    const validThemes = ["default", "dark", "warm", "ocean"];
    const storefrontTheme = validThemes.includes(theme) ? theme : "default";
    await prisma.shopSettings.upsert({
      where: { shop: session.shop },
      update: { storefrontTheme },
      create: { shop: session.shop, storefrontTheme },
    });
    return { ok: true, themeSaved: true };
  }

  if (intent === "save-logo-from-media") {
    const mediaUrl = String(formData.get("logoMediaUrl") || "").trim();
    if (!mediaUrl) {
      return { logoError: "Please select an image from the media library." };
    }
    try {
      const res = await fetch(mediaUrl);
      if (!res.ok) {
        throw new Error(`Failed to fetch image: ${res.status}`);
      }
      const contentType = res.headers.get("content-type") || "image/png";
      const allowedTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
      const mime = contentType.split(";")[0].trim().toLowerCase();
      if (!mime.startsWith("image/")) {
        return { logoError: "Selected file is not an image." };
      }
      const safeMime = allowedTypes.includes(mime) ? mime : "image/png";
      const arrayBuffer = await res.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      if (base64.length > 700000) {
        return { logoError: "Image is too large. Max 500 KB recommended." };
      }
      const dataUrl = `data:${safeMime};base64,${base64}`;
      await prisma.shopSettings.upsert({
        where: { shop: session.shop },
        update: { logoDataUrl: dataUrl },
        create: { shop: session.shop, logoDataUrl: dataUrl },
      });
      return { ok: true, logoSaved: true };
    } catch (err) {
      console.error("Logo from media error:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      return { logoError: `Failed to use image: ${msg}` };
    }
  }

  if (intent === "save-logo") {
    try {
      const file = formData.get("logo");
      const isFile = file instanceof File;
      if (!isFile || file.size === 0) {
        return { logoError: "Please select an image file (PNG, JPEG, GIF, or WebP)." };
      }
      if (file.size > 500 * 1024) {
        return { logoError: "Image must be under 500 KB." };
      }
      const allowedTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
      if (!allowedTypes.includes(file.type)) {
        return { logoError: "Please select an image file (PNG, JPEG, GIF, or WebP)." };
      }
      const bytes = await file.arrayBuffer();
      const base64 = Buffer.from(bytes).toString("base64");
      const dataUrl = `data:${file.type};base64,${base64}`;
      await prisma.shopSettings.upsert({
        where: { shop: session.shop },
        update: { logoDataUrl: dataUrl },
        create: { shop: session.shop, logoDataUrl: dataUrl },
      });
      return { ok: true, logoSaved: true };
    } catch (err) {
      console.error("Logo upload error:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      return { logoError: `Upload failed: ${msg}. Please try again.` };
    }
  }

  if (intent === "remove-logo") {
    await prisma.shopSettings.upsert({
      where: { shop: session.shop },
      update: { logoDataUrl: null },
      create: { shop: session.shop },
    });
    return { ok: true, logoRemoved: true };
  }

  if (intent === "save-nav-buttons") {
    const navButton1Label = String(formData.get("navButton1Label") || "").trim();
    const navButton1Url = String(formData.get("navButton1Url") || "").trim();
    const navButton2Label = String(formData.get("navButton2Label") || "").trim();
    const navButton2Url = String(formData.get("navButton2Url") || "").trim();
    const navButton3Label = String(formData.get("navButton3Label") || "").trim();
    const navButton3Url = String(formData.get("navButton3Url") || "").trim();

    await prisma.shopSettings.upsert({
      where: { shop: session.shop },
      update: {
        navButton1Label: navButton1Label || null,
        navButton1Url: navButton1Url || null,
        navButton2Label: navButton2Label || null,
        navButton2Url: navButton2Url || null,
        navButton3Label: navButton3Label || null,
        navButton3Url: navButton3Url || null,
      },
      create: {
        shop: session.shop,
        navButton1Label: navButton1Label || null,
        navButton1Url: navButton1Url || null,
        navButton2Label: navButton2Label || null,
        navButton2Url: navButton2Url || null,
        navButton3Label: navButton3Label || null,
        navButton3Url: navButton3Url || null,
      },
    });
    return { ok: true, navButtonsSaved: true };
  }

  if (intent === "update-project") {
    const projectId = String(formData.get("projectId") || "").trim();
    const name = String(formData.get("name") || "").trim();
    const poNumber = String(formData.get("poNumber") || "").trim();
    const companyName = String(formData.get("companyName") || "").trim();

    if (!projectId || !name) {
      return Response.json(
        { projectError: "Project name is required." },
        { status: 400 },
      );
    }

    await prisma.project.update({
      where: { id: projectId, shop: session.shop },
      data: {
        name,
        poNumber: poNumber || null,
        companyName: companyName || null,
      },
    });

    return { ok: true, projectUpdated: true };
  }

  if (intent === "delete-job-admin") {
    const projectId = String(formData.get("projectId") || "").trim();
    const jobId = String(formData.get("jobId") || "").trim();
    if (!projectId || !jobId) {
      return Response.json({ projectError: "Order is required." }, { status: 400 });
    }
    const job = await prisma.job.findFirst({
      where: { id: jobId, projectId },
      include: { orderLink: true },
    });
    if (!job) {
      return Response.json({ projectError: "Order not found." }, { status: 404 });
    }
    const isLocked = job.isLocked || Boolean(job.orderLink);
    if (isLocked) {
      return Response.json({ projectError: "Order is locked." }, { status: 403 });
    }
    await prisma.job.delete({ where: { id: jobId } });
    return { ok: true, projectUpdated: true };
  }

  if (intent === "delete-item-admin") {
    const projectId = String(formData.get("projectId") || "").trim();
    const itemId = String(formData.get("itemId") || "").trim();
    if (!projectId || !itemId) {
      return Response.json({ projectError: "Item is required." }, { status: 400 });
    }
    const item = await prisma.jobItem.findFirst({
      where: { id: itemId },
      include: { job: { include: { orderLink: true } } },
    });
    if (!item || item.job.projectId !== projectId) {
      return Response.json({ projectError: "Item not found." }, { status: 404 });
    }
    const isLocked = item.job.isLocked || Boolean(item.job.orderLink);
    if (isLocked) {
      return Response.json({ projectError: "Order is locked." }, { status: 403 });
    }
    await prisma.jobItem.delete({ where: { id: itemId } });
    return { ok: true, projectUpdated: true };
  }

  if (intent === "remove-member") {
    const projectId = String(formData.get("projectId") || "").trim();
    const memberCustomerId = String(formData.get("memberCustomerId") || "").trim();

    if (!projectId || !memberCustomerId) {
      return Response.json(
        { memberError: "Member and project are required." },
        { status: 400 },
      );
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, shop: session.shop },
    });

    if (!project) {
      return Response.json(
        { memberError: "Project not found." },
        { status: 404 },
      );
    }

    if (memberCustomerId === project.ownerCustomerId) {
      return Response.json(
        { memberError: "Cannot remove the project owner." },
        { status: 400 },
      );
    }

    await prisma.projectMember.deleteMany({
      where: { projectId, customerId: memberCustomerId },
    });

    return { ok: true, memberRemoved: true };
  }

  if (intent === "add-member") {
    const projectId = String(formData.get("projectId") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const role = String(formData.get("role") || "view");

    if (!projectId) {
      return Response.json(
        { memberError: "Project is required." },
        { status: 400 },
      );
    }
    if (!email) {
      return Response.json(
        { memberError: "Email is required." },
        { status: 400 },
      );
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, shop: session.shop },
    });

    if (!project) {
      return Response.json(
        { memberError: "Project not found." },
        { status: 404 },
      );
    }

    let memberCustomerId: string | null = null;
    try {
      memberCustomerId = await findCustomerIdByEmail(session.shop, email);
    } catch (error) {
      return Response.json(
        {
          memberError:
            error instanceof Error
              ? error.message
              : "Customer lookup failed.",
        },
        { status: 400 },
      );
    }

    if (!memberCustomerId) {
      return Response.json(
        { memberError: "No customer found with that email." },
        { status: 404 },
      );
    }

    if (memberCustomerId === project.ownerCustomerId) {
      return Response.json(
        { memberError: "This customer already owns the project." },
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
      update: { role: role === "edit" ? "edit" : "view" },
      create: {
        projectId,
        customerId: memberCustomerId,
        role: role === "edit" ? "edit" : "view",
      },
    });

    return { ok: true, memberAdded: true };
  }

  if (intent === "email-csv") {
    const projectId = String(formData.get("projectId") || "").trim();
    const toEmail = String(formData.get("toEmail") || "").trim();

    if (!projectId) {
      return { emailError: "Select a project first." };
    }
    if (!toEmail) {
      return { emailError: "Recipient email is required." };
    }
    if (!isEmailConfigured()) {
      return {
        emailError:
          "SMTP not configured. Set SMTP_USER and SMTP_PASSWORD in .env.",
      };
    }

    try {
      const csv = await getCsvForProjectIds(session.shop, [projectId]);
      await sendEmail({
        to: toEmail,
        subject: "ProjectClad project export",
        text: "Project export CSV is attached.",
        attachments: [
          {
            filename: "projectclad-projects.csv",
            content: csv,
          },
        ],
      });
      return { ok: true, emailSent: true };
    } catch (error) {
      return {
        emailError:
          error instanceof Error ? error.message : "Failed to send email.",
      };
    }
  }

  if (intent === "clear" || !password) {
    await prisma.shopSettings.upsert({
      where: { shop: session.shop },
      update: { pricingPasswordHash: null, pricingPasswordSalt: null },
      create: { shop: session.shop },
    });

    return { ok: true, cleared: true };
  }

  const { hash, salt } = hashPassword(password);

  await prisma.shopSettings.upsert({
    where: { shop: session.shop },
    update: { pricingPasswordHash: hash, pricingPasswordSalt: salt },
    create: {
      shop: session.shop,
      pricingPasswordHash: hash,
      pricingPasswordSalt: salt,
    },
  });

  return { ok: true, cleared: false };
};

export default function Settings() {
  const {
    hasPricingPassword,
    storefrontTheme,
    hasLogo,
    mediaImages,
    mediaError,
    navButtons,
    emailConfigured,
    smtpStatus,
    projects,
    shop,
    grantedScopes,
    memberLookupError,
    variantLookupError,
    customers,
    customerListError,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const memberError =
    actionData && typeof actionData === "object" && "memberError" in actionData
      ? (actionData.memberError as string)
      : null;
  const memberAdded =
    actionData && typeof actionData === "object" && "memberAdded" in actionData
      ? Boolean(actionData.memberAdded)
      : false;
  const memberRemoved =
    actionData && typeof actionData === "object" && "memberRemoved" in actionData
      ? Boolean(actionData.memberRemoved)
      : false;
  const projectUpdated =
    actionData && typeof actionData === "object" && "projectUpdated" in actionData
      ? Boolean(actionData.projectUpdated)
      : false;
  const projectError =
    actionData && typeof actionData === "object" && "projectError" in actionData
      ? (actionData.projectError as string)
      : null;
  const emailSent =
    actionData && typeof actionData === "object" && "emailSent" in actionData
      ? Boolean(actionData.emailSent)
      : false;
  const emailError =
    actionData && typeof actionData === "object" && "emailError" in actionData
      ? (actionData.emailError as string)
      : null;
  const sessionsCleared =
    actionData && typeof actionData === "object" && "sessionsCleared" in actionData
      ? Boolean(actionData.sessionsCleared)
      : false;
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState(
    customers[0]?.id || "",
  );
  const customerProjects = useMemo(() => {
    if (!selectedCustomerId) return [];
    return projects.filter(
      (project) =>
        project.ownerCustomerId === selectedCustomerId ||
        project.members.some((member) => member.customerId === selectedCustomerId),
    );
  }, [projects, selectedCustomerId]);
  const [selectedProjectId, setSelectedProjectId] = useState(
    customerProjects[0]?.id || "",
  );
  const selectedProjectIds = useMemo(
    () => new Set(customerProjects.map((project) => project.id)),
    [customerProjects],
  );
  useEffect(() => {
    if (selectedProjectId && !selectedProjectIds.has(selectedProjectId)) {
      setSelectedProjectId(customerProjects[0]?.id || "");
    }
    if (!selectedProjectId && customerProjects.length) {
      setSelectedProjectId(customerProjects[0]?.id || "");
    }
  }, [customerProjects, selectedProjectId, selectedProjectIds]);
  const selectedProject = useMemo(
    () => customerProjects.find((project) => project.id === selectedProjectId),
    [customerProjects, selectedProjectId],
  );

  const handleDownloadCsv = async () => {
    if (!shop || downloading) return;
    if (!selectedProjectId) {
      setDownloadError("Select a project first.");
      return;
    }
    setDownloading(true);
    setDownloadError(null);
    try {
      const response = await fetch(
        `/app/export-projects?shop=${encodeURIComponent(shop)}&projectId=${encodeURIComponent(
          selectedProjectId,
        )}`,
      );
      if (!response.ok) {
        throw new Error("Unable to download CSV.");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "projectclad-projects.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setDownloadError(
        error instanceof Error ? error.message : "Unable to download CSV.",
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <s-page heading="ProjectClad settings">
      <s-section heading="App access scopes">
        <s-paragraph>
          Granted scopes: {grantedScopes || "No offline session yet."}
        </s-paragraph>
        <Form method="post">
          <button type="submit" name="intent" value="reset-sessions">
            Reset app sessions
          </button>
        </Form>
        {sessionsCleared && (
          <s-paragraph>
            Sessions cleared. Reopen the app to reauthorize.
          </s-paragraph>
        )}
      </s-section>
      <s-section heading="Storefront theme">
        <s-paragraph>
          Choose the look and feel for the customer-facing Projects and Orders
          pages.
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="save-theme" />
          <s-stack direction="block" gap="base">
            <div
              style={{
                display: "grid",
                gap: "0.75rem",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              }}
            >
              {[
                { value: "default", label: "Default", desc: "Light, clean" },
                { value: "dark", label: "Dark", desc: "Dark mode" },
                { value: "warm", label: "Warm", desc: "Amber tones" },
                { value: "ocean", label: "Ocean", desc: "Blues & teals" },
              ].map(({ value, label, desc }) => (
                <label
                  key={value}
                  style={{
                    display: "block",
                    padding: "1rem",
                    border:
                      storefrontTheme === value
                        ? "2px solid var(--color-border-strong)"
                        : "1px solid var(--color-border)",
                    borderRadius: "8px",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="storefrontTheme"
                    value={value}
                    defaultChecked={storefrontTheme === value}
                    style={{ marginRight: "0.5rem" }}
                  />
                  <strong>{label}</strong>
                  <div style={{ fontSize: "0.85rem", opacity: 0.8 }}>
                    {desc}
                  </div>
                </label>
              ))}
            </div>
            <button type="submit">Save theme</button>
          </s-stack>
        </Form>
      </s-section>
      <s-section heading="Storefront logo">
        <s-paragraph>
          Upload a logo to display at the top center of Projects and Project
          detail pages. Max 500 KB. PNG, JPEG, GIF, or WebP.
        </s-paragraph>
        <s-stack direction="block" gap="base">
          {mediaError ? (
            <s-paragraph>
              Media library unavailable: {mediaError}. Ensure read_files scope is
              granted and reinstall the app if needed.
            </s-paragraph>
          ) : (
            mediaImages.length > 0 && (
              <div>
                <s-paragraph>Or choose from your Shopify media library:</s-paragraph>
                <Form method="post">
                  <input type="hidden" name="intent" value="save-logo-from-media" />
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
                      gap: "0.5rem",
                      marginTop: "0.5rem",
                    }}
                  >
                    {mediaImages.map((img) => (
                      <button
                        key={img.id}
                        type="submit"
                        name="logoMediaUrl"
                        value={img.url}
                        style={{
                          padding: 0,
                          border: "2px solid transparent",
                          borderRadius: 8,
                          cursor: "pointer",
                          overflow: "hidden",
                          background: "transparent",
                        }}
                      >
                        <img
                          src={img.url}
                          alt={img.alt || "Media"}
                          style={{
                            width: 80,
                            height: 80,
                            objectFit: "cover",
                            display: "block",
                          }}
                        />
                      </button>
                    ))}
                  </div>
                </Form>
              </div>
            )
          )}
          {hasLogo && (
            <div
              style={{
                padding: "1rem",
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
                textAlign: "center",
              }}
            >
              <s-paragraph>Current logo (preview in storefront)</s-paragraph>
              <Form method="post" style={{ marginTop: "0.5rem" }}>
                <input type="hidden" name="intent" value="remove-logo" />
                <button type="submit">Remove logo</button>
              </Form>
            </div>
          )}
          <Form
            method="post"
            encType="multipart/form-data"
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
          >
            <input type="hidden" name="intent" value="save-logo" />
            <div
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
              }}
            >
              <label
                htmlFor="logo-upload"
                style={{
                  padding: "0.5rem 1rem",
                  border: "1px solid var(--color-border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Choose image
              </label>
              <input
                id="logo-upload"
                name="logo"
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                required
              />
              <button type="submit">Upload logo</button>
            </div>
            {actionData &&
              typeof actionData === "object" &&
              "logoError" in actionData && (
                <s-paragraph>
                  {actionData.logoError as string}
                </s-paragraph>
              )}
          </Form>
        </s-stack>
      </s-section>
      <s-section heading="Navigation buttons">
        <s-paragraph>
          Configure the three navigation buttons shown on Projects and Project
          detail pages. Leave a field blank to use the default.
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="save-nav-buttons" />
          <s-stack direction="block" gap="base">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "120px 1fr",
                  gap: "0.5rem",
                  alignItems: "center",
                }}
              >
                <label htmlFor={`navButton${i}Label`}>
                  Button {i} label
                </label>
                <input
                  id={`navButton${i}Label`}
                  name={`navButton${i}Label`}
                  type="text"
                  defaultValue={
                    navButtons[i - 1]?.label
                  }
                  placeholder={
                    i === 1
                      ? "Projects"
                      : i === 2
                        ? "Store"
                        : "Cart"
                  }
                />
                <label htmlFor={`navButton${i}Url`}>Button {i} URL</label>
                <input
                  id={`navButton${i}Url`}
                  name={`navButton${i}Url`}
                  type="text"
                  defaultValue={navButtons[i - 1]?.url}
                  placeholder={
                    i === 1
                      ? "/apps/project-clad/projects"
                      : i === 2
                        ? "/"
                        : "/cart"
                  }
                />
              </div>
            ))}
            <button type="submit">Save navigation buttons</button>
          </s-stack>
        </Form>
      </s-section>
      <s-section heading="Pricing visibility password">
        <s-paragraph>
          Customers must enter this password to reveal pricing in project views.
        </s-paragraph>
        <Form method="post">
          <s-stack direction="block" gap="base">
            <label style={{ display: "grid", gap: "0.25rem" }}>
              <span>Pricing password</span>
              <input
                name="pricingPassword"
                type="password"
                placeholder={hasPricingPassword ? "••••••••" : "Set a password"}
                autoComplete="new-password"
              />
            </label>
            <button type="submit" name="intent" value="save">
              Save password
            </button>
            {hasPricingPassword && (
              <button type="submit" name="intent" value="clear">
                Clear password
              </button>
            )}
          </s-stack>
        </Form>
      </s-section>
      <s-section heading="Projects">
        <s-stack direction="block" gap="base">
          <button type="button" onClick={handleDownloadCsv} disabled={downloading}>
            {downloading ? "Downloading..." : "Download projects CSV"}
          </button>
          {downloadError && <s-paragraph>{downloadError}</s-paragraph>}
          <s-stack direction="block" gap="base">
            <s-paragraph>
              {emailConfigured
                ? "Email the selected project’s CSV to an address."
                : "Set SMTP_USER, SMTP_PASSWORD, and SMTP_HOST in .env and restart the app to enable Email CSV."}
            </s-paragraph>
            {!emailConfigured && (
              <s-paragraph>
                SMTP in .env: USER {smtpStatus.SMTP_USER ? "✓" : "✗"} · PASSWORD{" "}
                {smtpStatus.SMTP_PASSWORD ? "✓" : "✗"} · HOST{" "}
                {smtpStatus.SMTP_HOST ? "✓" : "✗"} — fix missing and restart.
                Add these lines to .env in the project root (same folder as package.json), one per line, no spaces around =: SMTP_USER=your@email.com · SMTP_PASSWORD=your_app_password · SMTP_HOST=smtp.office365.com
              </s-paragraph>
            )}
            <Form method="post">
              <input type="hidden" name="intent" value="email-csv" />
              <input
                type="hidden"
                name="projectId"
                value={selectedProjectId || ""}
              />
              <s-stack direction="inline" gap="base" align="center">
                <label style={{ display: "grid", gap: "0.25rem" }}>
                  <span>Email CSV to</span>
                  <input
                    name="toEmail"
                    type="email"
                    placeholder="email@example.com"
                    disabled={!emailConfigured}
                  />
                </label>
                <button
                  type="submit"
                  disabled={!selectedProjectId || !emailConfigured}
                  style={{ alignSelf: "end" }}
                >
                  Email CSV
                </button>
              </s-stack>
              {emailSent && !emailError && (
                <s-paragraph>CSV sent to recipient.</s-paragraph>
              )}
              {emailError && <s-paragraph>{emailError}</s-paragraph>}
            </Form>
          </s-stack>
          <label style={{ display: "grid", gap: "0.25rem" }}>
            <span>User account e-mail</span>
            <select
              value={selectedCustomerId}
              onChange={(event) => {
                const nextId = event.target.value;
                setSelectedCustomerId(nextId);
                const nextProjects = projects.filter(
                  (project) =>
                    project.ownerCustomerId === nextId ||
                    project.members.some(
                      (member) => member.customerId === nextId,
                    ),
                );
                setSelectedProjectId(nextProjects[0]?.id || "");
              }}
            >
              <option value="">Select a customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.email || "No email"}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: "0.25rem" }}>
            <span>Project</span>
            <select
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
            >
              <option value="">Select a project</option>
              {customerProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          {selectedProject && (
            <s-card padding="base" key={selectedProject.id}>
              <Form method="post">
                <input type="hidden" name="intent" value="update-project" />
                <input type="hidden" name="projectId" value={selectedProject.id} />
                <s-stack direction="block" gap="base">
                  <label style={{ display: "grid", gap: "0.25rem" }}>
                    <span>PO Number</span>
                    <input
                      name="poNumber"
                      type="text"
                      defaultValue={selectedProject.poNumber || ""}
                    />
                  </label>
                  <label style={{ display: "grid", gap: "0.25rem" }}>
                    <span>Company name</span>
                    <input
                      name="companyName"
                      type="text"
                      defaultValue={selectedProject.companyName || ""}
                    />
                  </label>
                  <button type="submit">Save project</button>
                  {projectUpdated && !projectError && (
                    <s-paragraph>Project updated.</s-paragraph>
                  )}
                  {projectError && <s-paragraph>{projectError}</s-paragraph>}
                </s-stack>
              </Form>

              <s-stack direction="block" gap="base">
                <s-paragraph>Orders and products</s-paragraph>
                {variantLookupError && <s-paragraph>{variantLookupError}</s-paragraph>}
                {selectedProject.jobs.length === 0 ? (
                  <s-paragraph>No orders.</s-paragraph>
                ) : (
                  selectedProject.jobs.map((job) => (
                    <s-card key={job.id} padding="base">
                      <s-stack direction="block" gap="base">
                        <s-paragraph>{job.name}</s-paragraph>
                        <Form method="post">
                          <input type="hidden" name="intent" value="delete-job-admin" />
                          <input type="hidden" name="projectId" value={selectedProject.id} />
                          <input type="hidden" name="jobId" value={job.id} />
                          <button type="submit">Delete order</button>
                        </Form>
                        {job.items.length === 0 ? (
                          <s-paragraph>No items.</s-paragraph>
                        ) : (
                          job.items.map((item) => (
                            <s-stack
                              key={item.id}
                              direction="inline"
                              gap="base"
                              align="center"
                              justify="space-between"
                            >
                              <s-paragraph>
                                {item.displayName} • Quantity {item.quantity}
                              </s-paragraph>
                              <Form method="post">
                                <input
                                  type="hidden"
                                  name="intent"
                                  value="delete-item-admin"
                                />
                                <input
                                  type="hidden"
                                  name="projectId"
                                  value={selectedProject.id}
                                />
                                <input type="hidden" name="itemId" value={item.id} />
                                <button type="submit">Remove</button>
                              </Form>
                            </s-stack>
                          ))
                        )}
                      </s-stack>
                    </s-card>
                  ))
                )}
              </s-stack>

              <s-stack direction="block" gap="base">
                <s-paragraph>Project members</s-paragraph>
                {memberLookupError && <s-paragraph>{memberLookupError}</s-paragraph>}
                {selectedProject.members.filter((member) => member.role !== "owner")
                  .length === 0 ? (
                  <s-paragraph>No members.</s-paragraph>
                ) : (
                  selectedProject.members
                    .filter((member) => member.role !== "owner")
                    .map((member) => {
                      const name = [member.firstName, member.lastName]
                        .filter(Boolean)
                        .join(" ");
                      return (
                        <s-stack
                          key={`${selectedProject.id}-${member.customerId}`}
                          direction="inline"
                          gap="base"
                          align="center"
                          justify="space-between"
                        >
                          <s-paragraph>
                            {name || "—"} • {member.email || "—"} •{" "}
                            {member.role === "edit" ? "Edit" : "View only"}
                          </s-paragraph>
                          <Form method="post">
                            <input type="hidden" name="intent" value="remove-member" />
                            <input type="hidden" name="projectId" value={selectedProject.id} />
                            <input
                              type="hidden"
                              name="memberCustomerId"
                              value={member.customerId}
                            />
                            <button type="submit">Remove</button>
                          </Form>
                        </s-stack>
                      );
                    })
                )}
                <Form method="post">
                  <input type="hidden" name="intent" value="add-member" />
                  <input type="hidden" name="projectId" value={selectedProject.id} />
                  <s-stack direction="block" gap="base">
                    <label style={{ display: "grid", gap: "0.25rem" }}>
                      <span>Add member email</span>
                      <input name="email" type="email" placeholder="email@example.com" />
                    </label>
                    <label style={{ display: "grid", gap: "0.25rem" }}>
                      <span>Role</span>
                      <select name="role" defaultValue="edit">
                        <option value="edit">Edit</option>
                        <option value="view">View only</option>
                      </select>
                    </label>
                    <button type="submit">Add</button>
                    {memberAdded && !memberError && (
                      <s-paragraph>Member added.</s-paragraph>
                    )}
                    {memberError && <s-paragraph>{memberError}</s-paragraph>}
                  </s-stack>
                </Form>
              </s-stack>
            </s-card>
          )}

          {customerListError && <s-paragraph>{customerListError}</s-paragraph>}
        </s-stack>
      </s-section>
    </s-page>
  );
}
