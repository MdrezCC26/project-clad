
(function() {
  /* Routes the approval reloads through pc-dirty-guard.js so anything typed elsewhere on
     the page is stashed first; falls back to a plain reload if that script is missing. */
  function pcGuardedReload(options) {
    if (typeof window.pcReload === 'function') return window.pcReload(options);
    var opts = options || {};
    if (opts.mode === 'assign' && opts.href) window.location.href = opts.href;
    else window.location.reload();
    return true;
  }

  /* Every card is rendered server-side; this is how many stay visible at once so a long list
     does not dump 40+ tiles on screen. Filtering still runs across the whole set. */
  var PAGE_SIZE = 20;

  var root = document.querySelector('.project-clad-page--projects');
  var controlsRoot = root && root.querySelector('.project-clad-projects-controls-grid');
  var grid = root && root.querySelector('.project-clad-grid');
  if (controlsRoot && grid) {
    var searchInput = controlsRoot.querySelector('[data-pc-search]');
    var summary = root && root.querySelector('.project-clad-projects-summary');
    var showMoreWrap = root && root.querySelector('[data-pc-show-more-wrap]');
    var showMoreBtn = root && root.querySelector('[data-pc-show-more]');
    var ui = {
      status: 'all',
      view: 'all',
      sort: 'recent',
      visibleLimit: PAGE_SIZE,
      q:
        searchInput && 'value' in searchInput
          ? String(searchInput.value || '').trim().toLowerCase()
          : ''
    };
    function getCards() {
      return Array.prototype.slice.call(grid.querySelectorAll('[data-pc-project-card="1"]'));
    }
    function setActive(groupAttr, value) {
      controlsRoot.querySelectorAll('[' + groupAttr + ']').forEach(function(btn) {
        if (!(btn instanceof Element)) return;
        if (btn.getAttribute(groupAttr) === value) btn.classList.add('is-active');
        else btn.classList.remove('is-active');
      });
    }
    function matches(card) {
      var viaCompany = card.getAttribute('data-pc-via-company') === '1';
      var isOwner = card.getAttribute('data-pc-owner') === '1';
      var pending = Number(card.getAttribute('data-pc-pending-approvals') || '0');
      var projApproval = card.getAttribute('data-pc-project-approval-pending') === '1';
      var searchHay = (card.getAttribute('data-pc-search') || '').toLowerCase();
      if (ui.status === 'approval' && !projApproval && pending <= 0) return false;
      if (ui.view === 'mine' && !isOwner) return false;
      if (ui.view === 'company' && !viaCompany) return false;
      if (ui.q && searchHay.indexOf(ui.q) === -1) return false;
      return true;
    }
    function comparator(a, b) {
      var aCreated = Number(a.getAttribute('data-pc-created-at') || '0');
      var bCreated = Number(b.getAttribute('data-pc-created-at') || '0');
      if (ui.sort === 'newest') return bCreated - aCreated;
      if (ui.sort === 'oldest') return aCreated - bCreated;
      if (ui.sort === 'name') {
        var an = a.getAttribute('data-pc-name') || '';
        var bn = b.getAttribute('data-pc-name') || '';
        return an.localeCompare(bn);
      }
      if (ui.sort === 'orders') {
        var ao = Number(a.getAttribute('data-pc-orders') || '0');
        var bo = Number(b.getAttribute('data-pc-orders') || '0');
        if (bo !== ao) return bo - ao;
        return bCreated - aCreated;
      }
      /* recent: last order submitted, then ownership, then created */
      var aOwner = a.getAttribute('data-pc-owner') === '1' ? 0 : 1;
      var bOwner = b.getAttribute('data-pc-owner') === '1' ? 0 : 1;
      if (aOwner !== bOwner) return aOwner - bOwner;
      var aOrdered = Number(a.getAttribute('data-pc-last-ordered-at') || '0');
      var bOrdered = Number(b.getAttribute('data-pc-last-ordered-at') || '0');
      if (aOrdered !== bOrdered) return bOrdered - aOrdered;
      return bCreated - aCreated;
    }
    function writeSummary() {
      if (!summary) return;
      var cards = getCards();
      var pv = 0;
      var ov = 0;
      var av = 0;
      cards.forEach(function(card) {
        if (!matches(card)) return;
        pv += 1;
        ov += Number(card.getAttribute('data-pc-orders') || '0');
        av += Number(card.getAttribute('data-pc-pending-approvals') || '0');
      });
      function setVal(key, n) {
        var el = summary.querySelector('[data-pc-summary-value="' + key + '"]');
        if (el) el.textContent = String(n);
      }
      setVal('projects', pv);
      setVal('orders', ov);
      setVal('approvals', av);
      var apprEl = summary.querySelector('.project-clad-projects-summary__stat--approvals');
      if (apprEl) {
        if (av === 0) apprEl.classList.add('project-clad-projects-summary__stat--dim');
        else apprEl.classList.remove('project-clad-projects-summary__stat--dim');
      }
    }
    /* Changing what is being filtered restarts the window — otherwise a search that widens the
       result set would silently keep showing only the previously revealed count. */
    function resetVisibleLimit() {
      ui.visibleLimit = PAGE_SIZE;
    }
    function updateShowMore(matchedCount) {
      if (!(showMoreWrap instanceof HTMLElement)) return;
      var remaining = matchedCount - ui.visibleLimit;
      if (remaining > 0) {
        showMoreWrap.style.display = '';
        if (showMoreBtn) {
          showMoreBtn.textContent = 'Show more (' + remaining + ' remaining)';
        }
      } else {
        showMoreWrap.style.display = 'none';
      }
    }
    function apply() {
      var cards = getCards();
      var ordered = cards.slice().sort(comparator);
      var matchedCount = 0;
      ordered.forEach(function(card) {
        var visible = matches(card);
        if (visible) {
          matchedCount += 1;
          if (matchedCount > ui.visibleLimit) visible = false;
        }
        card.style.display = visible ? '' : 'none';
        grid.appendChild(card);
      });
      updateShowMore(matchedCount);
      setActive('data-pc-status', ui.status);
      setActive('data-pc-view', ui.view);
      setActive('data-pc-sort', ui.sort);
      /* Only offer the reset once something is actually filtered. */
      var resetEl = controlsRoot.querySelector('[data-pc-reset]');
      if (resetEl instanceof HTMLElement) {
        var isFiltered =
          Boolean(ui.q) ||
          ui.status !== 'all' ||
          ui.view !== 'all' ||
          ui.sort !== 'recent';
        resetEl.style.display = isFiltered ? '' : 'none';
      }
      writeSummary();
    }
    controlsRoot.addEventListener('click', function(ev) {
      var target = ev.target;
      if (target && target.nodeType === Node.TEXT_NODE) target = target.parentElement;
      if (!(target instanceof Element)) return;
      var statusBtn = target.closest('[data-pc-status]');
      if (statusBtn) {
        ev.preventDefault();
        ui.status = statusBtn.getAttribute('data-pc-status') || 'all';
        resetVisibleLimit();
        apply();
        return;
      }
      var viewBtn = target.closest('[data-pc-view]');
      if (viewBtn) {
        ev.preventDefault();
        ui.view = viewBtn.getAttribute('data-pc-view') || 'all';
        resetVisibleLimit();
        apply();
        return;
      }
      var sortBtn = target.closest('[data-pc-sort]');
      if (sortBtn) {
        ev.preventDefault();
        ui.sort = sortBtn.getAttribute('data-pc-sort') || 'recent';
        resetVisibleLimit();
        apply();
        return;
      }
      var resetBtn = target.closest('[data-pc-reset]');
      if (resetBtn) {
        ev.preventDefault();
        ui.status = 'all';
        ui.view = 'all';
        ui.sort = 'recent';
        ui.q = '';
        if (searchInput && 'value' in searchInput) searchInput.value = '';
        resetVisibleLimit();
        apply();
      }
    }, true);
    if (searchInput) {
      searchInput.addEventListener('input', function() {
        ui.q = String(searchInput.value || '').trim().toLowerCase();
        resetVisibleLimit();
        apply();
      });
    }
    if (showMoreBtn) {
      showMoreBtn.addEventListener('click', function(ev) {
        ev.preventDefault();
        ui.visibleLimit += PAGE_SIZE;
        apply();
      });
    }
    apply();
  }

  document.querySelectorAll('[data-projectclad-submit-approval]').forEach(function(form) {
    if (!(form instanceof HTMLFormElement)) return;
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var projectId = form.getAttribute('data-project-id');
      var msgEl = form.querySelector('[data-projectclad-approval-message]');
      function setMsg(t) { if (msgEl) msgEl.textContent = t || ''; }
      setMsg('');
      var intent = form.getAttribute('data-intent') || 'submit-for-approval';

      /* Disable while in flight — the request round-trips and then reloads, so an active button
         reads as "nothing happened" and invites a duplicate submit. */
      var submitters = Array.prototype.slice.call(form.elements).filter(function(el) {
        if (el.disabled) return false;
        return (el.tagName === 'BUTTON' || el.tagName === 'INPUT') && el.type === 'submit';
      });
      var navigating = false;
      function setBusy(busy) {
        form.setAttribute('aria-busy', busy ? 'true' : 'false');
        submitters.forEach(function(el) { el.disabled = busy; });
      }
      function release() { if (!navigating) setBusy(false); }
      setBusy(true);

      var url = '/apps/project-clad/api/project-actions?intent=' + encodeURIComponent(intent) + '&projectId=' + encodeURIComponent(projectId);
      fetch(url, { credentials: 'include' }).then(function(r) {
        return r.json().then(function(data) {
          if (!r.ok && data?.redirectTo) {
            /* pcGuardedReload returns false when a discard prompt is declined; the button
               must come back out of its busy state in that case. */
            navigating = pcGuardedReload({
              mode: 'assign',
              href: data.redirectTo,
              except: form,
            });
            return;
          }
          return { response: r, data: data };
        });
      }).then(function(result) {
        if (!result) return;
        var data = result.data;
        if (data.ok) {
          setMsg(intent === 'cancel-approval-request' ? 'Approval request cancelled.' : 'Approval request sent.');
          navigating = pcGuardedReload({ except: form });
        } else {
          setMsg(data.error || '');
        }
      }).catch(function() { setMsg('Unable to send.'); }).then(release, release);
    });
  });
})();
          