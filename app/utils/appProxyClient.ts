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
