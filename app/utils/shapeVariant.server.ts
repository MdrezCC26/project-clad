import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { getOfflineAccessTokenForShop } from "./adminCustomers.server";
import { shopStringFilter } from "./projectAccess.server";
import { ShapeCartError, shapeCartLineProperties, type ShapeCartLine } from "./shapeCart.server";
import { formatLength, geometryHash } from "./shapeProfile";
import { shopifyGidToLegacyNumericId } from "./shopifyIds.server";

/**
 * Every distinct custom profile gets its own Shopify product with a single, priced variant, created
 * the first time that profile is ordered. Sharing one "carrier" variant across all custom parts made
 * every order line look identical in Shopify and forced price overrides everywhere; a real variant
 * per part carries its own price, SKU, and title into draft orders, invoices, and reports.
 *
 * Products are created as **drafts** on purpose: they must never appear in the storefront catalog or
 * search, they exist only to back an order line.
 */
const ADMIN_API_VERSION = "2024-10";
const PRODUCT_TAGS = ["project-clad", "shape_type = custom"];

export type ShapeOrderItem = {
  variantId: string;
  quantity: number;
  priceSnapshot: string;
  /** `{ name, value }` list, the shape `api/save-job` reads (same as `/cart.js`). */
  properties: Array<{ name: string; value: string }>;
  lineMeta: {
    productTitle: string;
    variantTitle: string;
    productId: string;
    sku: string;
  };
};

function specKeyFor(line: ShapeCartLine): string {
  return [
    geometryHash(line.legs),
    line.gauge,
    line.color.toLowerCase(),
    formatLength(line.lengthIn),
  ].join("|");
}

export function shapeProductTitle(line: ShapeCartLine): string {
  return `Custom shape — ${formatLength(line.girth)}" girth, ${line.gauge} ga, ${line.color}`;
}

/** Short, stable, human-scannable SKU: gauge + girth + a hash of the geometry. */
function skuFor(line: ShapeCartLine): string {
  let h = 0;
  const key = specKeyFor(line);
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) | 0;
  const suffix = (h >>> 0).toString(36).toUpperCase().slice(0, 6);
  const girth = formatLength(line.girth).replace(".", "-");
  return `CS-${line.gauge}-${girth}-${suffix}`;
}

function descriptionHtml(line: ShapeCartLine): string {
  const legs = line.legs
    .map((leg, i) => `<li>L${i + 1}: ${formatLength(leg.length)}" at ${leg.angle}°</li>`)
    .join("");
  return [
    "<p>Custom brake-formed profile built in the Canadian Cladding shape builder.</p>",
    `<ul>${legs}</ul>`,
    `<p>${formatLength(line.girth)}" girth · ${line.bends} bends · ${formatLength(line.lengthIn)}" long · ${line.gauge} ga · ${line.color}</p>`,
  ].join("");
}

type GraphqlResult<T> = { data?: T; errors?: Array<{ message?: string }> };

async function adminGraphql<T>(
  shop: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    `https://${shop.trim().toLowerCase()}/admin/api/${ADMIN_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  if (!response.ok) {
    throw new ShapeCartError(
      `Shopify rejected the custom part request (${response.status}).`,
    );
  }
  const body = (await response.json()) as GraphqlResult<T>;
  if (body.errors?.length) {
    throw new ShapeCartError(
      body.errors[0]?.message || "Shopify could not create the custom part.",
    );
  }
  if (!body.data) {
    throw new ShapeCartError("Shopify returned no data for the custom part.");
  }
  return body.data;
}

function firstUserError(
  errors: Array<{ field?: string[] | null; message?: string }> | undefined,
): string | null {
  const hit = errors?.find((e) => e?.message);
  return hit?.message ?? null;
}

const CREATE_PRODUCT = `
  mutation ProjectCladShapeProductCreate($input: ProductInput!) {
    productCreate(input: $input) {
      product {
        id
        variants(first: 1) { nodes { id } }
      }
      userErrors { field message }
    }
  }
`;

const UPDATE_VARIANT = `
  mutation ProjectCladShapeVariantUpdate(
    $productId: ID!
    $variants: [ProductVariantsBulkInput!]!
  ) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message }
    }
  }
