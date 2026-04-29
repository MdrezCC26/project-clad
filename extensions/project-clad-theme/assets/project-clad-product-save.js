/*
 * Product detail page glue for "Save to Project".
 *
 * Reads the merchant theme's selected variant id, option pickers, and qty
 * from the closest <form action*="/cart/add">, validates, builds a single-
 * item payload, and hands it to the shared save modal.
 *
 * All modal markup, project loading, and POST logic live in the shared
 * module (project-clad-save-modal.js). This file is intentionally only:
 *   - finder + validator for the theme inputs
 *   - one-item payload builder (incl. lineMeta hydrated from /products/<h>.js)
 *   - inline error rendering
 *   - sessionStorage round-trip across the auth redirect
 *   - inline saved indicator (stays on PDP after save)
 *
 * The block can be added on any product template (enabled_on: product) and
 * should be placed under the merchant's "Buy buttons" block.
 */
(() => {
  const STORAGE_PREFIX = "projectclad:product-save:";
  const RETURN_QUERY_KEY = "projectclad-save";
  const INLINE_SAVED_VISIBLE_MS = 60000;

  function findRoot() {
    return document.querySelector(
      "[data-projectclad][data-projectclad-product]",
    );
  }

  function findCartAddForm(root) {
    // Prefer a form within the same Shopify section; fall back to nearest
    // visible cart-add form on the page.
    const section = root.closest(".shopify-section") || document;
    const forms = section.querySelectorAll('form[action*="/cart/add"]');
    for (const form of forms) {
      if (!(form instanceof HTMLFormElement)) continue;
      // Skip our own custom-part block's hidden form (its inputs are only
      // populated at submit time and would shadow real theme variant /
      // option pickers).
      if (form.closest("[data-projectclad-custom-part]")) continue;
      return form;
    }
    const fallback = document.querySelector('form[action*="/cart/add"]');
    return fallback instanceof HTMLFormElement &&
      !fallback.closest("[data-projectclad-custom-part]")
      ? fallback
      : null;
  }

  /**
   * Locate the custom-part configurator block (L / Z / U dimension form)
   * for the current product, if one was added by the merchant to this
   * Product information section.
   */
  function findCustomPartRoot() {
    return document.querySelector("[data-projectclad-custom-part]");
  }

  /**
   * Snapshot the user's dimension / gauge / qty selections from the custom-
   * part configurator. Mirrors the input wiring in custom-part-form.liquid
   * + project-clad-custom-part.js so save-to-project sees the same values
   * the user would Add-to-Cart with.
   */
  function readCustomPart(cpRoot) {
    if (!cpRoot) return null;
    const shapeType = cpRoot.dataset.shapeType || "L";
    const variantId = cpRoot.dataset.variantId || "";
    const num = (sel, fallback) => {
      const el = cpRoot.querySelector(sel);
      if (!(el instanceof HTMLInputElement)) return fallback;
      const n = parseFloat(el.value);
      return Number.isFinite(n) ? n : fallback;
    };
    const intVal = (sel, fallback) => {
      const el = cpRoot.querySelector(sel);
      if (!(el instanceof HTMLInputElement)) return fallback;
      const n = parseInt(el.value, 10);
      return Number.isFinite(n) ? n : fallback;
    };
    const L1 = num("[data-projectclad-l1]", 0);
    const L2 = num("[data-projectclad-l2]", 0);
    const A1 = num("[data-projectclad-a1]", 90);
    const hasL3Input = !!cpRoot.querySelector("[data-projectclad-l3]");
    const L3 = hasL3Input ? num("[data-projectclad-l3]", 0) : 0;
    const gaugeEl = cpRoot.querySelector("[data-projectclad-gauge]");
    const gauge =
      gaugeEl instanceof HTMLSelectElement || gaugeEl instanceof HTMLInputElement
        ? gaugeEl.value || "16"
        : "16";
    const quantity = Math.max(intVal("[data-projectclad-quantity]", 1), 1);
    return { shapeType, variantId, L1, L2, A1, L3, hasL3Input, gauge, quantity };
  }

  /**
   * Same pricing endpoint as `project-clad-custom-part.js` — variant list price
   * is often $0 for calculator SKUs; save-to-project must persist unit price here.
   */
  async function fetchCustomPartUnitPrice(cpRoot, cp) {
    if (!cpRoot || !cp) return null;
    const priceUrl = (cpRoot.dataset.priceUrl || "").trim();
    if (!priceUrl) return null;
    const params = new URLSearchParams({
      shapeType: cp.shapeType,
      gauge: String(cp.gauge),
      L1: String(cp.L1),
      L2: String(cp.L2),
      quantity: String(cp.quantity),
    });
    if (cp.shapeType === "Z" || cp.shapeType === "U") {
      params.set("L3", String(cp.L3));
    }
    try {
      const r = await fetch(`${priceUrl}?${params.toString()}`, {
        credentials: "same-origin",
      });
      if (!r.ok) return null;
      const data = await r.json();
      if (typeof data.unitPrice === "number" && Number.isFinite(data.unitPrice)) {
        return data.unitPrice;
      }
      if (
        typeof data.totalPrice === "number" &&
        Number.isFinite(data.totalPrice) &&
        cp.quantity > 0
      ) {
        return Math.round((data.totalPrice / cp.quantity) * 100) / 100;
      }
      return null;
    } catch {
      return null;
    }
  }

  function customPartProperties(cp) {
    if (!cp) return [];
    const props = [
      { name: "shape_type", value: cp.shapeType },
      { name: "L1", value: String(cp.L1) },
      { name: "L2", value: String(cp.L2) },
      { name: "Gauge", value: String(cp.gauge) },
    ];
    if (cp.shapeType === "L") {
      props.push({ name: "A1", value: String(cp.A1) });
    }
    if (cp.shapeType === "Z" || cp.shapeType === "U") {
      props.push({ name: "L3", value: String(cp.L3) });
    }
    return props;
  }

  function applyCustomPartSelection(cpRoot, selection) {
    if (!cpRoot || !selection) return;
    const setVal = (sel, value) => {
      const el = cpRoot.querySelector(sel);
      if (
        (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) &&
        value != null
      ) {
        el.value = String(value);
        // Re-trigger the live price fetch in custom-part JS.
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    };
    setVal("[data-projectclad-l1]", selection.L1);
    setVal("[data-projectclad-l2]", selection.L2);
    setVal("[data-projectclad-a1]", selection.A1);
    if (selection.L3 != null) setVal("[data-projectclad-l3]", selection.L3);
    setVal("[data-projectclad-gauge]", selection.gauge);
    setVal("[data-projectclad-quantity]", selection.quantity);
  }

  function readVariantId(form, fallbackId) {
    if (!form) return fallbackId || "";
    const input = form.querySelector('[name="id"]');
    if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) {
      const v = (input.value || "").trim();
      if (v) return v;
    }
    return fallbackId || "";
  }

  function readQuantity(form) {
    if (!form) return 1;
    const input = form.querySelector('[name="quantity"]');
    if (input instanceof HTMLInputElement) {
      const n = Number(input.value);
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
    return 1;
  }

  /**
   * Read the option pickers in the cart-add form. Returns an array of
   * { name, value, valid } where `valid` is false when the picker is
   * unselected (empty value or matches a "Please select…" placeholder).
   */
  function readOptionPickers(form) {
    if (!form) return [];
    const pickers = form.querySelectorAll(
      '[name^="options"], [name^="properties"]',
    );
    const seen = new Set();
    const out = [];
    pickers.forEach((el) => {
      if (
        !(
          el instanceof HTMLInputElement ||
          el instanceof HTMLSelectElement
        )
      ) {
        return;
      }
      const name = el.name || "";
      // For radios, only the checked one matters. For others, use the value.
      let value = "";
      if (el instanceof HTMLInputElement && el.type === "radio") {
        if (!el.checked) return;
        value = el.value || "";
      } else if (el instanceof HTMLInputElement && el.type === "checkbox") {
        if (!el.checked) return;
        value = el.value || "";
      } else {
        value = el.value || "";
      }
      if (seen.has(name) && !value) return;
      seen.add(name);
      const trimmed = String(value).trim();
      const looksUnselected =
        !trimmed || /please\s*select/i.test(trimmed) || trimmed === "—";
      // Anything in `properties[…]` is custom-part data, not an option to
      // validate as "color"; we still capture it so it goes on the payload.
      out.push({
        name,
        value: trimmed,
        valid: name.startsWith("properties") ? true : !looksUnselected,
      });
    });
    return out;
  }

  function buildPropertiesFromForm(form) {
    const properties = [];
    if (!form) return properties;
    const inputs = form.querySelectorAll('[name^="properties["]');
    inputs.forEach((el) => {
      if (
        !(
          el instanceof HTMLInputElement ||
          el instanceof HTMLSelectElement ||
          el instanceof HTMLTextAreaElement
        )
      ) {
        return;
      }
      const name = el.name || "";
      const m = name.match(/^properties\[(.+?)\]$/);
      if (!m) return;
      const propName = m[1];
      let value = "";
      if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox")) {
        if (!el.checked) return;
        value = el.value || "";
      } else {
        value = el.value || "";
      }
      const trimmed = String(value).trim();
      if (!trimmed) return;
      properties.push({ name: propName, value: trimmed });
    });
    return properties;
  }

  function variantTitleFromOptions(options) {
    return options
      .filter((o) => o.value && !o.name.startsWith("properties"))
      .map((o) => o.value)
      .join(" / ");
  }

  let productCache = null;
  async function ensureProductData(root) {
    if (productCache) return productCache;
    const handle = root.getAttribute("data-projectclad-product-handle") || "";
    if (!handle) return null;
    try {
      const r = await fetch(`/products/${encodeURIComponent(handle)}.js`, {
        credentials: "same-origin",
      });
      if (!r.ok) return null;
      productCache = await r.json();
      return productCache;
    } catch {
      return null;
    }
  }

  function findVariantInProduct(product, variantId) {
    if (!product || !Array.isArray(product.variants)) return null;
    const idStr = String(variantId);
    return (
      product.variants.find((v) => String(v.id) === idStr) ||
      product.variants.find((v) => String(v.variant_id) === idStr) ||
      null
    );
  }

  function showInlineError(root, message) {
    const el = root.querySelector("[data-projectclad-error]");
    if (!(el instanceof HTMLElement)) return;
    el.textContent = message;
    el.hidden = false;
    el.classList.add("projectclad-product-save__error--visible");
  }

  function clearInlineError(root) {
    const el = root.querySelector("[data-projectclad-error]");
    if (!(el instanceof HTMLElement)) return;
    el.textContent = "";
    el.hidden = true;
    el.classList.remove("projectclad-product-save__error--visible");
  }

  /*
   * Inline "Order saved ✓" indicator that appears next to the Save button
   * after a successful save and auto-hides after INLINE_SAVED_VISIBLE_MS.
   * Using per-root WeakMap state so repeated saves reset the timer cleanly
   * instead of hiding the pill mid-countdown from a stale invocation.
   */
  const inlineSavedTimers = new WeakMap();

  function showInlineSaved(root, { projectName, projectId }) {
    const savedEl = root.querySelector("[data-projectclad-saved]");
    if (!(savedEl instanceof HTMLElement)) return;

    const textEl = savedEl.querySelector("[data-projectclad-saved-text]");
    if (textEl instanceof HTMLElement) {
      textEl.textContent = projectName
        ? `Saved to ${projectName}`
        : "Order saved";
    }

    // Toggle an existing "View project" link so it points at the freshly
    // saved project without creating duplicate nodes across saves.
    let link = savedEl.querySelector("[data-projectclad-saved-link]");
    if (projectId) {
      if (!(link instanceof HTMLAnchorElement)) {
        link = document.createElement("a");
        link.className = "projectclad-product-save__saved-link";
        link.setAttribute("data-projectclad-saved-link", "");
        savedEl.appendChild(link);
      }
      link.href = `/apps/project-clad/project?id=${encodeURIComponent(projectId)}`;
      link.textContent = "View project";
    } else if (link instanceof HTMLElement) {
      link.remove();
    }

    savedEl.hidden = false;
    // Double-rAF lets the browser paint the hidden-to-visible transition.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        savedEl.classList.add("projectclad-product-save__saved--visible");
      });
    });

    const prior = inlineSavedTimers.get(root);
    if (prior) window.clearTimeout(prior);
    const timer = window.setTimeout(() => {
      savedEl.classList.remove("projectclad-product-save__saved--visible");
      // Match the CSS fade-out duration before fully hiding for a11y.
      window.setTimeout(() => {
        savedEl.hidden = true;
      }, 300);
      inlineSavedTimers.delete(root);
    }, INLINE_SAVED_VISIBLE_MS);
    inlineSavedTimers.set(root, timer);
  }

  function storageKey(root) {
    const productId =
      root.getAttribute("data-projectclad-product-id") ||
      root.getAttribute("data-projectclad-product-handle") ||
      "default";
    return STORAGE_PREFIX + productId;
  }

  function readSavedState(root) {
    try {
      const raw = sessionStorage.getItem(storageKey(root));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function writeSavedState(root, state) {
    try {
      sessionStorage.setItem(storageKey(root), JSON.stringify(state));
    } catch {
      // ignore quota / disabled storage
    }
  }

  function clearSavedState(root) {
    try {
      sessionStorage.removeItem(storageKey(root));
    } catch {
      // ignore
    }
  }

  function applyFormSelection(form, selection) {
    if (!form || !selection) return;
    if (selection.variantId) {
      const idInput = form.querySelector('[name="id"]');
      if (idInput instanceof HTMLInputElement || idInput instanceof HTMLSelectElement) {
        if (idInput.value !== selection.variantId) {
          idInput.value = selection.variantId;
        }
      }
    }
    if (selection.quantity) {
      const qtyInput = form.querySelector('[name="quantity"]');
      if (qtyInput instanceof HTMLInputElement) {
        const n = Number(selection.quantity);
        if (Number.isFinite(n) && n > 0) qtyInput.value = String(n);
      }
    }
  }

  async function buildItem(root, form, cpRoot) {
    const fallbackId =
      root.getAttribute("data-projectclad-default-variant-id") || "";

    // Custom-part products carry no theme variant pickers — read everything
    // from the configurator instead of from the (hidden) cart-add form.
    const cp = cpRoot ? readCustomPart(cpRoot) : null;
    const variantId = cp
      ? cp.variantId || fallbackId
      : readVariantId(form, fallbackId);
    const quantity = cp ? cp.quantity : readQuantity(form);
    const properties = cp
      ? customPartProperties(cp)
      : buildPropertiesFromForm(form);
    const options = cp ? [] : readOptionPickers(form);

    let priceSnapshot = 0;
    let variantTitle = "";
    let sku = null;
    const product = await ensureProductData(root);
    const variant = product ? findVariantInProduct(product, variantId) : null;
    if (variant) {
      // Match cart-save behavior: store the variant base price as the line
      // snapshot. Dimension-based pricing is computed downstream from the
      // properties (same as a cart line).
      priceSnapshot = Number(variant.price) / 100;
      variantTitle = (variant.public_title || variant.title || "").trim();
      sku = variant.sku ? String(variant.sku) : null;
    } else {
      const fallbackPrice = Number(
        root.getAttribute("data-projectclad-default-variant-price") || "0",
      );
      if (Number.isFinite(fallbackPrice)) {
        priceSnapshot = fallbackPrice / 100;
      }
      if (!cp) variantTitle = variantTitleFromOptions(options);
    }

    if (cp && cpRoot) {
      const calcUnit = await fetchCustomPartUnitPrice(cpRoot, cp);
      if (calcUnit != null && Number.isFinite(calcUnit) && calcUnit > 0) {
        priceSnapshot = calcUnit;
      }
    }

    const productTitle =
      root.getAttribute("data-projectclad-product-title") ||
      product?.title ||
      "";
    const productHandle =
      root.getAttribute("data-projectclad-product-handle") ||
      product?.handle ||
      null;
    const productId =
      root.getAttribute("data-projectclad-product-id") ||
      (product?.id != null ? String(product.id) : undefined);
    const vendor =
      root.getAttribute("data-projectclad-product-vendor") ||
      product?.vendor ||
      null;
    const imageUrl =
      root.getAttribute("data-projectclad-product-image-url") ||
      (variant && variant.featured_image && variant.featured_image.src) ||
      (product?.featured_image ? String(product.featured_image) : null);

    return {
      variantId: String(variantId),
      quantity,
      priceSnapshot,
      properties: properties.length ? properties : undefined,
      lineMeta: {
        productTitle: productTitle || undefined,
        variantTitle: variantTitle || undefined,
        imageUrl: imageUrl || null,
        productHandle: productHandle || null,
        productId: productId || undefined,
        sku,
        vendor: vendor || null,
      },
    };
  }

  /**
   * Validate before opening the modal. Strategy:
   *
   *   1. Custom-part configurator present → mirror the rules
   *      project-clad-custom-part.js applies on Add-to-Cart submit:
   *      L1 > 0, L2 > 0, plus L3 > 0 for Z / U shapes, plus qty ≥ 1.
   *
   *   2. Theme cart-add form with option pickers (variant products) →
   *      every option must have a real value (not "Please select…"), plus
   *      qty ≥ 1.
   *
   *   3. No options of any kind (single-variant, no custom part) →
   *      qty ≥ 1 only.
   */
  function validate(form, cpRoot) {
    if (cpRoot) {
      const cp = readCustomPart(cpRoot);
      if (!cp) return "Please configure the part before saving.";
      if (cp.L1 <= 0) return "Enter L1 (in) greater than 0.";
      if (cp.L2 <= 0) return "Enter L2 (in) greater than 0.";
      if ((cp.shapeType === "Z" || cp.shapeType === "U") && cp.L3 <= 0) {
        return "Enter L3 (in) greater than 0.";
      }
      if (!cp.gauge) return "Please select a gauge.";
      if (!Number.isFinite(cp.quantity) || cp.quantity < 1) {
        return "Please choose a quantity of at least 1.";
      }
      return null;
    }

    const quantity = readQuantity(form);
    if (!Number.isFinite(quantity) || quantity < 1) {
      return "Please choose a quantity of at least 1.";
    }
    const options = readOptionPickers(form);
    const optionOnly = options.filter((o) => !o.name.startsWith("properties"));
    const invalid = optionOnly.find((o) => !o.valid);
    if (invalid) {
      // "options[Color]" → "Color"
      const m = invalid.name.match(/^options\[(.+?)\]$/);
      const friendly = m ? m[1] : invalid.name;
      return `Please select a ${friendly}.`;
    }
    return null;
  }

  function captureSelection(form, cpRoot) {
    if (cpRoot) {
      const cp = readCustomPart(cpRoot);
      if (!cp) return null;
      return {
        kind: "customPart",
        variantId: cp.variantId,
        L1: cp.L1,
        L2: cp.L2,
        A1: cp.A1,
        L3: cp.hasL3Input ? cp.L3 : null,
        gauge: cp.gauge,
        quantity: cp.quantity,
      };
    }
    if (!form) return null;
    return {
      kind: "form",
      variantId: readVariantId(form, ""),
      quantity: readQuantity(form),
    };
  }

  function restoreSelection(form, cpRoot, selection) {
    if (!selection) return;
    if (selection.kind === "customPart" && cpRoot) {
      applyCustomPartSelection(cpRoot, selection);
      return;
    }
    if (selection.kind === "form" && form) {
      applyFormSelection(form, selection);
    }
  }

  function init() {
    const root = findRoot();
    if (!root) return;
    if (!window.ProjectCladSaveModal) return;

    const cpRoot = findCustomPartRoot();
    const form = cpRoot ? null : findCartAddForm(root);
    const customerSignedIn =
      root.getAttribute("data-projectclad-customer-signed-in") === "true";

    const persistedState = readSavedState(root);
    const wantAutoOpen =
      new URLSearchParams(window.location.search).get(RETURN_QUERY_KEY) ===
        "1" && persistedState;

    if (wantAutoOpen && persistedState?.selection) {
      restoreSelection(form, cpRoot, persistedState.selection);
    }

    const controller = window.ProjectCladSaveModal.init(root, {
      modalIntent: "product",
      requireCartItems: false,
      getItems: async () => {
        const item = await buildItem(root, form, cpRoot);
        return [item];
      },
      onBeforeOpen: () => {
        const err = validate(form, cpRoot);
        if (err) {
          showInlineError(root, err);
          return false;
        }
        clearInlineError(root);
        // Snapshot the user's product selection so we can restore it after
        // an auth-redirect round-trip.
        const selection = captureSelection(form, cpRoot);
        if (selection) {
          const prior = readSavedState(root) || {};
          writeSavedState(root, { ...prior, selection });
        }
        return true;
      },
      prefillState:
        wantAutoOpen && persistedState?.modal ? persistedState.modal : null,
      onStateChange: (state) => {
        const prior = readSavedState(root) || {};
        writeSavedState(root, { ...prior, modal: state });
      },
      onSaved: ({ projectName, projectId }) => {
        clearSavedState(root);
        clearInlineError(root);
        if (controller && typeof controller.closeModal === "function") {
          controller.closeModal();
        }
        showInlineSaved(root, { projectName, projectId });
      },
    });

    if (!controller) return;

    // Clear any stale inline error when the user changes inputs in either
    // the standard cart-add form or the custom-part configurator.
    const clear = () => clearInlineError(root);
    if (form) {
      form.addEventListener("change", clear);
      form.addEventListener("input", clear);
    }
    if (cpRoot) {
      cpRoot.addEventListener("change", clear);
      cpRoot.addEventListener("input", clear);
    }

    // After the auth round-trip, auto-open the modal so the user lands back
    // exactly where they left off. Strip the marker from the URL so a hard
    // refresh doesn't keep re-opening it.
    if (wantAutoOpen && customerSignedIn) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete(RETURN_QUERY_KEY);
        window.history.replaceState(
          window.history.state,
          "",
          url.pathname + (url.search ? url.search : "") + url.hash,
        );
      } catch {
        // ignore URL rewrite errors
      }
      // Wait one tick so the input restoration above settles before the
      // modal validates the values it sees.
      window.setTimeout(() => {
        controller.openModal();
      }, 0);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
