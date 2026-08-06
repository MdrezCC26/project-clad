
(function() {
  var main = document.querySelector('.project-clad-page');
  if (main) {
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        main.classList.add('project-clad-enter-done');
      });
    });
  }
  /* React does not hydrate on the app proxy, so a React onSubmit confirm never runs and
     destructive forms would post on first click. Capture phase to beat any other handler. */
  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    var message = form.getAttribute('data-projectclad-confirm');
    if (!message) return;
    if (window.confirm(message)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  /* Pricing gate. Ported from the equivalent handler on the main project route: the
     "Hidden" buttons and the modal render server-side, but nothing revealed the modal
     here because the only opener was a React useEffect, which never runs on the proxy. */
  var pricingBackdrop = function() {
    return document.querySelector('[data-projectclad-pricing-modal-backdrop]');
  };
  document.addEventListener('click', function(e) {
    var target = e.target;
    if (target && target.nodeType === 3 && target.parentElement) {
      target = target.parentElement;
    }
    if (!(target instanceof Element)) return;

    if (target.closest('[data-projectclad-show-price]')) {
      e.preventDefault();
      var openModal = pricingBackdrop();
      if (openModal instanceof HTMLElement) {
        openModal.style.display = 'flex';
        var pw = openModal.querySelector('input[name="password"]');
        if (pw instanceof HTMLInputElement) {
          pw.value = '';
          setTimeout(function() { pw.focus(); }, 50);
        }
      }
      return;
    }

    var cancel = target.closest('[data-projectclad-pricing-modal-cancel]');
    if (cancel || target === pricingBackdrop()) {
      var closeModal = pricingBackdrop();
      if (closeModal instanceof HTMLElement) closeModal.style.display = 'none';
    }
  });
  /* A ?job= deep link opens that order server-side but leaves the viewport at the top
     of a long page, so bring it into view. Instant after a reload, smooth otherwise. */
  try {
    var deepJobId = new URLSearchParams(location.search).get('job');
    if (deepJobId) {
      window.addEventListener('load', function() {
        var jobEl = document.getElementById('job-' + deepJobId);
        if (!jobEl) return;
        var nav = performance.getEntriesByType('navigation')[0];
        jobEl.scrollIntoView({
          behavior: nav && nav.type === 'reload' ? 'auto' : 'smooth',
          block: 'start'
        });
      });
    }
  } catch (err) {}
  /* Leave-transition for same-origin links. Bubble phase and no preventDefault, so the
     browser navigates itself: the fade plays while the next page loads instead of
     delaying the request, and modifier/middle-clicks still open new tabs. */
  var leaveTimer = 0;
  document.addEventListener('click', function(e) {
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (typeof e.button === 'number' && e.button !== 0) return;
    var target = e.target;
    if (target && target.nodeType === 3 && target.parentElement) {
      target = target.parentElement;
    }
    if (!(target instanceof Element)) return;
    var a = target.closest('a[href]');
    if (!a || a.target === '_blank' || a.getAttribute('data-projectclad-no-transition')) return;
    var href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    try {
      if (new URL(href, location.origin).origin !== location.origin) return;
    } catch (err) { return; }
    document.body.classList.add('project-clad-leaving');
    /* Don't strand the page invisible if the navigation never happens. */
    if (leaveTimer) window.clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(function() {
      document.body.classList.remove('project-clad-leaving');
    }, 3000);
  });
  window.addEventListener('pageshow', function() {
    document.body.classList.remove('project-clad-leaving');
  });
})();
          