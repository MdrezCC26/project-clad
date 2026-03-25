/**
 * Sync Shopify catalog variant prices when a gauge master rate (`GaugeConfig.value`) changes.
 *
 * Variants must have variant metafield namespace `project_clad`, key `gauge`, value matching
 * the gauge number (e.g. "26"). Proportional: newPrice = oldPrice * (currentValue / valueAtLastCatalogSync).
 */

import { GAUGE_CATALOG_METAFIELD } from "./gaugeCatalogConstants";

type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type VariantRow = {
  variantGid: string;
  productGid: string;
  price: string;
};

/** Paginate productVariants search by gauge metafield. */
export async function listVariantPricesForGauge(
  admin: AdminClient,
  gauge: number,
): Promise<VariantRow[]> {
  const q = `metafields.${GAUGE_CATALOG_METAFIELD.namespace}.${GAUGE_CATALOG_METAFIELD.key}:${gauge}`;
  const out: VariantRow[] = [];
  let cursor: string | null = null;

  const query = `#graphql
    query ProjectCladVariantsByGauge($q: String!, $cursor: String) {
      productVariants(first: 50, query: $q, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          price
          product {
            id
          }
        }
      }
    }
  `;

  for (;;) {
    const res = await admin.graphql(query, {
      variables: { q, cursor },
    });
    const json = (await res.json()) as {
      data?: {
        productVariants?: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: Array<{
            id: string;
            price: string;
            product: { id: string };
          }>;
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (json.errors?.length) {
      throw new Error(json.errors.map((e) => e.message).join("; "));
    }

    const conn = json.data?.productVariants;
    if (!conn?.nodes?.length) break;

    for (const n of conn.nodes) {
      out.push({
        variantGid: n.id,
        productGid: n.product.id,
        price: n.price,
      });
    }

    if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
    cursor = conn.pageInfo.endCursor;
  }

  return out;
}

export async function bulkUpdateVariantPrices(
  admin: AdminClient,
  updatesByProduct: Map<string, Array<{ id: string; price: string }>>,
): Promise<{ errors: string[]; variantsUpdated: number }> {
  const mutation = `#graphql
    mutation ProjectCladBulkVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        userErrors {
          field
          message
        }
      }
    }
  `;

  const errors: string[] = [];
  let variantsUpdated = 0;

  for (const [productId, variants] of updatesByProduct) {
    for (let i = 0; i < variants.length; i += 100) {
      const chunk = variants.slice(i, i + 100);
      const res = await admin.graphql(mutation, {
        variables: { productId, variants: chunk },
      });
      const json = (await res.json()) as {
        data?: {
          productVariantsBulkUpdate?: {
            userErrors: Array<{ message: string }>;
          };
        };
        errors?: Array<{ message: string }>;
      };

      if (json.errors?.length) {
        errors.push(...json.errors.map((e) => e.message));
        continue;
      }
      const ue = json.data?.productVariantsBulkUpdate?.userErrors ?? [];
      if (ue.length) {
        errors.push(...ue.map((e) => e.message));
        continue;
      }
      variantsUpdated += chunk.length;
    }
  }

  return { errors, variantsUpdated };
}

export function buildProportionalPriceUpdates(
  rows: VariantRow[],
  ratio: number,
): Map<string, Array<{ id: string; price: string }>> {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    throw new Error("Invalid price ratio.");
  }

  const byProduct = new Map<string, Array<{ id: string; price: string }>>();

  for (const row of rows) {
    const base = Number.parseFloat(row.price);
    if (!Number.isFinite(base) || base < 0) continue;
    const next = Math.round(base * ratio * 100) / 100;
    if (next <= 0) continue;
    const price = next.toFixed(2);
    const list = byProduct.get(row.productGid);
    if (list) {
      list.push({ id: row.variantGid, price });
    } else {
      byProduct.set(row.productGid, [{ id: row.variantGid, price }]);
    }
  }

  return byProduct;
}
