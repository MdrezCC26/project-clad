
(() => {
  /*
   * Print pagination must refresh on every script inject (HMR / soft nav).
   * Assign before the once-guard so stale handlers are replaced.
   */
  window.__pcPrintPinVersion = 9;
  window.__pcHandleExportOrderPdf = function (exportPdfBtn) {
      if (!(exportPdfBtn instanceof HTMLButtonElement)) return;
      const jobId = exportPdfBtn.getAttribute('data-job-id') || '';
      const printMode = (exportPdfBtn.getAttribute('data-print-mode') || 'packing').toLowerCase();
      const safeId = jobId.replace(/"/g, '');
      const target = document.querySelector(
        'details.project-clad-order-row[data-job-id="' + safeId + '"]',
      );
      if (!(target instanceof HTMLDetailsElement)) {
        window.alert('Could not find that order on the page.');
        return;
      }
      var wasOpen = target.open;
      target.open = true;
      var suppressed = [];
      function suppressForPrint(el) {
        if (el instanceof HTMLElement) {
          suppressed.push(el);
          el.classList.add('project-clad-print-suppressed');
        }
      }
      document.body.classList.add('project-clad-print-order-only');
      if (printMode === 'packing') {
        document.body.classList.add('project-clad-print-hide-prices');
      }
      var hdr = document.querySelector('header.project-clad-header');
      if (hdr) suppressForPrint(hdr);
      var container = document.querySelector('.project-clad-container');
      if (container) {
        Array.from(container.children).forEach(function (el) {
          if (!(el instanceof HTMLElement)) return;
          if (!el.contains(target)) {
            suppressForPrint(el);
          }
        });
      }
      suppressForPrint(document.querySelector('#project-clad-comments'));
      document.querySelectorAll('.project-clad-modal-backdrop').forEach(suppressForPrint);
      var ordersShell = document.querySelector('.project-clad-orders-shell');
      if (ordersShell) {
        Array.from(ordersShell.children).forEach(function (el) {
          if (!(el instanceof HTMLElement)) return;
          if (el.contains(target)) return;
          if (
            el.classList.contains("project-clad-project-meta-strip") ||
            el.classList.contains("project-clad-orders-page-banner") ||
            el.hasAttribute("data-projectclad-project-meta-print-banner")
          )
            return;
          suppressForPrint(el);
        });
      }
      document.querySelectorAll('.project-clad-order-row-shell').forEach(function (wrap) {
        var det = wrap.querySelector('details.project-clad-order-row[data-job-id]');
        var idAttr = det ? det.getAttribute('data-job-id') : '';
        if (idAttr !== safeId) suppressForPrint(wrap);
      });
      var scope = document.getElementById('project-clad-orders-font-scope');
      if (scope) {
        Array.from(scope.children).forEach(function (el) {
          if (!(el instanceof HTMLElement)) return;
          if (el.contains(target)) return;
          suppressForPrint(el);
        });
      }
      document.querySelectorAll('[data-projectclad-export-order-pdf]').forEach(suppressForPrint);
      document.querySelectorAll('[data-projectclad-export-order-csv]').forEach(suppressForPrint);
      document.querySelectorAll('.project-clad-storefront-footer--fullbleed, .project-clad-storefront-footer').forEach(suppressForPrint);

      var PRINT_ITEMS_PER_PAGE = 10;
      var printPagesRoot = null;
      var printBannerEl = null;
      var printShellEl = target.closest('.project-clad-order-row-shell');
      function stripCloneIds(root) {
        if (!(root instanceof HTMLElement)) return;
        root.querySelectorAll('[id]').forEach(function (node) {
          node.removeAttribute('id');
        });
        root.querySelectorAll('label[for]').forEach(function (lab) {
          lab.removeAttribute('for');
        });
      }
      function findPrintBanner() {
        if (!ordersShell) return null;
        return (
          ordersShell.querySelector('[data-projectclad-project-meta-print-banner]') ||
          ordersShell.querySelector('.project-clad-orders-page-banner') ||
          ordersShell.querySelector('.project-clad-project-meta-strip')
        );
      }
      /* Letter page usable height — keep compact CSS so 10 lines + finance fit. */
      function getPrintTargetPx() {
        var probe = document.createElement('div');
        probe.setAttribute('aria-hidden', 'true');
        probe.style.cssText =
          'position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;width:1px;height:10.7in;';
        document.body.appendChild(probe);
        var targetPx = probe.offsetHeight;
        probe.remove();
        if (!targetPx || targetPx < 200) {
          targetPx = Math.round(10.7 * 96);
        }
        return targetPx;
      }
      function collectItemRows(root) {
        var rows = Array.from(
          root.querySelectorAll(
            '.project-clad-orders-table > tbody > tr[data-projectclad-item-row]',
          ),
        );
        if (!rows.length) {
          rows = Array.from(root.querySelectorAll('tr[data-projectclad-item-row]'));
        }
        return rows;
      }
      /*
       * One print sheet: banner + up to 10 item rows.
       * Contact/Payment footer is only on the LAST page, pinned via spacer img.
       * Never reduce item count to make finance fit — pack exactly 10 per page.
       */
      function createPrintPage(sliceStart, sliceEnd, pageIndex, pageCount, keepFinance) {
        var page = document.createElement('table');
        page.className = 'project-clad-print-page';
        page.setAttribute('data-projectclad-print-page', String(pageIndex + 1));
        page.setAttribute('data-projectclad-print-page-count', String(pageCount));
        page.setAttribute('cellpadding', '0');
        page.setAttribute('cellspacing', '0');
        page.setAttribute('role', 'presentation');
        if (pageIndex < pageCount - 1) {
          page.classList.add('project-clad-print-page--break-after');
        }
        if (!keepFinance) {
          page.classList.add('project-clad-print-page--continued');
        }

        var topRow = page.insertRow();
        var top = topRow.insertCell();
        top.className = 'project-clad-print-page__top';
        top.vAlign = 'top';

        if (printBannerEl instanceof HTMLElement) {
          var bannerClone = printBannerEl.cloneNode(true);
          if (bannerClone instanceof HTMLElement) {
            stripCloneIds(bannerClone);
            bannerClone.classList.add('project-clad-print-page__banner');
            top.appendChild(bannerClone);
          }
        }

        var shellClone = printShellEl.cloneNode(true);
        if (!(shellClone instanceof HTMLElement)) return null;
        stripCloneIds(shellClone);
        shellClone.classList.remove('project-clad-print-suppressed');
        shellClone.classList.remove('project-clad-print-source-hidden');
        shellClone.classList.add('project-clad-print-page__shell');

        var detailsClone = shellClone.querySelector('details.project-clad-order-row');
        if (detailsClone instanceof HTMLDetailsElement) {
          detailsClone.open = true;
          detailsClone.classList.add('project-clad-print-page__details');
        }

        var cloneRows = collectItemRows(shellClone);
        cloneRows.forEach(function (row, idx) {
          if (idx < sliceStart || idx >= sliceEnd) row.remove();
        });

        var financeEl = shellClone.querySelector('.project-clad-order-finance');
        var financeParent = null;
        if (financeEl instanceof HTMLElement) {
          financeParent = financeEl.closest('tfoot');
          if (!keepFinance) {
            if (financeParent) financeParent.remove();
            else financeEl.remove();
            financeEl = null;
            financeParent = null;
          }
        }

        shellClone
          .querySelectorAll(
            '.project-clad-order-actions, .project-clad-order-edit-panel, .project-clad-receipt',
          )
          .forEach(function (el) {
            el.remove();
          });

        top.appendChild(shellClone);

        /* Spacer + footer on every page that keeps finance (last page). */
        if (keepFinance) {
          var spacerRow = page.insertRow();
          spacerRow.className = 'project-clad-print-page__spacer-row';
          var spacerCell = spacerRow.insertCell();
          spacerCell.className = 'project-clad-print-page__spacer';
          spacerCell.setAttribute('aria-hidden', 'true');
          var spacerImg = document.createElement('img');
          spacerImg.className = 'project-clad-print-page__spacer-img';
          spacerImg.alt = '';
          spacerImg.width = 1;
          spacerImg.height = 1;
          spacerImg.setAttribute('width', '1');
          spacerImg.setAttribute('height', '1');
          spacerImg.src =
            'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
          spacerCell.appendChild(spacerImg);

          var footerRow = page.insertRow();
          var footerCell = footerRow.insertCell();
          footerCell.className = 'project-clad-print-page__footer';
          footerCell.vAlign = 'bottom';
          if (financeEl instanceof HTMLElement) {
            footerCell.appendChild(financeEl);
            if (financeParent) financeParent.remove();
          }
        }

        return page;
      }
      function buildPrintPages() {
        if (!(printShellEl instanceof HTMLElement)) return;

        var itemRows = collectItemRows(target);
        var totalItems = itemRows.length;
        printBannerEl = findPrintBanner();
        printPagesRoot = document.createElement('div');
        printPagesRoot.className = 'project-clad-print-pages';
        printPagesRoot.setAttribute('data-projectclad-print-pages', '');

        /* Strict chunks of 10 — never shrink the last page to make finance fit. */
        var pageCount = Math.max(1, Math.ceil(Math.max(totalItems, 1) / PRINT_ITEMS_PER_PAGE));
        for (var pageIndex = 0; pageIndex < pageCount; pageIndex++) {
          var sliceStart = pageIndex * PRINT_ITEMS_PER_PAGE;
          var sliceEnd = Math.min(sliceStart + PRINT_ITEMS_PER_PAGE, totalItems);
          var keepFinance = pageIndex === pageCount - 1;
          var page = createPrintPage(
            sliceStart,
            sliceEnd,
            pageIndex,
            pageCount,
            keepFinance,
          );
          if (page) printPagesRoot.appendChild(page);
        }

        if (printBannerEl instanceof HTMLElement) {
          suppressForPrint(printBannerEl);
        }
        suppressForPrint(printShellEl);
        var fontScope = document.getElementById('project-clad-orders-font-scope');
        if (fontScope instanceof HTMLElement) {
          fontScope.appendChild(printPagesRoot);
        } else if (ordersShell instanceof HTMLElement) {
          ordersShell.appendChild(printPagesRoot);
        } else {
          printShellEl.after(printPagesRoot);
        }
        document.body.classList.add('project-clad-print-paginated');
      }
      function sizePrintPageSpacers() {
        if (!(printPagesRoot instanceof HTMLElement)) return;
        var targetPx = getPrintTargetPx();
        Array.prototype.forEach.call(
          printPagesRoot.querySelectorAll('table.project-clad-print-page'),
          function (page) {
            if (!(page instanceof HTMLElement)) return;
            var topEl = page.querySelector('.project-clad-print-page__top');
            var footerEl = page.querySelector('.project-clad-print-page__footer');
            var spacerImg = page.querySelector('.project-clad-print-page__spacer-img');
            /* Item-only / continued pages — natural height, no pin. */
            if (
              !(topEl instanceof HTMLElement) ||
              !(footerEl instanceof HTMLElement) ||
              !(spacerImg instanceof HTMLImageElement)
            ) {
              page.style.removeProperty('height');
              page.style.removeProperty('min-height');
              page.removeAttribute('height');
              return;
            }
            spacerImg.height = 1;
            spacerImg.setAttribute('height', '1');
            spacerImg.style.setProperty('height', '1px', 'important');
            page.style.setProperty('height', 'auto', 'important');
            page.style.removeProperty('min-height');

            var topH = topEl.offsetHeight;
            var footerH = footerEl.offsetHeight;
            var safety = 8;
            var gap = Math.max(0, Math.floor(targetPx - topH - footerH - safety));

            page.style.setProperty('height', targetPx + 'px', 'important');
            page.style.setProperty('min-height', targetPx + 'px', 'important');
            page.setAttribute('height', String(targetPx));

            var gapPx = Math.max(1, gap);
            spacerImg.height = gapPx;
            spacerImg.setAttribute('height', String(gapPx));
            spacerImg.style.setProperty('display', 'block', 'important');
            spacerImg.style.setProperty('width', '1px', 'important');
            spacerImg.style.setProperty('height', gapPx + 'px', 'important');
            spacerImg.style.setProperty('min-height', gapPx + 'px', 'important');
            spacerImg.style.setProperty('max-height', gapPx + 'px', 'important');
            spacerImg.style.setProperty('border', '0', 'important');

            console.info('[project-clad] print pin v9', {
              page: page.getAttribute('data-projectclad-print-page'),
              targetPx: targetPx,
              topH: topH,
              footerH: footerH,
              gap: gapPx,
            });
          },
        );
      }
      function teardownPrintPages() {
        if (printPagesRoot && printPagesRoot.parentNode) {
          printPagesRoot.parentNode.removeChild(printPagesRoot);
        }
        printPagesRoot = null;
        document.body.classList.remove('project-clad-print-paginated');
        printBannerEl = null;
      }
      try {
        buildPrintPages();
      } catch (err) {
        console.error('[project-clad] print pagination failed:', err);
        teardownPrintPages();
      }

      var printRestoreDone = false;
      var printRestoreTimer = null;
      function restorePrintLayout() {
        if (printRestoreDone) return;
        printRestoreDone = true;
        if (printRestoreTimer !== null) {
          window.clearTimeout(printRestoreTimer);
          printRestoreTimer = null;
        }
        window.removeEventListener('beforeprint', sizePrintPageSpacers);
        teardownPrintPages();
        suppressed.forEach(function (el) {
          el.classList.remove('project-clad-print-suppressed');
        });
        suppressed.length = 0;
        document.body.classList.remove('project-clad-print-order-only');
        document.body.classList.remove('project-clad-print-hide-prices');
        target.open = wasOpen;
      }
      window.addEventListener('afterprint', restorePrintLayout, { once: true });
      window.addEventListener('beforeprint', sizePrintPageSpacers);
      printRestoreTimer = window.setTimeout(restorePrintLayout, 8000);
      window.requestAnimationFrame(function () {
        sizePrintPageSpacers();
        window.setTimeout(function () {
          sizePrintPageSpacers();
          window.setTimeout(function () {
            sizePrintPageSpacers();
            window.print();
          }, 80);
        }, 160);
      });
  };

  if (window.__pcShareCopyInitialized) return;
  window.__pcShareCopyInitialized = true;
  const actionsEndpoint = '/apps/project-clad/api/project-actions';

  function syncMemberRoleSelect(details) {
    const labelEl = details.querySelector('[data-role-label]');
    var promptRaw = details.getAttribute('data-projectclad-role-prompt');
    if (
      typeof promptRaw === 'string' &&
      promptRaw.trim() &&
      !details.getAttribute('data-projectclad-role-touched') &&
      labelEl instanceof HTMLElement
    ) {
      labelEl.textContent = promptRaw.trim();
      return;
    }
    const checked = details.querySelector('input[name="role"]:checked');
    const opt = checked && checked.closest('.project-clad-member-role-select__option');
    const textEl = opt && opt.querySelector('.project-clad-member-role-select__option-text');
    const text = textEl && textEl.textContent ? textEl.textContent.trim() : '';
    if (labelEl && text) labelEl.textContent = text;
  }

  var PC_ROLE_PANEL_MS = 240;
  var PC_ROLE_PANEL_EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';

  var PC_EDIT_PROJECT_MODAL_MS = 300;
  var editProjectModalCloseTimer = null;

  function pcEditProjectModalMotionMs() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return 0;
    }
    return PC_EDIT_PROJECT_MODAL_MS;
  }

  function openEditProjectModal() {
    var modal = document.querySelector('[data-projectclad-edit-project-modal]');
    if (!(modal instanceof HTMLElement)) return;
    if (editProjectModalCloseTimer) {
      clearTimeout(editProjectModalCloseTimer);
      editProjectModalCloseTimer = null;
    }
    closeEditProjectUnsavedModal();
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.remove('project-clad-edit-project-modal--open');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        modal.classList.add('project-clad-edit-project-modal--open');
        window.setTimeout(function () {
          pcSyncEditProjectDeliveryPanels();
          captureEditProjectBaseline();
        }, 0);
      });
    });
  }

  var editProjectModalBaseline = '';

  function getEditProjectMainForm() {
    return document.querySelector('[data-projectclad-edit-project-main-form]');
  }

  function closeEditProjectUnsavedModal() {
    var u = document.querySelector('[data-projectclad-edit-project-unsaved-modal]');
    if (u instanceof HTMLElement) {
      u.style.display = 'none';
      u.setAttribute('aria-hidden', 'true');
    }
  }

  function openEditProjectUnsavedModal() {
    var u = document.querySelector('[data-projectclad-edit-project-unsaved-modal]');
    if (u instanceof HTMLElement) {
      u.style.display = 'flex';
      u.setAttribute('aria-hidden', 'false');
    }
  }

  function pcSerializeEditProjectMainForm(form) {
    var bits = [];
    for (var i = 0; i < form.elements.length; i++) {
      var el = form.elements[i];
      if (!(el instanceof HTMLElement)) continue;
      if (!('name' in el) || !el.name) continue;
      var tag = el.tagName;
      if (tag === 'BUTTON') continue;
      var type = el.type;
      if (type === 'checkbox') {
        bits.push(encodeURIComponent(el.name) + '=' + (el.checked ? '1' : '0'));
      } else if (type === 'radio') {
        if (el.checked) bits.push(encodeURIComponent(el.name) + '=' + encodeURIComponent(String(el.value)));
      } else {
        bits.push(encodeURIComponent(el.name) + '=' + encodeURIComponent(String(el.value)));
      }
    }
    bits.sort();
    return bits.join('&');
  }

  function captureEditProjectBaseline() {
    var form = getEditProjectMainForm();
    if (!(form instanceof HTMLFormElement)) {
      editProjectModalBaseline = '';
      return;
    }
    editProjectModalBaseline = pcSerializeEditProjectMainForm(form);
  }

  function isEditProjectDirty() {
    var form = getEditProjectMainForm();
    if (!(form instanceof HTMLFormElement)) return false;
    if (!editProjectModalBaseline) return false;
    return pcSerializeEditProjectMainForm(form) !== editProjectModalBaseline;
  }

  function requestCloseEditProjectModal() {
    if (isEditProjectDirty()) {
      openEditProjectUnsavedModal();
      return;
    }
    closeEditProjectUnsavedModal();
    closeEditProjectModal();
  }

  function closeEditProjectModal() {
    try {
      window.dispatchEvent(new CustomEvent('projectclad-edit-project-modal-closed'));
    } catch (e) {}
    closeEditProjectUnsavedModal();
    var modal = document.querySelector('[data-projectclad-edit-project-modal]');
    if (!(modal instanceof HTMLElement)) return;
    if (editProjectModalCloseTimer) {
      clearTimeout(editProjectModalCloseTimer);
      editProjectModalCloseTimer = null;
    }
    var ms = pcEditProjectModalMotionMs();
    if (!modal.classList.contains('project-clad-edit-project-modal--open')) {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
      return;
    }
    modal.classList.remove('project-clad-edit-project-modal--open');
    if (ms <= 0) {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
      return;
    }
    editProjectModalCloseTimer = window.setTimeout(function () {
      editProjectModalCloseTimer = null;
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }, ms);
  }

  function pcMemberRolePanel(details) {
    return details.querySelector('.project-clad-member-role-select__panel');
  }
  function pcMemberRoleList(details) {
    return details.querySelector('.project-clad-member-role-select__list');
  }

  function pcAnimateMemberRoleOpen(details) {
    var panel = pcMemberRolePanel(details);
    var list = pcMemberRoleList(details);
    if (!panel || !list) return;
    var target = list.scrollHeight;
    panel.style.overflow = 'hidden';
    panel.style.transition = 'height ' + PC_ROLE_PANEL_MS / 1000 + 's ' + PC_ROLE_PANEL_EASE;
    panel.style.height = '0px';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        panel.style.height = target + 'px';
      });
    });
    function settle() {
      if (details.open) panel.style.height = 'auto';
    }
    function onEnd(ev) {
      if (ev.propertyName !== 'height') return;
      clearTimeout(tid);
      settle();
    }
    var tid = setTimeout(settle, PC_ROLE_PANEL_MS + 100);
    panel.addEventListener('transitionend', onEnd, { once: true });
  }

  function pcAnimateMemberRoleClose(details, done) {
    var panel = pcMemberRolePanel(details);
    var list = pcMemberRoleList(details);
    if (!panel || !list) {
      done();
      return;
    }
    var h = list.scrollHeight;
    panel.style.overflow = 'hidden';
    panel.style.transition = 'height ' + PC_ROLE_PANEL_MS / 1000 + 's ' + PC_ROLE_PANEL_EASE;
    if (panel.style.height === 'auto' || panel.style.height === '') {
      panel.style.height = h + 'px';
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        panel.style.height = '0px';
      });
    });
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      panel.removeEventListener('transitionend', onEnd);
      clearTimeout(tid);
      panel.style.transition = '';
      panel.style.height = '';
      done();
    }
    function onEnd(ev) {
      if (ev.propertyName !== 'height') return;
      finish();
    }
    panel.addEventListener('transitionend', onEnd);
    var tid = setTimeout(finish, PC_ROLE_PANEL_MS + 100);
  }

  function pcBindMemberRoleSelect(details) {
    var sum = details.querySelector('summary.project-clad-member-role-select__trigger');
    if (!(sum instanceof HTMLElement)) return;
    sum.addEventListener('click', function (e) {
      e.preventDefault();
      if (details.open) {
        pcAnimateMemberRoleClose(details, function () {
          details.open = false;
        });
      } else {
        var p = pcMemberRolePanel(details);
        if (p) {
          p.style.transition = 'none';
          p.style.height = '0px';
        }
        details.open = true;
        if (p) {
          void p.offsetHeight;
          p.style.transition = '';
        }
        pcAnimateMemberRoleOpen(details);
      }
    });
  }

  document.querySelectorAll('[data-projectclad-member-role-select]').forEach(function (el) {
    if (!(el instanceof HTMLDetailsElement)) return;
    syncMemberRoleSelect(el);
    pcBindMemberRoleSelect(el);
    el.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t instanceof HTMLInputElement && t.name === 'role') {
        el.setAttribute('data-projectclad-role-touched', '1');
        syncMemberRoleSelect(el);
        if (el.open) {
          pcAnimateMemberRoleClose(el, function () {
            el.open = false;
          });
        } else {
          el.open = false;
        }
      }
    });
  });

  document.addEventListener(
    'pointerdown',
    function (e) {
      var t = e.target;
      if (!(t instanceof Node)) return;
      document.querySelectorAll('details[data-projectclad-member-role-select][open]').forEach(function (d) {
        if (!(d instanceof HTMLDetailsElement)) return;
        if (d.contains(t)) return;
        pcAnimateMemberRoleClose(d, function () {
          d.open = false;
        });
      });
    },
    true,
  );

  const memberMessage = document.querySelector('[data-projectclad-member-message]');
  const setMemberMessage = (text) => {
    if (memberMessage) {
      memberMessage.textContent = text || '';
    }
  };
  const closePricingModal = () => {
    const pricingModal = document.querySelector('[data-projectclad-pricing-modal-backdrop]');
    if (pricingModal instanceof HTMLElement) {
      pricingModal.style.display = 'none';
    }
  };
  const rejectModal = document.querySelector('[data-projectclad-reject-modal]');
  const reorderModal = document.querySelector('[data-projectclad-reorder-modal]');
  const reorderOrderNameInput = document.getElementById('projectclad-reorder-order-name');
  const reorderExistingWrap = document.querySelector('[data-projectclad-reorder-existing-wrap]');
  const reorderNewWrap = document.querySelector('[data-projectclad-reorder-new-wrap]');
  const reorderTargetModeInputs = document.querySelectorAll('[data-projectclad-reorder-target-mode]');
  const reorderNewProjectNameInput = document.getElementById('projectclad-reorder-new-project-name');
  const rejectForm = document.querySelector('[data-projectclad-reject-form]');
  const rejectReasonInput = document.getElementById('reject-reason');
  let rejectProjectId = '';
  let rejectJobId = '';
  let rejectItemId = '';
  let rejectMessageSpan = null;

  let editingJobId = null;
  let editRemovedItemIds = {};
  let editPendingDeleteJobId = null;
  let editSnapshotItems = {};

  const syncReorderDestination = function() {
    var selected = document.querySelector('[data-projectclad-reorder-target-mode]:checked');
    var mode = selected instanceof HTMLInputElement ? selected.value : 'same';
    if (reorderExistingWrap instanceof HTMLElement) {
      reorderExistingWrap.style.display = mode === 'existing' ? 'block' : 'none';
    }
    if (reorderNewWrap instanceof HTMLElement) {
      reorderNewWrap.style.display = mode === 'new' ? 'block' : 'none';
    }
    if (reorderNewProjectNameInput instanceof HTMLInputElement) {
      reorderNewProjectNameInput.required = mode === 'new';
    }
  };
  reorderTargetModeInputs.forEach(function(inp) {
    inp.addEventListener('change', syncReorderDestination);
  });
  syncReorderDestination();

  document.addEventListener('input', (event) => {
    const qtyInput = event.target?.closest?.('[data-projectclad-qty-input]');
    if (qtyInput instanceof HTMLInputElement && editingJobId) {
      const itemId = qtyInput.getAttribute('data-item-id') || '';
      const jobId = qtyInput.getAttribute('data-job-id') || '';
      const val = parseInt(qtyInput.value, 10);
      const row = document.querySelector('[data-projectclad-item-row][data-item-id="' + itemId + '"]');
      const nameSpan = row?.querySelector('[data-projectclad-item-name]');
      const displayName = nameSpan?.getAttribute('data-display-name') || '';
      if (isNaN(val) || val <= 0) {
        if (!editRemovedItemIds[jobId]) editRemovedItemIds[jobId] = [];
        if (!editRemovedItemIds[jobId].includes(itemId)) editRemovedItemIds[jobId].push(itemId);
        if (nameSpan) nameSpan.textContent = displayName + ' (Removed)';
        qtyInput.value = '0';
      } else {
        editRemovedItemIds[jobId] = (editRemovedItemIds[jobId] || []).filter(id => id !== itemId);
        if (nameSpan) nameSpan.textContent = displayName;
      }
    }
  });

  document.addEventListener('change', (event) => {
    const qtyInput = event.target?.closest?.('[data-projectclad-qty-input]');
    if (qtyInput instanceof HTMLInputElement && editingJobId) {
      const val = parseInt(qtyInput.value, 10);
      if (isNaN(val) || val < 0) qtyInput.value = '0';
    }
  });

  document.addEventListener('focus', (event) => {
    const qtyInput = event.target?.closest?.('[data-projectclad-qty-input]');
    if (qtyInput instanceof HTMLInputElement) {
      qtyInput.select();
    }
  }, true);

  document.addEventListener('pointerdown', (event) => {
    var __pcPd = event.target;
    if (__pcPd && __pcPd.nodeType === 3 && __pcPd.parentElement) {
      __pcPd = __pcPd.parentElement;
    }
    const deleteOrderBtn = event.target?.closest?.('[data-projectclad-delete-order-btn]');
    if (deleteOrderBtn instanceof HTMLElement && editingJobId && !deleteOrderBtn.disabled) {
      event.preventDefault();
      event.stopPropagation();
      const jobId = deleteOrderBtn.getAttribute('data-job-id') || '';
      if (editPendingDeleteJobId === jobId) return;
      if (confirm('This order will be permanently deleted. Are you sure?')) {
        editPendingDeleteJobId = jobId;
        const details = document.querySelector('details[data-job-id="' + jobId + '"]');
        if (details) {
          details.classList.add('project-clad-pending-delete');
          deleteOrderBtn.textContent = 'Deleting';
          deleteOrderBtn.disabled = true;
        }
      }
    }
  }, true);

  /* CC v2 project detail: order finance actions are flat icon+label controls
   * (single button / link / form submit per slot). */

  document.addEventListener('click', (event) => {
    var __pcDel = event.target;
    if (__pcDel && __pcDel.nodeType === 3 && __pcDel.parentElement) {
      __pcDel = __pcDel.parentElement;
    }
    const moveBtn = event.target?.closest?.('[data-projectclad-item-move]');
    if (moveBtn instanceof HTMLButtonElement) {
      event.preventDefault();
      event.stopPropagation();
      const row = moveBtn.closest('[data-projectclad-item-row]');
      if (!(row instanceof HTMLElement)) return;
      const tbody = row.parentElement;
      if (!(tbody instanceof HTMLElement)) return;
      const direction = moveBtn.getAttribute('data-direction') || '';
      if (direction === 'up') {
        const prev = row.previousElementSibling;
        if (prev) tbody.insertBefore(row, prev);
      } else if (direction === 'down') {
        const next = row.nextElementSibling;
        if (next) tbody.insertBefore(next, row);
      }
      const rows = Array.from(
        tbody.querySelectorAll('[data-projectclad-item-row]'),
      );
      rows.forEach(function (r, idx) {
        const num = r.querySelector('.project-clad-order-line-num');
        if (num) num.textContent = String(idx + 1);
      });
      const jobId = moveBtn.getAttribute('data-job-id') || '';
      if (jobId) {
        const itemIds = rows
          .map(function (r) {
            return r.getAttribute('data-item-id') || '';
          })
          .filter(Boolean);
        void fetch(window.location.pathname + window.location.search, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            intent: 'reorder-items',
            jobId: jobId,
            itemIds: itemIds,
          }),
        }).catch(function () {});
      }
      return;
    }
    const saveFieldsBtn = event.target?.closest?.('[data-projectclad-save-fields-btn]');
    if (saveFieldsBtn instanceof HTMLButtonElement) {
      if (saveFieldsBtn.dataset.projectcladSaving === '1') return;
      event.preventDefault();
      event.stopPropagation();
      const jobId = saveFieldsBtn.getAttribute('data-job-id') || '';
      if (!jobId) return;
      const details = document.querySelector('details[data-job-id="' + jobId.replace(/"/g, '') + '"]');
      if (!(details instanceof HTMLElement)) {
        window.alert('Could not find this order on the page — try refreshing.');
        return;
      }
      const readField = function (selector) {
        const el = details.querySelector(selector);
        return el instanceof HTMLInputElement ? el.value.trim() : '';
      };
      const jobName = readField('[data-projectclad-job-name-input]');
      const purchaseOrderNumber = readField('[data-projectclad-purchase-order-input]');
      const siteContactName = readField('[data-projectclad-site-contact-name-input]');
      const siteContactPhone = readField('[data-projectclad-site-contact-phone-input]');
      saveFieldsBtn.dataset.projectcladSaving = '1';
      saveFieldsBtn.setAttribute('aria-busy', 'true');
      void (async function () {
        try {
          var saveUrl = new URL(window.location.href);
          saveUrl.searchParams.set('pcJson', '1');
          const res = await fetch(saveUrl.pathname + saveUrl.search, {
            method: 'POST',
            redirect: 'manual',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
              intent: 'save-order-edit',
              responseMode: 'json',
              jobId: jobId,
              jobName: jobName,
              purchaseOrderNumber: purchaseOrderNumber,
              siteContactName: siteContactName,
              siteContactPhone: siteContactPhone,
              removeItemIds: [],
              itemUpdates: [],
              deleteJob: false,
            }),
          });
          /*
           * Default fetch follows Remix redirect() so the final response is often
           * 200 HTML and the JSON ack is lost even though the DB already updated.
           * redirect manual keeps 3xx; treat redirect after save as success.
           */
          function stripPcJsonAndReload() {
            var u = new URL(window.location.href);
            u.searchParams.delete('pcJson');
            window.location.replace(u.pathname + u.search);
          }
          if (res.status >= 300 && res.status < 400) {
            stripPcJsonAndReload();
            return;
          }
          var raw = await res.text();
          var bomStripped = raw.length && raw.charCodeAt(0) === 65279 ? raw.slice(1) : raw;
          var trimmed = bomStripped.trimStart();
          var ack = null;
          if (trimmed.indexOf('{') === 0) {
            try {
              ack = JSON.parse(trimmed);
            } catch (e) {
              ack = null;
            }
          }
          if (!res.ok) {
            const serverMsg =
              (ack && typeof ack.error === 'string' && ack.error.trim()) ||
              ('Save failed (' + res.status + ').');
            console.error('[project-clad] Save fields failed:', res.status, serverMsg);
            window.alert(serverMsg);
            return;
          }
          /*
           * res.ok but body may be HTML (app proxy / redirect quirks) or JSON without
           * a boolean ok flag. If the server sent an explicit JSON error, surface it;
           * otherwise assume the action completed and reload so SSR shows saved values.
           */
          if (ack && typeof ack.error === 'string' && ack.error.trim()) {
            window.alert(ack.error.trim());
            return;
          }
          if (ack && ack.ok === false) {
            window.alert(
              (ack.error && String(ack.error).trim()) || 'Save could not be completed.',
            );
            return;
          }
          stripPcJsonAndReload();
        } catch (err) {
          console.error('[project-clad] Save fields network error:', err);
          window.alert("Couldn't save — check your connection and try again.");
        } finally {
          saveFieldsBtn.dataset.projectcladSaving = '';
          saveFieldsBtn.removeAttribute('aria-busy');
        }
      })();
      return;
    }
    const exportPdfBtn = event.target?.closest?.('[data-projectclad-export-order-pdf]');
    if (exportPdfBtn instanceof HTMLButtonElement) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof window.__pcHandleExportOrderPdf === 'function') {
        window.__pcHandleExportOrderPdf(exportPdfBtn);
      }
      return;
    }
    const editOrderBtn = event.target?.closest?.('[data-projectclad-edit-order]');
    if (editOrderBtn instanceof HTMLElement) {
      event.preventDefault();
      event.stopPropagation();
      const jobId = editOrderBtn.getAttribute('data-job-id') || '';
      const projectId = editOrderBtn.getAttribute('data-project-id') || '';
      const details = document.querySelector('details[data-job-id="' + jobId + '"]');
      if (!details) return;
      if (editingJobId === jobId) {
        const saveModal = document.querySelector('[data-projectclad-edit-save-modal]');
        if (saveModal instanceof HTMLElement) {
          saveModal.dataset.pendingJobId = jobId;
          saveModal.style.display = 'flex';
        }
      } else {
        editingJobId = jobId;
        editRemovedItemIds[jobId] = [];
        editPendingDeleteJobId = null;
        const rows = details.querySelectorAll('[data-projectclad-item-row]');
        editSnapshotItems[jobId] = Array.from(rows).map(r => r.getAttribute('data-item-id')).filter(Boolean);
        details.classList.add('project-clad-edit-mode');
      }
    }
    const showPriceBtn = event.target?.closest?.('[data-projectclad-show-price]');
    if (showPriceBtn instanceof HTMLElement) {
      event.preventDefault();
      const pricingModal = document.querySelector('[data-projectclad-pricing-modal-backdrop]');
      const passwordInput = pricingModal?.querySelector?.('input[name="password"]');
      if (pricingModal instanceof HTMLElement) {
        pricingModal.style.display = 'flex';
        const msg = pricingModal.querySelector('[data-projectclad-form-message]');
        if (msg) msg.textContent = '';
        if (passwordInput instanceof HTMLInputElement) {
          passwordInput.value = '';
          setTimeout(function() { passwordInput.focus(); }, 50);
        }
      }
    }
    const pricingModalCancel = event.target?.closest?.('[data-projectclad-pricing-modal-cancel]');
    const pricingModalBackdrop = event.target?.closest?.('[data-projectclad-pricing-modal-backdrop]');
    if (pricingModalCancel || event.target === pricingModalBackdrop) {
      const pm = document.querySelector('[data-projectclad-pricing-modal-backdrop]');
      if (pm instanceof HTMLElement) pm.style.display = 'none';
    }
    const btn = event.target?.closest?.('[data-projectclad-reject-trigger]');
    if (btn instanceof HTMLElement) {
      event.preventDefault();
      rejectProjectId = btn.getAttribute('data-projectclad-project-id') || '';
      rejectJobId = btn.getAttribute('data-projectclad-job-id') || '';
      rejectItemId = btn.getAttribute('data-projectclad-item-id') || '';
      rejectMessageSpan = btn.closest('.project-clad-approval-buttons')?.querySelector('[data-projectclad-reject-message]') || null;
      if (rejectModal instanceof HTMLElement) {
        rejectModal.style.display = 'flex';
        if (rejectReasonInput instanceof HTMLTextAreaElement) {
          rejectReasonInput.value = '';
          setTimeout(() => rejectReasonInput.focus(), 50);
        }
      }
    }
    if (event.target?.closest?.('[data-projectclad-reject-cancel]') || event.target === rejectModal) {
      if (rejectModal instanceof HTMLElement) rejectModal.style.display = 'none';
    }
    const reorderOpenBtn = event.target?.closest?.('[data-projectclad-reorder-open]');
    if (reorderOpenBtn instanceof HTMLElement) {
      event.preventDefault();
      event.stopPropagation();
      const itemId = reorderOpenBtn.getAttribute('data-item-id') || '';
      const defQty = reorderOpenBtn.getAttribute('data-default-qty') || '1';
      const lineLabel = reorderOpenBtn.getAttribute('data-line-label') || '';
      const hid = document.getElementById('projectclad-reorder-source-item-id');
      const qtyInp = document.getElementById('projectclad-reorder-qty');
      const titleEl = document.querySelector('[data-projectclad-reorder-modal-title]');
      const sameMode = document.querySelector('[data-projectclad-reorder-target-mode][value="same"]');
      if (hid instanceof HTMLInputElement) hid.value = itemId;
      if (qtyInp instanceof HTMLInputElement) {
        var q0 = parseInt(defQty, 10);
        qtyInp.value = !isNaN(q0) && q0 > 0 ? String(q0) : '1';
      }
      if (reorderOrderNameInput instanceof HTMLInputElement) {
        reorderOrderNameInput.value = lineLabel ? ('Reorder — ' + lineLabel) : '';
      }
      if (sameMode instanceof HTMLInputElement) {
        sameMode.checked = true;
      }
      syncReorderDestination();
      if (titleEl) {
        titleEl.textContent = lineLabel ? 'Reorder: ' + lineLabel : 'Reorder';
      }
      if (reorderModal instanceof HTMLElement) {
        reorderModal.style.display = 'flex';
        setTimeout(function () {
          if (qtyInp instanceof HTMLInputElement) {
            qtyInp.focus();
            qtyInp.select();
          }
        }, 50);
      }
    }
    if (
      event.target?.closest?.('[data-projectclad-reorder-cancel]') ||
      event.target === reorderModal
    ) {
      if (reorderModal instanceof HTMLElement) reorderModal.style.display = 'none';
    }
    const editSaveClose = event.target?.closest?.('[data-projectclad-edit-save-close]');
    if (editSaveClose) {
      const m = document.querySelector('[data-projectclad-edit-save-modal]');
      if (m instanceof HTMLElement) m.style.display = 'none';
    }
    const editSaveModal = document.querySelector('[data-projectclad-edit-save-modal]');
    if (event.target === editSaveModal) {
      if (editSaveModal instanceof HTMLElement) editSaveModal.style.display = 'none';
    }
  });

  document.addEventListener('click', async (event) => {
    const editSaveYes = event.target?.closest?.('[data-projectclad-edit-save-yes]');
    if (editSaveYes) {
      const modal = document.querySelector('[data-projectclad-edit-save-modal]');
      const jobId = modal?.getAttribute?.('data-pending-job-id') || '';
      const projectId = new URLSearchParams(window.location.search).get('id') || document.querySelector('.project-clad-container')?.getAttribute?.('data-projectclad-project-id') || '';
      if (!jobId || !projectId) return;
      const details = document.querySelector('details[data-job-id="' + jobId + '"]');
      const deleteJob = editPendingDeleteJobId === jobId;
      const itemUpdates = [];
      const qtyInputs = details?.querySelectorAll?.('[data-projectclad-qty-input]') || [];
      qtyInputs.forEach(function(inp) {
        const itemId = inp.getAttribute('data-item-id');
        const qty = parseInt(inp.value, 10);
        if (itemId && !isNaN(qty) && qty >= 0) {
          const row = inp.closest('[data-projectclad-item-row]');
          const priceInp = row && row.querySelector('[data-projectclad-unit-price-input]');
          const entry = { itemId: itemId, quantity: qty };
          if (priceInp instanceof HTMLInputElement) {
            var rawP = priceInp.value.trim().replace(/,/g, '');
            if (rawP !== '') {
              var p = parseFloat(rawP);
              if (!isNaN(p) && p >= 0) entry.unitPrice = p;
            }
          }
          itemUpdates.push(entry);
        }
      });
      let jobName = '';
      const nameInput = details?.querySelector?.('[data-projectclad-job-name-input]');
      if (nameInput instanceof HTMLInputElement) {
        jobName = nameInput.value.trim();
      }
      let purchaseOrderNumber = '';
      const poInput = details?.querySelector?.('[data-projectclad-purchase-order-input]');
      if (poInput instanceof HTMLInputElement) {
        purchaseOrderNumber = poInput.value.trim();
      }
      let siteContactName = '';
      const siteNameInput = details?.querySelector?.('[data-projectclad-site-contact-name-input]');
      if (siteNameInput instanceof HTMLInputElement) {
        siteContactName = siteNameInput.value.trim();
      }
      let siteContactPhone = '';
      const sitePhoneInput = details?.querySelector?.('[data-projectclad-site-contact-phone-input]');
      if (sitePhoneInput instanceof HTMLInputElement) {
        siteContactPhone = sitePhoneInput.value.trim();
      }
      try {
        const res = await fetch(window.location.pathname + window.location.search, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intent: 'save-order-edit', jobId, jobName: jobName, purchaseOrderNumber: purchaseOrderNumber, siteContactName: siteContactName, siteContactPhone: siteContactPhone, removeItemIds: [], itemUpdates: itemUpdates, deleteJob: deleteJob }),
          credentials: 'include',
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok && payload?.redirectTo) {
          window.location.href = payload.redirectTo;
          return;
        }
        window.location.reload();
      } catch (e) {
        console.error(e);
      }
    }
    const editSaveNo = event.target?.closest?.('[data-projectclad-edit-save-no]');
    if (editSaveNo) {
      const modal = document.querySelector('[data-projectclad-edit-save-modal]');
      const jobId = modal?.getAttribute?.('data-pending-job-id') || '';
      if (modal instanceof HTMLElement) modal.style.display = 'none';
      editingJobId = null;
      editPendingDeleteJobId = null;
      if (jobId) editRemovedItemIds[jobId] = [];
      window.location.reload();
    }
  });

  if (rejectForm instanceof HTMLFormElement) {
    rejectForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const errEl = rejectForm.querySelector('[data-projectclad-reject-form-error]');
      if (errEl) errEl.textContent = '';
      const reason = rejectReasonInput instanceof HTMLTextAreaElement ? rejectReasonInput.value.trim() : '';
      if (!reason) {
        if (errEl) errEl.textContent = 'Please enter a rejection reason.';
        return;
      }
      try {
        const res = await fetch(actionsEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intent: 'cancel-approval-request',
            projectId: rejectProjectId,
            jobId: rejectJobId,
            itemId: rejectItemId,
            rejectReason: reason,
          }),
          credentials: 'include',
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || payload.error) {
          if (payload?.redirectTo) {
            window.location.href = payload.redirectTo;
            return;
          }
          if (errEl) errEl.textContent = payload.error || 'Unable to reject.';
          return;
        }
        if (rejectModal instanceof HTMLElement) rejectModal.style.display = 'none';
        if (rejectMessageSpan) rejectMessageSpan.textContent = 'Order rejected.';
        window.location.reload();
      } catch {
        if (errEl) errEl.textContent = 'Unable to complete action.';
      }
    });
  }

  const isAddMemberPopoverOpen = (popover) =>
    popover instanceof HTMLElement &&
    popover.classList.contains('project-clad-add-member-popover--open');

  function clearAddMemberPopoverMobileLayout(pop) {
    if (!(pop instanceof HTMLElement)) return;
    pop.style.removeProperty('position');
    pop.style.removeProperty('top');
    pop.style.removeProperty('left');
    pop.style.removeProperty('right');
    pop.style.removeProperty('width');
    pop.style.removeProperty('max-width');
    pop.style.removeProperty('transform');
  }

  function applyAddMemberPopoverMobileLayout(pop, toggle) {
    if (!(pop instanceof HTMLElement) || !(toggle instanceof HTMLElement)) return;
    clearAddMemberPopoverMobileLayout(pop);
    if (window.matchMedia && window.matchMedia('(min-width: 750px)').matches) return;
    var rect = toggle.getBoundingClientRect();
    var vw = window.innerWidth;
    var margin = 12;
    var maxW = Math.min(352, vw - margin * 2);
    var left = rect.left + rect.width / 2 - maxW / 2;
    left = Math.max(margin, Math.min(left, vw - margin - maxW));
    var top = rect.bottom + 8;
    pop.style.setProperty('position', 'fixed', 'important');
    pop.style.setProperty('top', top + 'px', 'important');
    pop.style.setProperty('left', left + 'px', 'important');
    pop.style.setProperty('width', maxW + 'px', 'important');
    pop.style.setProperty('right', 'auto', 'important');
    pop.style.setProperty('transform', 'none', 'important');
  }

  var pcAddMemberResizeTimer = null;
  window.addEventListener('resize', function () {
    var pop = document.querySelector('[data-projectclad-add-member-popover]');
    var tgl = document.querySelector('[data-projectclad-add-member-popover-toggle]');
    if (!isAddMemberPopoverOpen(pop)) return;
    if (pcAddMemberResizeTimer) clearTimeout(pcAddMemberResizeTimer);
    pcAddMemberResizeTimer = setTimeout(function () {
      applyAddMemberPopoverMobileLayout(pop, tgl);
    }, 60);
  });

  const openAddMemberPopover = (popover, toggle) => {
    if (!(popover instanceof HTMLElement)) return;
    popover.classList.add('project-clad-add-member-popover--open');
    popover.setAttribute('aria-hidden', 'false');
    if (toggle instanceof HTMLElement) {
      toggle.setAttribute('aria-expanded', 'true');
    }
    applyAddMemberPopoverMobileLayout(popover, toggle);
  };

  const closeAddMemberPopover = (popover, toggle) => {
    if (!(popover instanceof HTMLElement)) return;
    clearAddMemberPopoverMobileLayout(popover);
    popover.classList.remove('project-clad-add-member-popover--open');
    popover.setAttribute('aria-hidden', 'true');
    if (toggle instanceof HTMLElement) {
      toggle.setAttribute('aria-expanded', 'false');
    }
  };

  var orderDeliveryModal = document.querySelector('[data-projectclad-order-delivery-modal]');
  var orderDeliveryForm = document.querySelector('[data-projectclad-order-delivery-form]');

  function pcShipComplete(ship) {
    return Boolean(
      ship.shipAddress1 && ship.shipCity && ship.shipProvince && ship.shipPostal,
    );
  }

  function pcProjectCtxFromDeliveryModal() {
    if (!(orderDeliveryModal instanceof HTMLElement)) {
      return { receiveMode: 'pickup', ship: {} };
    }
    return {
      receiveMode: orderDeliveryModal.getAttribute('data-project-receive-mode') || 'pickup',
      ship: {
        shipAddress1: orderDeliveryModal.getAttribute('data-project-ship-address1') || '',
        shipCity: orderDeliveryModal.getAttribute('data-project-ship-city') || '',
        shipProvince: orderDeliveryModal.getAttribute('data-project-ship-province') || '',
        shipPostal: orderDeliveryModal.getAttribute('data-project-ship-postal') || '',
        shipCountry: orderDeliveryModal.getAttribute('data-project-ship-country') || 'Canada',
      },
    };
  }

  function pcReadOrderDeliveryMode() {
    if (!(orderDeliveryForm instanceof HTMLFormElement)) return 'inherit';
    var checked = orderDeliveryForm.querySelector('input[name="deliveryMode"]:checked');
    return checked instanceof HTMLInputElement ? checked.value : 'inherit';
  }

  function pcReadOrderDeliveryShipFromForm() {
    if (!(orderDeliveryForm instanceof HTMLFormElement)) return {};
    function val(name) {
      var el = orderDeliveryForm.querySelector('[name="' + name + '"]');
      return el instanceof HTMLInputElement || el instanceof HTMLSelectElement
        ? String(el.value || '').trim()
        : '';
    }
    return {
      shipAddress1: val('shipAddress1'),
      shipCity: val('shipCity'),
      shipProvince: val('shipProvince'),
      shipPostal: val('shipPostal'),
      shipCountry: val('shipCountry') || 'Canada',
    };
  }

  function pcPreviewDeliveryFee() {
    var feeAttr = orderDeliveryModal instanceof HTMLElement
      ? parseFloat(orderDeliveryModal.getAttribute('data-delivery-fee') || '15')
      : 15;
    var fee = isFinite(feeAttr) ? feeAttr : 15;
    var mode = pcReadOrderDeliveryMode();
    var projectCtx = pcProjectCtxFromDeliveryModal();
    if (mode === 'pickup') return { method: 'pickup', fee: 0, line: 'Store pickup · no delivery fee.' };
    if (mode === 'delivery') {
      var ship = pcReadOrderDeliveryShipFromForm();
      var jobOk = pcShipComplete(ship);
      var projectOk = pcShipComplete(projectCtx.ship);
      var canCharge = jobOk || projectOk;
      return {
        method: 'delivery',
        fee: canCharge ? fee : 0,
        line: canCharge
          ? 'Delivery · $' + fee.toFixed(2) + ' fee on this order.'
          : 'Delivery · enter a complete address (or use project address).',
      };
    }
    if (projectCtx.receiveMode === 'pickup' || !pcShipComplete(projectCtx.ship)) {
      return { method: 'pickup', fee: 0, line: 'Uses project settings · store pickup.' };
    }
    return {
      method: 'delivery',
      fee: fee,
      line: 'Uses project settings · delivery · $' + fee.toFixed(2) + ' fee.',
    };
  }

  var deliveryPhasesState = {
    items: [],
    phases: [],
    planMode: 'single',
    batchByItem: {},
    repeatIntervalDays: null,
    repeatEndDate: null,
  };

  function pcParsePhasePlanFromJob(jobId) {
    var det = document.querySelector('details.project-clad-order-row[data-job-id="' + jobId.replace(/"/g, '') + '"]');
    if (!(det instanceof HTMLElement)) {
      return {
        items: [],
        phases: [],
        planMode: 'single',
        batchByItem: {},
        repeatIntervalDays: null,
        repeatEndDate: null,
      };
    }
    var raw = det.getAttribute('data-pc-phase-plan') || '';
    try {
      var plan = JSON.parse(decodeURIComponent(raw)) || {};
      var rawMode = String(plan.planMode || 'single').toLowerCase();
      var planMode =
        rawMode === 'recurring' || rawMode === 'at_a_time'
          ? 'recurring'
          : 'single';
      return {
        items: plan.items || [],
        phases: plan.phases || [],
        planMode: planMode,
        batchByItem: plan.batchByItem || {},
        repeatIntervalDays: plan.repeatIntervalDays != null ? plan.repeatIntervalDays : null,
        repeatEndDate: plan.repeatEndDate || null,
      };
    } catch (e) {
      return {
        items: [],
        phases: [],
        planMode: 'single',
        batchByItem: {},
        repeatIntervalDays: null,
        repeatEndDate: null,
      };
    }
  }

  function pcAddDaysYmd(ymd, days) {
    var m = /^(d{4})-(d{2})-(d{2})$/.exec((ymd || '').trim());
    if (!m) return null;
    var u = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
    var dt = new Date(u);
    return (
      dt.getUTCFullYear() +
      '-' +
      String(dt.getUTCMonth() + 1).padStart(2, '0') +
      '-' +
      String(dt.getUTCDate()).padStart(2, '0')
    );
  }

  function pcReadDeliveryRepeatIntervalDays() {
    if (!(orderDeliveryForm instanceof HTMLFormElement)) return null;
    var sel = orderDeliveryForm.querySelector('[data-projectclad-delivery-repeat-interval]');
    if (!(sel instanceof HTMLSelectElement)) return null;
    var n = Math.floor(Number(sel.value));
    return Number.isFinite(n) && n >= 1 ? n : null;
  }

  function pcReadDeliveryRepeatEndDate() {
    if (!(orderDeliveryForm instanceof HTMLFormElement)) return null;
    var inp = orderDeliveryForm.querySelector('[data-projectclad-delivery-repeat-end]');
    return inp instanceof HTMLInputElement ? inp.value.trim() || null : null;
  }

  function pcDeliveryDateMin() {
    if (!(orderDeliveryForm instanceof HTMLFormElement)) return '';
    return orderDeliveryForm.getAttribute('data-pc-delivery-date-min') || '';
  }

  function pcOttawaWindows() {
    if (!(orderDeliveryForm instanceof HTMLFormElement)) return [];
    try {
      return JSON.parse(
        orderDeliveryForm.getAttribute('data-pc-ottawa-windows') || '[]',
      );
    } catch (e) {
      return [];
    }
  }

  function pcSyncScheduleWindowSelect(dateInp, winSel) {
    if (!(winSel instanceof HTMLSelectElement)) return;
    var hasDate =
      dateInp instanceof HTMLInputElement && Boolean(dateInp.value.trim());
    winSel.disabled = !hasDate;
    if (!hasDate) {
      winSel.value = '';
    }
    var placeholder = winSel.querySelector('option[value=""]');
    if (placeholder) {
      placeholder.textContent = hasDate ? 'Select…' : 'Select a day first…';
    }
  }

  function pcReadRecurringStartScheduleFromForm() {
    var dateEl = orderDeliveryForm.querySelector(
      '[data-projectclad-delivery-recurring-start-date]',
    );
    var winEl = orderDeliveryForm.querySelector(
      '[data-projectclad-delivery-recurring-start-window]',
    );
    return {
      scheduledDeliveryDate:
        dateEl instanceof HTMLInputElement ? dateEl.value.trim() : '',
      scheduledDeliveryWindow:
        winEl instanceof HTMLSelectElement ? winEl.value.trim() : '',
    };
  }

  function pcReadAtATimeScheduleFromForm() {
    var recurring = pcReadDeliveryPlanMode() === 'recurring';
    var sched = recurring
      ? pcReadRecurringStartScheduleFromForm()
      : pcReadDeliveryScheduleFromForm();
    return {
      scheduledDeliveryDate: sched.scheduledDeliveryDate,
      scheduledDeliveryWindow: sched.scheduledDeliveryWindow,
      repeatIntervalDays: recurring ? pcReadDeliveryRepeatIntervalDays() : null,
      repeatEndDate: recurring ? pcReadDeliveryRepeatEndDate() : null,
    };
  }

  function pcApplyRecurringPhaseDates(phases, schedule) {
    var interval = schedule.repeatIntervalDays;
    var start = (schedule.scheduledDeliveryDate || '').trim();
    if (!interval || interval < 1 || !start) return phases;
    var endCap = (schedule.repeatEndDate || '').trim();
    return phases.map(function (ph) {
      if (ph.sequence === 1) {
        return {
          sequence: ph.sequence,
          scheduledDeliveryDate: start,
          scheduledDeliveryWindow: schedule.scheduledDeliveryWindow,
          lines: ph.lines,
        };
      }
      var date = pcAddDaysYmd(start, interval * (ph.sequence - 1));
      if (!date || (endCap && date > endCap)) {
        return {
          sequence: ph.sequence,
          scheduledDeliveryDate: '',
          scheduledDeliveryWindow: '',
          lines: ph.lines,
        };
      }
      return {
        sequence: ph.sequence,
        scheduledDeliveryDate: date,
        scheduledDeliveryWindow: schedule.scheduledDeliveryWindow,
        lines: ph.lines,
      };
    });
  }

  function pcReadDeliveryPlanMode() {
    if (!(orderDeliveryForm instanceof HTMLFormElement)) return 'single';
    var checked = orderDeliveryForm.querySelector(
      'input[name="deliveryPlanMode"]:checked',
    );
    var v = checked instanceof HTMLInputElement ? checked.value : 'single';
    return v === 'recurring' ? v : 'single';
  }

  function pcReadDeliveryScheduleFromForm() {
    var dateEl = orderDeliveryForm.querySelector('[data-projectclad-order-delivery-date]');
    var winEl = orderDeliveryForm.querySelector('[data-projectclad-order-delivery-window]');
    return {
      scheduledDeliveryDate:
        dateEl instanceof HTMLInputElement ? dateEl.value.trim() : '',
      scheduledDeliveryWindow:
        winEl instanceof HTMLSelectElement ? winEl.value.trim() : '',
    };
  }

  function pcBuildPhasesFromAtATime(batchByItem) {
    var items = deliveryPhasesState.items || [];
    var schedule = pcReadAtATimeScheduleFromForm();
    var remaining = {};
    items.forEach(function (it) {
      remaining[it.id] = it.quantity;
    });
    var phases = [];
    var seq = 0;
    var anyLeft = true;
    while (anyLeft) {
      anyLeft = false;
      var lines = [];
      items.forEach(function (it) {
        var rem = remaining[it.id] || 0;
        if (rem <= 0) return;
        anyLeft = true;
        var batch = Math.max(1, Math.floor(Number(batchByItem[it.id]) || rem));
        var planned = Math.min(rem, batch);
        remaining[it.id] = rem - planned;
        if (planned > 0) lines.push({ jobItemId: it.id, quantityPlanned: planned });
      });
      if (!lines.length) break;
      seq += 1;
      phases.push({
        sequence: seq,
        scheduledDeliveryDate: seq === 1 ? schedule.scheduledDeliveryDate : '',
        scheduledDeliveryWindow: seq === 1 ? schedule.scheduledDeliveryWindow : '',
        lines: lines,
      });
    }
    var built = phases.length
      ? phases
      : [
          {
            sequence: 1,
            scheduledDeliveryDate: schedule.scheduledDeliveryDate,
            scheduledDeliveryWindow: schedule.scheduledDeliveryWindow,
            lines: items.map(function (it) {
              return { jobItemId: it.id, quantityPlanned: it.quantity };
            }),
          },
        ];
    return pcApplyRecurringPhaseDates(built, schedule);
  }

  function pcReadBatchByItemFromForm() {
    var batch = {};
    var list = orderDeliveryForm.querySelector('[data-projectclad-delivery-batch-list]');
    if (!(list instanceof HTMLElement)) return batch;
    deliveryPhasesState.items.forEach(function (it) {
      var inp = list.querySelector('[data-batch-qty-item="' + it.id + '"]');
      var q =
        inp instanceof HTMLInputElement
          ? Math.max(1, Math.floor(Number(inp.value) || 0))
          : it.quantity;
      batch[it.id] = Math.min(q, it.quantity);
    });
    return batch;
  }

  function pcRenderDeliveryBatchList() {
    var list = orderDeliveryForm.querySelector('[data-projectclad-delivery-batch-list]');
    if (!(list instanceof HTMLElement)) return;
    list.innerHTML = '';
    deliveryPhasesState.items.forEach(function (it) {
      var row = document.createElement('label');
      row.className = 'project-clad-delivery-batch-row';
      var batchVal =
        deliveryPhasesState.batchByItem[it.id] != null
          ? deliveryPhasesState.batchByItem[it.id]
          : it.quantity;
      row.innerHTML =
        '<span class="project-clad-delivery-batch-row__label">' +
        (it.label || 'Line') +
        ' <span class="project-clad-muted">(ordered ' +
        it.quantity +
        ')</span></span><span class="project-clad-delivery-batch-row__field"><span class="project-clad-delivery-batch-row__hint">Per delivery</span><input type="number" min="1" max="' +
        it.quantity +
        '" step="1" data-batch-qty-item="' +
        it.id +
        '" value="' +
        batchVal +
        '" class="project-clad-preferred-delivery-input project-clad-delivery-batch-row__qty" aria-label="Quantity per delivery" /></span>';
      list.appendChild(row);
    });
  }

  function pcPlaceDeliveryFeePreview(planMode) {
    if (!(orderDeliveryForm instanceof HTMLFormElement)) return;
    var fee = orderDeliveryForm.querySelector('[data-projectclad-delivery-fee-preview]');
    if (!(fee instanceof HTMLElement)) return;
    var recurringAnchor = orderDeliveryForm.querySelector(
      '[data-projectclad-delivery-fee-anchor-recurring]',
    );
    var singleAnchor = orderDeliveryForm.querySelector(
      '[data-projectclad-delivery-fee-anchor-single]',
    );
    var target =
      planMode === 'recurring' ? recurringAnchor : singleAnchor;
    if (target instanceof HTMLElement) target.appendChild(fee);
  }

  function pcUpdateDeliveryPlanPreviewTexts(phaseCount) {
    var preview = orderDeliveryForm.querySelector('[data-projectclad-delivery-fee-preview]');
    var info = pcPreviewDeliveryFee();
    var n = phaseCount != null ? phaseCount : deliveryPhasesState.phases.length || 1;
    if (preview instanceof HTMLElement) {
      var rateEl = preview.querySelector('[data-projectclad-delivery-fee-rate]');
      var totalEl = preview.querySelector('[data-projectclad-delivery-fee-total]');
      if (info.method === 'delivery' && info.fee > 0) {
        if (rateEl instanceof HTMLElement) {
          rateEl.textContent =
            'Delivery · $' +
            info.fee.toFixed(2) +
            ' per delivery × ' +
            n;
        }
        if (totalEl instanceof HTMLElement) {
          totalEl.textContent = '$' + (info.fee * n).toFixed(2);
          totalEl.hidden = false;
        }
      } else {
        if (rateEl instanceof HTMLElement) rateEl.textContent = info.line;
        if (totalEl instanceof HTMLElement) totalEl.hidden = true;
      }
    }
    var previewEl = orderDeliveryForm.querySelector('[data-projectclad-delivery-phase-preview]');
    var planMode = pcReadDeliveryPlanMode();
    if (previewEl instanceof HTMLElement) {
      if (planMode === 'recurring') {
        var schedRecur = pcReadAtATimeScheduleFromForm();
        var recurLine =
          schedRecur.repeatIntervalDays && schedRecur.scheduledDeliveryDate
            ? ' Dates repeat every ' + schedRecur.repeatIntervalDays + ' days from the first delivery.'
            : ' Choose a first delivery date and repeat interval.';
        previewEl.textContent =
          n +
          ' deliver' +
          (n === 1 ? 'y' : 'ies') +
          ' from your per-delivery quantities.' +
          recurLine;
      } else {
        previewEl.textContent = 'One delivery with all line quantities.';
      }
    }
  }

  function pcUpdateDeliveryPlanPanels(options) {
    options = options || {};
    var rerenderBatch = options.rerenderBatch !== false;
    var wrap = orderDeliveryForm && orderDeliveryForm.querySelector('[data-projectclad-delivery-phases-wrap]');
    if (!(wrap instanceof HTMLElement)) return;
    var deliveryMode = pcReadOrderDeliveryMode();
    var preview = pcPreviewDeliveryFee();
    wrap.hidden = deliveryMode !== 'delivery' && preview.method !== 'delivery';

    var planMode = pcReadDeliveryPlanMode();
    deliveryPhasesState.planMode = planMode;

    var preferredSched = orderDeliveryForm.querySelector(
      '[data-projectclad-order-delivery-preferred-schedule]',
    );
    if (preferredSched instanceof HTMLElement) {
      preferredSched.hidden = planMode !== 'single';
    }
    var preferredDate = orderDeliveryForm.querySelector(
      '[data-projectclad-order-delivery-date]',
    );
    var preferredWindow = orderDeliveryForm.querySelector(
      '[data-projectclad-order-delivery-window]',
    );
    if (preferredDate instanceof HTMLInputElement) {
      preferredDate.disabled = planMode !== 'single';
    }
    if (preferredWindow instanceof HTMLSelectElement) {
      preferredWindow.disabled =
        planMode !== 'single' ||
        !(preferredDate instanceof HTMLInputElement && preferredDate.value.trim());
    }
    var recurStartDate = orderDeliveryForm.querySelector(
      '[data-projectclad-delivery-recurring-start-date]',
    );
    var recurStartWindow = orderDeliveryForm.querySelector(
      '[data-projectclad-delivery-recurring-start-window]',
    );
    if (recurStartDate instanceof HTMLInputElement) {
      recurStartDate.disabled = planMode !== 'recurring';
    }
    if (recurStartWindow instanceof HTMLSelectElement) {
      recurStartWindow.disabled =
        planMode !== 'recurring' ||
        !(recurStartDate instanceof HTMLInputElement && recurStartDate.value.trim());
    }

    var recurringPanel = orderDeliveryForm.querySelector('[data-projectclad-delivery-recurring-panel]');
    if (recurringPanel instanceof HTMLElement) {
      recurringPanel.hidden = planMode !== 'recurring';
    }

    pcPlaceDeliveryFeePreview(planMode);

    if (planMode === 'recurring') {
      if (rerenderBatch) {
        var existingBatch = pcReadBatchByItemFromForm();
        if (Object.keys(existingBatch).length > 0) {
          deliveryPhasesState.batchByItem = existingBatch;
        }
        pcRenderDeliveryBatchList();
      }
      deliveryPhasesState.batchByItem = pcReadBatchByItemFromForm();
      deliveryPhasesState.phases = pcBuildPhasesFromAtATime(deliveryPhasesState.batchByItem);
    } else if (planMode === 'single') {
      var sched = pcReadDeliveryScheduleFromForm();
      deliveryPhasesState.phases = [
        {
          sequence: 1,
          scheduledDeliveryDate: sched.scheduledDeliveryDate,
          scheduledDeliveryWindow: sched.scheduledDeliveryWindow,
          lines: deliveryPhasesState.items.map(function (it) {
            return { jobItemId: it.id, quantityPlanned: it.quantity };
          }),
        },
      ];
    }

    pcUpdateDeliveryPlanPreviewTexts(deliveryPhasesState.phases.length || 1);
  }

  function pcCollectDeliveryPhasesJson() {
    var planMode = pcReadDeliveryPlanMode();
    if (planMode === 'recurring') {
      var batch = pcReadBatchByItemFromForm();
      return JSON.stringify(pcBuildPhasesFromAtATime(batch));
    }
    if (planMode === 'single') {
      var sched = pcReadDeliveryScheduleFromForm();
      return JSON.stringify([
        {
          sequence: 1,
          scheduledDeliveryDate: sched.scheduledDeliveryDate,
          scheduledDeliveryWindow: sched.scheduledDeliveryWindow,
          lines: deliveryPhasesState.items.map(function (it) {
            return { jobItemId: it.id, quantityPlanned: it.quantity };
          }),
        },
      ]);
    }
    return JSON.stringify([]);
  }

  function pcCollectDeliveryBatchJson() {
    var recurring = pcReadDeliveryPlanMode() === 'recurring';
    return JSON.stringify({
      batchByItem: pcReadBatchByItemFromForm(),
      repeatIntervalDays: recurring ? pcReadDeliveryRepeatIntervalDays() : null,
      repeatEndDate: recurring ? pcReadDeliveryRepeatEndDate() : null,
    });
  }

  function pcParseDeliverySaveError(text, status) {
    if (text && text.trim().indexOf('{') >= 0) {
      var start = text.indexOf('{');
      try {
        var parsed = JSON.parse(text.slice(start));
        if (parsed && typeof parsed.error === 'string' && parsed.error.trim()) {
          return parsed.error.trim();
        }
      } catch (e) {}
    }
    if (status === 403) return 'You cannot edit delivery for this project.';
    if (status >= 500) return 'Server error while saving. Try again or contact support.';
    return 'Could not save delivery options. Reload the page and try again.';
  }

  function pcSyncOrderDeliveryModalUi(onlyBatchQtyUpdate) {
    if (!(orderDeliveryForm instanceof HTMLFormElement)) return;
    var mode = pcReadOrderDeliveryMode();
    var addrWrap = orderDeliveryForm.querySelector('[data-projectclad-order-delivery-address-wrap]');
    if (addrWrap instanceof HTMLElement) {
      addrWrap.hidden = mode !== 'delivery';
    }
    var batchPlanMode = pcReadDeliveryPlanMode();
    if (onlyBatchQtyUpdate && batchPlanMode === 'recurring') {
      deliveryPhasesState.batchByItem = pcReadBatchByItemFromForm();
      deliveryPhasesState.phases = pcBuildPhasesFromAtATime(deliveryPhasesState.batchByItem);
      pcUpdateDeliveryPlanPreviewTexts(deliveryPhasesState.phases.length);
      return;
    }
    pcUpdateDeliveryPlanPreviewTexts(null);
    pcUpdateDeliveryPlanPanels({ rerenderBatch: true });
    var planModeSync = pcReadDeliveryPlanMode();
    var dateInput = orderDeliveryForm.querySelector('[data-projectclad-order-delivery-date]');
    var windowSelect = orderDeliveryForm.querySelector('[data-projectclad-order-delivery-window]');
    if (dateInput instanceof HTMLInputElement) {
      dateInput.disabled = planModeSync !== 'single';
    }
    pcSyncScheduleWindowSelect(dateInput, windowSelect);
    var recurDateInput = orderDeliveryForm.querySelector(
      '[data-projectclad-delivery-recurring-start-date]',
    );
    var recurWindowSelect = orderDeliveryForm.querySelector(
      '[data-projectclad-delivery-recurring-start-window]',
    );
    if (recurDateInput instanceof HTMLInputElement) {
      recurDateInput.disabled = planModeSync !== 'recurring';
    }
    pcSyncScheduleWindowSelect(recurDateInput, recurWindowSelect);
  }

  function pcOpenOrderDeliveryModal(btn) {
    if (!(orderDeliveryModal instanceof HTMLElement)) return;
    if (!(orderDeliveryForm instanceof HTMLFormElement)) return;
    var jobIdInput = orderDeliveryForm.querySelector('[data-projectclad-order-delivery-job-id]');
    if (jobIdInput instanceof HTMLInputElement) {
      jobIdInput.value = btn.getAttribute('data-job-id') || '';
    }
    var mode = btn.getAttribute('data-delivery-mode') || 'inherit';
    orderDeliveryForm.querySelectorAll('input[name="deliveryMode"]').forEach(function (inp) {
      if (!(inp instanceof HTMLInputElement)) return;
      inp.checked = inp.value === mode;
    });
    function setField(name, val) {
      var el = orderDeliveryForm.querySelector('[name="' + name + '"]');
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
        el.value = val || '';
      }
    }
    setField('shipAddress1', btn.getAttribute('data-ship-address1'));
    setField('shipCity', btn.getAttribute('data-ship-city'));
    setField('shipProvince', btn.getAttribute('data-ship-province'));
    setField('shipPostal', btn.getAttribute('data-ship-postal'));
    setField('shipCountry', btn.getAttribute('data-ship-country') || 'Canada');
    var jobIdOpen = btn.getAttribute('data-job-id') || '';
    var parsedPlan = pcParsePhasePlanFromJob(jobIdOpen);
    deliveryPhasesState.items = parsedPlan.items || [];
    deliveryPhasesState.phases = parsedPlan.phases || [];
    deliveryPhasesState.planMode = parsedPlan.planMode || 'single';
    deliveryPhasesState.batchByItem = parsedPlan.batchByItem || {};
    deliveryPhasesState.repeatIntervalDays = parsedPlan.repeatIntervalDays;
    deliveryPhasesState.repeatEndDate = parsedPlan.repeatEndDate;
    var repeatSel = orderDeliveryForm.querySelector('[data-projectclad-delivery-repeat-interval]');
    if (repeatSel instanceof HTMLSelectElement) {
      repeatSel.value =
        parsedPlan.repeatIntervalDays != null
          ? String(parsedPlan.repeatIntervalDays)
          : '7';
    }
    var repeatEnd = orderDeliveryForm.querySelector('[data-projectclad-delivery-repeat-end]');
    if (repeatEnd instanceof HTMLInputElement) {
      repeatEnd.value = parsedPlan.repeatEndDate || '';
    }
    if (!deliveryPhasesState.phases.length) {
      deliveryPhasesState.phases = [
        {
          sequence: 1,
          scheduledDeliveryDate: '',
          scheduledDeliveryWindow: '',
          lines: (deliveryPhasesState.items || []).map(function (it) {
            return { jobItemId: it.id, quantityPlanned: it.quantity };
          }),
        },
      ];
    }
    var phase1Open = deliveryPhasesState.phases[0] || null;
    var jobDate = btn.getAttribute('data-scheduled-date') || '';
    var jobWindow = btn.getAttribute('data-scheduled-window') || '';
    setField(
      'scheduledDeliveryDate',
      deliveryPhasesState.planMode === 'single'
        ? phase1Open?.scheduledDeliveryDate || jobDate
        : jobDate,
    );
    setField(
      'scheduledDeliveryWindow',
      deliveryPhasesState.planMode === 'single'
        ? phase1Open?.scheduledDeliveryWindow || jobWindow
        : jobWindow,
    );
    setField(
      'deliveryRecurringStartDate',
      phase1Open?.scheduledDeliveryDate || jobDate,
    );
    setField(
      'deliveryRecurringStartWindow',
      phase1Open?.scheduledDeliveryWindow || jobWindow,
    );
    orderDeliveryForm.querySelectorAll('input[name="deliveryPlanMode"]').forEach(function (inp) {
      if (!(inp instanceof HTMLInputElement)) return;
      inp.checked = inp.value === deliveryPhasesState.planMode;
    });
    var msg = orderDeliveryForm.querySelector('[data-projectclad-order-delivery-message]');
    if (msg instanceof HTMLElement) msg.textContent = '';
    var planLocked = btn.getAttribute('data-plan-locked') === '1';
    var canEditPlan = btn.getAttribute('data-can-edit-plan') === '1';
    var planReadOnly = planLocked || !canEditPlan;
    if (orderDeliveryModal instanceof HTMLElement) {
      orderDeliveryModal.setAttribute(
        'data-current-plan-locked',
        planReadOnly ? '1' : '0',
      );
    }
    pcSetDeliveryModalPlanLocked(planReadOnly);
    pcShowDeliveryModalJobPanels(jobIdOpen);
    var openTab = btn.getAttribute('data-delivery-open-tab') || '';
    pcSetDeliveryModalTab(openTab || pcDefaultDeliveryModalTab(btn));
    pcSyncOrderDeliveryModalUi();
    orderDeliveryModal.style.display = 'flex';
  }

  function pcCloseOrderDeliveryModal() {
    if (orderDeliveryModal instanceof HTMLElement) {
      orderDeliveryModal.style.display = 'none';
    }
  }

  (function pcOpenDeliveryDocumentsFromUrl() {
    try {
      var params = new URLSearchParams(window.location.search);
      var jobId = params.get('job');
      if (!jobId || params.get('deliveryTab') !== 'documents') return;
      var btn = document.querySelector(
        '[data-projectclad-delivery-options][data-job-id="' + jobId + '"]',
      );
      if (!(btn instanceof HTMLElement)) return;
      pcOpenOrderDeliveryModal(btn);
    } catch (e) {
      /* ignore */
    }
  })();

  function pcSetDeliveryModalPlanLocked(locked) {
    if (!(orderDeliveryForm instanceof HTMLFormElement)) return;
    var lockedNote = orderDeliveryForm.querySelector(
      '[data-projectclad-delivery-plan-locked-note]',
    );
    if (lockedNote instanceof HTMLElement) {
      lockedNote.hidden = !locked;
    }
    orderDeliveryForm.querySelectorAll('input, select, textarea, button').forEach(function (el) {
      if (!(el instanceof HTMLElement)) return;
      if (el.matches('[data-projectclad-order-delivery-cancel]')) return;
      if (el.matches('[data-projectclad-order-delivery-save]')) {
        el.hidden = locked;
        return;
      }
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement
      ) {
        el.disabled = locked;
      }
    });
  }

  function pcShowDeliveryModalJobPanels(jobId) {
    if (!(orderDeliveryModal instanceof HTMLElement)) return;
    orderDeliveryModal
      .querySelectorAll('[data-projectclad-delivery-fulfillment-job]')
      .forEach(function (panel) {
        if (!(panel instanceof HTMLElement)) return;
        panel.hidden = panel.getAttribute('data-projectclad-delivery-fulfillment-job') !== jobId;
      });
    orderDeliveryModal
      .querySelectorAll('[data-projectclad-delivery-documents-job]')
      .forEach(function (panel) {
        if (!(panel instanceof HTMLElement)) return;
        panel.hidden = panel.getAttribute('data-projectclad-delivery-documents-job') !== jobId;
      });
  }

  function pcSetDeliveryModalTab(tab) {
    if (!(orderDeliveryModal instanceof HTMLElement)) return;
    var tabsNav = orderDeliveryModal.querySelector('[data-projectclad-delivery-modal-tabs]');
    if (tabsNav instanceof HTMLElement) {
      tabsNav.querySelectorAll('[data-projectclad-delivery-tab]').forEach(function (btn) {
        if (!(btn instanceof HTMLElement)) return;
        var isActive = btn.getAttribute('data-projectclad-delivery-tab') === tab;
        btn.classList.toggle('is-active', isActive);
      });
    }
    orderDeliveryModal
      .querySelectorAll('[data-projectclad-delivery-tab-panel]')
      .forEach(function (panel) {
        if (!(panel instanceof HTMLElement)) return;
        panel.hidden = panel.getAttribute('data-projectclad-delivery-tab-panel') !== tab;
      });
    var saveBtn = orderDeliveryModal.querySelector('[data-projectclad-order-delivery-save]');
    if (saveBtn instanceof HTMLElement) {
      var planLocked =
        orderDeliveryModal.getAttribute('data-current-plan-locked') === '1';
      saveBtn.hidden = tab !== 'plan' || planLocked;
    }
  }

  function pcDefaultDeliveryModalTab(btn) {
    var staff = btn.getAttribute('data-staff-fulfillment') === '1';
    var lifecycle = (btn.getAttribute('data-order-lifecycle') || '').toLowerCase();
    var planLocked = btn.getAttribute('data-plan-locked') === '1';
    var deliveredPct = parseInt(btn.getAttribute('data-delivered-percent') || '0', 10) || 0;
    if (staff && (lifecycle === 'ordered' || lifecycle === 'delivered')) {
      return 'fulfillment';
    }
    if (
      lifecycle === 'ordered' ||
      lifecycle === 'delivered' ||
      lifecycle === 'paid' ||
      planLocked ||
      deliveredPct > 0
    ) {
      return staff ? 'fulfillment' : 'documents';
    }
    return 'plan';
  }

  if (orderDeliveryForm instanceof HTMLFormElement) {
    orderDeliveryForm.addEventListener('change', function (ev) {
      var t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.matches('input[name="deliveryPlanMode"]')) {
        var prevPlanMode = deliveryPhasesState.planMode;
        var nextPlanMode =
          t instanceof HTMLInputElement ? t.value : prevPlanMode;
        if (nextPlanMode === 'recurring' && prevPlanMode === 'single') {
          var schedSingle = pcReadDeliveryScheduleFromForm();
          var recurDateInp = orderDeliveryForm.querySelector(
            '[data-projectclad-delivery-recurring-start-date]',
          );
          var recurWinSel = orderDeliveryForm.querySelector(
            '[data-projectclad-delivery-recurring-start-window]',
          );
          if (recurDateInp instanceof HTMLInputElement) {
            recurDateInp.value = schedSingle.scheduledDeliveryDate;
          }
          if (recurWinSel instanceof HTMLSelectElement) {
            recurWinSel.value = schedSingle.scheduledDeliveryWindow;
          }
        }
      }
      if (
        t.matches('input[name="deliveryMode"]') ||
        t.matches('input[name="deliveryPlanMode"]') ||
        t.matches('[data-projectclad-delivery-address-input]') ||
        t.matches('[data-projectclad-order-delivery-date]') ||
        t.matches('[data-projectclad-delivery-recurring-start-date]') ||
        t.matches('[data-projectclad-delivery-recurring-start-window]') ||
        t.matches('[data-projectclad-delivery-repeat-interval]') ||
        t.matches('[data-projectclad-delivery-repeat-end]')
      ) {
        pcSyncOrderDeliveryModalUi(false);
      }
      if (t.matches('[data-batch-qty-item]')) {
        pcSyncOrderDeliveryModalUi(true);
      }
    });
    orderDeliveryForm.addEventListener('input', function (ev) {
      var t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.matches('[data-batch-qty-item]')) {
        pcSyncOrderDeliveryModalUi(true);
        return;
      }
      if (t.matches('[data-projectclad-delivery-address-input]')) {
        pcSyncOrderDeliveryModalUi(false);
      }
    });
  }

  function pcSyncEditProjectDeliveryPanels() {
    var main = getEditProjectMainForm();
    if (!(main instanceof HTMLFormElement)) return;
    var receive = main.querySelector('input[name="projectReceiveMode"]:checked');
    var receiveVal = receive instanceof HTMLInputElement ? receive.value : 'pickup';
    var projAddr = main.querySelector('[data-projectclad-edit-project-delivery-address]');
    if (projAddr instanceof HTMLElement) {
      projAddr.hidden = receiveVal !== 'delivery';
    }
    var newMode = main.querySelector('input[name="newOrderDeliveryMode"]:checked');
    var newVal = newMode instanceof HTMLInputElement ? newMode.value : 'inherit';
    var newAddr = main.querySelector('[data-projectclad-new-order-delivery-address]');
    if (newAddr instanceof HTMLElement) {
      newAddr.hidden = newVal !== 'delivery';
    }
  }

  document.querySelectorAll('input[name="projectReceiveMode"]').forEach(function (inp) {
    inp.addEventListener('change', pcSyncEditProjectDeliveryPanels);
  });
  document.querySelectorAll('input[name="newOrderDeliveryMode"]').forEach(function (inp) {
    inp.addEventListener('change', pcSyncEditProjectDeliveryPanels);
  });
  pcSyncEditProjectDeliveryPanels();

  function pcReadSiteContactForJob(jobId) {
    var safeId = String(jobId || '').replace(/"/g, '');
    var details = document.querySelector(
      'details.project-clad-order-row[data-job-id="' + safeId + '"]',
    );
    var name = '';
    var phone = '';
    if (details) {
      var nameInput = details.querySelector('[data-projectclad-site-contact-name-input]');
      var phoneInput = details.querySelector('[data-projectclad-site-contact-phone-input]');
      if (nameInput instanceof HTMLInputElement) name = nameInput.value.trim();
      if (phoneInput instanceof HTMLInputElement) phone = phoneInput.value.trim();
    }
    return { siteContactName: name, siteContactPhone: phone };
  }

  function pcSyncOrderNowButtonForJob(jobId) {
    var safeId = String(jobId || '').replace(/"/g, '');
    if (!safeId) return;
    var details = document.querySelector(
      'details.project-clad-order-row[data-job-id="' + safeId + '"]',
    );
    if (!details) return;
    var btn = details.querySelector('[data-projectclad-order-now-submit]');
    if (!(btn instanceof HTMLButtonElement)) return;
    if (btn.getAttribute('aria-busy') === 'true') return;
    var nameInput = details.querySelector('[data-projectclad-site-contact-name-input]');
    var phoneInput = details.querySelector('[data-projectclad-site-contact-phone-input]');
    if (!(nameInput instanceof HTMLInputElement) || !(phoneInput instanceof HTMLInputElement)) {
      return;
    }
    var ok = nameInput.value.trim().length > 0 && phoneInput.value.trim().length > 0;
    btn.disabled = !ok;
    btn.setAttribute('data-has-site-contact', ok ? '1' : '0');
    if (!ok) {
      btn.title = 'Add site contact & phone first.';
      btn.setAttribute('aria-label', 'Add site contact and phone first');
    } else {
      btn.title = 'Confirm & Pay';
      btn.setAttribute('aria-label', 'Confirm and pay');
    }
  }

  function pcSyncAllOrderNowButtons() {
    document.querySelectorAll('[data-projectclad-order-now-submit]').forEach(function (btn) {
      if (!(btn instanceof HTMLButtonElement)) return;
      pcSyncOrderNowButtonForJob(btn.getAttribute('data-job-id') || '');
    });
  }

  document.addEventListener('input', function (event) {
    var t = event.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (
      !t.hasAttribute('data-projectclad-site-contact-name-input') &&
      !t.hasAttribute('data-projectclad-site-contact-phone-input')
    ) {
      return;
    }
    pcSyncOrderNowButtonForJob(t.getAttribute('data-job-id') || '');
  });
  document.addEventListener('change', function (event) {
    var t = event.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (
      !t.hasAttribute('data-projectclad-site-contact-name-input') &&
      !t.hasAttribute('data-projectclad-site-contact-phone-input')
    ) {
      return;
    }
    pcSyncOrderNowButtonForJob(t.getAttribute('data-job-id') || '');
  });
  pcSyncAllOrderNowButtons();

  document.addEventListener('click', (event) => {
    var tOnow = event.target;
    if (tOnow && tOnow.nodeType === 3 && tOnow.parentElement) {
      tOnow = tOnow.parentElement;
    }
    var onowBtn =
      tOnow && tOnow.closest && tOnow.closest('[data-projectclad-order-now-submit]');
    if (onowBtn instanceof HTMLButtonElement && !onowBtn.disabled) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (
        !window.confirm(
          'Please ensure delivery details are correct. Use Delivery options on this order or Edit project for defaults before placing.',
        )
      ) {
        return;
      }
      var onowJobId = onowBtn.getAttribute('data-job-id') || '';
      if (!onowJobId) return;
      var onowHasDel = onowBtn.getAttribute('data-has-delivery') === '1';
      var onowMethod = onowHasDel ? 'delivery' : 'pickup';
      var onowPath = window.location.pathname + window.location.search;
      var onowContact = pcReadSiteContactForJob(onowJobId);
      onowBtn.disabled = true;
      fetch(onowPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          intent: 'confirm-order-now',
          jobId: onowJobId,
          fulfillmentMethod: onowMethod,
          siteContactName: onowContact.siteContactName,
          siteContactPhone: onowContact.siteContactPhone,
        }),
      })
        .then(function (res) {
          return res.text().then(function (text) {
            return { res: res, text: text };
          });
        })
        .then(function (o) {
          var payload = null;
          try {
            payload = o.text ? JSON.parse(o.text) : null;
          } catch (e) {}
          if (payload && payload.redirectTo) {
            window.location.href = payload.redirectTo;
            return;
          }
          var errLine = (payload && payload.error) || null;
          if (!o.res.ok || errLine) {
            window.alert(errLine || 'Unable to confirm order.');
            onowBtn.disabled = false;
            pcSyncOrderNowButtonForJob(onowJobId);
            return;
          }
          window.location.reload();
        })
        .catch(function () {
          window.alert('Unable to confirm order.');
          onowBtn.disabled = false;
          pcSyncOrderNowButtonForJob(onowJobId);
        });
      return;
    }
    const addMemberToggle = event.target?.closest?.('[data-projectclad-add-member-popover-toggle]');
    if (addMemberToggle instanceof HTMLElement) {
      event.preventDefault();
      event.stopPropagation();
      const pop = document.querySelector('[data-projectclad-add-member-popover]');
      if (pop instanceof HTMLElement) {
        const open = isAddMemberPopoverOpen(pop);
        if (open) {
          closeAddMemberPopover(pop, addMemberToggle);
        } else {
          openAddMemberPopover(pop, addMemberToggle);
          const email = document.getElementById('member-email-header');
          if (email instanceof HTMLElement) setTimeout(function() { email.focus(); }, 30);
        }
      }
      return;
    }

    const editProjectBtn = event.target?.closest?.('[data-projectclad-edit-project-details]');
    if (editProjectBtn instanceof HTMLElement) {
      event.preventDefault();
      const popOver = document.querySelector('[data-projectclad-add-member-popover]');
      const popToggle = document.querySelector('[data-projectclad-add-member-popover-toggle]');
      if (popOver instanceof HTMLElement) {
        closeAddMemberPopover(popOver, popToggle);
      }
      openEditProjectModal();
    }
    const editProjectClose = event.target?.closest?.('[data-projectclad-edit-project-close]');
    if (editProjectClose) {
      requestCloseEditProjectModal();
    }
    const editProjectCancel = event.target?.closest?.('[data-projectclad-edit-project-cancel]');
    if (editProjectCancel) {
      requestCloseEditProjectModal();
    }
    if (event.target?.closest?.('[data-projectclad-edit-project-modal]') === event.target) {
      requestCloseEditProjectModal();
    }

    const editUnsavedBackdrop = event.target?.closest?.('[data-projectclad-edit-project-unsaved-modal]');
    if (editUnsavedBackdrop && editUnsavedBackdrop === event.target) {
      closeEditProjectUnsavedModal();
    }
    const editUnsavedCancel = event.target?.closest?.('[data-projectclad-edit-project-unsaved-cancel]');
    if (editUnsavedCancel) {
      closeEditProjectUnsavedModal();
    }
    const editUnsavedDiscard = event.target?.closest?.('[data-projectclad-edit-project-unsaved-discard]');
    if (editUnsavedDiscard) {
      var discardForm = getEditProjectMainForm();
      if (discardForm instanceof HTMLFormElement) discardForm.reset();
      closeEditProjectUnsavedModal();
      closeEditProjectModal();
    }
    const editUnsavedSave = event.target?.closest?.('[data-projectclad-edit-project-unsaved-save]');
    if (editUnsavedSave) {
      var saveForm = getEditProjectMainForm();
      if (saveForm instanceof HTMLFormElement) {
        closeEditProjectUnsavedModal();
        if (typeof saveForm.requestSubmit === 'function') {
          saveForm.requestSubmit();
        } else {
          saveForm.submit();
        }
      }
    }

    const deliveryTabBtn = event.target?.closest?.('[data-projectclad-delivery-tab]');
    if (deliveryTabBtn instanceof HTMLElement) {
      event.preventDefault();
      var tabName = deliveryTabBtn.getAttribute('data-projectclad-delivery-tab');
      if (tabName) pcSetDeliveryModalTab(tabName);
      return;
    }
    const deliveryOptionsBtn = event.target?.closest?.('[data-projectclad-delivery-options]');
    if (deliveryOptionsBtn instanceof HTMLElement) {
      event.preventDefault();
      event.stopPropagation();
      if (
        deliveryOptionsBtn.disabled ||
        deliveryOptionsBtn.getAttribute('aria-disabled') === 'true'
      ) {
        return;
      }
      pcOpenOrderDeliveryModal(deliveryOptionsBtn);
      return;
    }
    const deliverySaveBtn = event.target?.closest?.('[data-projectclad-order-delivery-save]');
    if (deliverySaveBtn instanceof HTMLElement) {
      event.preventDefault();
      if (!(orderDeliveryForm instanceof HTMLFormElement)) return;
      var deliveryMsg = orderDeliveryForm.querySelector('[data-projectclad-order-delivery-message]');
      if (deliveryMsg instanceof HTMLElement) deliveryMsg.textContent = '';
      var previewInfo = pcPreviewDeliveryFee();
      var modeSave = pcReadOrderDeliveryMode();
      if (modeSave === 'delivery' && previewInfo.fee <= 0 && previewInfo.method === 'delivery') {
        if (deliveryMsg instanceof HTMLElement) {
          deliveryMsg.textContent =
            'Enter a complete delivery address, or choose store pickup.';
        }
        return;
      }
      var planModeSave = pcReadDeliveryPlanMode();
      if (planModeSave === 'recurring' && modeSave === 'delivery') {
        var jobIdInputSave = orderDeliveryForm.querySelector('[data-projectclad-order-delivery-job-id]');
        if (
          jobIdInputSave instanceof HTMLInputElement &&
          !deliveryPhasesState.items.length
        ) {
          var reparsed = pcParsePhasePlanFromJob(jobIdInputSave.value || '');
          deliveryPhasesState.items = reparsed.items || [];
        }
        if (!deliveryPhasesState.items.length) {
          if (deliveryMsg instanceof HTMLElement) {
            deliveryMsg.textContent =
              'Add line items to this order before saving a delivery plan.';
          }
          return;
        }
        var batchCheck = pcReadBatchByItemFromForm();
        var batchMissing = deliveryPhasesState.items.some(function (it) {
          return !batchCheck[it.id] || batchCheck[it.id] < 1;
        });
        if (batchMissing) {
          if (deliveryMsg instanceof HTMLElement) {
            deliveryMsg.textContent =
              'Enter a quantity per delivery for each line.';
          }
          return;
        }
        var repeatDays = pcReadDeliveryRepeatIntervalDays();
        var startSched = pcReadRecurringStartScheduleFromForm();
        if (!repeatDays) {
          if (deliveryMsg instanceof HTMLElement) {
            deliveryMsg.textContent =
              'Choose how often deliveries repeat.';
          }
          return;
        }
        if (!startSched.scheduledDeliveryDate) {
          if (deliveryMsg instanceof HTMLElement) {
            deliveryMsg.textContent =
              'Choose a date for the first recurring delivery.';
          }
          return;
        }
      }
      deliverySaveBtn.disabled = true;
      var saveUrlDel = new URL(window.location.href);
      saveUrlDel.searchParams.set('pcJson', '1');
      var phasesHidden = orderDeliveryForm.querySelector('[data-projectclad-delivery-phases-json]');
      if (phasesHidden instanceof HTMLInputElement) {
        phasesHidden.value = pcCollectDeliveryPhasesJson();
      }
      var batchHidden = orderDeliveryForm.querySelector('[data-projectclad-delivery-batch-json]');
      if (batchHidden instanceof HTMLInputElement) {
        batchHidden.value = pcCollectDeliveryBatchJson();
      }
      var fdDel = new FormData(orderDeliveryForm);
      fetch(saveUrlDel.pathname + saveUrlDel.search, {
        method: 'POST',
        credentials: 'include',
        body: fdDel,
      })
        .then(function (res) {
          return res.text().then(function (text) {
            return { res: res, text: text };
          });
        })
        .then(function (o) {
          var ack = null;
          try {
            ack = o.text.trim().indexOf('{') === 0 ? JSON.parse(o.text) : null;
          } catch (e) {}
          if (!o.res.ok || (ack && ack.error)) {
            var err =
              (ack && typeof ack.error === 'string' && ack.error) ||
              pcParseDeliverySaveError(o.text, o.res.status);
            if (deliveryMsg instanceof HTMLElement) deliveryMsg.textContent = err;
            return;
          }
          pcCloseOrderDeliveryModal();
          var u = new URL(window.location.href);
          u.searchParams.delete('pcJson');
          window.location.replace(u.pathname + u.search);
        })
        .catch(function () {
          if (deliveryMsg instanceof HTMLElement) {
            deliveryMsg.textContent = "Couldn't save — check your connection.";
          }
        })
        .finally(function () {
          deliverySaveBtn.disabled = false;
        });
      return;
    }
    const deliveryCancelBtn =
      event.target?.closest?.('[data-projectclad-order-delivery-cancel]') ||
      event.target?.closest?.('[data-projectclad-order-delivery-close]');
    if (deliveryCancelBtn) {
      event.preventDefault();
      pcCloseOrderDeliveryModal();
      return;
    }
    if (event.target === orderDeliveryModal) {
      pcCloseOrderDeliveryModal();
      return;
    }

    const editNewOrderCreate = event.target?.closest?.('[data-projectclad-edit-project-create-order]');
    if (editNewOrderCreate instanceof HTMLElement) {
      event.preventDefault();
      var mainFormCreate = getEditProjectMainForm();
      var msgNewOrder = document.querySelector('[data-projectclad-edit-project-new-order-message]');
      var setNewOrderMsg = function (t) {
        if (msgNewOrder instanceof HTMLElement) msgNewOrder.textContent = t || '';
      };
      setNewOrderMsg('');
      if (!(mainFormCreate instanceof HTMLFormElement)) return;
      var projectIdCreate = mainFormCreate.getAttribute('data-projectclad-project-id') || '';
      if (!projectIdCreate) return;
      var nameInCreate = mainFormCreate.querySelector('input[name="newOrderJobName"]');
      var poInCreate = mainFormCreate.querySelector('input[name="newOrderPurchaseOrderNumber"]');
      var jobNameCreate = nameInCreate instanceof HTMLInputElement ? nameInCreate.value.trim() : '';
      var poCreate = poInCreate instanceof HTMLInputElement ? poInCreate.value.trim() : '';
      if (!jobNameCreate) {
        setNewOrderMsg('Order name is required.');
        return;
      }
      var createBtnEl = editNewOrderCreate;
      if (createBtnEl instanceof HTMLButtonElement) createBtnEl.disabled = true;
      var qpCreate = new URLSearchParams({
        intent: 'create-job',
        projectId: projectIdCreate,
        jobName: jobNameCreate,
        purchaseOrderNumber: poCreate,
      });
      var newDelModeInp = mainFormCreate.querySelector('input[name="newOrderDeliveryMode"]:checked');
      var newDelMode =
        newDelModeInp instanceof HTMLInputElement ? newDelModeInp.value : 'inherit';
      qpCreate.set('deliveryMode', newDelMode);
      if (newDelMode === 'delivery') {
        ['shipAddress1', 'shipCity', 'shipProvince', 'shipPostal', 'shipCountry'].forEach(
          function (field) {
            var el = mainFormCreate.querySelector('[name="' + field + '"]');
            if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
              qpCreate.set(field, el.value.trim());
            }
          },
        );
      }
      fetch(actionsEndpoint + '?' + qpCreate.toString(), { credentials: 'include' })
        .then(function (res) {
          return res.json().then(function (payload) {
            return { res: res, payload: payload };
          });
        })
        .then(function (o) {
          if (createBtnEl instanceof HTMLButtonElement) createBtnEl.disabled = false;
          if (!o.res.ok) {
            if (o.payload && o.payload.redirectTo) {
              window.location.href = o.payload.redirectTo;
              return;
            }
            setNewOrderMsg((o.payload && o.payload.error) || 'Unable to complete action.');
            return;
          }
          if (o.payload && o.payload.error) {
            setNewOrderMsg(o.payload.error);
            return;
          }
          window.location.reload();
        })
        .catch(function () {
          if (createBtnEl instanceof HTMLButtonElement) createBtnEl.disabled = false;
          setNewOrderMsg('Unable to complete action.');
        });
      return;
    }

    const editNewOrderClear = event.target?.closest?.('[data-projectclad-edit-project-new-order-clear]');
    if (editNewOrderClear) {
      event.preventDefault();
      var mainFormClear = getEditProjectMainForm();
      if (mainFormClear instanceof HTMLFormElement) {
        var nameInClear = mainFormClear.querySelector('input[name="newOrderJobName"]');
        var poInClear = mainFormClear.querySelector('input[name="newOrderPurchaseOrderNumber"]');
        if (nameInClear instanceof HTMLInputElement) nameInClear.value = '';
        if (poInClear instanceof HTMLInputElement) poInClear.value = '';
      }
      var msgClear = document.querySelector('[data-projectclad-edit-project-new-order-message]');
      if (msgClear instanceof HTMLElement) msgClear.textContent = '';
      captureEditProjectBaseline();
      return;
    }

    const deleteProjectOpen = event.target?.closest?.('[data-projectclad-delete-project-open]');
    if (deleteProjectOpen instanceof HTMLElement) {
      event.preventDefault();
      const modal = document.querySelector('[data-projectclad-delete-project-modal]');
      if (modal instanceof HTMLElement) modal.style.display = 'flex';
    }
    const deleteProjectCancel = event.target?.closest?.('[data-projectclad-delete-project-cancel]');
    if (deleteProjectCancel) {
      const modal = document.querySelector('[data-projectclad-delete-project-modal]');
      if (modal instanceof HTMLElement) modal.style.display = 'none';
    }
    const deleteProjectBackdrop = event.target?.closest?.('[data-projectclad-delete-project-modal]');
    if (deleteProjectBackdrop && deleteProjectBackdrop === event.target) {
      const modal = document.querySelector('[data-projectclad-delete-project-modal]');
      if (modal instanceof HTMLElement) modal.style.display = 'none';
    }

    const addMemberPopoverEl = document.querySelector('[data-projectclad-add-member-popover]');
    if (isAddMemberPopoverOpen(addMemberPopoverEl)) {
      if (!event.target?.closest?.('[data-projectclad-add-member-popover]') && !event.target?.closest?.('[data-projectclad-add-member-popover-toggle]')) {
        const tt = document.querySelector('[data-projectclad-add-member-popover-toggle]');
        closeAddMemberPopover(addMemberPopoverEl, tt);
      }
    }
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const pop = document.querySelector('[data-projectclad-add-member-popover]');
    const tgl = document.querySelector('[data-projectclad-add-member-popover-toggle]');
    if (isAddMemberPopoverOpen(pop)) {
      closeAddMemberPopover(pop, tgl);
      return;
    }
    const editProjModal = document.querySelector('[data-projectclad-edit-project-modal]');
    const unsavedEl = document.querySelector('[data-projectclad-edit-project-unsaved-modal]');
    var unsavedOpen =
      unsavedEl instanceof HTMLElement && unsavedEl.style.display === 'flex';
    if (unsavedOpen) {
      closeEditProjectUnsavedModal();
      return;
    }
    if (
      editProjModal instanceof HTMLElement &&
      editProjModal.classList.contains('project-clad-edit-project-modal--open')
    ) {
      requestCloseEditProjectModal();
    }
  });

  /* Capture phase so declining also cancels the ajax hub below, which would otherwise
     preventDefault and fetch regardless. Declarative rather than keyed off intent so it
     guards plain POST forms too, and so it stays the single confirm if React ever hydrates. */
  document.addEventListener(
    'submit',
    function (event) {
      var confirmForm = event.target;
      if (!(confirmForm instanceof HTMLFormElement)) return;
      var confirmMessage = confirmForm.getAttribute('data-projectclad-confirm');
      if (!confirmMessage) return;
      if (window.confirm(confirmMessage)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );

  document.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.hasAttribute('data-projectclad-reject-form')) return;
    if (!form.hasAttribute('data-projectclad-ajax')) return;
    event.preventDefault();
    const messageNode = form.querySelector('[data-projectclad-form-message]');
    const setFormMessage = (text) => {
      if (messageNode) {
        messageNode.textContent = text || '';
      } else if (form.hasAttribute('data-projectclad-member-form')) {
        setMemberMessage(text);
      }
    };
    setFormMessage('');

    const intent = form.getAttribute('data-projectclad-intent') || '';
    const projectId = form.getAttribute('data-projectclad-project-id') || '';

    if (intent === 'delete-job' && !confirm('Are you sure you want to delete this order?')) {
      return;
    }
    if (intent === 'delete-item' && !confirm('Are you sure you want to remove this item?')) {
      return;
    }
    const memberCustomerId =
      form.getAttribute('data-projectclad-member-id') || '';

    /* Without this the page looks frozen: these submits round-trip to the server and then reload,
       so an un-disabled button invites a second click that fires the action twice.
       form.elements (not querySelectorAll) also covers buttons attached from outside the form via
       the form attribute — e.g. "Add member" in the modal footer. */
    var busySubmitters = Array.prototype.slice
      .call(form.elements)
      .filter(function (el) {
        if (el.disabled) return false;
        return (el.tagName === 'BUTTON' || el.tagName === 'INPUT') && el.type === 'submit';
      });
    var busyActive = false;
    var navigating = false;
    var setBusy = function (busy) {
      busyActive = busy;
      form.setAttribute('aria-busy', busy ? 'true' : 'false');
      busySubmitters.forEach(function (el) {
        el.disabled = busy;
        var busyLabel = el.getAttribute('data-projectclad-busy-label');
        if (!busyLabel) return;
        if (busy) {
          el.setAttribute('data-projectclad-idle-label', el.textContent || '');
          el.textContent = busyLabel;
        } else {
          var idle = el.getAttribute('data-projectclad-idle-label');
          if (idle !== null) {
            el.textContent = idle;
            el.removeAttribute('data-projectclad-idle-label');
          }
        }
      });
    };
    var releaseBusy = function () {
      if (busyActive) setBusy(false);
    };
    setBusy(true);

    const params = new URLSearchParams({ intent, projectId });
    const passwordInput = form.querySelector('input[name="password"]');
    const jobNameInput = form.querySelector('input[name="jobName"]');
    const purchaseOrderInput = form.querySelector('input[name="purchaseOrderNumber"]');
    const jobIdInput = form.querySelector('input[name="jobId"]');
    const itemIdInput = form.querySelector('input[name="itemId"]');
    const approveJobIdInput = form.querySelector('input[name="approveJobId"]');
    const approveItemIdInput = form.querySelector('input[name="approveItemId"]');
    const emailInput = form.querySelector('input[name="email"]');
    const roleSelect = form.querySelector('select[name="role"]');
    const roleRadio = form.querySelector('input[name="role"]:checked');

    if (passwordInput instanceof HTMLInputElement) {
      params.set('password', passwordInput.value.trim());
    }
    if (jobNameInput instanceof HTMLInputElement) {
      params.set('jobName', jobNameInput.value.trim());
    }
    if (purchaseOrderInput instanceof HTMLInputElement) {
      params.set('purchaseOrderNumber', purchaseOrderInput.value.trim());
    }
    if (jobIdInput instanceof HTMLInputElement) {
      params.set('jobId', jobIdInput.value);
    }
    if (itemIdInput instanceof HTMLInputElement) {
      params.set('itemId', itemIdInput.value);
    }
    if (approveJobIdInput instanceof HTMLInputElement) {
      params.set('approveJobId', approveJobIdInput.value);
    }
    if (approveItemIdInput instanceof HTMLInputElement) {
      params.set('approveItemId', approveItemIdInput.value);
    }
    if (emailInput instanceof HTMLInputElement) {
      params.set('email', emailInput.value.trim());
    }
    if (roleSelect instanceof HTMLSelectElement) {
      params.set('role', roleSelect.value);
    } else if (roleRadio instanceof HTMLInputElement) {
      params.set('role', roleRadio.value);
    }
    if (memberCustomerId) {
      params.set('memberCustomerId', memberCustomerId);
    }

    try {
      const response = await fetch(actionsEndpoint + '?' + params.toString(), { credentials: 'include' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (payload?.redirectTo) {
          navigating = true;
          window.location.href = payload.redirectTo;
          return;
        }
        setFormMessage(payload.error || 'Unable to complete action.');
        return;
      }
      if (payload?.error) {
        setFormMessage(payload.error);
        return;
      }
      if (payload?.pricingUnlocked) {
        document.cookie = (window.__PROJECT_CLAD__ || {}).pricingCookie + '; Path=/; Max-Age=3600; SameSite=Lax';
        closePricingModal();
        navigating = true;
        window.location.reload();
        return;
      }
      if (payload?.shareLink) {
        const fullUrl = 'https://' + (window.__PROJECT_CLAD__ || {}).shop + payload.shareLink;
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(fullUrl);
          }
        } catch {}
        const shareBtn = document.querySelector('[data-projectclad-share-submit]');
        if (shareBtn instanceof HTMLElement) {
          shareBtn.textContent = 'Link Added to Clipboard';
        }
        return;
      }
      if ((intent === 'submit-for-approval' || intent === 'cancel-approval-request') && payload?.ok) {
        setFormMessage(intent === 'submit-for-approval' ? 'Approval request sent.' : 'Approval request cancelled.');
        navigating = true;
        window.location.reload();
        return;
      }
      if (intent === 'approve' && payload?.ok) {
        const url = new URL(window.location.href);
        url.searchParams.delete('approve');
        url.searchParams.delete('approveJobId');
        url.searchParams.delete('approveItemId');
        navigating = true;
        window.location.href = url.toString();
        return;
      }
      navigating = true;
      window.location.reload();
    } catch {
      setFormMessage('Unable to complete action.');
    } finally {
      /* Stay disabled while a reload/redirect is in flight so the action cannot double-fire. */
      if (!navigating) releaseBusy();
    }
  });
})();
              