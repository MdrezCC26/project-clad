/**
 * Custom shape calculator (Templates / Builder / Profiles / Parts cart).
 * Set to `true` when re-enabling the storefront shape workflow.
 */
export const SHAPE_CALCULATOR_ENABLED = false;

const SHAPE_STOREFRONT_PATH_RE =
  /\/project-clad\/shape-(templates|builder|library|cart)(\/|$)/i;

export function isShapeStorefrontUrl(url: string): boolean {
  const path = url.trim();
  if (!path) return false;
  try {
    const parsed = path.startsWith("/")
      ? path
      : new URL(path).pathname;
    return SHAPE_STOREFRONT_PATH_RE.test(parsed.replace(/\/+$/, "") || "/");
  } catch {
    return SHAPE_STOREFRONT_PATH_RE.test(path.replace(/\/+$/, "") || "/");
  }
}

export function filterShapeLinksFromNav<T extends { url: string }>(
  links: T[],
): T[] {
  if (SHAPE_CALCULATOR_ENABLED) return links;
  return links.filter((link) => !isShapeStorefrontUrl(link.url));
}

export function requireShapeCalculatorEnabled(): void {
  if (!SHAPE_CALCULATOR_ENABLED) {
    throw new Response("Not found", { status: 404 });
  }
}
