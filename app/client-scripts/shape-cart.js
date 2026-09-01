/*
 * Custom parts cart (app proxy, no React).
 *
 * Quantities and removals go to `api/shape-cart`, which owns pricing. Saving runs in two steps
 * because each distinct profile needs its own Shopify product/variant: `save-items` mints (or
 * reuses) those variants and returns the order lines, then those lines are posted to `api/save-job`
 * — the same endpoint the theme cart uses, so shape parts land in projects and orders exactly like
 * catalogue parts. The staging cart is emptied afterwards so nothing is saved twice.
 */
(function () {
  var root = document.querySelector('[data-pc-shape-cart="1"]');
  if (!root) return;

  var payload = { items: [] };
  var payloadEl = document.getElementById('pc-shape-cart-payload');
  if (payloadEl) {
    try {
      payload = JSON.parse(payloadEl.textContent || '{}');
    } catch (e) {
      payload = { items: [] };
    }
  }
  var cartApiUrl = payload.cartApiUrl || '/apps/project-clad/api/shape-cart';
  var saveJobUrl = payload.saveJobUrl || '/apps/project-clad/api/save-job';

  var busy = false;
  function setBusy(state) {
    busy = state;
    root.setAttribute('aria-busy', state ? 'true' : 'false');
  }

  /* Every app-proxy POST can come back as 401 + redirectTo when the storefront session lapsed. */
  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    }).then(function (response) {
      return response
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          if (response.status === 401 && data && data.redirectTo) {
            window.location.href = data.redirectTo;
            throw new Error('redirecting');
          }
          if (!response.ok) {
            throw new Error(
              (data && (data.error || data.description || data.message)) ||
                'Request failed (' + response.status + ')'
            );
          }
          return data;
        });
    });
  }

  function mutateCart(body) {
    if (busy) return Promise.resolve(null);
    setBusy(true);
    return postJson(cartApiUrl, body)
      .then(function () {
        window.location.reload();
      })
      .catch(function (err) {
        setBusy(false);
        if (err && err.message === 'redirecting') return;
        window.alert(err && err.message ? err.message : 'Could not update the cart.');
      });
  }

  function lineIdOf(node) {
    var line = node.closest('[data-pc-cart-line]');
    return line ? line.getAttribute('data-pc-cart-line') : null;
  }

  root.addEventListener('click', function (event) {
    var target = event.target;
    if (!(target instanceof Element)) return;

    var step = target.closest('[data-pc-cart-step]');
    if (step) {
      var id = lineIdOf(step);
      var input = step.parentElement.querySelector('[data-pc-cart-qty]');
      if (!id || !input) return;
      var next = parseInt(input.value, 10);
      if (!isFinite(next)) next = 1;
      next += parseInt(step.getAttribute('data-pc-cart-step'), 10) || 0;
      if (next < 1) {
        if (!window.confirm('Remove this part from the cart?')) return;
        next = 0;
      }
      mutateCart({ action: 'qty', id: id, quantity: next });
      return;
    }

    var remove = target.closest('[data-pc-cart-remove]');
    if (remove) {
      mutateCart({ action: 'remove', id: remove.getAttribute('data-pc-cart-remove') });
      return;
    }

    if (target.closest('[data-pc-cart-clear]')) {
      if (!window.confirm('Empty your custom parts cart?')) return;
      mutateCart({ action: 'clear' });
      return;
    }

    if (target.closest('[data-pc-cart-save-open]')) {
      setSavePanelOpen(true);
      return;
    }

    if (target.closest('[data-pc-save-cancel]')) {
      setSavePanelOpen(false);
      return;
    }

    if (target.closest('[data-pc-save-submit]')) {
      saveToProject();
    }
  });

  root.addEventListener('change', function (event) {
    var target = event.target;
    if (!(target instanceof Element)) return;

    if (target.matches('[data-pc-cart-qty]')) {
      var id = lineIdOf(target);
      var quantity = parseInt(target.value, 10);
      if (!id) return;
      if (!isFinite(quantity) || quantity < 0) {
        window.location.reload();
        return;
      }
      mutateCart({ action: 'qty', id: id, quantity: quantity });
      return;
    }

    if (target.matches('[data-pc-save-mode]')) {
      applyMode();
      return;
    }

    if (target.matches('[data-pc-save-project]')) {
      filterJobOptions();
      prefillFromProject();
    }
  });

  /* --- Save to project ------------------------------------------------------ */

  var panel = root.querySelector('[data-pc-cart-save-panel]');
  var modeSelect = root.querySelector('[data-pc-save-mode]');
  var projectSelect = root.querySelector('[data-pc-save-project]');
  var jobSelect = root.querySelector('[data-pc-save-job]');
  var statusEl = root.querySelector('[data-pc-save-status]');

  function fieldWrap(name) {
    return root.querySelector('[data-pc-save-field="' + name + '"]');
  }

  function show(node, visible) {
    if (!node) return;
    if (visible) node.removeAttribute('hidden');
    else node.setAttribute('hidden', 'hidden');
  }

  function setSavePanelOpen(open) {
    show(panel, open);
    if (open) {
      applyMode();
      if (panel && panel.scrollIntoView) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  function currentMode() {
    return modeSelect ? modeSelect.value : 'newProject';
  }

  function applyMode() {
    var mode = currentMode();
    show(fieldWrap('project'), mode !== 'newProject');
    show(fieldWrap('job'), mode === 'existingJob');
    show(fieldWrap('projectName'), mode === 'newProject');
    show(fieldWrap('jobName'), mode !== 'existingJob');
    if (mode !== 'newProject') filterJobOptions();
  }

  function filterJobOptions() {
    if (!jobSelect || !projectSelect) return;
    var projectId = projectSelect.value;
    var options = jobSelect.querySelectorAll('option[data-project]');
    var keptSelection = false;
    for (var i = 0; i < options.length; i++) {
      var match = options[i].getAttribute('data-project') === projectId;
      options[i].hidden = !match;
      options[i].disabled = !match;
      if (match && options[i].selected) keptSelection = true;
    }
    if (!keptSelection) jobSelect.value = '';
  }

  function prefillFromProject() {
    if (!projectSelect) return;
    var option = projectSelect.options[projectSelect.selectedIndex];
    var name = option ? option.textContent || '' : '';
    var jobNameInput = root.querySelector('[data-pc-save-job-name]');
    if (jobNameInput && !jobNameInput.value.trim()) {
      jobNameInput.value = name ? 'Custom parts' : '';
    }
  }

  function setStatus(message, isError) {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.setAttribute('data-error', isError ? '1' : '0');
  }

  function valueOf(selector) {
    var node = root.querySelector(selector);
    return node ? String(node.value || '').trim() : '';
  }

  function saveToProject() {
    if (busy) return;
    var mode = currentMode();
    var body = {
      mode: mode,
      poNumber: valueOf('[data-pc-save-po]') || undefined,
      companyName: valueOf('[data-pc-save-company]') || undefined
    };

    if (mode === 'newProject') {
      body.projectName = valueOf('[data-pc-save-project-name]');
      body.jobName = valueOf('[data-pc-save-job-name]') || 'Custom parts';
      if (!body.projectName) {
        setStatus('Name the new project first.', true);
        return;
      }
    } else {
      body.projectId = projectSelect ? projectSelect.value : '';
      if (!body.projectId) {
        setStatus('Pick a project.', true);
        return;
      }
      if (mode === 'existingJob') {
        body.jobId = jobSelect ? jobSelect.value : '';
        body.quantityMode = 'add';
        if (!body.jobId) {
          setStatus('Pick an order.', true);
          return;
        }
      } else {
        body.jobName = valueOf('[data-pc-save-job-name]') || 'Custom parts';
      }
    }

    setBusy(true);
    setStatus('Creating the custom parts…', false);
    postJson(cartApiUrl, { action: 'save-items' })
      .then(function (prepared) {
        body.items = prepared.items || [];
        if (!body.items.length) {
          throw new Error('These parts could not be prepared for ordering.');
        }
        setStatus('Saving…', false);
        return postJson(saveJobUrl, body);
      })
      .then(function (result) {
        return postJson(cartApiUrl, { action: 'clear' }).then(function () {
          window.location.href = result && result.projectId
            ? '/apps/project-clad/project?id=' + encodeURIComponent(result.projectId)
            : '/apps/project-clad/projects';
        });
      })
      .catch(function (err) {
        setBusy(false);
        if (err && err.message === 'redirecting') return;
        setStatus(err && err.message ? err.message : 'Could not save these parts.', true);
      });
  }

  applyMode();
})();
