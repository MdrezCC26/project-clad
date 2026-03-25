import { sessionStorage } from "../shopify.server";

const ADMIN_GRAPHQL = "2024-10";

export async function fetchVariantPriceUsd(
  shop: string,
  variantId: string,
): Promise<number | null> {
  const found = await sessionStorage.findSessionsByShop(shop);
  const accessToken = found.find((s) => !s.isOnline)?.accessToken;
  if (!accessToken) return null;
  const gid = `gid://shopify/ProductVariant/${variantId}`;
  const res = await fetch(
    `https://${shop}/admin/api/${ADMIN_GRAPHQL}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query: `query ($id: ID!) { node(id: $id) { ... on ProductVariant { price } } }`,
        variables: { id: gid },
      }),
    },
  );
  if (!res.ok) return null;
  const payload = (await res.json()) as {
    data?: { node?: { price?: string } | null };
  };
  const p = payload.data?.node?.price;
  if (p == null) return null;
  return Number.parseFloat(String(p));
}
