(() => {
  const root = document.querySelector("[data-projectclad]");
  if (!root) return;

  const loginUrl = root.getAttribute("data-projectclad-login-url") || "";
  const projectsUrl = root.getAttribute("data-projectclad-projects-url") || "";
  const saveUrl = root.getAttribute("data-projectclad-save-url") || "";
  const viewProjectsUrl =
    root.getAttribute("data-projectclad-view-projects-url") || "";

  const saveButton = root.querySelector("[data-projectclad-save]");
  const viewProjectsLink = root.querySelector("[data-projectclad-view-projects]");
  const modal = root.querySelector("[data-projectclad-modal]");
  const modalContent = root.querySelector(".projectclad-modal__content");
  const closeButton = root.querySelector("[data-projectclad-close]");
  const form = root.querySelector("[data-projectclad-form]");
  const modeSelect = root.querySelector("[data-projectclad-mode]");
  const duplicateModal = root.querySelector("[data-projectclad-duplicate-modal]");
  const duplicateYesBtn = root.querySelector("[data-projectclad-duplicate-yes]");
  const duplicateNoBtn = root.querySelector("[data-projectclad-duplicate-no]");
  const duplicateMergeBtn = root.querySelector("[data-projectclad-duplicate-merge]");

  const sections = Array.from(
    root.querySelectorAll("[data-projectclad-section]"),
  );
  const projectSelects = Array.from(
    root.querySelectorAll("[data-projectclad-project]"),
  );
  const jobSelect = root.querySelector("[data-projectclad-job]");
  const poNumberInput = root.querySelector("[data-projectclad-po]");
  const companyNameInput = root.querySelector("[data-projectclad-company]");

  if (!saveButton || !modal || !form || !modeSelect) return;

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
          field.disabled = !isActive;
        });
    });
  };

  const toggleSection = (mode) => {
    sections.forEach((section) => {
      section.hidden = section.getAttribute("data-projectclad-section") !== mode;
    });
    updateFieldRequirements(mode);
  };

  const fillProjectOptions = () => {
    projectSelects.forEach((select) => {
      select.innerHTML = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select project";
      select.appendChild(placeholder);
      cachedProjects.forEach((project) => {
        const option = document.createElement("option");
        option.value = project.id;
        option.textContent = project.name;
        select.appendChild(option);
      });
    });
  };

  const setProjectDetails = (projectId) => {
    if (
      !projectId ||
      !poNumberInput ||
      !(poNumberInput instanceof HTMLInputElement)
    ) {
      return;
    }
    const project = cachedProjects.find((item) => item.id === projectId);
    if (!project) return;
    poNumberInput.value = project.poNumber || "";
    if (companyNameInput instanceof HTMLInputElement) {
      companyNameInput.value = project.companyName || "";
    }
  };

  const fillJobOptions = (projectId) => {
    if (!jobSelect) return;
    jobSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select order";
    jobSelect.appendChild(placeholder);
    const project = cachedProjects.find((item) => item.id === projectId);
    if (!project) return;
    project.jobs.forEach((job) => {
      const option = document.createElement("option");
      option.value = job.id;
      option.textContent = job.name + (job.isLocked ? " (Locked)" : "");
      jobSelect.appendChild(option);
    });
  };

  const resetModal = () => {
    if (poNumberInput instanceof HTMLInputElement) {
      poNumberInput.value = "";
    }
    if (companyNameInput instanceof HTMLInputElement) {
      companyNameInput.value = "";
    }
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
    projectSelects.forEach((select) => {
      select.value = "";
    });
    if (jobSelect instanceof HTMLSelectElement) {
      jobSelect.value = "";
    }
    const quantityAdd = root.querySelector(
      'input[name="projectclad-quantity"][value="add"]',
    );
    if (quantityAdd instanceof HTMLInputElement) {
      quantityAdd.checked = true;
    }
    toggleSection(modeSelect.value);
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

      return {
        variantId: String(item.id),
        quantity: Number(item.quantity),
        priceSnapshot: Number(item.price) / 100,
        properties,
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
    modal.hidden = false;
    lockBodyScroll();
    toggleSection(modeSelect.value);
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
    modal.hidden = true;
    unlockBodyScroll();
    resetModal();
  });

  modal.addEventListener("pointerdown", (event) => {
    if (event.target === modal) {
      modal.hidden = true;
      unlockBodyScroll();
      resetModal();
    }
  });

  modalContent?.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });

  modeSelect.addEventListener("change", () => {
    toggleSection(modeSelect.value);
    if (modeSelect.value === "newProject") {
      if (poNumberInput instanceof HTMLInputElement) {
        poNumberInput.value = "";
      }
      if (companyNameInput instanceof HTMLInputElement) {
        companyNameInput.value = "";
      }
      return;
    }
    const activeProject =
      projectSelects.find(
        (select) => !select.closest("[hidden]") && select.value,
      )?.value || "";
    if (activeProject) {
      setProjectDetails(activeProject);
    }
  });

  projectSelects.forEach((select) => {
    select.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      fillJobOptions(target.value);
      setProjectDetails(target.value);
    });
  });

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

  const performSave = async (payload, clearCart) => {
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
  };

  let pendingDuplicate = null;

  duplicateNoBtn?.addEventListener("click", () => {
    if (duplicateModal) duplicateModal.hidden = true;
    pendingDuplicate = null;
  });

  duplicateModal?.addEventListener("pointerdown", (event) => {
    if (event.target === duplicateModal) {
      duplicateModal.hidden = true;
      pendingDuplicate = null;
    }
  });

  duplicateYesBtn?.addEventListener("click", async () => {
    if (!pendingDuplicate) return;
    const { payload, clearCart } = pendingDuplicate;
    pendingDuplicate = null;
    if (duplicateModal) duplicateModal.hidden = true;
    payload.projectName = getUniqueProjectName(payload.projectName);
    await performSave(payload, clearCart);
  });

  duplicateMergeBtn?.addEventListener("click", async () => {
    if (!pendingDuplicate) return;
    const { payload, clearCart, matchingProject } = pendingDuplicate;
    pendingDuplicate = null;
    if (duplicateModal) duplicateModal.hidden = true;
    const mergePayload = {
      mode: "existingProject",
      poNumber: payload.poNumber,
      companyName: payload.companyName,
      projectId: matchingProject.id,
      jobName: payload.jobName,
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

    const mode = modeSelect.value;
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
    const poNumber =
      poNumberInput instanceof HTMLInputElement
        ? poNumberInput.value.trim()
        : "";
    const companyName =
      companyNameInput instanceof HTMLInputElement
        ? companyNameInput.value.trim()
        : "";

    const selectedProject =
      projectSelects.find(
        (select) => !select.closest("[hidden]") && select.value,
      )?.value || "";

    const selectedJob =
      jobSelect instanceof HTMLSelectElement ? jobSelect.value : "";

    const payload = {
      mode,
      poNumber: poNumber || undefined,
      companyName: companyName || undefined,
      projectName: projectName || undefined,
      jobName:
        jobName instanceof HTMLInputElement ? jobName.value.trim() : undefined,
      projectId: selectedProject || undefined,
      jobId: selectedJob || undefined,
      quantityMode:
        quantityModeInput instanceof HTMLInputElement
          ? quantityModeInput.value
          : "add",
      items: await getCartItems(),
    };

    if (mode === "newProject" && projectName) {
      const matchingProject = cachedProjects.find(
        (p) => p.name.trim().toLowerCase() === projectName.trim().toLowerCase(),
      );
      if (matchingProject) {
        pendingDuplicate = { payload, clearCart, matchingProject };
        if (duplicateModal) duplicateModal.hidden = false;
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

  refreshCartState();
})();
