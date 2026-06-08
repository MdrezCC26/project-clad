/*
 * Shared "Save to project" modal logic.
 *
 * Owns: modal open/close + body-scroll lock, animated role-select widgets,
 * mode/section toggling, project + jobs list fetching, duplicate-project
 * detection, and POST to /apps/project-clad/api/save-job.
 *
 * Mounted by both the cart block (project-clad-cart.js) and the product
 * block (project-clad-product-save.js). Each caller supplies the items to
 * save and decides what happens after a successful save (cart redirects,
 * product page shows a toast and stays put).
 *
 * Public API:
 *   window.ProjectCladSaveModal.init(root, options)
 *
 * options:
 *   getItems           : () => Promise<Item[]>           required
 *   modalIntent        : 'cart' | 'product'              default 'cart'
 *   triggerSelector    : string                          default '[data-projectclad-save]'
 *   requireCartItems   : boolean                         default false
 *                        Cart-only: when true the trigger is hidden when
 *                        the live cart is empty (re-checked on each click).
 *   refreshGuard       : () => Promise<boolean>          optional pre-open
 *                        gate. Return false to abort opening.
 *   onBeforeOpen       : () => boolean | void            optional sync
 *                        gate. Return false to abort opening.
 *   onSaved            : (info) => void                  optional. info =
 *                        { projectId, jobId, projectName?, jobName?,
 *                          clearCart, mode, payload, response, copied? }.
 *                        If not provided, default behavior redirects to
 *                        /apps/project-clad/project?id=… (current cart UX).
 *   prefillState       : SerializedState | null          optional. Restores
 *                        the modal's mode + form fields when the modal
 *                        opens (used after auth-return on product pages).
 *   onStateChange      : (SerializedState) => void       optional. Fires
 *                        whenever the modal's mode or fields change so the
 *                        caller can persist them across navigations.
 *
 * Returns a controller:
 *   { openModal, closeModal, getState, setState, refreshProjects,
 *     setTriggerVisible, destroy }
 */
