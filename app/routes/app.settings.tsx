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
import { extractNumericCustomerIdsFromText } from "../utils/customerTags.server";
import { getAdminVariantInfo } from "../utils/adminVariants.server";
import { getCsvForProjectIds } from "../utils/exportProjectsCsv.server";
import { listMediaImages } from "../utils/adminMedia.server";
import {
  getSmtpConfigStatus,
  isEmailConfigured,
  sendEmail,
} from "../utils/email.server";
import {
  DEFAULT_EMAIL_NOTIFICATION_PREFS,
  EMAIL_NOTIFICATION_KINDS,
  financeMutedFromSendAllowList,
  parseEmailNotificationSettingsJson,
  serializeEmailNotificationSettings,
  type EmailNotificationPrefs,
} from "../utils/emailNotificationPrefs";
import { listConfiguredFinanceEmails } from "../utils/financeEmailRecipients.server";
import {
  parseStorefrontNavLinksJson,
  STOREFRONT_APP_NAV_JSON_PLACEHOLDER,
} from "../utils/storefrontAppNav";
import {
  assignNextJobOrderNumberForShop,
  setManualJobOrderNumberForShop,
} from "../utils/jobOrderNumber.server";
import { notifyMissionControlRemove } from "../utils/missionControl.server";
import {
  DEFAULT_SHOP_DELIVERY_FEE,
  parseDeliveryFeeFromForm,
} from "../utils/shopDeliveryFee";

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
    variantInfo = await getAdminVariantInfo(session.shop, variantIds, session);
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
    { label: "Store", url: "/collections/main-products" },
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

  const emailNotificationSettings = parseEmailNotificationSettingsJson(
    settings?.emailNotificationPrefsJson,
  );
  const financeRecipients = listConfiguredFinanceEmails();
  const financeMutedEmails = emailNotificationSettings.financeMutedEmails;
  const emailNotificationPrefs = emailNotificationSettings.prefs;

  return {
    emailNotificationPrefs,
    financeRecipients,
    financeMutedEmails,
    hasPricingPassword: Boolean(settings?.pricingPasswordHash),
    hasLogo: Boolean(settings?.logoDataUrl),
    hasBackgroundLogo: Boolean(settings?.backgroundLogoDataUrl),
    mediaImages,
    mediaError,
    navButtons,
    storefrontNavLinksJson: settings?.storefrontNavLinksJson ?? "",
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
        orderNumber: job.orderNumber ?? null,
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
    appAdminCustomerIds: settings?.appAdminCustomerIds ?? "",
    globalStaffEmails: settings?.globalStaffEmails ?? "",
    deliveryFeeAmount:
      settings?.deliveryFeeAmount != null
        ? Number(settings.deliveryFeeAmount)
        : DEFAULT_SHOP_DELIVERY_FEE,
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
      if (base64.length > 2800000) {
        return { logoError: "Image is too large. Max 2 MB recommended." };
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
      if (file.size > 2 * 1024 * 1024) {
        return { logoError: "Image must be under 2 MB." };
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

  if (intent === "save-bg-logo-from-media") {
    const mediaUrl = String(formData.get("bgLogoMediaUrl") || "").trim();
    if (!mediaUrl) {
      return { bgLogoError: "Please select an image from the media library." };
    }
    try {
      const res = await fetch(mediaUrl);
      if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
      const contentType = res.headers.get("content-type") || "image/png";
      const mime = contentType.split(";")[0].trim().toLowerCase();
      const allowedTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
      if (!mime.startsWith("image/")) {
        return { bgLogoError: "Selected file is not an image." };
      }
      const safeMime = allowedTypes.includes(mime) ? mime : "image/png";
      const arrayBuffer = await res.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      if (base64.length > 700000) {
        return { bgLogoError: "Image is too large. Max 500 KB recommended." };
      }
      const dataUrl = `data:${safeMime};base64,${base64}`;
      await prisma.shopSettings.upsert({
        where: { shop: session.shop },
        update: { backgroundLogoDataUrl: dataUrl },
        create: { shop: session.shop, backgroundLogoDataUrl: dataUrl },
      });
      return { ok: true, bgLogoSaved: true };
    } catch (err) {
      console.error("Background logo from media error:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      return { bgLogoError: `Failed to use image: ${msg}` };
    }
  }

  if (intent === "save-bg-logo") {
    try {
      const file = formData.get("bgLogo");
      const isFile = file instanceof File;
      if (!isFile || file.size === 0) {
        return { bgLogoError: "Please select an image file (PNG, JPEG, GIF, or WebP)." };
      }
      if (file.size > 500 * 1024) {
        return { bgLogoError: "Image must be under 500 KB." };
      }
      const allowedTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
      if (!allowedTypes.includes(file.type)) {
        return { bgLogoError: "Please select an image file (PNG, JPEG, GIF, or WebP)." };
      }
      const bytes = await file.arrayBuffer();
      const base64 = Buffer.from(bytes).toString("base64");
      const dataUrl = `data:${file.type};base64,${base64}`;
      await prisma.shopSettings.upsert({
        where: { shop: session.shop },
        update: { backgroundLogoDataUrl: dataUrl },
        create: { shop: session.shop, backgroundLogoDataUrl: dataUrl },
      });
      return { ok: true, bgLogoSaved: true };
    } catch (err) {
      console.error("Background logo upload error:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      return { bgLogoError: `Upload failed: ${msg}. Please try again.` };
    }
  }

  if (intent === "remove-bg-logo") {
    await prisma.shopSettings.upsert({
      where: { shop: session.shop },
      update: { backgroundLogoDataUrl: null },
      create: { shop: session.shop },
    });
    return { ok: true, bgLogoRemoved: true };
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

  if (intent === "save-storefront-nav-json") {
    const raw = String(formData.get("storefrontNavLinksJson") || "").trim();
    if (raw) {
      const parsed = parseStorefrontNavLinksJson(raw);
      if (!parsed) {
        return {
          storefrontNavJsonError:
            "Invalid JSON. Use an array of objects with label and url strings.",
        };
      }
    }
    await prisma.shopSettings.upsert({
      where: { shop: session.shop },
      update: { storefrontNavLinksJson: raw || null },
      create: { shop: session.shop, storefrontNavLinksJson: raw || null },
    });
    return { ok: true, storefrontNavSaved: true };
  }

  if (intent === "assign-next-order-number") {
    const jobId = String(formData.get("jobId") || "").trim();
    if (!jobId) {
      return { orderNumberError: "Select a project and order." };
    }
    const result = await assignNextJobOrderNumberForShop(session.shop, jobId);
    if (!result.ok) {
      return { orderNumberError: result.error };
    }
    return {
      ok: true,
      orderNumberSuccess: `Assigned order number #${result.orderNumber}.`,
    };
  }

  if (intent === "set-order-number-manual") {
    const jobId = String(formData.get("jobId") || "").trim();
    const raw = String(formData.get("manualOrderNumber") || "").trim();
    if (!jobId) {
      return { orderNumberError: "Select a project and order." };
    }
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) {
      return { orderNumberError: "Enter a valid order number (whole number)." };
    }
    const result = await setManualJobOrderNumberForShop(
      session.shop,
      jobId,
      n,
    );
    if (!result.ok) {
      return { orderNumberError: result.error };
    }
    return {
      ok: true,
      orderNumberSuccess: `Saved order number #${result.orderNumber}.`,
    };
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
    notifyMissionControlRemove(jobId, session.shop);
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

  if (intent === "save-email-notification-prefs") {
    const prefs: EmailNotificationPrefs = { ...DEFAULT_EMAIL_NOTIFICATION_PREFS };
    for (const k of EMAIL_NOTIFICATION_KINDS) {
      prefs[k] = formData.get(`notify_${k}`) === "on";
    }
    const configured = listConfiguredFinanceEmails();
    const sendAllowList = formData
      .getAll("finance_send")
      .map((v) => String(v).trim())
      .filter(Boolean);
    const financeMutedEmails = financeMutedFromSendAllowList({
      configured,
      sendAllowList,
    });
    await prisma.shopSettings.upsert({
      where: { shop: session.shop },
      update: {
        emailNotificationPrefsJson: serializeEmailNotificationSettings({
          prefs,
          financeMutedEmails,
        }),
      },
      create: {
        shop: session.shop,
        emailNotificationPrefsJson: serializeEmailNotificationSettings({
          prefs,
          financeMutedEmails,
        }),
      },
    });
    return { ok: true, emailNotificationPrefsSaved: true };
  }

  if (intent === "save-delivery-fee") {
    const { deliveryFeeToDecimal } = await import("../utils/shopDeliveryFee.server");
    const parsed = parseDeliveryFeeFromForm(
      String(formData.get("deliveryFeeAmount") || ""),
    );
    if (parsed == null) {
      return { deliveryFeeError: "Enter a valid delivery fee (0 or greater)." };
    }
    await prisma.shopSettings.upsert({
      where: { shop: session.shop },
      update: { deliveryFeeAmount: deliveryFeeToDecimal(parsed) },
      create: {
        shop: session.shop,
        deliveryFeeAmount: deliveryFeeToDecimal(parsed),
      },
    });
    return { ok: true, deliveryFeeSaved: true };
  }

  if (intent === "save-app-admin-ids") {
    const raw = String(formData.get("appAdminCustomerIds") || "").trim();
    const emailsRaw = String(formData.get("globalStaffEmails") || "").trim();
    const extracted = extractNumericCustomerIdsFromText(raw);
    const ids = extracted.length ? extracted.join(", ") : raw || null;
    const globalStaffEmails = emailsRaw || null;
    await prisma.shopSettings.upsert({
      where: { shop: session.shop },
      update: { appAdminCustomerIds: ids, globalStaffEmails },
      create: {
        shop: session.shop,
        appAdminCustomerIds: ids,
        globalStaffEmails,
      },
    });
    return { ok: true, appAdminIdsSaved: true };
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

const EMAIL_NOTIFICATION_LABELS: Record<
  keyof EmailNotificationPrefs,
  { title: string; hint?: string }
> = {
  cartSave: {
    title: "Cart saved",
    hint: "When order lines are saved to the project (owner / notify list).",
  },
  projectStatus: {
    title: "Project status updates",
    hint: "Reorder, edit order, delivery settings, move/copy, etc. Off by default — enable here if you want them.",
  },
  orderPlacedCustomer: {
    title: "Order placed — customer",
    hint: "Thank-you to the project customer (owner when staff places Order now on their behalf).",
  },
  orderPlacedShop: {
    title: "Order placed — shop",
    hint: "Operations copy (PROJECTCLAD_SHOP_ORDER_NOTIFY_EMAIL).",
  },
  fulfillmentOwner: {
    title: "Delivered — customer",
    hint: "Project owner (and the member who placed the order, when they are not staff). After fulfillment photo.",
  },
  fulfillmentFinance: {
    title: "Delivered — finance",
    hint: "Invoice-oriented copy (PROJECTCLAD_FINANCE_EMAIL) with order totals.",
  },
  approvalRequest: {
    title: "Submit for review",
    hint: "Email to approvers when someone requests review.",
  },
  approvalApproved: {
    title: "Order approved",
    hint: "Email to project members when a submission is approved.",
  },
  approvalRejected: {
    title: "Order rejected",
    hint: "Email to project members when a submission is rejected.",
  },
  projectDeleteBackup: {
    title: "Project deleted — backup CSV",
    hint: "Automatic export when a project is deleted from the storefront.",
  },
};

export default function Settings() {
  const {
    emailNotificationPrefs,
    financeRecipients,
    financeMutedEmails,
    hasPricingPassword,
    hasLogo,
    hasBackgroundLogo,
    mediaImages,
    mediaError,
    navButtons,
    storefrontNavLinksJson,
    emailConfigured,
    smtpStatus,
    projects,
    shop,
    grantedScopes,
    appAdminCustomerIds,
    globalStaffEmails,
    deliveryFeeAmount,
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
  const appAdminIdsSaved =
    actionData && typeof actionData === "object" && "appAdminIdsSaved" in actionData
      ? Boolean(actionData.appAdminIdsSaved)
      : false;
  const deliveryFeeSaved =
    actionData && typeof actionData === "object" && "deliveryFeeSaved" in actionData
      ? Boolean(actionData.deliveryFeeSaved)
      : false;
  const deliveryFeeError =
    actionData && typeof actionData === "object" && "deliveryFeeError" in actionData
      ? String(actionData.deliveryFeeError)
      : null;
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
  const emailNotificationPrefsSaved =
    actionData &&
    typeof actionData === "object" &&
    "emailNotificationPrefsSaved" in actionData
      ? Boolean(actionData.emailNotificationPrefsSaved)
      : false;
  const orderNumberError =
    actionData && typeof actionData === "object" && "orderNumberError" in actionData
      ? (actionData.orderNumberError as string)
      : null;
  const orderNumberSuccess =
    actionData && typeof actionData === "object" && "orderNumberSuccess" in actionData
      ? (actionData.orderNumberSuccess as string)
      : null;
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [showLogoMediaPicker, setShowLogoMediaPicker] = useState(false);
  const [showBgLogoMediaPicker, setShowBgLogoMediaPicker] = useState(false);
  const [orderNumberProjectId, setOrderNumberProjectId] = useState(
    projects[0]?.id || "",
  );
  const orderNumberJobs = useMemo(() => {
    const p = projects.find((x) => x.id === orderNumberProjectId);
    return p?.jobs ?? [];
  }, [projects, orderNumberProjectId]);
  const [orderNumberJobId, setOrderNumberJobId] = useState(
    orderNumberJobs[0]?.id || "",
  );
  const selectedOrderJob = useMemo(
    () => orderNumberJobs.find((j) => j.id === orderNumberJobId),
    [orderNumberJobs, orderNumberJobId],
  );
  useEffect(() => {
    if (orderNumberJobId && orderNumberJobs.some((j) => j.id === orderNumberJobId)) {
      return;
    }
    setOrderNumberJobId(orderNumberJobs[0]?.id || "");
  }, [orderNumberProjectId, orderNumberJobs, orderNumberJobId]);
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
      <s-section heading="Storefront staff (all projects)">
        <s-paragraph>
          Staff can see every saved project and get full edit access in the storefront
          app. Add emails (matched to the signed-in customer’s email from the app
          proxy) and/or numeric customer IDs. You can paste full Admin customer URLs
          for IDs; numbers are extracted on save. If both lists are empty, customer
          tags <code>admin</code> or <code>staff</code> are checked (Admin API).
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="save-app-admin-ids" />
          <s-paragraph>Staff emails (one per line or comma-separated)</s-paragraph>
          <textarea
            name="globalStaffEmails"
            rows={3}
            style={{ width: "100%", maxWidth: 480, fontFamily: "monospace" }}
            defaultValue={globalStaffEmails}
            placeholder="e.g. ops@example.com"
          />
          <div style={{ marginTop: 12 }}>
            <s-paragraph>Staff customer IDs</s-paragraph>
          </div>
          <textarea
            name="appAdminCustomerIds"
            rows={2}
            style={{ width: "100%", maxWidth: 480, fontFamily: "monospace" }}
            defaultValue={appAdminCustomerIds}
            placeholder="e.g. 7012345678901, 7123456789012"
          />
          <div style={{ marginTop: 8 }}>
            <button type="submit">Save storefront staff</button>
          </div>
        </Form>
        {appAdminIdsSaved && (
          <s-paragraph>Storefront staff settings saved.</s-paragraph>
        )}
      </s-section>
      <s-section heading="Delivery fee">
        <s-paragraph>
          Flat fee charged for each <strong>delivery phase</strong> on the storefront
          (CAD). Pickup phases are $0. Default is ${DEFAULT_SHOP_DELIVERY_FEE.toFixed(2)}{" "}
          when unset.
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="save-delivery-fee" />
          <label>
            Delivery fee per phase ($)
            <input
              type="number"
              name="deliveryFeeAmount"
              min={0}
              step={0.01}
              defaultValue={deliveryFeeAmount.toFixed(2)}
              style={{ display: "block", marginTop: 6, maxWidth: 160 }}
            />
          </label>
          <div style={{ marginTop: 8 }}>
            <button type="submit">Save delivery fee</button>
          </div>
        </Form>
        {deliveryFeeSaved && (
          <s-paragraph>Delivery fee saved.</s-paragraph>
        )}
        {deliveryFeeError && (
          <s-paragraph>{deliveryFeeError}</s-paragraph>
        )}
      </s-section>
      <s-section heading="Automated email notifications">
        <s-paragraph>
          Turn off categories you do not want sent via SMTP. Unchecked means that
          email is skipped; the storefront action still completes (for example,
          submit for review works without mail when that toggle is off). Most
          categories default to on; <strong>Project status updates</strong> defaults
          to off (high volume). Manual “Email CSV” in Projects below is not affected.
        </s-paragraph>
        <Form method="post">
          <input
            type="hidden"
            name="intent"
            value="save-email-notification-prefs"
          />
          <s-stack direction="block" gap="base">
            {EMAIL_NOTIFICATION_KINDS.map((key) => {
              const { title, hint } = EMAIL_NOTIFICATION_LABELS[key];
              return (
                <label
                  key={key}
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    alignItems: "flex-start",
                    maxWidth: 640,
                  }}
                >
                  <input
                    type="checkbox"
                    name={`notify_${key}`}
                    defaultChecked={emailNotificationPrefs[key]}
                    style={{ marginTop: 4 }}
                  />
                  <span>
                    <strong>{title}</strong>
                    {hint ? (
                      <>
                        {" "}
                        <span style={{ color: "var(--p-color-text-secondary)" }}>
                          — {hint}
                        </span>
                      </>
                    ) : null}
                  </span>
                </label>
              );
            })}
            <div style={{ marginTop: 8, maxWidth: 640 }}>
              <s-paragraph>
                <strong>Finance recipients</strong> — uncheck to mute that
                address for delivered finance mail. List comes from{" "}
                <code>PROJECTCLAD_FINANCE_EMAIL</code> (restart the app after
                changing the env). Category toggle above must stay on for any
                finance mail to send.
              </s-paragraph>
              {financeRecipients.length === 0 ? (
                <s-paragraph>No finance recipients configured.</s-paragraph>
              ) : (
                <s-stack direction="block" gap="base">
                  {financeRecipients.map((email) => {
                    const muted = financeMutedEmails.includes(
                      email.trim().toLowerCase(),
                    );
                    return (
                      <label
                        key={email}
                        style={{
                          display: "flex",
                          gap: "0.5rem",
                          alignItems: "flex-start",
                        }}
                      >
                        <input
                          type="checkbox"
                          name="finance_send"
                          value={email}
                          defaultChecked={!muted}
                          style={{ marginTop: 4 }}
                        />
                        <span>
                          <code>{email}</code>
                          {muted ? (
                            <span
                              style={{
                                color: "var(--p-color-text-secondary)",
                                marginLeft: 6,
                              }}
                            >
                              (currently muted)
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </s-stack>
              )}
            </div>
            <button type="submit">Save notification settings</button>
          </s-stack>
        </Form>
        {emailNotificationPrefsSaved && (
          <s-paragraph>Notification settings saved.</s-paragraph>
        )}
      </s-section>
      <s-section heading="Storefront logo">
        <s-paragraph>
          Upload a logo to display at the top center of Projects and Project
          detail pages. Max 2 MB. PNG, JPEG, GIF, or WebP.
        </s-paragraph>
        <s-stack direction="block" gap="base">
          {mediaError ? (
            <s-paragraph>
              Media library unavailable: {mediaError}. Ensure read_files scope is
              granted and reinstall the app if needed.
            </s-paragraph>
          ) : (
            mediaImages.length > 0 && (
              <button type="button" onClick={() => setShowLogoMediaPicker(true)}>
                Choose from media library
              </button>
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
          {showLogoMediaPicker && mediaImages.length > 0 && (
            <div
              role="dialog"
              aria-modal="true"
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.5)",
                zIndex: 1000,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "1rem",
              }}
            >
              <div
                style={{
                  width: "min(980px, 100%)",
                  maxHeight: "85vh",
                  overflow: "auto",
                  background: "var(--p-color-bg-surface, #fff)",
                  borderRadius: 12,
                  border: "1px solid var(--p-color-border, #ddd)",
                  padding: "1rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "0.75rem",
                  }}
                >
                  <strong>Select storefront logo</strong>
                  <button type="button" onClick={() => setShowLogoMediaPicker(false)}>
                    Close
                  </button>
                </div>
                <Form method="post">
                  <input type="hidden" name="intent" value="save-logo-from-media" />
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
                      gap: "0.5rem",
                    }}
                  >
                    {mediaImages.map((img) => (
                      <button
                        key={img.id}
                        type="submit"
                        name="logoMediaUrl"
                        value={img.url}
                        title="Use this image"
                        style={{
                          padding: 0,
                          border: "1px solid var(--p-color-border, #ddd)",
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
                            width: "100%",
                            height: 96,
                            objectFit: "cover",
                            display: "block",
                          }}
                        />
                      </button>
                    ))}
                  </div>
                </Form>
              </div>
            </div>
          )}
        </s-stack>
      </s-section>
      <s-section heading="Projects page background logo">
        <s-paragraph>
          Optional image shown as a faint watermark behind the Projects list (5%
          opacity). Can be different from the header logo. Max 500 KB. PNG, JPEG,
          GIF, or WebP.
        </s-paragraph>
        <s-stack direction="block" gap="base">
          {mediaImages.length > 0 && (
            <button type="button" onClick={() => setShowBgLogoMediaPicker(true)}>
              Choose from media library
            </button>
          )}
          {hasBackgroundLogo && (
            <div
              style={{
                padding: "1rem",
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
                textAlign: "center",
              }}
            >
              <s-paragraph>Background logo set</s-paragraph>
              <Form method="post" style={{ marginTop: "0.5rem" }}>
                <input type="hidden" name="intent" value="remove-bg-logo" />
                <button type="submit">Remove background logo</button>
              </Form>
            </div>
          )}
          <Form
            method="post"
            encType="multipart/form-data"
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
          >
            <input type="hidden" name="intent" value="save-bg-logo" />
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <label
                htmlFor="bg-logo-upload"
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
                id="bg-logo-upload"
                name="bgLogo"
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                required
              />
              <button type="submit">Upload background logo</button>
            </div>
            {actionData &&
              typeof actionData === "object" &&
              "bgLogoError" in actionData && (
                <s-paragraph>{actionData.bgLogoError as string}</s-paragraph>
              )}
          </Form>
          {showBgLogoMediaPicker && mediaImages.length > 0 && (
            <div
              role="dialog"
              aria-modal="true"
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.5)",
                zIndex: 1000,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "1rem",
              }}
            >
              <div
                style={{
                  width: "min(980px, 100%)",
                  maxHeight: "85vh",
                  overflow: "auto",
                  background: "var(--p-color-bg-surface, #fff)",
                  borderRadius: 12,
                  border: "1px solid var(--p-color-border, #ddd)",
                  padding: "1rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "0.75rem",
                  }}
                >
                  <strong>Select background logo</strong>
                  <button type="button" onClick={() => setShowBgLogoMediaPicker(false)}>
                    Close
                  </button>
                </div>
                <Form method="post">
                  <input type="hidden" name="intent" value="save-bg-logo-from-media" />
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
                      gap: "0.5rem",
                    }}
                  >
                    {mediaImages.map((img) => (
                      <button
                        key={img.id}
                        type="submit"
                        name="bgLogoMediaUrl"
                        value={img.url}
                        title="Use this image"
                        style={{
                          padding: 0,
                          border: "1px solid var(--p-color-border, #ddd)",
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
                            width: "100%",
                            height: 96,
                            objectFit: "cover",
                            display: "block",
                          }}
                        />
                      </button>
                    ))}
                  </div>
                </Form>
              </div>
            </div>
          )}
        </s-stack>
      </s-section>
      <s-section heading="Navigation buttons">
        <s-paragraph>
          These three slots feed the storefront-style menu on app pages when you
          are not using the JSON override below: button 1 is typically Projects,
          button 2 Shop, button 3 sets the cart icon URL. Leave a field blank to
          use the default.
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
      <s-section heading="Storefront menu on app pages (optional)">
        <s-paragraph>
          Paste a JSON array of links to match your theme header exactly. When
          empty, the app builds a default menu from the three navigation buttons
          below plus common pages (Custom part, Colours, Contact). Search,
          account,           and cart always use <code>/search</code>, <code>/account</code>, and
          button 3 URL (or <code>/cart</code>).
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="save-storefront-nav-json" />
          <s-stack direction="block" gap="base">
            <label htmlFor="storefrontNavLinksJson" style={{ display: "grid", gap: "0.35rem" }}>
              <span>Menu JSON (array of objects with label and url)</span>
              <textarea
                id="storefrontNavLinksJson"
                name="storefrontNavLinksJson"
                rows={12}
                defaultValue={storefrontNavLinksJson}
                placeholder={STOREFRONT_APP_NAV_JSON_PLACEHOLDER}
                style={{ fontFamily: "monospace", fontSize: "0.85rem" }}
              />
            </label>
            <button type="submit">Save storefront menu JSON</button>
            {actionData &&
              typeof actionData === "object" &&
              "storefrontNavJsonError" in actionData && (
                <s-paragraph>{actionData.storefrontNavJsonError as string}</s-paragraph>
              )}
            {actionData &&
              typeof actionData === "object" &&
              "storefrontNavSaved" in actionData &&
              (actionData.storefrontNavSaved as boolean) && (
                <s-paragraph>Storefront menu saved.</s-paragraph>
              )}
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
      <s-section heading="Order numbers">
        <s-paragraph>
          Assign the internal order number used on admin queues and the storefront.
          Use <strong>Assign next number</strong> when an order is already &quot;Ordered&quot;
          but has no number (e.g. status was set from admin). Use <strong>Set number</strong>
          only to correct a value; it must be unique and at least 1100.
        </s-paragraph>
        {orderNumberError ? (
          <s-paragraph>
            <span style={{ color: "var(--p-color-text-critical, #c00)" }}>{orderNumberError}</span>
          </s-paragraph>
        ) : null}
        {orderNumberSuccess ? (
          <s-paragraph>{orderNumberSuccess}</s-paragraph>
        ) : null}
        {projects.length === 0 ? (
          <s-paragraph>No projects yet — create a project on the storefront first.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            <label style={{ display: "grid", gap: "0.25rem", maxWidth: 480 }}>
              <span>Project</span>
              <select
                value={orderNumberProjectId}
                onChange={(e) => {
                  setOrderNumberProjectId(e.target.value);
                }}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {orderNumberJobs.length === 0 ? (
              <s-paragraph>This project has no orders (jobs) yet.</s-paragraph>
            ) : (
              <>
                <label style={{ display: "grid", gap: "0.25rem", maxWidth: 480 }}>
                  <span>Order (job)</span>
                  <select
                    value={orderNumberJobId}
                    onChange={(e) => setOrderNumberJobId(e.target.value)}
                  >
                    {orderNumberJobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.name}
                        {j.orderNumber != null ? ` · #${j.orderNumber}` : " · (no number)"}
                      </option>
                    ))}
                  </select>
                </label>
                <s-paragraph>
                  Current number:{" "}
                  {selectedOrderJob?.orderNumber != null ? (
                    <strong>#{selectedOrderJob.orderNumber}</strong>
                  ) : (
                    <span style={{ opacity: 0.8 }}>None assigned</span>
                  )}
                </s-paragraph>
                <s-stack direction="inline" gap="base" alignItems="end">
                  <Form method="post">
                    <input type="hidden" name="intent" value="assign-next-order-number" />
                    <input type="hidden" name="jobId" value={orderNumberJobId} />
                    <button
                      type="submit"
                      disabled={!orderNumberJobId}
                      title="Uses the next value from the global sequence"
                    >
                      Assign next number
                    </button>
                  </Form>
                </s-stack>
                <Form method="post">
                  <s-stack direction="inline" gap="base" alignItems="end">
                    <input type="hidden" name="intent" value="set-order-number-manual" />
                    <input type="hidden" name="jobId" value={orderNumberJobId} />
                    <label style={{ display: "grid", gap: "0.25rem" }}>
                      <span>Set number (manual, ≥ 1100)</span>
                      <input
                        name="manualOrderNumber"
                        type="number"
                        min={1100}
                        step={1}
                        placeholder="e.g. 1150"
                        style={{ width: 140 }}
                        defaultValue={selectedOrderJob?.orderNumber ?? ""}
                        key={selectedOrderJob?.id}
                      />
                    </label>
                    <button type="submit" disabled={!orderNumberJobId}>
                      Save number
                    </button>
                  </s-stack>
                </Form>
              </>
            )}
          </s-stack>
        )}
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
              <s-stack direction="inline" gap="base" alignItems="center">
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
                              alignItems="center"
                              justifyContent="space-between"
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
                          alignItems="center"
                          justifyContent="space-between"
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
                    {memberRemoved && !memberError && (
                      <s-paragraph>Member removed.</s-paragraph>
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
