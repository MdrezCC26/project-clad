import { sessionStorage } from "../shopify.server";

export type MediaImage = {
  id: string;
  url: string;
  alt: string | null;
};

export async function listMediaImages(
  shop: string,
  limit = 50
): Promise<MediaImage[]> {
  const sessions = await sessionStorage.findSessionsByShop(shop);
  const offlineSession = sessions.find((s) => !s.isOnline);

  if (!offlineSession) {
    throw new Error("App needs to be reauthorized to access media.");
  }

  const response = await fetch(
    `https://${shop}/admin/api/2024-10/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": offlineSession.accessToken,
      },
      body: JSON.stringify({
        query: `#graphql
          query ProjectCladMediaImages($first: Int!, $query: String) {
            files(first: $first, query: $query) {
              edges {
                node {
                  ... on MediaImage {
                    id
                    alt
                    status
                    image {
                      url
                    }
                  }
                }
              }
            }
          }
        `,
        variables: {
          first: limit,
          query: "media_type:IMAGE",
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error("Failed to fetch media from Shopify.");
  }

  const json = (await response.json()) as {
    data?: {
      files?: {
        edges?: Array<{
          node?: {
            id?: string;
            alt?: string | null;
            status?: string;
            image?: { url?: string } | null;
          };
        }>;
      };
    };
    errors?: Array<{ message?: string }>;
  };

  if (json.errors?.length) {
    throw new Error(
      json.errors.map((e) => e.message).filter(Boolean).join(", ") ||
        "Media fetch failed."
    );
  }

  const edges = json.data?.files?.edges ?? [];
  const result: MediaImage[] = [];

  for (const edge of edges) {
    const node = edge?.node;
    if (
      node &&
      "image" in node &&
      node.image?.url &&
      node.status === "READY"
    ) {
      result.push({
        id: node.id!,
        url: node.image.url,
        alt: node.alt ?? null,
      });
    }
  }

  return result;
}
