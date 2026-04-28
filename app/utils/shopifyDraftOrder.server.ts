import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { getOfflineAccessTokenForShop } from "./adminCustomers.server";
import {
  parseOrderLineCapture,
  parseVariantSnapshot,
} from "./variantInfo.server";

const DRAFT_ORDER_API_VERSION = "2024-10";

/** Shopify `DraftOrderInput.lineItems[*].customAttributes[]` shape. */
export type DraftOrderCustomAttribute = {
  key: string;
  value: string;
};

/** Matches the subset of Shopify's `DraftOrderLineItemInput` we use. */
export type DraftOrderLineItemInput = {
  /** Required when linking to an existing Shopify variant. Omit for pure custom lines. */
  variantId?: string;
  quantity: number;
  /** Price override for variant-backed lines. Currency is always inherited from the shop. */
  priceOverrideAmount?: string;
  /** For custom (non-variant) lines. */
  title?: string;
  originalUnitPriceAmount?: string;
  customAttributes?: DraftOrderCustomAttribute[];
};

export type DraftOrderShippingLineInput = {
  title: string;
  amount: string;
};

export type DraftOrderAddressInput = {
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  country?: string | null;
  name?: string | null;
  phone?: string | null;
  company?: string | null;
};

export type DraftOrderInput = {
  currencyCode: string;
  lineItems: DraftOrderLineItemInput[];
  /** Single shipping line. Omit for pickup. */
  shippingLine?: DraftOrderShippingLineInput;
  shippingAddress?: DraftOrderAddressInput;
  note?: string;
  noteAttributes?: DraftOrderCustomAttribute[];
  tags?: string[];
  /** Full customer GID (`gid://shopify/Customer/1234`). */
  customerGid?: string;
  /** Shopify GraphQL Admin API version override. Defaults to {@link DRAFT_ORDER_API_VERSION}. */
  apiVersion?: string;
};

export type DraftOrderCreateResult =
  | {
      ok: true;
      draftOrderId: string;
      invoiceUrl: string | null;
    }
  | {
      ok: false;
      error: string;
      userErrors?: Array<{ message: string; field?: string[] | null }>;
    };

/**
 * Fires `draftOrderCreate` against the shop's Admin GraphQL API using the app's offline
 * session token. Caller must handle failures (this helper never throws on Shopify errors).
 *
 * Tax is left for Shopify to compute based on shop settings + shipping address. Do not
 * pass tax lines manually.
 */
export async function createShopifyDraftOrder(
  shop: string,
  input: DraftOrderInput,
): Promise<DraftOrderCreateResult> {
  const accessToken = await getOfflineAccessTokenForShop(shop);
  if (!accessToken) {
    return {
      ok: false,
      error: "Missing offline token. App needs to be reauthorized.",
    };
  }

  const apiVersion = input.apiVersion ?? DRAFT_ORDER_API_VERSION;
  const endpoint = `https://${shop.trim().toLowerCase()}/admin/api/${apiVersion}/graphql.json`;

  const graphqlInput: Record<string, unknown> = {
    lineItems: input.lineItems.map((li) =>
      buildLineItemInput(li, input.currencyCode),
    ),
  };

  if (input.shippingLine) {
    graphqlInput.shippingLine = {
      title: input.shippingLine.title,
      priceWithCurrency: {
        amount: input.shippingLine.amount,
        currencyCode: input.currencyCode,
      },
    };
  }

  if (input.shippingAddress) {
    graphqlInput.shippingAddress = cleanAddress(input.shippingAddress);
  }
  if (input.note?.trim()) graphqlInput.note = input.note.trim();
  /* Shopify's DraftOrderInput exposes order-level note attributes as
     `customAttributes` (the placed Order surfaces them back as `noteAttributes`,
     which is what threw off the original naming). */
  if (input.noteAttributes?.length) {
    graphqlInput.customAttributes = input.noteAttributes.filter((a) => a.value);
  }
  if (input.tags?.length) graphqlInput.tags = input.tags;
  if (input.customerGid) {
    graphqlInput.purchasingEntity = { customerId: input.customerGid };
  }

  const mutation = `#graphql
    mutation draftOrderCreate($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder {
          id
          invoiceUrl
        }
        userErrors {
          message
          field
        }
      }
    }
  `;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query: mutation, variables: { input: graphqlInput } }),
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Shopify network error: ${err.message}`
          : "Shopify network error.",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `Shopify responded ${response.status} ${response.statusText}.`,
    };
  }

  const json = (await response.json().catch(() => null)) as {
    data?: {
      draftOrderCreate?: {
        draftOrder?: { id?: string; invoiceUrl?: string | null };
        userErrors?: Array<{ message: string; field?: string[] | null }>;
      };
    };
    errors?: Array<{ message?: string }>;
  } | null;

  if (!json) {
    return { ok: false, error: "Shopify returned an unreadable response." };
  }

  if (json.errors?.length) {
    return {
      ok: false,
      error: json.errors.map((e) => e.message).filter(Boolean).join(", "),
    };
  }

  const userErrors = json.data?.draftOrderCreate?.userErrors ?? [];
  if (userErrors.length) {
    return {
      ok: false,
      error: userErrors.map((e) => e.message).filter(Boolean).join(", "),
      userErrors,
    };
  }

  const draft = json.data?.draftOrderCreate?.draftOrder;
  if (!draft?.id) {
    return { ok: false, error: "Shopify did not return a draft order id." };
  }

  return {
    ok: true,
    draftOrderId: draft.id,
    invoiceUrl: draft.invoiceUrl ?? null,
  };
}

function buildLineItemInput(
  li: DraftOrderLineItemInput,
  currencyCode: string,
) {
  const out: Record<string, unknown> = { quantity: Math.max(1, li.quantity) };
  if (li.customAttributes?.length) {
    out.customAttributes = li.customAttributes.filter(
      (a) => a && a.key && a.value != null,
    );
  }
  if (li.variantId) {
    out.variantId = li.variantId.startsWith("gid://")
      ? li.variantId
      : `gid://shopify/ProductVariant/${li.variantId}`;
    if (li.priceOverrideAmount != null) {
      out.priceOverride = {
        amount: li.priceOverrideAmount,
        currencyCode,
      };
    }
    return out;
  }
  out.title = li.title || "Custom line";
  if (li.originalUnitPriceAmount != null) {
    out.originalUnitPriceWithCurrency = {
      amount: li.originalUnitPriceAmount,
      currencyCode,
    };
  }
  return out;
}

