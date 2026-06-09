/** Query params Shopify adds to signed app-proxy requests. */
export const APP_PROXY_QUERY_KEYS = [
  "shop",
  "signature",
  "path_prefix",
  "timestamp",
  "logged_in_customer_id",
  "logged_in_customer_email",
] as const;

/**
 * Browser fetches to app-proxy routes must include the same signed query string
 * as the current page (shop, signature, logged_in_customer_id, …), or the server
 * returns 401 and the URL can break if a form falls back to GET without ?id=.
 */
export function appProxyApiPath(path: string): string {
  if (typeof window === "undefined") {
    return path;
  }
  const q = window.location.search;
  if (!q) {
    return path;
  }
  return path.includes("?") ? `${path}&${q.slice(1)}` : `${path}${q}`;
}

/**
 * Merge app-proxy auth params from the current storefront URL onto a proxy path.
 * Skips keys already set on `path` so route params (id, jobId, …) are preserved.
 */
export function appProxyStorefrontHref(path: string): string {
  if (typeof window === "undefined") {
    return path;
  }
  const target = new URL(path, window.location.origin);
  const current = new URLSearchParams(window.location.search);
  for (const key of APP_PROXY_QUERY_KEYS) {
    if (key === "signature") continue;
    if (target.searchParams.has(key)) continue;
    const value = current.get(key);
    if (value !== null) {
      target.searchParams.set(key, value);
    }
  }
  return `${target.pathname}${target.search}`;
}
