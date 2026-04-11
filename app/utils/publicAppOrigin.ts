/**
 * Shopify CLI `shopify app dev` sets HOST to the tunnel URL. Copy it to SHOPIFY_APP_URL
 * once at process startup (e.g. from vite.config) so loaders and Vite share the same value.
 */
export function applyHostToShopifyAppUrlFromEnv(): void {
  const hostRaw = process.env.HOST?.trim();
  if (!hostRaw) return;
  let url = hostRaw;
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  process.env.SHOPIFY_APP_URL = url;
  delete process.env.HOST;
}

/** Origin (scheme + host + port) for absolute URLs shown to customers (tunnel or SHOPIFY_APP_URL). */
export function resolvePublicAppOrigin(): string | undefined {
  const hostRaw = process.env.HOST?.trim();
  if (hostRaw) {
    const withProto = /^https?:\/\//i.test(hostRaw)
      ? hostRaw
      : `https://${hostRaw}`;
    try {
      return new URL(withProto).origin;
    } catch {
      /* fall through */
    }
  }
  const appRaw = process.env.SHOPIFY_APP_URL?.trim();
  if (!appRaw) return undefined;
  try {
    return new URL(appRaw).origin;
  } catch {
    return undefined;
  }
}