(() => {
  if (window.ProjectCladSaveModal) return;

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

  function init(root, options) {
    if (!(root instanceof HTMLElement)) return null;
    const opts = options || {};
    const triggerSelector =
      opts.triggerSelector || "[data-projectclad-save]";
    const modalIntent = opts.modalIntent || "cart";
    const requireCartItems = !!opts.requireCartItems;

    const customerSignedIn =
      root.getAttribute("data-projectclad-customer-signed-in") === "true";
    const loginUrl = root.getAttribute("data-projectclad-login-url") || "";
    const projectsUrl =
      root.getAttribute("data-projectclad-projects-url") || "";
    const saveUrl = root.getAttribute("data-projectclad-save-url") || "";

    const trigger = root.querySelector(triggerSelector);
    const modal = root.querySelector("[data-projectclad-modal]");
    const modalContent = modal?.querySelector(".projectclad-modal__content");
    const closeButton = root.querySelector("[data-projectclad-close]");
    const form = root.querySelector("[data-projectclad-form]");
    const modeHidden = root.querySelector("input[data-projectclad-mode]");
    const duplicateModal = root.querySelector(
      "[data-projectclad-duplicate-modal]",
    );
    const duplicateYesBtn = root.querySelector(
      "[data-projectclad-duplicate-yes]",
    );
    const duplicateNoBtn = root.querySelector(
      "[data-projectclad-duplicate-no]",
    );
    const duplicateMergeBtn = root.querySelector(
      "[data-projectclad-duplicate-merge]",
    );
    const duplicateDismissBtn = root.querySelector(
      "[data-projectclad-duplicate-dismiss]",
    );

    if (
      !trigger ||
      !modal ||
      !form ||
      !(modeHidden instanceof HTMLInputElement)
    ) {
      return null;
    }

    const sections = Array.from(
      root.querySelectorAll("[data-projectclad-section]"),
    );
    const poNumberInputs = root.querySelectorAll("[data-projectclad-po]");
    const companyNameInputs = root.querySelectorAll(
      "[data-projectclad-company]",
    );
    const orderNumberInputs = root.querySelectorAll(
      "[data-projectclad-order-number]",
    );

    const getMode = () => modeHidden.value || "newProject";

    const getJobDeliveryModeRadioName = (mode) =>
      mode === "existingProject"
        ? "projectclad-job-delivery-mode-existing"
        : "projectclad-job-delivery-mode-new";

    const isJobDeliveryModeRadioName = (name) =>
      name === "projectclad-job-delivery-mode-new" ||
      name === "projectclad-job-delivery-mode-existing";

    const ensureDefaultJobDelivery = (mode) => {
      if (mode !== "newProject" && mode !== "existingProject") return;
      const inherit = root.querySelector(
        `[data-projectclad-section="${mode}"] input[name="${getJobDeliveryModeRadioName(mode)}"][value="inherit"]`,
      );
      if (inherit instanceof HTMLInputElement) {
        inherit.checked = true;
      }
    };

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

    const setTriggerVisible = (visible) => {
      if (!(trigger instanceof HTMLElement)) return;
      trigger.style.display = visible ? "" : "none";
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
            if (
              !(
                field instanceof HTMLInputElement ||
                field instanceof HTMLSelectElement ||
                field instanceof HTMLTextAreaElement
              )
            ) {
              return;
            }
            const shouldRequire =
              field.dataset.required === "true" && isActive;
            field.required = shouldRequire;
          });
      });
    };

    const shipFieldsComplete = (ship) =>
      Boolean(
        ship.shipAddress1 &&
          ship.shipCity &&
          ship.shipProvince &&
          ship.shipPostal,
      );

    const readShipFromContainer = (container) => {
      if (!(container instanceof HTMLElement)) {
        return {
          shipAddress1: "",
          shipCity: "",
          shipProvince: "",
          shipPostal: "",
          shipCountry: "Canada",
        };
      }
      const get = (name) => {
        const el = container.querySelector(`[name="${name}"]`);
        return el instanceof HTMLInputElement || el instanceof HTMLSelectElement
          ? String(el.value || "").trim()
          : "";
      };
      return {
        shipAddress1: get("projectShipAddress1") || get("jobShipAddress1"),
        shipCity: get("projectShipCity") || get("jobShipCity"),
        shipProvince: get("projectShipProvince") || get("jobShipProvince"),
        shipPostal: get("projectShipPostal") || get("jobShipPostal"),
        shipCountry: get("projectShipCountry") || get("jobShipCountry") || "Canada",
      };
    };

    const syncSaveDeliveryPanels = () => {
      const mode = getMode();
      const projectReceive = root.querySelector(
        'input[name="projectclad-project-receive-mode"]:checked',
      );
      const receiveVal =
        projectReceive instanceof HTMLInputElement
          ? projectReceive.value
          : "pickup";
      root
        .querySelectorAll("[data-projectclad-save-project-delivery-address]")
        .forEach((el) => {
          if (!(el instanceof HTMLElement)) return;
          const inNew =
            el.closest('[data-projectclad-section="newProject"]') &&
            mode === "newProject";
          el.hidden = !inNew || receiveVal !== "delivery";
        });

      let jobMode = "inherit";
      if (mode === "newProject" || mode === "existingProject") {
        const radioName = getJobDeliveryModeRadioName(mode);
        const jobDelivery = root.querySelector(
          `[data-projectclad-section="${mode}"] input[name="${radioName}"]:checked`,
        );
        jobMode =
          jobDelivery instanceof HTMLInputElement ? jobDelivery.value : "inherit";
      }
      root
        .querySelectorAll("[data-projectclad-save-order-delivery-address]")
        .forEach((el) => {
          if (!(el instanceof HTMLElement)) return;
          const section = el.closest("[data-projectclad-section]");
          if (!(section instanceof HTMLElement) || section.hidden) return;
          const sectionMode = section.getAttribute("data-projectclad-section");
          const showOrderBlock =
            (sectionMode === "newProject" || sectionMode === "existingProject") &&
            (mode === "newProject" || mode === "existingProject");
          el.hidden = !showOrderBlock || jobMode !== "delivery";
        });
    };

    const appendDeliveryToPayload = (payload, mode) => {
      if (mode === "newProject") {
        const receive = root.querySelector(
          'input[name="projectclad-project-receive-mode"]:checked',
        );
        payload.projectReceiveMode =
          receive instanceof HTMLInputElement && receive.value === "delivery"
            ? "delivery"
            : "pickup";
        const projAddr = root.querySelector(
          '[data-projectclad-section="newProject"] [data-projectclad-save-project-delivery-address]',
        );
        if (projAddr instanceof HTMLElement) {
          const ship = readShipFromContainer(projAddr);
          payload.projectShipAddress1 = ship.shipAddress1 || undefined;
          payload.projectShipCity = ship.shipCity || undefined;
          payload.projectShipProvince = ship.shipProvince || undefined;
          payload.projectShipPostal = ship.shipPostal || undefined;
          payload.projectShipCountry = ship.shipCountry || undefined;
        }
      }
      if (mode === "newProject" || mode === "existingProject") {
        const radioName = getJobDeliveryModeRadioName(mode);
        const jobModeInp = root.querySelector(
          `[data-projectclad-section="${mode}"] input[name="${radioName}"]:checked`,
        );
        payload.jobDeliveryMode =
          jobModeInp instanceof HTMLInputElement ? jobModeInp.value : "inherit";
        const orderAddr = root.querySelector(
          `[data-projectclad-section="${mode}"] [data-projectclad-save-order-delivery-address]`,
        );
        if (orderAddr instanceof HTMLElement) {
          const ship = readShipFromContainer(orderAddr);
          payload.jobShipAddress1 = ship.shipAddress1 || undefined;
          payload.jobShipCity = ship.shipCity || undefined;
          payload.jobShipProvince = ship.shipProvince || undefined;
          payload.jobShipPostal = ship.shipPostal || undefined;
          payload.jobShipCountry = ship.shipCountry || undefined;
        }
      }
    };

    const validateSaveDeliveryClient = (payload, mode) => {
      if (mode === "newProject") {
        if (payload.projectReceiveMode === "delivery") {
          const ship = {
            shipAddress1: payload.projectShipAddress1,
            shipCity: payload.projectShipCity,
            shipProvince: payload.projectShipProvince,
            shipPostal: payload.projectShipPostal,
          };
          if (!shipFieldsComplete(ship)) {
            return "Enter a complete delivery address for this project, or choose store pickup.";
          }
        }
      }
      if (mode === "newProject" || mode === "existingProject") {
        if (payload.jobDeliveryMode === "delivery") {
          const jobShip = {
            shipAddress1: payload.jobShipAddress1,
            shipCity: payload.jobShipCity,
            shipProvince: payload.jobShipProvince,
            shipPostal: payload.jobShipPostal,
          };
          if (!shipFieldsComplete(jobShip)) {
            if (mode === "newProject" && payload.projectReceiveMode === "delivery") {
              const projShip = {
                shipAddress1: payload.projectShipAddress1,
                shipCity: payload.projectShipCity,
                shipProvince: payload.projectShipProvince,
                shipPostal: payload.projectShipPostal,
              };
              if (shipFieldsComplete(projShip)) return null;
            }
            return "Enter a complete delivery address for this order, or choose store pickup.";
          }
        }
      }
      return null;
    };

    const toggleSection = (mode) => {
      sections.forEach((section) => {
        section.hidden =
          section.getAttribute("data-projectclad-section") !== mode;
      });
      updateFieldRequirements(mode);
      ensureDefaultJobDelivery(mode);
      syncSaveDeliveryPanels();
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
        const lid = `pc-proj-${radioName}-${id || "none"}`.replace(
          /[^a-zA-Z0-9_-]/g,
          "",
        );
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
      root
        .querySelectorAll("[data-projectclad-project-wrap]")
        .forEach((wrap) => {
          if (wrap instanceof HTMLElement) buildProjectRadioList(wrap);
        });
    };

    const setProjectDetails = (projectId) => {
      if (!projectId) return;
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
      const projectNameInput = root.querySelector(
        "[data-projectclad-project-name]",
      );
      const jobNameInputs = root.querySelectorAll(
        "[data-projectclad-job-name]",
      );
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
      const pickupReceive = root.querySelector(
        'input[name="projectclad-project-receive-mode"][value="pickup"]',
      );
      if (pickupReceive instanceof HTMLInputElement) {
        pickupReceive.checked = true;
      }
      ensureDefaultJobDelivery("newProject");
      ensureDefaultJobDelivery("existingProject");
      root
        .querySelectorAll(
          '[data-projectclad-save-ship-input], [name^="projectShip"], [name^="jobShip"]',
        )
        .forEach((el) => {
          if (
            el instanceof HTMLInputElement ||
            el instanceof HTMLSelectElement
          ) {
            el.value = "";
          }
        });
      const provinceDefaults = root.querySelectorAll(
        'select[name="projectShipProvince"], select[name="jobShipProvince"]',
      );
      provinceDefaults.forEach((sel) => {
        if (sel instanceof HTMLSelectElement) sel.value = "ON";
      });
      const countryDefaults = root.querySelectorAll(
        'select[name="projectShipCountry"], select[name="jobShipCountry"]',
      );
      countryDefaults.forEach((sel) => {
        if (sel instanceof HTMLSelectElement) sel.value = "Canada";
      });
      syncSaveDeliveryPanels();
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
      const modeWidget = root.querySelector(
        "[data-projectclad-save-mode-widget]",
      );
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
      const response = await fetch(projectsUrl, {
        credentials: "same-origin",
      });
      if (response.status === 401) {
        const payload = await response.json();
        if (payload?.redirectTo) {
          window.location.href = payload.redirectTo;
        }
        return;
      }
      const payload = await response.json();
      cachedProjects = payload.projects || [];
      /* Autofill the "Company name" field from the viewer's `company:<name>` Shopify
         customer tag when the inputs are still blank. Users can overwrite to still
         type their own company string. */
      const defaultCompany = (payload.viewerDefaultCompany || "").trim();
      if (defaultCompany) {
        companyNameInputs.forEach((el) => {
          if (el instanceof HTMLInputElement && !el.value.trim()) {
            el.value = defaultCompany;
          }
        });
      }
      fillProjectOptions();
    };

    const getUniqueProjectName = (baseName) => {
      const names = cachedProjects.map((p) => p.name);
      const baseLower = baseName.trim().toLowerCase();
      const exactMatch = names.some(
        (n) => n.trim().toLowerCase() === baseLower,
      );
      if (!exactMatch) return baseName;
      const regex = new RegExp(
        "^" +
          baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
          " \\((\\d+)\\)$",
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

    const findProjectName = (projectId) => {
      const p = cachedProjects.find((it) => it.id === projectId);
      return p?.name || "";
    };

    const findJobName = (projectId, jobId) => {
      const p = cachedProjects.find((it) => it.id === projectId);
      const j = p?.jobs?.find((it) => it.id === jobId);
      return j?.name || "";
    };

    const serializeState = () => {
      const projectNameInput = root.querySelector(
        "[data-projectclad-project-name]",
      );
      const jobNameInput = Array.from(
        root.querySelectorAll("[data-projectclad-job-name]"),
      ).find((el) => el instanceof HTMLInputElement && !el.closest("[hidden]"));
      const poInput = getVisibleInput("[data-projectclad-po]");
      const companyInput = getVisibleInput("[data-projectclad-company]");
      const orderNumberInput = Array.from(orderNumberInputs).find(
        (el) => el instanceof HTMLInputElement && !el.closest("[hidden]"),
      );
      const quantityModeInput = root.querySelector(
        'input[name="projectclad-quantity"]:checked',
      );
      return {
        mode: getMode(),
        projectName:
          projectNameInput instanceof HTMLInputElement
            ? projectNameInput.value
            : "",
        jobName:
          jobNameInput instanceof HTMLInputElement ? jobNameInput.value : "",
        poNumber: poInput instanceof HTMLInputElement ? poInput.value : "",
        companyName:
          companyInput instanceof HTMLInputElement ? companyInput.value : "",
        purchaseOrderNumber:
          orderNumberInput instanceof HTMLInputElement
            ? orderNumberInput.value
            : "",
        projectId: getVisibleProjectHidden()?.value || "",
        jobId: getJobHidden()?.value || "",
        quantityMode:
          quantityModeInput instanceof HTMLInputElement
            ? quantityModeInput.value
            : "add",
      };
    };

    let suppressStateChange = 0;
    const fireStateChange = () => {
      if (suppressStateChange) return;
      if (typeof opts.onStateChange === "function") {
        try {
          opts.onStateChange(serializeState());
        } catch {
          // ignore subscriber errors
        }
      }
    };

    const applyState = (state) => {
      if (!state || typeof state !== "object") return;
      suppressStateChange += 1;
      try {
        const mode = state.mode || "newProject";
        const radio = root.querySelector(
          `input[name="projectclad-save-mode"][value="${mode}"]`,
        );
        if (radio instanceof HTMLInputElement) radio.checked = true;
        modeHidden.value = mode;
        const modeWidget = root.querySelector(
          "[data-projectclad-save-mode-widget]",
        );
        if (modeWidget instanceof HTMLDetailsElement) syncRoleLabel(modeWidget);
        toggleSection(mode);

        // Apply project + job pickers BEFORE text fields, because
        // fillJobOptions() clears purchaseOrderNumber inputs as part of its
        // normal "user picked a different project" reset.
        if (state.projectId) {
          root
            .querySelectorAll("input[data-projectclad-project]")
            .forEach((h) => {
              if (h instanceof HTMLInputElement) h.value = state.projectId;
            });
          fillProjectOptions();
          // After fillProjectOptions(), the visible project picker's
          // selected radio reflects state.projectId (when present in
          // cachedProjects). Build job options for that project so a
          // restored jobId can be selected too.
          fillJobOptions(state.projectId);
          if (state.jobId) {
            const jh = root.querySelector("input[data-projectclad-job]");
            if (jh instanceof HTMLInputElement) jh.value = state.jobId;
            const list = root.querySelector(
              "[data-projectclad-job-options]",
            );
            const match = list?.querySelector(
              `input[type="radio"][value="${CSS.escape(state.jobId)}"]`,
            );
            if (match instanceof HTMLInputElement) match.checked = true;
            const det = root.querySelector("[data-projectclad-job-picker]");
            if (det instanceof HTMLDetailsElement) syncRoleLabel(det);
          }
        }

        const projectNameInput = root.querySelector(
          "[data-projectclad-project-name]",
        );
        if (projectNameInput instanceof HTMLInputElement) {
          projectNameInput.value = state.projectName || "";
        }
        root
          .querySelectorAll("[data-projectclad-job-name]")
          .forEach((el) => {
            if (el instanceof HTMLInputElement) el.value = state.jobName || "";
          });
        poNumberInputs.forEach((el) => {
          if (el instanceof HTMLInputElement) el.value = state.poNumber || "";
        });
        companyNameInputs.forEach((el) => {
          if (el instanceof HTMLInputElement)
            el.value = state.companyName || "";
        });
        orderNumberInputs.forEach((el) => {
          if (el instanceof HTMLInputElement)
            el.value = state.purchaseOrderNumber || "";
        });

        if (state.quantityMode) {
          const qm = root.querySelector(
            `input[name="projectclad-quantity"][value="${state.quantityMode}"]`,
          );
          if (qm instanceof HTMLInputElement) qm.checked = true;
        }
      } finally {
        suppressStateChange -= 1;
      }
    };

    let saveInFlight = false;
    let pendingDuplicate = null;

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
          // Surface the server's own error message when present (e.g.
          // "Select a project and order.") so the user knows exactly what
          // to fix. Fall back to a generic message if the response isn't
          // JSON / has no error field.
          let message = "Unable to save order. Please try again.";
          try {
            const data = await response.json();
            if (data?.error && typeof data.error === "string") {
              message = data.error;
            }
          } catch {
            /* non-JSON body — keep fallback */
          }
          alert(message);
          return;
        }

        const result = await response.json();
        const projectName =
          payload.mode === "newProject"
            ? payload.projectName || ""
            : findProjectName(result?.projectId || payload.projectId || "");
        const jobName =
          payload.jobName ||
          (payload.jobId
            ? findJobName(payload.projectId || result?.projectId, payload.jobId)
            : "");
        const info = {
          projectId: result?.projectId,
          jobId: result?.jobId,
          projectName,
          jobName,
          clearCart,
          mode: payload.mode,
          payload,
          response: result,
          copied: !!result?.copied,
        };
        if (typeof opts.onSaved === "function") {
          opts.onSaved(info);
          return;
        }
        // Default behavior matches the legacy cart UX (redirect to project).
        const redirectTo = info.projectId
          ? `/apps/project-clad/project?id=${info.projectId}`
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

    const closeDuplicateModal = () => {
      pendingDuplicate = null;
      if (duplicateModal instanceof HTMLElement) {
        closeProjectcladModal(duplicateModal, () => {});
      }
    };

    duplicateNoBtn?.addEventListener("click", closeDuplicateModal);
    duplicateDismissBtn?.addEventListener("click", closeDuplicateModal);

    duplicateModal?.addEventListener("pointerdown", (event) => {
      if (event.target === duplicateModal) closeDuplicateModal();
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

    const openModalFlow = async () => {
      if (typeof opts.onBeforeOpen === "function") {
        const ok = opts.onBeforeOpen();
        if (ok === false) return;
      }
      if (!customerSignedIn) {
        window.location.href = loginUrl || "/account/login";
        return;
      }
      if (typeof opts.refreshGuard === "function") {
        const allow = await opts.refreshGuard();
        if (allow === false) return;
      }
      // Cart-only: re-check cart state via the caller-provided guard already
      // handled above. Trigger may also be hidden via setTriggerVisible(false).
      if (
        requireCartItems &&
        trigger instanceof HTMLElement &&
        trigger.style.display === "none"
      ) {
        return;
      }
      markRequiredFields();
      lockBodyScroll();
      openProjectcladModal(modal);
      const openMode = getMode();
      ensureDefaultJobDelivery(openMode);
      toggleSection(openMode);
      syncSaveDeliveryPanels();
      if (opts.prefillState) {
        applyState(opts.prefillState);
      }
      await loadProjects();
      // After projects load, re-apply prefill so the project + job pickers
      // can find their saved selections.
      if (opts.prefillState) {
        applyState(opts.prefillState);
      }
      syncSaveDeliveryPanels();
    };

    trigger.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await openModalFlow();
    });

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
      if (
        t.name === "projectclad-project-receive-mode" ||
        isJobDeliveryModeRadioName(t.name)
      ) {
        syncSaveDeliveryPanels();
        fireStateChange();
        return;
      }
      if (t.name === "projectclad-save-mode") {
        modeHidden.value = t.value;
        toggleSection(t.value);
        const modeWidget = root.querySelector(
          "[data-projectclad-save-mode-widget]",
        );
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
          fireStateChange();
          return;
        }
        const ph = getVisibleProjectHidden();
        if (ph?.value) setProjectDetails(ph.value);
        fireStateChange();
        return;
      }
      if (
        t.name === "projectclad-project-existing" ||
        t.name === "projectclad-project-job"
      ) {
        const wrap = t.closest("[data-projectclad-project-wrap]");
        const hidden = wrap?.querySelector("input[data-projectclad-project]");
        const det = wrap?.querySelector("[data-projectclad-project-picker]");
        if (hidden instanceof HTMLInputElement) hidden.value = t.value;
        if (det instanceof HTMLDetailsElement) syncRoleLabel(det);
        fillJobOptions(t.value);
        setProjectDetails(t.value);
        fireStateChange();
        return;
      }
      if (t.name === "projectclad-job-pick") {
        const wrap = t.closest("[data-projectclad-job-wrap]");
        const hidden = wrap?.querySelector("input[data-projectclad-job]");
        const det = wrap?.querySelector("[data-projectclad-job-picker]");
        if (hidden instanceof HTMLInputElement) hidden.value = t.value;
        if (det instanceof HTMLDetailsElement) syncRoleLabel(det);
        syncPurchaseOrderFromSelectedJob();
        fireStateChange();
        return;
      }
      fireStateChange();
    });

    root.addEventListener("input", (event) => {
      const t = event.target;
      if (!(t instanceof HTMLInputElement)) return;
      const watched = [
        "data-projectclad-project-name",
        "data-projectclad-job-name",
        "data-projectclad-po",
        "data-projectclad-company",
        "data-projectclad-order-number",
      ];
      if (watched.some((attr) => t.hasAttribute(attr))) {
        fireStateChange();
      }
    });

    document.addEventListener(
      "pointerdown",
      (e) => {
        const t = e.target;
        if (!(t instanceof Node)) return;
        root
          .querySelectorAll(
            "details[data-projectclad-member-role-select][open]",
          )
          .forEach((d) => {
            if (!(d instanceof HTMLDetailsElement)) return;
            if (d.contains(t)) return;
            pcAnimateMemberRoleClose(d, () => {
              d.open = false;
            });
          });
      },
      true,
    );

    form.addEventListener("submit", async (event) => {
      const clearCart =
        modalIntent === "cart" &&
        !!event.submitter?.hasAttribute?.("data-projectclad-clear");
      event.preventDefault();
      if (typeof opts.refreshGuard === "function") {
        const allow = await opts.refreshGuard();
        if (allow === false) return;
      }
      if (
        requireCartItems &&
        trigger instanceof HTMLElement &&
        trigger.style.display === "none"
      ) {
        return;
      }

      const mode = getMode();
      const projectNameInput = root.querySelector(
        "[data-projectclad-project-name]",
      );
      const jobNameInputs = root.querySelectorAll(
        "[data-projectclad-job-name]",
      );
      const quantityModeInput = root.querySelector(
        'input[name="projectclad-quantity"]:checked',
      );

      const projectName =
        projectNameInput instanceof HTMLInputElement
          ? projectNameInput.value.trim()
          : "";
      const jobName = Array.from(jobNameInputs).find(
        (input) =>
          input instanceof HTMLInputElement && input.value.trim().length,
      );
      const poInput = getVisibleInput("[data-projectclad-po]");
      const companyInput = getVisibleInput("[data-projectclad-company]");
      const orderNumberInput = Array.from(orderNumberInputs).find(
        (input) =>
          input instanceof HTMLInputElement && input.value.trim().length,
      );
      const poNumber =
        poInput instanceof HTMLInputElement ? poInput.value.trim() : "";
      const companyName =
        companyInput instanceof HTMLInputElement
          ? companyInput.value.trim()
          : "";
      const orderNumber =
        orderNumberInput instanceof HTMLInputElement
          ? orderNumberInput.value.trim()
          : "";

      const selectedProject = getVisibleProjectHidden()?.value || "";
      const selectedJob = getJobHidden()?.value || "";

      let items;
      try {
        items = await opts.getItems();
      } catch (e) {
        console.error("[ProjectClad] getItems failed", e);
        alert("Unable to read items to save. Please try again.");
        return;
      }
      if (!Array.isArray(items) || items.length === 0) {
        alert("Nothing to save.");
        return;
      }

      const payload = {
        mode,
        poNumber: poNumber || undefined,
        companyName: companyName || undefined,
        projectName: projectName || undefined,
        jobName:
          jobName instanceof HTMLInputElement
            ? jobName.value.trim()
            : undefined,
        purchaseOrderNumber: orderNumber || undefined,
        projectId: selectedProject || undefined,
        jobId: selectedJob || undefined,
        quantityMode:
          quantityModeInput instanceof HTMLInputElement
            ? quantityModeInput.value
            : "add",
        items,
      };

      /*
       * Pre-submit validation. These rules mirror the server-side guards in
       * apps.project-clad.api.save-job.tsx but run client-side so the user
       * gets an immediate, specific message (the hidden inputs carrying
       * project/job IDs can't use native `required` — browsers skip type=hidden
       * during form validation).
       */
      const missing = [];
      if (mode === "newProject") {
        if (!projectName) missing.push("a project name");
        if (!payload.jobName) missing.push("an order name");
      } else if (mode === "existingProject") {
        if (!selectedProject) missing.push("a project");
        if (!payload.jobName) missing.push("an order name");
      } else if (mode === "existingJob") {
        if (!selectedProject) missing.push("a project");
        if (!selectedJob) missing.push("an order");
      }
      if (missing.length) {
        alert(`Please choose ${missing.join(" and ")}.`);
        return;
      }

      appendDeliveryToPayload(payload, mode);
      const deliveryErr = validateSaveDeliveryClient(payload, mode);
      if (deliveryErr) {
        alert(deliveryErr);
        return;
      }

      if (mode === "newProject" && projectName) {
        const normStr = (s) => (s || "").trim();
        const matchingProject = cachedProjects.find((p) => {
          const sameName =
            p.name.trim().toLowerCase() === projectName.trim().toLowerCase();
          const pPo = normStr(p.poNumber);
          const pCo = normStr(p.companyName);
          const samePoCompany =
            poNumber && companyName && pPo === poNumber && pCo === companyName;
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

    bindAnimatedMemberRoleSelectsIn(root);
    syncSaveDeliveryPanels();

    return {
      openModal: openModalFlow,
      closeModal: () =>
        closeProjectcladModal(modal, () => {
          unlockBodyScroll();
          resetModal();
        }),
      getState: serializeState,
      setState: applyState,
      refreshProjects: loadProjects,
      setTriggerVisible,
      resetModal,
    };
  }

  window.ProjectCladSaveModal = { init };
})();