`;

async function createShapeProduct(
  shop: string,
  accessToken: string,
  line: ShapeCartLine,
): Promise<{ productId: string; variantId: string; sku: string }> {
  const created = await adminGraphql<{
    productCreate?: {
      product?: { id?: string; variants?: { nodes?: Array<{ id?: string }> } };
      userErrors?: Array<{ field?: string[] | null; message?: string }>;
    };
  }>(shop, accessToken, CREATE_PRODUCT, {
    input: {
      title: shapeProductTitle(line),
      descriptionHtml: descriptionHtml(line),
      productType: "Custom shape",
      status: "DRAFT",
      tags: PRODUCT_TAGS,
    },
  });

  const userError = firstUserError(created.productCreate?.userErrors);
  if (userError) throw new ShapeCartError(userError);

  const productGid = created.productCreate?.product?.id;
  const variantGid = created.productCreate?.product?.variants?.nodes?.[0]?.id;
  if (!productGid || !variantGid) {
    throw new ShapeCartError("Shopify did not return the new custom part.");
  }

  const sku = skuFor(line);
  const updated = await adminGraphql<{
    productVariantsBulkUpdate?: {
      userErrors?: Array<{ field?: string[] | null; message?: string }>;
    };
  }>(shop, accessToken, UPDATE_VARIANT, {
    productId: productGid,
    variants: [
      {
        id: variantGid,
        price: line.unitPrice.toFixed(2),
        taxable: true,
        inventoryItem: { sku, tracked: false, requiresShipping: true },
      },
    ],
  });
  const updateError = firstUserError(
    updated.productVariantsBulkUpdate?.userErrors,
  );
  if (updateError) throw new ShapeCartError(updateError);

  return {
    productId: shopifyGidToLegacyNumericId(productGid) ?? productGid,
    variantId: shopifyGidToLegacyNumericId(variantGid) ?? variantGid,
    sku,
  };
}

async function repriceShapeVariant(args: {
  shop: string;
  accessToken: string;
  productId: string;
  variantId: string;
  price: number;
}): Promise<void> {
  const updated = await adminGraphql<{
    productVariantsBulkUpdate?: {
      userErrors?: Array<{ field?: string[] | null; message?: string }>;
    };
  }>(args.shop, args.accessToken, UPDATE_VARIANT, {
    productId: `gid://shopify/Product/${args.productId}`,
    variants: [
      {
        id: `gid://shopify/ProductVariant/${args.variantId}`,
        price: args.price.toFixed(2),
      },
    ],
  });
  const error = firstUserError(updated.productVariantsBulkUpdate?.userErrors);
  if (error) throw new ShapeCartError(error);
}

/**
 * Find-or-create the Shopify variant for one profile. Concurrent saves of the same profile race on
 * the `(shop, specKey)` unique index; the loser re-reads the winner's row rather than creating a
 * duplicate product.
 */
export async function ensureShapeVariant(
  shop: string,
  line: ShapeCartLine,
): Promise<{ productId: string; variantId: string; sku: string }> {
  const specKey = specKeyFor(line);
  const existing = await prisma.shapeVariant.findFirst({
    where: { shop: shopStringFilter(shop), specKey },
  });

  const accessToken = await getOfflineAccessTokenForShop(shop);
  if (!accessToken) {
    throw new ShapeCartError(
      "This shop needs to reconnect to Project Clad before custom parts can be ordered.",
    );
  }

  if (existing) {
    /* Catalogue rates can move after a part was first created; keep Shopify in step. */
    if (Number(existing.unitPrice) !== line.unitPrice) {
      await repriceShapeVariant({
        shop,
        accessToken,
        productId: existing.productId,
        variantId: existing.variantId,
        price: line.unitPrice,
      });
      await prisma.shapeVariant.update({
        where: { id: existing.id },
        data: { unitPrice: new Prisma.Decimal(line.unitPrice.toFixed(2)) },
      });
    }
    return {
      productId: existing.productId,
      variantId: existing.variantId,
      sku: existing.sku,
    };
  }

  const created = await createShapeProduct(shop, accessToken, line);
  try {
    await prisma.shapeVariant.create({
      data: {
        shop,
        specKey,
        geometryHash: geometryHash(line.legs),
        segments: line.legs as unknown as Prisma.InputJsonValue,
        gauge: line.gauge,
        color: line.color,
        girth: line.girth,
        bends: line.bends,
        lengthIn: line.lengthIn,
        unitPrice: new Prisma.Decimal(line.unitPrice.toFixed(2)),
        productId: created.productId,
        variantId: created.variantId,
        sku: created.sku,
      },
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      const winner = await prisma.shapeVariant.findFirst({
        where: { shop: shopStringFilter(shop), specKey },
      });
      if (winner) {
        return {
          productId: winner.productId,
          variantId: winner.variantId,
          sku: winner.sku,
        };
      }
    }
    throw e;
  }
  return created;
}

/** Cart lines → `api/save-job` items, creating any missing Shopify variants along the way. */
export async function buildShapeOrderItems(
  shop: string,
  lines: ShapeCartLine[],
): Promise<ShapeOrderItem[]> {
  const items: ShapeOrderItem[] = [];
  for (const line of lines) {
    const variant = await ensureShapeVariant(shop, line);
    const properties = shapeCartLineProperties(line);
    items.push({
      variantId: variant.variantId,
      quantity: line.quantity,
      priceSnapshot: line.unitPrice.toFixed(2),
      properties: Object.entries(properties).map(([name, value]) => ({
        name,
        value,
      })),
      lineMeta: {
        productTitle: shapeProductTitle(line),
        variantTitle: "Default Title",
        productId: variant.productId,
        sku: variant.sku,
      },
    });
  }
  return items;
}
