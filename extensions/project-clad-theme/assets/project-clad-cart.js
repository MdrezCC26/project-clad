/*
 * Cart-page glue for the ProjectClad cart-actions block.
 *
 * Responsibilities are intentionally narrow:
 *   - Mount the shared "Save to project" modal (window.ProjectCladSaveModal)
 *     with cart-specific item supply and after-save behavior (redirect, or
 *     clear-cart-then-redirect when "Save order & Clear cart" was clicked).
 *   - Hide the Save Order button when the cart is empty, and keep that in
 *     sync as the user changes line items elsewhere on the page.
 *   - Run the checkout fulfillment modal (Pickup vs Delivery) for non-
 *     custom-part carts; or, when the cart contains custom parts, hide the
 *     theme's checkout buttons entirely (those carts are completed in-app).
 *   - Wire the "View Projects" link to the customer-aware destination so
 *     drawer-rendered copies of the link still navigate correctly.
 *
 * All modal markup, role-select widgets, project loading, mode toggling,
 * duplicate handling, and POSTing to /apps/project-clad/api/save-job live in
 * project-clad-save-modal.js.
 */
(() => {
  function initCheckoutFulfillmentModal(root) {
    const modal = root.querySelector(
      "[data-projectclad-checkout-fulfillment-modal]",
    );
    if (!(modal instanceof HTMLElement)) return;

    const content = modal.querySelector(".projectclad-modal__content");
    const closeBtn = modal.querySelector(
      "[data-projectclad-checkout-fulfill-close]",
    );
    const cancelBtn = modal.querySelector(
      "[data-projectclad-checkout-fulfill-cancel]",
    );
    const continueBtn = modal.querySelector(
      "[data-projectclad-checkout-fulfill-continue]",
    );

    let pendingCheckout = null;

    const openModal = (m) => {
      m.hidden = false;
      m.setAttribute("aria-hidden", "false");
      m.classList.remove("projectclad-modal--open");
      void m.offsetWidth;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          m.classList.add("projectclad-modal--open");
        });
      });
    };

    const closeModal = (m, after) => {
      const done = () => {
        m.hidden = true;
        m.setAttribute("aria-hidden", "true");
        m.classList.remove("projectclad-modal--open");
        if (typeof after === "function") after();
      };
      if (!m.classList.contains("projectclad-modal--open")) return done();
      m.classList.remove("projectclad-modal--open");
      window.setTimeout(done, 300);
    };

    const closeFulfill = () => {
      closeModal(modal, () => {
        pendingCheckout = null;
        if (document.body.style.overflow === "hidden") {
          document.body.style.overflow = "";
        }
      });
    };

    const openFulfill = (intent) => {
      pendingCheckout = intent;
      document.body.style.overflow = "hidden";
      openModal(modal);
    };

    const applyCartAttributeAndGo = async (method) => {
      try {
        const r = await fetch("/cart/update.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            attributes: { projectclad_fulfillment: method },
          }),
        });
        if (!r.ok) throw new Error("cart update failed");
      } catch (e) {
        console.error("[ProjectClad] cart fulfillment attribute failed", e);
        alert("Unable to update cart. Please try again.");
        return;
      }
      const intent = pendingCheckout;
      closeFulfill();
      if (!intent) return;
      if (intent.kind === "href") {
        window.location.href = intent.url;
        return;
      }
      if (intent.kind === "form" && intent.form instanceof HTMLFormElement) {
        const sub = intent.form.querySelector('[name="checkout"]');
        if (
          sub instanceof HTMLElement &&
          typeof intent.form.requestSubmit === "function"
        ) {
          intent.form.requestSubmit(sub);
          return;
        }
        intent.form.submit();
      }
    };

    continueBtn?.addEventListener("click", () => {
      const sel = modal.querySelector(
        'input[name="projectclad-checkout-fulfill"]:checked',
      );
      const v = sel instanceof HTMLInputElement ? sel.value : "pickup";
      if (v !== "pickup" && v !== "delivery") return;
      void applyCartAttributeAndGo(v);
    });
    closeBtn?.addEventListener("click", closeFulfill);
    cancelBtn?.addEventListener("click", closeFulfill);
    modal.addEventListener("pointerdown", (e) => {
      if (e.target === modal) closeFulfill();
    });
    content?.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });

    const checkoutLabelMatch = (el) => {
      const t = (el.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (!t) return false;
      return (
        t === "order now" ||
        t === "checkout" ||
        t === "check out" ||
        t.includes("order now")
      );
    };

    const inThemeCartUi = (el) =>
      Boolean(
        el.closest(
          "[data-cart-drawer],cart-drawer,[is='cart-drawer'],[id*='CartDrawer'],[id*='cart-drawer'],[class*='cart-drawer'],[class*='CartDrawer'],[class*='drawer__footer'],[class*='cart__ctas'],[class*='cart__blocks'],[class*='mini-cart'],[class*='minicart'],#cart-drawer,.shopify-section[class*='cart']",
        ),
      );

    const cartContextHint = /cart|drawer|checkout|basket|bag|subtotal|order-summary|totals|line-items/i;
    const nearCartLikeContainer = (el) => {
      let p = el;
      for (let i = 0; i < 14 && p; i += 1, p = p.parentElement) {
        if (!(p instanceof HTMLElement)) continue;
        const id = String(p.id || "");
        const cls =
          typeof p.className === "string"
            ? p.className
            : String(p.className || "");
        if (cartContextHint.test(`${id} ${cls}`)) return true;
      }
      return false;
    };

    const resolveCheckoutIntent = (target) => {
      let node = target;
      if (node && node.nodeType === 3 && node.parentElement) {
        node = node.parentElement;
      }
      if (!(node instanceof Element)) return null;

      if (node.closest("[data-projectclad-checkout-fulfillment-modal]")) {
        return null;
      }
      if (node.closest("[data-projectclad]")) return null;

      const a = node.closest('a[href*="/checkout"]');
      if (a instanceof HTMLAnchorElement) {
        const href = a.getAttribute("href") || "";
        if (!href.includes("checkout")) return null;
        return { kind: "href", url: a.href };
      }

      const named = node.closest('[name="checkout"]');
      if (
        named instanceof HTMLButtonElement ||
        named instanceof HTMLInputElement
      ) {
        const form = named.form;
        if (!form) return null;
        return { kind: "form", form };
      }

      const btn = node.closest("button, a");
      if (
        btn instanceof HTMLElement &&
        checkoutLabelMatch(btn) &&
        (inThemeCartUi(node) || nearCartLikeContainer(btn))
      ) {
        if (btn instanceof HTMLAnchorElement) {
          const h = btn.getAttribute("href") || "";
          if (h && !h.startsWith("#") && !h.startsWith("javascript:")) {
            return { kind: "href", url: btn.href };
          }
        }
        return {
          kind: "href",
          url: `${window.location.origin}/checkout`,
        };
      }

      return null;
    };

    document.addEventListener(
      "click",
      (event) => {
        const intent = resolveCheckoutIntent(event.target);
        if (!intent) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openFulfill(intent);
      },
      true,
    );
  }

  const productHandleFromUrl = (url) => {
    if (!url || typeof url !== "string") return null;
    const m = url.match(/\/products\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  };

  const imageUrlFromLine = (item) => {
    const raw =
      (item.featured_image && item.featured_image.url) || item.image || null;
    if (!raw || typeof raw !== "string") return null;
    if (raw.startsWith("//")) return `https:${raw}`;
    return raw;
  };

  const getCartItems = async () => {
    const response = await fetch("/cart.js", { credentials: "same-origin" });
    const cart = await response.json();
    return (cart.items || []).map((item) => {
      const rawProps = item.properties || {};
      const properties = [];
      if (Array.isArray(rawProps)) {
        rawProps.forEach((prop) => {
          if (!prop || !prop.name) return;
          properties.push({
            name: String(prop.name),
            value:
              typeof prop.value === "string"
                ? prop.value
                : JSON.stringify(prop.value),
          });
        });
      } else {
        Object.entries(rawProps).forEach(([name, value]) => {
          if (!name) return;
          properties.push({
            name: String(name),
            value:
              typeof value === "string" ? value : JSON.stringify(value),
          });
        });
      }

      const variantIdNum =
        item.variant_id != null && item.variant_id !== ""
          ? item.variant_id
          : item.id;
      const productTitle =
        (item.product_title && String(item.product_title).trim()) ||
        (item.title && String(item.title).trim()) ||
        "";
      const variantTitle =
        (item.variant_title && String(item.variant_title).trim()) || "";

      return {
        variantId: String(variantIdNum),
        quantity: Number(item.quantity),
        priceSnapshot: Number(item.price) / 100,
        properties,
        lineMeta: {
          productTitle: productTitle || undefined,
          variantTitle: variantTitle || undefined,
          imageUrl: imageUrlFromLine(item),
          productHandle: productHandleFromUrl(item.url),
          productId:
            item.product_id != null && item.product_id !== ""
              ? String(item.product_id)
              : undefined,
          sku: item.sku ? String(item.sku) : null,
          vendor: item.vendor ? String(item.vendor) : null,
        },
      };
    });
  };

  const root = document.querySelector(
    "[data-projectclad]:not([data-projectclad-product])",
  );
  if (!root) return;

  const hasCustomParts =
    root.getAttribute("data-projectclad-has-custom-parts") === "true";
  if (hasCustomParts) {
    const checkoutSelectors = [
      'a[href="/checkout"]',
      'a[href*="/checkout"]',
      '[name="checkout"]',
      '[data-checkout]',
      'form[action="/checkout"]',
      'form[action*="checkout"]',
    ];
    checkoutSelectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        if (el.closest("[data-projectclad]")) return;
        el.style.display = "none";
      });
    });
  } else {
    initCheckoutFulfillmentModal(root);
  }

  const viewProjectsUrl =
    root.getAttribute("data-projectclad-view-projects-url") || "";
  const viewProjectsLink = root.querySelector(
    "[data-projectclad-view-projects]",
  );
  if (viewProjectsLink && viewProjectsUrl) {
    const navigateToProjects = (event) => {
      event.preventDefault();
      window.location.href = viewProjectsUrl;
    };
    viewProjectsLink.addEventListener("click", navigateToProjects);
    document.addEventListener(
      "click",
      (event) => {
        if (
          event.target instanceof Element &&
          (event.target === viewProjectsLink ||
            viewProjectsLink.contains(event.target))
        ) {
          navigateToProjects(event);
        }
      },
      true,
    );
  }

  // Save Order is only meaningful when the cart is non-empty. Toggle the
  // trigger's display in lockstep with /cart.js so SPA-style line item
  // updates keep the button correct.
  let cartRefreshTimer;
  let controller = null;
  const trigger = root.querySelector("[data-projectclad-save]");

  const setSaveVisibility = (count) => {
    if (controller) controller.setTriggerVisible(count > 0);
    else if (trigger instanceof HTMLElement)
      trigger.style.display = count > 0 ? "" : "none";
  };

  const refreshCartState = async () => {
    try {
      const response = await fetch("/cart.js", {
        credentials: "same-origin",
      });
      if (!response.ok) return false;
      const cart = await response.json();
      const count = Number(cart.item_count || 0);
      setSaveVisibility(count);
      return count > 0;
    } catch {
      return true;
    }
  };

  if (window.ProjectCladSaveModal) {
    controller = window.ProjectCladSaveModal.init(root, {
      getItems: getCartItems,
      modalIntent: "cart",
      requireCartItems: true,
      refreshGuard: async () => {
        return await refreshCartState();
      },
      // Default behavior was already "redirect to project (or clear cart
      // first when requested)"; passing onSaved would override the module
      // default, so we leave it unset to preserve legacy UX.
    });
  }

  document.addEventListener("change", () => {
    clearTimeout(cartRefreshTimer);
    cartRefreshTimer = setTimeout(refreshCartState, 250);
  });

  document.addEventListener("submit", () => {
    clearTimeout(cartRefreshTimer);
    cartRefreshTimer = setTimeout(refreshCartState, 500);
  });

  refreshCartState();
})();
