
(function() {
  document.addEventListener('click', function(ev) {
    if (ev.defaultPrevented) return;
    /* Honor modifier-key clicks: let the browser handle cmd/ctrl-click open-in-
       new-tab, middle-click, etc. via the underlying <a>. */
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    if (typeof ev.button === 'number' && ev.button !== 0) return;
    var target = ev.target;
    if (target && target.nodeType === 3 /* TEXT_NODE */ && target.parentElement) {
      target = target.parentElement;
    }
    if (!(target instanceof Element)) return;
    var link = target.closest('[data-projectclad-projects-link]');
    if (!(link instanceof HTMLAnchorElement)) return;
    var href = link.getAttribute('href');
    if (!href) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === 'function') {
      ev.stopImmediatePropagation();
    }
    /* This handler owns the navigation, so it also owns the unsaved-work prompt —
       leaving it to beforeunload would ask twice. */
    if (typeof window.pcConfirmLeave === 'function' && !window.pcConfirmLeave()) return;
    /* Signed app-proxy params are only valid for the current proxy request.
       Reusing them on /projects can produce a Shopify 404. This one has to keep
       intercepting because it rewrites the URL, but the navigation starts now — the
       fade plays while the next page loads rather than before the request begins. */
    document.body.classList.add('project-clad-leaving');
    try {
      var url = new URL(href, location.origin);
      [
        'signature',
        'shop',
        'path_prefix',
        'timestamp',
        'logged_in_customer_id',
        'logged_in_customer_email'
      ].forEach(function(key) {
        url.searchParams.delete(key);
      });
      window.location.href = url.pathname + url.search + url.hash;
    } catch (e) {
      window.location.href = '/apps/project-clad/projects';
    }
  }, true);
})();
          