import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { sessionStorage } from "../shopify.server";
import { getAppProxyContext } from "../utils/appProxy.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    return await handleDraftOrder(request);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    console.error("[draft-order]", err);
    return Response.json({ error: message }, { status: 500 });
  }
};

async function handleDraftOrder(request: Request) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  let shop: string;
  try {
    shop = getAppProxyContext(request).shop;
  } catch {
    if (process.env.NODE_ENV === "development") {
      const url = new URL(request.url);
      shop = url.searchParams.get("shop") || "";
      if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)) {
        return Response.json(
          { error: "Missing or invalid shop param" },
          { status: 400 },
        );
      }
    } else {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: {
    variantId: string;
    L1: number;
    L2: number;
    L3?: number;
    gauge: number;
    quantity: number;
    shapeType: string;
    A1?: number;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    variantId,
    L1 = 0,
    L2 = 0,
    L3 = 0,
    gauge = 16,
    quantity = 1,
    shapeType = "L",
  } = body;

  if (!variantId || !shapeType) {
    return Response.json(
      { error: "Missing required fields: variantId, shapeType" },
      { status: 400 },
    );
  }

  if (shapeType !== "L" && shapeType !== "Z" && shapeType !== "U") {
    return Response.json({ error: "Invalid shapeType" }, { status: 400 });
  }

  const config = await prisma.gaugeConfig.findUnique({
    where: { shop_gauge: { shop, gauge } },
  });

  if (!config) {
    return Response.json(
      { error: "Gauge not configured for this store" },
      { status: 400 },
    );
  }

  const value = Number(config.value);
  const girth =
    shapeType === "L" ? L1 + L2 : L1 + L2 + (typeof L3 === "number" ? L3 : 0);
  const lengthFeet = 10;
  const unitPrice = value * girth * lengthFeet;
  const totalPrice = Math.round(unitPrice * quantity * 100) / 100;

  const sessions = await sessionStorage.findSessionsByShop(shop);
  const offlineSession = sessions.find((s) => !s.isOnline);
  const accessToken = offlineSession?.accessToken;

  if (!accessToken) {
    return Response.json(
      { error: "App needs to be reauthorized" },
      { status: 503 },
    );
  }

  const variantGid = variantId.startsWith("gid://")
    ? variantId
    : `gid://shopify/ProductVariant/${variantId}`;

  const customAttributes = [
    { key: "L1", value: String(L1) },
    { key: "L2", value: String(L2) },
    { key: "Gauge", value: String(gauge) },
    { key: "shape_type", value: shapeType },
  ];
  if (body.A1 != null) {
    customAttributes.push({ key: "A1", value: String(body.A1) });
  }
  if (shapeType === "Z" || shapeType === "U") {
    customAttributes.push({ key: "L3", value: String(L3 || 0) });
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

  const response = await fetch(
    `https://${shop}/admin/api/2024-10/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          input: {
            lineItems: [
              {
                variantId: variantGid,
                quantity: Math.max(1, quantity),
                priceOverride: {
                  amount: String(totalPrice / quantity),
                  currencyCode: "CAD",
                },
                customAttributes,
              },
            ],
          },
        },
      }),
    },
  );

  const json = (await response.json()) as {
    data?: {
      draftOrderCreate?: {
        draftOrder?: { id: string; invoiceUrl: string };
        userErrors?: Array<{ message: string; field?: string[] }>;
      };
    };
    errors?: Array<{ message: string }>;
  };

  if (!response.ok) {
    return Response.json(
      { error: "Failed to create draft order" },
      { status: 502 },
    );
  }

  const errors = json.errors || json.data?.draftOrderCreate?.userErrors;
  if (errors?.length) {
    return Response.json(
      { error: errors.map((e) => e.message).join(", ") },
      { status: 400 },
    );
  }

  const invoiceUrl = json.data?.draftOrderCreate?.draftOrder?.invoiceUrl;
  if (!invoiceUrl) {
    return Response.json(
      { error: "Draft order created but no checkout URL" },
      { status: 500 },
    );
  }

  return Response.json({ invoiceUrl });
}
