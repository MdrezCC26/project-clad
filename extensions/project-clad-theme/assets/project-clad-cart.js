(() => {
  const MODAL_MOTION_MS = 300;
  const PC_ROLE_PANEL_MS = 240;
  const PC_ROLE_PANEL_EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

  function prefersReducedMotion() {
    return (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function openProjectcladModal(modal) {
    if (!(modal instanceof HTMLElement)) return;
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    modal.classList.remove("projectclad-modal--open");
    if (prefersReducedMotion()) {
      modal.classList.add("projectclad-modal--open");
      return;
    }
    void modal.offsetWidth;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        modal.classList.add("projectclad-modal--open");
      });
    });
  }

  function closeProjectcladModal(modal, after) {
    if (!(modal instanceof HTMLElement)) return;
    const done = () => {
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
      modal.classList.remove("projectclad-modal--open");
      if (typeof after === "function") after();
    };
    if (!modal.classList.contains("projectclad-modal--open")) {
      done();
      return;
    }
    if (prefersReducedMotion()) {
      modal.classList.remove("projectclad-modal--open");
      done();
      return;
    }
    modal.classList.remove("projectclad-modal--open");
    window.setTimeout(done, MODAL_MOTION_MS);
  }

  function syncRoleLabel(details) {
    if (!(details instanceof HTMLDetailsElement)) return;
    const labelEl = details.querySelector("[data-role-label]");
    const checked = details.querySelector('input[type="radio"]:checked');
    const opt = checked?.closest(".project-clad-member-role-select__option");
    const textEl = opt?.querySelector(".project-clad-member-role-select__option-text");
    const text = (textEl?.textContent || "").trim();
    if (labelEl) labelEl.textContent = text || "—";
  }

  function pcMemberRolePanel(details) {
    return details.querySelector(".project-clad-member-role-select__panel");
  }

  function pcMemberRoleList(details) {
    return details.querySelector(".project-clad-member-role-select__list");
  }

  function pcAnimateMemberRoleOpen(details) {
    const panel = pcMemberRolePanel(details);
    const list = pcMemberRoleList(details);
    if (!panel || !list) return;
    const target = list.scrollHeight;
    panel.style.overflow = "hidden";
    panel.style.transition =
      "height " + PC_ROLE_PANEL_MS / 1000 + "s " + PC_ROLE_PANEL_EASE;
    panel.style.height = "0px";
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        panel.style.height = target + "px";
      });
    });
    function settle() {
      if (details.open) panel.style.height = "auto";
    }
    function onEnd(ev) {
      if (ev.propertyName !== "height") return;
      clearTimeout(tid);
      settle();
    }
    const tid = setTimeout(settle, PC_ROLE_PANEL_MS + 100);
    panel.addEventListener("transitionend", onEnd, { once: true });
  }

  function pcAnimateMemberRoleClose(details, done) {
    const panel = pcMemberRolePanel(details);
    const list = pcMemberRoleList(details);
    if (!panel || !list) {
      done();
      return;
    }
    const h = list.scrollHeight;
    panel.style.overflow = "hidden";
    panel.style.transition =
      "height " + PC_ROLE_PANEL_MS / 1000 + "s " + PC_ROLE_PANEL_EASE;
    if (panel.style.height === "auto" || panel.style.height === "") {
      panel.style.height = h + "px";
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        panel.style.height = "0px";
      });
    });
    let finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      panel.removeEventListener("transitionend", onEnd);
      clearTimeout(tid);
      panel.style.transition = "";
      panel.style.height = "";
      done();
    }
    function onEnd(ev) {
      if (ev.propertyName !== "height") return;
      finish();
    }
    panel.addEventListener("transitionend", onEnd);
    const tid = setTimeout(finish, PC_ROLE_PANEL_MS + 100);
  }

  function pcBindMemberRoleSelect(details) {
    const sum = details.querySelector("summary.project-clad-member-role-select__trigger");
    if (!(sum instanceof HTMLElement)) return;
    sum.addEventListener("click", (e) => {
      e.preventDefault();
      if (details.open) {
        pcAnimateMemberRoleClose(details, () => {
          details.open = false;
        });
      } else {
        const p = pcMemberRolePanel(details);
        if (p) {
          p.style.transition = "none";
          p.style.height = "0px";
        }
        details.open = true;
        if (p) {
          void p.offsetHeight;
          p.style.transition = "";
        }
        pcAnimateMemberRoleOpen(details);
      }
    });
  }

  function bindAnimatedMemberRoleSelectsIn(host) {
    if (!(host instanceof HTMLElement)) return;
    host.querySelectorAll("[data-projectclad-member-role-select]").forEach((el) => {
      if (!(el instanceof HTMLDetailsElement)) return;
      if (el.dataset.projectcladRoleBind === "1") return;
      el.dataset.projectcladRoleBind = "1";
      syncRoleLabel(el);
      pcBindMemberRoleSelect(el);
      el.addEventListener("change", (ev) => {
        const t = ev.target;
        if (!(t instanceof HTMLInputElement) || t.type !== "radio") return;
        if (!el.contains(t)) return;
        syncRoleLabel(el);
        if (el.hasAttribute("data-projectclad-save-mode-widget")) return;
        if (el.open) {
          pcAnimateMemberRoleClose(el, () => {
            el.open = false;
          });
        } else {
          el.open = false;
        }
      });
    });
  }

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

    const closeFulfill = () => {
      closeProjectcladModal(modal, () => {
        pendingCheckout = null;
        if (document.body.style.overflow === "hidden") {
          document.body.style.overflow = "";
        }
      });
    };

    const openFulfill = (intent) => {
      pendingCheckout = intent;
      document.body.style.overflow = "hidden";
      openProjectcladModal(modal);
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

  const root = document.querySelector("[data-projectclad]");
  if (!root) return;

  const loginUrl = root.getAttribute("data-projectclad-login-url") || "";
  const projectsUrl = root.getAttribute("data-projectclad-projects-url") || "";
  const saveUrl = root.getAttribute("data-projectclad-save-url") || "";
  const viewProjectsUrl =
    root.getAttribute("data-projectclad-view-projects-url") || "";

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

  const saveButton = root.querySelector("[data-projectclad-save]");
  const viewProjectsLink = root.querySelector("[data-projectclad-view-projects]");
  const modal = root.querySelector("[data-projectclad-modal]");
  const modalContent = modal?.querySelector(".projectclad-modal__content");
  const closeButton = root.querySelector("[data-projectclad-close]");
  const form = root.querySelector("[data-projectclad-form]");
  const modeHidden = root.querySelector("input[data-projectclad-mode]");
  const duplicateModal = root.querySelector("[data-projectclad-duplicate-modal]");
  const duplicateYesBtn = root.querySelector("[data-projectclad-duplicate-yes]");
  const duplicateNoBtn = root.querySelector("[data-projectclad-duplicate-no]");
  const duplicateMergeBtn = root.querySelector("[data-projectclad-duplicate-merge]");
  const duplicateDismissBtn = root.querySelector("[data-projectclad-duplicate-dismiss]");

  const sections = Array.from(
    root.querySelectorAll("[data-projectclad-section]"),
  );
  const poNumberInputs = root.querySelectorAll("[data-projectclad-po]");
  const companyNameInputs = root.querySelectorAll("[data-projectclad-company]");
  const orderNumberInputs = root.querySelectorAll(
    "[data-projectclad-order-number]",
  );

  if (!saveButton || !modal || !form || !(modeHidden instanceof HTMLInputElement)) {
    return;
  }

  const getMode = () => modeHidden.value || "newProject";

  const getVisibleProjectHidden = () => {
    const wraps = root.querySelectorAll("[data-projectclad-project-wrap]");
    for (const wrap of wraps) {
      if (!(wrap instanceof HTMLElement)) continue;
      if (wrap.closest("[hidden]")) continue;
      const h = wrap.querySelector("input[data-projectclad-project]");
      if (h instanceof HTMLInputElement) return h;
    }
    return null;
  };

  const getJobHidden = () => {
    const wrap = root.querySelector("[data-projectclad-job-wrap]");
    if (!(wrap instanceof HTMLElement) || wrap.closest("[hidden]")) return null;
    const h = wrap.querySelector("input[data-projectclad-job]");
    return h instanceof HTMLInputElement ? h : null;
  };

  let cachedProjects = [];
  let cartRefreshTimer;
  let scrollY = 0;
  const handleTouchMove = (event) => {
    if (!modalContent) return;
    if (!modalContent.contains(event.target)) {
      event.preventDefault();
    }
  };

  const lockBodyScroll = () => {
    scrollY = window.scrollY || 0;
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    modal.addEventListener("touchmove", handleTouchMove, { passive: false });
  };

  const unlockBodyScroll = () => {
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    window.scrollTo(0, scrollY);
    modal.removeEventListener("touchmove", handleTouchMove);
  };

  const setSaveVisibility = (count) => {
    if (!saveButton) return;
    saveButton.style.display = count > 0 ? "" : "none";
  };

  const refreshCartState = async () => {
    try {
      const response = await fetch("/cart.js", { credentials: "same-origin" });
      if (!response.ok) return;
      const cart = await response.json();
      setSaveVisibility(Number(cart.item_count || 0));
    } catch {
      // ignore cart fetch errors
    }
  };

  const getVisibleInput = (selector) => {
    const all = Array.from(root.querySelectorAll(selector));
    const visible = all.find((el) => !el.closest("[hidden]"));
    return visible instanceof HTMLInputElement ? visible : null;
  };

  const markRequiredFields = () => {
    root.querySelectorAll("[required]").forEach((field) => {
      if (field instanceof HTMLElement) {
        field.dataset.required = "true";
      }
    });
  };

  const updateFieldRequirements = (mode) => {
    sections.forEach((section) => {
      const isActive =
        section.getAttribute("data-projectclad-section") === mode;
      section
        .querySelectorAll("input, select, textarea")
        .forEach((field) => {
          if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) {
            return;
          }
          const shouldRequire = field.dataset.required === "true" && isActive;
          field.required = shouldRequire;
        });
    });
  };

  const toggleSection = (mode) => {
    sections.forEach((section) => {
      section.hidden = section.getAttribute("data-projectclad-section") !== mode;
    });
    updateFieldRequirements(mode);
  };

  const buildProjectRadioList = (wrap) => {
    const list = wrap.querySelector("[data-projectclad-project-options]");
    const hidden = wrap.querySelector("input[data-projectclad-project]");
    const details = wrap.querySelector("[data-projectclad-project-picker]");
    if (
      !(list instanceof HTMLElement) ||
      !(hidden instanceof HTMLInputElement) ||
      !(details instanceof HTMLDetailsElement)
    ) {
      return;
    }
    const radioName =
      wrap.getAttribute("data-projectclad-project-radio-name") ||
      "projectclad-project-existing";
    const prev = hidden.value;
    list.innerHTML = "";
    const addOpt = (id, label) => {
      const lid = `pc-proj-${radioName}-${id || "none"}`.replace(/[^a-zA-Z0-9_-]/g, "");
      const lab = document.createElement("label");
      lab.className = "project-clad-member-role-select__option";
      lab.setAttribute("for", lid);
      const inp = document.createElement("input");
      inp.type = "radio";
      inp.name = radioName;
      inp.value = id;
      inp.className = "project-clad-member-role-select__input";
      inp.id = lid;
      const span = document.createElement("span");
      span.className = "project-clad-member-role-select__option-text";
      span.textContent = label;
      lab.appendChild(inp);
      lab.appendChild(span);
      list.appendChild(lab);
    };
    addOpt("", "Select project");
    cachedProjects.forEach((project) => {
      addOpt(project.id, project.name);
    });
    let matched = false;
    if (prev) {
      for (const input of list.querySelectorAll('input[type="radio"]')) {
        if (input instanceof HTMLInputElement && input.value === prev) {
          input.checked = true;
          hidden.value = prev;
          matched = true;
          break;
        }
      }
    }
    if (!matched) {
      const ph = list.querySelector('input[type="radio"][value=""]');
      if (ph instanceof HTMLInputElement) ph.checked = true;
      hidden.value = "";
    }
    syncRoleLabel(details);
  };

  const fillProjectOptions = () => {
    root.querySelectorAll("[data-projectclad-project-wrap]").forEach((wrap) => {
      if (wrap instanceof HTMLElement) buildProjectRadioList(wrap);
    });
  };

  const setProjectDetails = (projectId) => {
    if (!projectId) {
      return;
    }
    const project = cachedProjects.find((item) => item.id === projectId);
    if (!project) return;
    const poInput = getVisibleInput("[data-projectclad-po]");
    const companyInput = getVisibleInput("[data-projectclad-company]");
    if (poInput) poInput.value = project.poNumber || "";
    if (companyInput) companyInput.value = project.companyName || "";
  };

  const fillJobOptions = (projectId) => {
    const wrap = root.querySelector("[data-projectclad-job-wrap]");
    const list = wrap?.querySelector("[data-projectclad-job-options]");
    const hidden = wrap?.querySelector("input[data-projectclad-job]");
    const details = wrap?.querySelector("[data-projectclad-job-picker]");
    if (
      !(list instanceof HTMLElement) ||
      !(hidden instanceof HTMLInputElement) ||
      !(details instanceof HTMLDetailsElement)
    ) {
      return;
    }
    const prev = hidden.value;
    list.innerHTML = "";
    const addJob = (id, label) => {
      const lid = `pc-job-${id || "none"}`.replace(/[^a-zA-Z0-9_-]/g, "");
      const lab = document.createElement("label");
      lab.className = "project-clad-member-role-select__option";
      lab.setAttribute("for", lid);
      const inp = document.createElement("input");
      inp.type = "radio";
      inp.name = "projectclad-job-pick";
      inp.value = id;
      inp.className = "project-clad-member-role-select__input";
      inp.id = lid;
      const span = document.createElement("span");
      span.className = "project-clad-member-role-select__option-text";
      span.textContent = label;
      lab.appendChild(inp);
      lab.appendChild(span);
      list.appendChild(lab);
    };
    addJob("", "Select order");
    const project = cachedProjects.find((item) => item.id === projectId);
    if (!project) {
      hidden.value = "";
      const ph = list.querySelector('input[type="radio"][value=""]');
      if (ph instanceof HTMLInputElement) ph.checked = true;
      syncRoleLabel(details);
      orderNumberInputs.forEach((input) => {
        if (input instanceof HTMLInputElement) input.value = "";
      });
      return;
    }
    project.jobs.forEach((job) => {
      addJob(job.id, job.name + (job.isLocked ? " (Locked)" : ""));
    });
    let matched = false;
    if (prev) {
      for (const input of list.querySelectorAll('input[type="radio"]')) {
        if (input instanceof HTMLInputElement && input.value === prev) {
          input.checked = true;
          hidden.value = prev;
          matched = true;
          break;
        }
      }
    }
    if (!matched) {
      const ph = list.querySelector('input[type="radio"][value=""]');
      if (ph instanceof HTMLInputElement) ph.checked = true;
      hidden.value = "";
    }
    syncRoleLabel(details);
    orderNumberInputs.forEach((input) => {
      if (input instanceof HTMLInputElement) input.value = "";
    });
  };

  const syncPurchaseOrderFromSelectedJob = () => {
    const jh = getJobHidden();
    if (!jh?.value) return;
    const activeProject = getVisibleProjectHidden()?.value || "";
    if (!activeProject) return;
    const project = cachedProjects.find((p) => p.id === activeProject);
    const job = project?.jobs.find((j) => j.id === jh.value);
    if (!job) return;
    const po = (job.purchaseOrderNumber || "").trim();
    orderNumberInputs.forEach((input) => {
      if (input instanceof HTMLInputElement) input.value = po;
    });
  };

  const resetModal = () => {
    poNumberInputs.forEach((input) => {
      if (input instanceof HTMLInputElement) input.value = "";
    });
    companyNameInputs.forEach((input) => {
      if (input instanceof HTMLInputElement) input.value = "";
    });
    const projectNameInput = root.querySelector("[data-projectclad-project-name]");
    const jobNameInputs = root.querySelectorAll("[data-projectclad-job-name]");
    if (projectNameInput instanceof HTMLInputElement) {
      projectNameInput.value = "";
    }
    jobNameInputs.forEach((input) => {
      if (input instanceof HTMLInputElement) {
        input.value = "";
      }
    });
    orderNumberInputs.forEach((input) => {
      if (input instanceof HTMLInputElement) {
        input.value = "";
      }
    });
    root.querySelectorAll("input[data-projectclad-project]").forEach((h) => {
      if (h instanceof HTMLInputElement) h.value = "";
    });
    const jh = root.querySelector("input[data-projectclad-job]");
    if (jh instanceof HTMLInputElement) jh.value = "";
    fillProjectOptions();
    fillJobOptions("");
    const modeNew = root.querySelector(
      'input[name="projectclad-save-mode"][value="newProject"]',
    );
    if (modeNew instanceof HTMLInputElement) modeNew.checked = true;
    modeHidden.value = "newProject";
    const modeWidget = root.querySelector("[data-projectclad-save-mode-widget]");
    if (modeWidget instanceof HTMLDetailsElement) syncRoleLabel(modeWidget);
    const quantityAdd = root.querySelector(
      'input[name="projectclad-quantity"][value="add"]',
    );
    if (quantityAdd instanceof HTMLInputElement) {
      quantityAdd.checked = true;
    }
    toggleSection(getMode());
  };

  const loadProjects = async () => {
    if (!projectsUrl) return;
    const response = await fetch(projectsUrl, { credentials: "same-origin" });
    if (response.status === 401) {
      const payload = await response.json();
      if (payload?.redirectTo) {
        window.location.href = payload.redirectTo;
      }
      return;
    }
    const payload = await response.json();
    cachedProjects = payload.projects || [];
    fillProjectOptions();
  };

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
              typeof value === "string"
                ? value
                : JSON.stringify(value),
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

  saveButton.addEventListener("click", async () => {
    if (!loginUrl || loginUrl.includes("/account/login")) {
      window.location.href = loginUrl;
      return;
    }
    await refreshCartState();
    if (saveButton.style.display === "none") {
      return;
    }
    markRequiredFields();
    lockBodyScroll();
    openProjectcladModal(modal);
    toggleSection(getMode());
    await loadProjects();
  });

  if (viewProjectsLink && viewProjectsUrl) {
    const navigateToProjects = (event) => {
      event.preventDefault();
      window.location.href = viewProjectsUrl;
    };
    viewProjectsLink.addEventListener("click", navigateToProjects);
    document.addEventListener("click", (event) => {
      if (
        event.target instanceof Element &&
        (event.target === viewProjectsLink ||
          viewProjectsLink.contains(event.target))
      ) {
        navigateToProjects(event);
      }
    }, true);
  }

  closeButton?.addEventListener("click", () => {
    closeProjectcladModal(modal, () => {
      unlockBodyScroll();
      resetModal();
    });
  });

  modal.addEventListener("pointerdown", (event) => {
    if (event.target === modal) {
      closeProjectcladModal(modal, () => {
        unlockBodyScroll();
        resetModal();
      });
    }
  });

  modalContent?.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });

  root.addEventListener("change", (event) => {
    const t = event.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (t.name === "projectclad-save-mode") {
      modeHidden.value = t.value;
      toggleSection(t.value);
      const modeWidget = root.querySelector("[data-projectclad-save-mode-widget]");
      if (modeWidget instanceof HTMLDetailsElement && modeWidget.open) {
        pcAnimateMemberRoleClose(modeWidget, () => {
          modeWidget.open = false;
        });
      }
      if (t.value === "newProject") {
        const poInput = getVisibleInput("[data-projectclad-po]");
        const companyInput = getVisibleInput("[data-projectclad-company]");
        if (poInput) poInput.value = "";
        if (companyInput) companyInput.value = "";
        return;
      }
      const ph = getVisibleProjectHidden();
      if (ph?.value) setProjectDetails(ph.value);
      return;
    }
    if (t.name === "projectclad-project-existing" || t.name === "projectclad-project-job") {
      const wrap = t.closest("[data-projectclad-project-wrap]");
      const hidden = wrap?.querySelector("input[data-projectclad-project]");
      const det = wrap?.querySelector("[data-projectclad-project-picker]");
      if (hidden instanceof HTMLInputElement) hidden.value = t.value;
      if (det instanceof HTMLDetailsElement) syncRoleLabel(det);
      fillJobOptions(t.value);
      setProjectDetails(t.value);
      return;
    }
    if (t.name === "projectclad-job-pick") {
      const wrap = t.closest("[data-projectclad-job-wrap]");
      const hidden = wrap?.querySelector("input[data-projectclad-job]");
      const det = wrap?.querySelector("[data-projectclad-job-picker]");
      if (hidden instanceof HTMLInputElement) hidden.value = t.value;
      if (det instanceof HTMLDetailsElement) syncRoleLabel(det);
      syncPurchaseOrderFromSelectedJob();
    }
  });

  document.addEventListener(
    "pointerdown",
    (e) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      root.querySelectorAll("details[data-projectclad-member-role-select][open]").forEach((d) => {
        if (!(d instanceof HTMLDetailsElement)) return;
        if (d.contains(t)) return;
        pcAnimateMemberRoleClose(d, () => {
          d.open = false;
        });
      });
    },
    true,
  );

  const getUniqueProjectName = (baseName) => {
    const names = cachedProjects.map((p) => p.name);
    const baseLower = baseName.trim().toLowerCase();
    const exactMatch = names.some(
      (n) => n.trim().toLowerCase() === baseLower,
    );
    if (!exactMatch) return baseName;
    const regex = new RegExp(
      "^" + baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\((\\d+)\\)$",
      "i",
    );
    let maxN = 0;
    names.forEach((n) => {
      const m = n.trim().match(regex);
      if (m) {
        const num = parseInt(m[1], 10);
        if (num > maxN) maxN = num;
      }
    });
    return baseName.trim() + " (" + (maxN + 1) + ")";
  };

  let saveInFlight = false;

  const performSave = async (payload, clearCart) => {
    if (saveInFlight) return;
    saveInFlight = true;
    try {
      const response = await fetch(saveUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });

      if (response.status === 401) {
        const data = await response.json();
        if (data?.redirectTo) {
          window.location.href = data.redirectTo;
        }
        return;
      }

      if (!response.ok) {
        alert("Unable to save order. Please try again.");
        return;
      }

      const result = await response.json();
      const redirectTo = result?.projectId
        ? `/apps/project-clad/project?id=${result.projectId}`
        : "/apps/project-clad/projects";
      if (clearCart) {
        const clearForm = document.createElement("form");
        clearForm.method = "post";
        clearForm.action = "/cart/clear";
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = "return_to";
        input.value = redirectTo;
        clearForm.appendChild(input);
        document.body.appendChild(clearForm);
        clearForm.submit();
      } else {
        window.location.href = redirectTo;
      }
    } finally {
      saveInFlight = false;
    }
  };

  let pendingDuplicate = null;

  const closeDuplicateModal = () => {
    pendingDuplicate = null;
    if (duplicateModal instanceof HTMLElement) {
      closeProjectcladModal(duplicateModal, () => {});
    }
  };

  duplicateNoBtn?.addEventListener("click", closeDuplicateModal);
  duplicateDismissBtn?.addEventListener("click", closeDuplicateModal);

  duplicateModal?.addEventListener("pointerdown", (event) => {
    if (event.target === duplicateModal) {
      closeDuplicateModal();
    }
  });

  duplicateYesBtn?.addEventListener("click", async () => {
    if (!pendingDuplicate) return;
    const { payload, clearCart } = pendingDuplicate;
    closeDuplicateModal();
    payload.projectName = getUniqueProjectName(payload.projectName);
    await performSave(payload, clearCart);
  });

  duplicateMergeBtn?.addEventListener("click", async () => {
    if (!pendingDuplicate) return;
    const { payload, clearCart, matchingProject } = pendingDuplicate;
    closeDuplicateModal();
    const mergePayload = {
      mode: "existingProject",
      poNumber: payload.poNumber,
      companyName: payload.companyName,
      projectId: matchingProject.id,
      jobName: payload.jobName,
      purchaseOrderNumber: payload.purchaseOrderNumber,
      quantityMode: payload.quantityMode || "add",
      items: payload.items,
    };
    await performSave(mergePayload, clearCart);
  });

  form.addEventListener("submit", async (event) => {
    const clearCart = !!event.submitter?.hasAttribute?.("data-projectclad-clear");
    event.preventDefault();
    await refreshCartState();
    if (saveButton.style.display === "none") {
      return;
    }

    const mode = getMode();
    const projectNameInput = root.querySelector("[data-projectclad-project-name]");
    const jobNameInputs = root.querySelectorAll("[data-projectclad-job-name]");
    const quantityModeInput = root.querySelector(
      'input[name="projectclad-quantity"]:checked',
    );

    const projectName =
      projectNameInput instanceof HTMLInputElement
        ? projectNameInput.value.trim()
        : "";
    const jobName = Array.from(jobNameInputs).find(
      (input) => input instanceof HTMLInputElement && input.value.trim().length,
    );
    const poInput = getVisibleInput("[data-projectclad-po]");
    const companyInput = getVisibleInput("[data-projectclad-company]");
    const orderNumberInput = Array.from(orderNumberInputs).find(
      (input) => input instanceof HTMLInputElement && input.value.trim().length,
    );
    const poNumber = poInput instanceof HTMLInputElement ? poInput.value.trim() : "";
    const companyName =
      companyInput instanceof HTMLInputElement ? companyInput.value.trim() : "";
    const orderNumber =
      orderNumberInput instanceof HTMLInputElement
        ? orderNumberInput.value.trim()
        : "";

    const selectedProject = getVisibleProjectHidden()?.value || "";

    const selectedJob = getJobHidden()?.value || "";

    const payload = {
      mode,
      poNumber: poNumber || undefined,
      companyName: companyName || undefined,
      projectName: projectName || undefined,
      jobName:
        jobName instanceof HTMLInputElement ? jobName.value.trim() : undefined,
      purchaseOrderNumber: orderNumber || undefined,
      projectId: selectedProject || undefined,
      jobId: selectedJob || undefined,
      quantityMode:
        quantityModeInput instanceof HTMLInputElement
          ? quantityModeInput.value
          : "add",
      items: await getCartItems(),
    };

    if (mode === "newProject" && projectName) {
      const normStr = (s) => (s || "").trim();
      const matchingProject = cachedProjects.find((p) => {
        const sameName =
          p.name.trim().toLowerCase() === projectName.trim().toLowerCase();
        const pPo = normStr(p.poNumber);
        const pCo = normStr(p.companyName);
        const samePoCompany =
          poNumber &&
          companyName &&
          pPo === poNumber &&
          pCo === companyName;
        return sameName || samePoCompany;
      });
      if (matchingProject) {
        pendingDuplicate = { payload, clearCart, matchingProject };
        if (duplicateModal instanceof HTMLElement) {
          openProjectcladModal(duplicateModal);
        }
        return;
      }
    }

    await performSave(payload, clearCart);
  });

  document.addEventListener("change", () => {
    clearTimeout(cartRefreshTimer);
    cartRefreshTimer = setTimeout(refreshCartState, 250);
  });

  document.addEventListener("submit", () => {
    clearTimeout(cartRefreshTimer);
    cartRefreshTimer = setTimeout(refreshCartState, 500);
  });

  bindAnimatedMemberRoleSelectsIn(root);
  refreshCartState();
})();
