import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import ShapeBuilderComponent from "../components/shape-builder/ShapeBuilder";
import { DEFAULT_SHAPE_COLOUR, type ShapeLeg } from "../utils/shapeProfile";

type IslandConfig = {
  initialLegs?: ShapeLeg[];
  initialGauge?: string;
  initialColor?: string;
  libraryUrl?: string;
  libraryHref?: string;
  cartUrl?: string;
  cartHref?: string;
  /** Set when the visitor is signed out; the staging cart is per-customer. */
  loginUrl?: string | null;
};

type AddPayload = {
  gauge: string;
  color?: string;
  girth: number;
  lengthIn?: number;
  segments: ShapeLeg[];
  bends: number;
  price?: number | null;
  quantity?: number;
};

/** `ShapeBuilder` is plain JSX; its prop defaults infer as `never[]`, so state the contract here. */
const ShapeBuilder = ShapeBuilderComponent as unknown as (props: {
  initialLegs?: ShapeLeg[];
  initialGauge?: string;
  initialColor?: string;
    showPricing?: boolean;
    onAddToCart?: (payload: AddPayload) => void | Promise<void>;
}) => ReactElement;

type ShapeCartResponse = {
  error?: string;
  redirectTo?: string;
  cartUrl?: string;
};

async function publishLibrary(url: string, payload: AddPayload) {
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        gauge: payload.gauge,
        color: payload.color || DEFAULT_SHAPE_COLOUR,
        girth: payload.girth,
        segments: payload.segments,
      }),
    });
  } catch {
    /* library publish is best-effort */
  }
}

/**
 * Adds the profile to the app's staging cart rather than straight to Shopify: the customer usually
 * needs several parts, and the cart page is what turns them into a Shopify cart or a project order.
 * Pricing is recomputed server-side there, so the `price` in this payload is only a preview.
 */
async function addToShapeCart(url: string, payload: AddPayload): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      action: "add",
      legs: payload.segments,
      gauge: payload.gauge,
      color: payload.color || DEFAULT_SHAPE_COLOUR,
      lengthIn: payload.lengthIn,
      bends: payload.bends,
      quantity: payload.quantity ?? 1,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as ShapeCartResponse;
  if (res.status === 401 && data.redirectTo) {
    window.location.href = data.redirectTo;
    throw new Error("redirecting");
  }
  if (!res.ok) {
    throw new Error(data.error || `Could not add this part (${res.status}).`);
  }
  return data.cartUrl || "/apps/project-clad/shape-cart";
}

/**
 * The storefront header on app-proxy pages is `position: sticky`, so the builder's own sticky
 * drawing panel has to start below it or the profile is clipped while scrolling. Height is measured
 * rather than hard-coded because the utility strip collapses on small viewports.
 */
function trackStickyOffset(el: HTMLElement) {
  const header = document.querySelector<HTMLElement>(
    ".project-clad-header--fullbleed",
  );
  const apply = () => {
    const height = header?.getBoundingClientRect().height ?? 0;
    el.style.setProperty("--pc-shape-sticky-top", `${Math.round(height) + 8}px`);
  };
  apply();
  window.addEventListener("resize", apply);
  if (header && "ResizeObserver" in window) {
    new ResizeObserver(apply).observe(header);
  }
}

function loadTailwind(): Promise<void> {
  if (document.querySelector("script[data-pc-tailwind]")) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://cdn.tailwindcss.com";
    s.dataset.pcTailwind = "1";
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}

function boot() {
  const el = document.getElementById("pc-shape-builder-root");
  if (!el) return;
  let config: IslandConfig = {};
  try {
    config = JSON.parse(el.getAttribute("data-config") || "{}") as IslandConfig;
  } catch {
    config = {};
  }

  const onAddToCart = async (payload: AddPayload) => {
    if (config.loginUrl) {
      window.location.href = config.loginUrl;
      return;
    }
    await publishLibrary(
      config.libraryUrl || "/apps/project-clad/api/shape-library",
      payload,
    );
    try {
      const cartHref = await addToShapeCart(
        config.cartUrl || "/apps/project-clad/api/shape-cart",
        payload,
      );
      window.location.href = config.cartHref || cartHref;
    } catch (err) {
      if (err instanceof Error && err.message === "redirecting") return;
      window.alert(
        err instanceof Error
          ? err.message
          : "Could not add this profile to the cart.",
      );
    }
  };

  trackStickyOffset(el);

  void loadTailwind().then(() => {
    createRoot(el).render(
      <ShapeBuilder
        initialLegs={config.initialLegs}
        initialGauge={config.initialGauge}
        initialColor={config.initialColor}
        showPricing={false}
        onAddToCart={onAddToCart}
      />,
    );
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
