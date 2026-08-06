
(function() {
  var main = document.querySelector('.project-clad-page');
  if (main) {
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        main.classList.add('project-clad-enter-done');
      });
    });
  }
  /* A ?job= deep link renders that order's <details> open server-side, but the browser
     only auto-scrolls for a #hash, so the user lands at the top of a very long page.
     After a mutation reload, jump straight there; on a fresh link, glide so it's clear
     where you ended up. */
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
  /*
   * Keep ?job= pointing at whichever order is expanded, so the URL stays shareable and
   * the card survives the reload that follows a mutation (the server renders it open
   * from this param).
   *
   * replaceState, never a router navigation: expanding a card is a free, instant native
   * <details> toggle and must not cost a refetch. The React onToggle this replaces would
   * have done exactly that once hydrated.
   *
   * Capture phase because the toggle event does not bubble. The deep-link scroll above
   * reads the job id once at parse time, so rewriting the URL here never re-triggers it.
   */
  document.addEventListener('toggle', function(ev) {
    var d = ev.target;
    if (!(d instanceof HTMLDetailsElement) || !d.isConnected) return;
    if (!d.classList.contains('project-clad-order-row')) return;
    /* Print builds detached clones of these rows and forces them open. */
    if (d.closest('.project-clad-print-page')) return;
    var jobId = d.getAttribute('data-job-id');
    if (!jobId) return;
    try {
      var url = new URL(window.location.href);
      if (d.open) {
        if (url.searchParams.get('job') === jobId) return;
        url.searchParams.set('job', jobId);
      } else {
        if (url.searchParams.get('job') !== jobId) return;
        url.searchParams.delete('job');
      }
      window.history.replaceState(
        window.history.state,
        '',
        url.pathname + url.search + url.hash
      );
    } catch (err) {}
  }, true);
  /* The safety timer matters because we no longer drive the navigation ourselves: if
     something cancels it, the page must not stay faded out permanently. */
  var leaveTimer = 0;
  function beginLeaveTransition() {
    document.body.classList.add('project-clad-leaving');
    if (leaveTimer) window.clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(function() {
      document.body.classList.remove('project-clad-leaving');
    }, 3000);
  }
  /*
   * Leave-transition for same-origin links. The browser keeps painting this document
   * until the next response arrives, so the fade plays during the load and there is no
   * reason to hold navigation behind a timer first.
   *
   * Runs in the bubble phase and never calls preventDefault, so the browser performs the
   * navigation itself: modifier- and middle-clicks still open new tabs, and nothing
   * downstream can be wedged by this listener. The interactive-element skip below is kept
   * so clicking a control nested in an <a> doesn't fade a page that isn't leaving.
   */
  document.addEventListener('click', function(e) {
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (typeof e.button === 'number' && e.button !== 0) return;
    var target = e.target;
    if (target && target.nodeType === Node.TEXT_NODE) target = target.parentElement;
    if (!(target instanceof Element)) return;
    if (
      target.closest(
        'button, input, textarea, select, option, [role="button"], [data-projectclad-line-thumb-preview]',
      )
    ) {
      return;
    }
    var a = target.closest('a[href]');
    if (!a || a.target === '_blank' || a.getAttribute('data-projectclad-no-transition')) return;
    var href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    try {
      if (new URL(href, location.origin).origin !== location.origin) return;
    } catch (err) { return; }
    beginLeaveTransition();
  });
  window.addEventListener('pageshow', function(ev) {
    /* A restored page keeps whatever classes it had when it left, so clear the fade
       before anything else or the document comes back invisible. */
    document.body.classList.remove('project-clad-leaving');
    if (ev.persisted) window.location.reload();
  });
})();
          