function cleanAddress(input: DraftOrderAddressInput) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.trim()) {
      out[key] = value.trim();
    }
  }
  return out;
}

/**
 * Build + fire a silent backup draft order for a placed ProjectClad job, then persist the
 * draft GID in {@link JobDraftOrderLink}. Never throws — on failure returns `{ ok: false }`
 * so the caller can log without blocking Order now.
 *
 * Idempotent: if a draft link already exists for the job it is returned unchanged.
 */
export async function createBackupDraftOrderForJob(args: {
  shop: string;
  jobId: string;
  /** Project-clad delivery fee to add as a shipping line when `fulfillmentMethod === "delivery"`. */
  deliveryFeeAmount?: number;
  /** Store currency code. Defaults to "CAD". */
  currencyCode?: string;
}): Promise<
  | { ok: true; draftOrderId: string; reused?: boolean }
  | { ok: false; error: string; userErrors?: unknown }
> {
  const { shop, jobId } = args;
  const currencyCode = args.currencyCode ?? "CAD";

  const existing = await prisma.jobDraftOrderLink.findUnique({
    where: { jobId },
  });
  if (existing) {
    return { ok: true, draftOrderId: existing.shopifyDraftOrderId, reused: true };
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      project: true,
      items: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!job) {
    return { ok: false, error: `Job ${jobId} not found.` };
  }
  const project = job.project;
  if (!project) {
    return { ok: false, error: `Project for job ${jobId} not found.` };
  }

  const isDelivery = job.fulfillmentMethod === "delivery";
  const deliveryFeeAmount = args.deliveryFeeAmount ?? 0;

  const lineItems: DraftOrderLineItemInput[] = job.items.map((item) => {
    const capture = parseOrderLineCapture(item.orderLineCapture);
    const snapshot = parseVariantSnapshot(item.variantSnapshot);
    const unitPrice = new Prisma.Decimal(item.priceSnapshot).toString();
    const displayTitle =
      capture?.displayLabel?.trim() ||
      [snapshot?.productTitle, snapshot?.variantTitle]
        .map((s) => s?.trim())
        .filter(Boolean)
        .join(" - ") ||
      "Project Clad line";

    const customAttributes: DraftOrderCustomAttribute[] = [];
    const customData = item.customData;
    if (Array.isArray(customData)) {
      for (const entry of customData) {
        if (
          entry &&
          typeof entry === "object" &&
          "name" in entry &&
          "value" in entry &&
          typeof (entry as { name: unknown }).name === "string" &&
          (entry as { value: unknown }).value != null
        ) {
          const key = String((entry as { name: string }).name).trim();
          const value = String((entry as { value: unknown }).value).trim();
          if (key && value) customAttributes.push({ key, value });
        }
      }
    }
    if (item.catalogSku?.trim()) {
      customAttributes.push({ key: "_sku", value: item.catalogSku.trim() });
    }

    const hasVariant = Boolean(item.variantId?.trim());
    if (hasVariant) {
      return {
        variantId: item.variantId,
        quantity: item.quantity,
        priceOverrideAmount: unitPrice,
        customAttributes: customAttributes.length ? customAttributes : undefined,
      };
    }
    return {
      title: displayTitle,
      quantity: item.quantity,
      originalUnitPriceAmount: unitPrice,
      customAttributes: customAttributes.length ? customAttributes : undefined,
    };
  });

  if (lineItems.length === 0) {
    return { ok: false, error: "Job has no line items to back up." };
  }

  const noteLines = [
    job.orderNumber != null ? `Order #: ${job.orderNumber}` : null,
    `Project: ${project.name}`,
    project.poNumber ? `Project PO: ${project.poNumber}` : null,
    job.purchaseOrderNumber ? `Job PO: ${job.purchaseOrderNumber}` : null,
  ].filter(Boolean);

  const noteAttributes: DraftOrderCustomAttribute[] = [
    { key: "projectCladJobId", value: jobId },
    { key: "projectCladProjectId", value: project.id },
    { key: "projectCladProjectName", value: project.name },
    ...(job.orderNumber != null
      ? [{ key: "projectCladOrderNumber", value: String(job.orderNumber) }]
      : []),
    {
      key: "projectCladFulfillmentMethod",
      value: job.fulfillmentMethod ?? "unspecified",
    },
  ];
  if (job.siteContactName?.trim()) {
    noteAttributes.push({
      key: "projectCladSiteContactName",
      value: job.siteContactName.trim(),
    });
  }
  if (job.siteContactPhone?.trim()) {
    noteAttributes.push({
      key: "projectCladSiteContactPhone",
      value: job.siteContactPhone.trim(),
    });
  }
  if (job.scheduledDeliveryDate?.trim()) {
    noteAttributes.push({
      key: "projectCladScheduledDeliveryDate",
      value: job.scheduledDeliveryDate.trim(),
    });
  }
  if (job.scheduledDeliveryWindow?.trim()) {
    noteAttributes.push({
      key: "projectCladScheduledDeliveryWindow",
      value: job.scheduledDeliveryWindow.trim(),
    });
  }
  if (project.companyName?.trim()) {
    noteAttributes.push({
      key: "projectCladCompany",
      value: project.companyName.trim(),
    });
  }

  const tags = [
    "project-clad",
    `project:${project.id}`,
    `job:${jobId}`,
    ...(job.orderNumber != null ? [`order-number:${job.orderNumber}`] : []),
  ];

  const shippingLine =
    isDelivery && deliveryFeeAmount > 0
      ? {
          title: "Delivery",
          amount: deliveryFeeAmount.toFixed(2),
        }
      : undefined;

  const shippingAddress =
    isDelivery &&
    project.shipAddress1?.trim() &&
    project.shipCity?.trim() &&
    project.shipProvince?.trim() &&
    project.shipPostal?.trim()
      ? {
          address1: project.shipAddress1,
          address2: project.shipAddress2 ?? null,
          city: project.shipCity,
          province: project.shipProvince,
          zip: project.shipPostal,
          country: project.shipCountry || "Canada",
          company: project.companyName ?? null,
          name: job.siteContactName ?? null,
          phone: job.siteContactPhone ?? null,
        }
      : undefined;

  const customerGid = project.ownerCustomerId
    ? buildCustomerGid(project.ownerCustomerId)
    : undefined;

  const result = await createShopifyDraftOrder(shop, {
    currencyCode,
    lineItems,
    shippingLine,
    shippingAddress,
    note: noteLines.length ? noteLines.join(" · ") : undefined,
    noteAttributes,
    tags,
    customerGid,
  });

  if (!result.ok) {
    return { ok: false, error: result.error, userErrors: result.userErrors };
  }

  try {
    await prisma.jobDraftOrderLink.create({
      data: {
        jobId,
        shopifyDraftOrderId: result.draftOrderId,
      },
    });
  } catch (err) {
    // Another concurrent Order Now may have raced us — treat as success.
    const isUniqueViolation =
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002";
    if (!isUniqueViolation) {
      return {
        ok: false,
        error:
          err instanceof Error
            ? `Draft created but link persist failed: ${err.message}`
            : "Draft created but link persist failed.",
      };
    }
  }

  return { ok: true, draftOrderId: result.draftOrderId };
}

function buildCustomerGid(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("gid://shopify/Customer/")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return undefined;
  return `gid://shopify/Customer/${digits}`;
}
