/*
 * Product-page prefill for Options Price Calculator (Online Origins).
 *
 * Project Clad line items link here with ?pc_opc=<json> (fields + optional qty).
 * OPC has no official restore API, so this waits for #calculator-form-container,
 * fills number inputs, then drives Gauge / Color Picker / Length dropdowns by
 * opening the menu and clicking the matching option label.
 *
 * Saving / adding to cart creates a new line — this never edits the original.
 */
(() => {
  if (window.__projectCladOpcPrefill) return;
  window.__projectCladOpcPrefill = true;

  const QUERY_KEY = "pc_opc";
  const MAX_WAIT_MS = 20000;
  const RETRY_MS = 350;
  const SETTLE_MS = 2500;
  const TOAST_MS = 6000;

  const ALIASES = {
    l1: ["field_1"],
    l2: ["field_2"],
    l3: ["field_3"],
    l4: ["field_7"],
    a1: ["field_6"],
    a2: ["field_8"],
    gauge: ["field_4"],
    color: ["colour", "color_picker", "colour_picker", "field_9"],
    colour: ["color", "color_picker", "field_9"],
    color_picker: ["color", "colour", "field_9"],
    length: ["field_10"],
    additional_details: ["field_5", "additionaldetails"],
    field_1: ["l1"],
    field_2: ["l2"],
    field_3: ["l3"],
    field_7: ["l4"],
    field_6: ["a1"],
    field_8: ["a2"],
    field_4: ["gauge"],
    field_9: ["color", "colour", "color_picker"],
    field_10: ["length"],
    field_5: ["additional_details"],
  };

  function normalizeKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[\s\-–—]+/g, "_")
      .replace(/[^\w]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
  }

  function normalizeMatch(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[\s_\-–—]+/g, " ")
      .replace(/["']/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function candidateKeys(raw) {
    const n = normalizeKey(raw);
    const out = new Set();
    if (!n) return [];
    out.add(n);
    out.add(n.replace(/_/g, ""));
    for (const alias of ALIASES[n] || []) out.add(alias);
    return [...out];
  }

  function isUnsetSentinel(key, value) {
    const v = String(value || "").trim();
    if (v !== "0" && v !== "0.0") return false;
    const n = normalizeKey(key);
    return /^(field_4|field_9|gauge|color|colour|color_picker|colour_picker|length|field_10)$/.test(
      n,
    );
  }

  function valueForKey(fields, rawKey) {
    let placeholder = null;
    for (const key of candidateKeys(rawKey)) {
      const direct = fields[key];
      const underscored = key.replace(/([a-z])(\d)/g, "$1_$2");
      const raw =
        direct != null && String(direct).trim()
          ? String(direct).trim()
          : fields[underscored] != null && String(fields[underscored]).trim()
            ? String(fields[underscored]).trim()
            : "";
      if (!raw) continue;
      if (isUnsetSentinel(key, raw) || isUnsetSentinel(underscored, raw)) {
        if (!placeholder) placeholder = raw;
        continue;
      }
      return raw;
    }
    return placeholder;
  }

  function readPayload() {
    const params = new URLSearchParams(window.location.search);
    let raw = params.get(QUERY_KEY);
    if (!raw && window.location.hash) {
      const hash = window.location.hash.replace(/^#/, "");
      raw = new URLSearchParams(hash).get(QUERY_KEY);
    }
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const fields =
        parsed.fields && typeof parsed.fields === "object"
          ? parsed.fields
          : parsed;
      return {
        fields,
        qty:
          typeof parsed.qty === "number" && Number.isFinite(parsed.qty)
            ? parsed.qty
            : null,
      };
    } catch {
      return null;
    }
  }

  function stripPrefillFromUrl() {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has(QUERY_KEY)) {
        url.searchParams.delete(QUERY_KEY);
      }
      if (url.hash && url.hash.includes(QUERY_KEY)) {
        url.hash = "";
      }
      window.history.replaceState({}, "", url.toString());
    } catch {
      /* ignore */
    }
  }

  function walkElements(root, visit) {
    if (!root) return;
    visit(root);
    const nodes =
      root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (const el of nodes) {
      visit(el);
      if (el.shadowRoot) walkElements(el.shadowRoot, visit);
    }
  }

  function collectControls(root) {
    const found = [];
    walkElements(root, (el) => {
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement
      ) {
        found.push(el);
      }
    });
    return found;
  }

  function isShopifyVariantControl(el) {
    const name = (el.getAttribute("name") || "").toLowerCase();
    if (name === "id") return true;
    if (name.startsWith("options[")) return true;
    return false;
  }

  function isCalculatorHidden(el) {
    const name = el.getAttribute("name") || "";
    const key =
      el.getAttribute("data-key") ||
      el.getAttribute("data-keyname") ||
      el.getAttribute("data-field-key") ||
      "";
    return /^properties\[/i.test(name) || /field_\d+/i.test(name + key);
  }

  function controlNameKey(el) {
    const name = el.getAttribute("name") || "";
    const prop = name.match(/^properties\[(.+)\]$/i);
    if (prop) return prop[1];
    const dataKey =
      el.getAttribute("data-key") ||
      el.getAttribute("data-keyname") ||
      el.getAttribute("data-field-key") ||
      el.getAttribute("data-field");
    if (dataKey) return dataKey;
    if (el.id) return el.id;
    return name;
  }

  function ownText(el) {
    if (!el) return "";
    let text = "";
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) text += node.textContent || "";
    }
    return text.trim();
  }

  function labelTextFor(el) {
    const chunks = [];
    if (el.labels && el.labels.length) {
      for (const label of el.labels) chunks.push(label.textContent || "");
    }
    const wrap = el.closest("label");
    if (wrap) chunks.push(wrap.textContent || "");
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        const node = document.getElementById(id);
        if (node) chunks.push(node.textContent || "");
      }
    }
    chunks.push(el.getAttribute("aria-label") || "");
    chunks.push(el.getAttribute("placeholder") || "");
    const prev = el.previousElementSibling;
    if (prev && (prev.tagName === "LABEL" || prev.tagName === "SPAN")) {
      chunks.push(prev.textContent || "");
    }
    const parentLabel = el.parentElement && el.parentElement.querySelector("label");
    if (parentLabel) chunks.push(parentLabel.textContent || "");
    return chunks.join(" ");
  }

  function setNativeValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function optionMatches(option, wanted) {
    const label = normalizeMatch(option.textContent || option.label || "");
    const value = normalizeMatch(option.value);
    const want = normalizeMatch(wanted);
    if (!want) return false;
    if (label === want || value === want) return true;
    const wantNum = want.match(/^(\d+(?:\.\d+)?)/);
    const labelNum = label.match(/^(\d+(?:\.\d+)?)/);
    if (
      wantNum &&
      labelNum &&
      wantNum[1] === labelNum[1] &&
      (/gauge/.test(want) || /gauge/.test(label) || want === wantNum[1])
    ) {
      return true;
    }
    const wantLen = want.replace(/\s*in(ches)?\s*$/i, "").replace(/"$/, "");
    const labelLen = label.replace(/\s*in(ches)?\s*$/i, "").replace(/"$/, "");
    if (wantLen && labelLen && wantLen === labelLen) return true;
    if (label.includes(want) || want.includes(label)) {
      if (/\bgalvanized\b/.test(want) || /\bgalvanized\b/.test(label)) {
        return /\bgalvanized\b/.test(want) && /\bgalvanized\b/.test(label);
      }
      if (/\bgalvalume\b/.test(want) || /\bgalvalume\b/.test(label)) {
        return /\bgalvalume\b/.test(want) && /\bgalvalume\b/.test(label);
      }
      if (label.length > want.length + 12) return false;
      return true;
    }
    const wantCode = want.match(/^(\d{3,5})\b/);
    const labelCode = label.match(/^(\d{3,5})\b/);
    if (wantCode && labelCode && wantCode[1] === labelCode[1]) return true;
    return false;
  }

  function setSelectValue(select, value) {
    const desc = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    );
    if (desc && desc.set) desc.set.call(select, value);
    else select.value = value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fillSelect(select, wanted) {
    const options = [...select.options];
    const match = options.find((opt) => optionMatches(opt, wanted));
    if (!match) return false;
    if (select.value !== match.value) setSelectValue(select, match.value);
    return true;
  }

  function coerceDimension(value) {
    const trimmed = String(value).trim();
    const match = trimmed.match(/^([\d.]+)/);
    return match ? match[1] : trimmed;
  }

  function isDimensionKey(key) {
    const n = normalizeKey(key);
    return /^[la]\d+$/.test(n) || /^field_[123678]$/.test(n);
  }

  function fillControl(el, key, value) {
    if (el instanceof HTMLSelectElement) return false;
    if (el instanceof HTMLTextAreaElement) {
      if (normalizeMatch(el.value) === normalizeMatch(value)) return true;
      setNativeValue(el, value);
      return true;
    }
    if (!(el instanceof HTMLInputElement)) return false;
    if (el.type === "color") return false;
    if (el.type === "hidden" && !isCalculatorHidden(el)) return false;
    if (el.type === "radio" || el.type === "checkbox") return false;
    const next =
      el.type === "number" || isDimensionKey(key) ? coerceDimension(value) : value;
    if (normalizeMatch(el.value) === normalizeMatch(next)) return true;
    setNativeValue(el, next);
    return true;
  }

  function headingKeyFromText(text) {
    const n = normalizeMatch(text);
    if (!n || n.length > 40) return null;
    if (/^color picker\b|^colour picker\b/.test(n)) return "color";
    if (/^gauge\b/.test(n)) return "gauge";
    if (/^length\b/.test(n)) return "length";
    if (/^additional details\b/.test(n)) return "additional_details";
    const dim = n.match(/^(l|a)\s*(\d+)\b/);
    if (dim) return `${dim[1]}${dim[2]}`;
    if (/^color\b|^colour\b/.test(n)) return "color";
    return null;
  }

  const DROPDOWN_DATA_NAMES = {
    gauge: ["field_4", "gauge"],
    color: ["field_9", "color", "colour", "color_picker"],
    length: ["field_10", "length"],
  };

  function findCalculatorRoot() {
    let found = document.getElementById("calculator-form-container");
    if (found) return found;
    found = document.querySelector(".calculator-form-container, #calc-form-preview");
    if (found) return found;
    walkElements(document.documentElement, (el) => {
      if (found) return;
      if (
        el instanceof HTMLElement &&
        (el.id === "calculator-form-container" ||
          el.id === "calc-form-preview" ||
          (el.classList && el.classList.contains("calculator-form-container")))
      ) {
        found = el;
      }
    });
    return found;
  }

  function wrapperMatchesField(wrapper, fieldKey) {
    const dataName = normalizeKey(wrapper.getAttribute("data-name") || "");
    for (const name of DROPDOWN_DATA_NAMES[fieldKey] || []) {
      if (dataName === normalizeKey(name)) return true;
    }
    const label = wrapper.querySelector("label");
    const labelKey = headingKeyFromText(
      ownText(label) || (label ? (label.textContent || "").trim() : ""),
    );
    return labelKey === fieldKey;
  }

  function findSelectWrapper(root, fieldKey) {
    if (!root) return null;
    const wrappers = root.querySelectorAll(".calc-custom-select-wrapper");
    for (const wrapper of wrappers) {
      if (wrapperMatchesField(wrapper, fieldKey)) return wrapper;
    }
    return null;
  }

  function triggerShowsWanted(wrapper, wanted) {
    const textEl =
      wrapper.querySelector(".calc-color-option-trigger-text") ||
      wrapper.querySelector(".calc-custom-select-trigger-label");
    const text = (textEl && textEl.textContent) || "";
    return optionMatches({ textContent: text, value: "", label: text }, wanted);
  }

  function clickOpcOption(wrapper, wanted) {
    const options = wrapper.querySelectorAll(".calc-custom-select-option");
    for (const opt of options) {
      const label = opt.getAttribute("data-label") || "";
      const value = opt.getAttribute("data-value") || "";
      if (
        !optionMatches(
          { textContent: label, value, label },
          wanted,
        )
      ) {
        continue;
      }
      if (triggerShowsWanted(wrapper, wanted)) return true;
      opt.click();
      return triggerShowsWanted(wrapper, wanted);
    }
    return false;
  }

  function fillOpcDropdowns(root, fields, done) {
    if (!root) return;
    for (const fieldKey of ["gauge", "color", "length"]) {
      if (done[fieldKey]) continue;
      const wanted = valueForKey(fields, fieldKey);
      if (!wanted) {
        done[fieldKey] = true;
        continue;
      }
      const wrapper = findSelectWrapper(root, fieldKey);
      if (!wrapper) continue;
      if (triggerShowsWanted(wrapper, wanted) || clickOpcOption(wrapper, wanted)) {
        done[fieldKey] = true;
      }
    }
  }

  function fillNumberInputs(root, fields) {
    let filled = 0;
    for (const el of collectControls(root)) {
      if (isShopifyVariantControl(el)) continue;
      if (el instanceof HTMLSelectElement) continue;
      const nameKey = controlNameKey(el);
      const label = labelTextFor(el);
      const heading = headingKeyFromText(
        (el.labels && el.labels[0] ? ownText(el.labels[0]) : "") ||
          (label.split(/\s{2,}|\n/)[0] || ""),
      );
      const wanted =
        valueForKey(fields, nameKey) ||
        (heading ? valueForKey(fields, heading) : null) ||
        valueForKey(fields, label);
      if (!wanted) continue;
      if (fillControl(el, heading || nameKey || label, wanted)) filled += 1;
    }
    return filled;
  }

  function fillQuantity(qty) {
    if (qty == null || qty < 1) return false;
    const n = String(Math.round(qty));
    const inputs = document.querySelectorAll(
      'form[action*="/cart/add"] input[name="quantity"], input[name="quantity"]',
    );
    let filled = false;
    for (const el of inputs) {
      if (!(el instanceof HTMLInputElement)) continue;
      if (el.closest("[data-projectclad-custom-part]")) continue;
      setNativeValue(el, n);
      filled = true;
    }
    return filled;
  }

  function showToast() {
    if (document.querySelector("[data-projectclad-opc-prefill-toast]")) return;
    const toast = document.createElement("div");
    toast.setAttribute("data-projectclad-opc-prefill-toast", "");
    toast.setAttribute("role", "status");
    toast.textContent = "Calculator filled from your order. Tweaks save as a new line.";
    Object.assign(toast.style, {
      position: "fixed",
      left: "50%",
      bottom: "1.25rem",
      transform: "translateX(-50%)",
      zIndex: "9999",
      maxWidth: "min(32rem, calc(100vw - 2rem))",
      padding: "0.7rem 1rem",
      borderRadius: "8px",
      background: "#1a1a1a",
      color: "#f5f0e8",
      fontFamily: "Helvetica, Arial, sans-serif",
      fontSize: "0.9rem",
      lineHeight: "1.35",
      boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
    });
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), TOAST_MS);
  }

  const payload = readPayload();
  if (!payload) return;

  let userTouched = false;
  let toastShown = false;
  let successAt = 0;
  const started = Date.now();
  const fields = payload.fields || {};
  const done = { gauge: false, color: false, length: false };
  const needsDropdown = ["gauge", "color", "length"].some((key) =>
    Boolean(valueForKey(fields, key)),
  );

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (event.isTrusted) userTouched = true;
    },
    { capture: true },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.isTrusted) userTouched = true;
    },
    { capture: true },
  );

  const tick = () => {
    if (userTouched) return;
    const root = findCalculatorRoot() || document.documentElement;
    const filledInputs = fillNumberInputs(root, fields);
    fillOpcDropdowns(findCalculatorRoot(), fields, done);
    fillQuantity(payload.qty);

    const dropdownDone =
      done.gauge || done.color || done.length;
    if ((filledInputs > 0 || dropdownDone) && !toastShown) {
      toastShown = true;
      successAt = Date.now();
      showToast();
      stripPrefillFromUrl();
    }

    const elapsed = Date.now() - started;
    if (elapsed > MAX_WAIT_MS) return;
    const pending =
      needsDropdown &&
      ["gauge", "color", "length"].some(
        (key) => valueForKey(fields, key) && !done[key],
      );
    if (!pending && successAt && Date.now() - successAt > SETTLE_MS) {
      return;
    }
    window.setTimeout(tick, RETRY_MS);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tick, { once: true });
  } else {
    tick();
  }
})();
