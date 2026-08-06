
(function() {
  var APP_PROXY_KEYS = {
    signature: true,
    shop: true,
    path_prefix: true,
    timestamp: true,
    logged_in_customer_id: true,
    logged_in_customer_email: true
  };
  var main = document.querySelector('.project-clad-page');
  if (main) {
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        main.classList.add('project-clad-enter-done');
      });
    });
  }
  /* Only animate tile click-throughs. Query-only controls (filter/sort/search links) must remain SPA
     navigations; forcing full reload in app-proxy context can break URL signatures and appear as 404/no-op. */
  document.addEventListener('click', function(e) {
    /* Let the browser own modifier and middle clicks so tiles can still be opened
       in a new tab; intercepting them forced every one into the current tab. */
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (typeof e.button === 'number' && e.button !== 0) return;
    var target = e.target;
    if (target && target.nodeType === Node.TEXT_NODE) target = target.parentElement;
    if (!(target instanceof Element)) return;
    var a = target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('data-projectclad-no-transition')) return;
    if (!a.classList.contains('project-clad-card-link')) return;
    var href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    try {
      var url = new URL(href, location.origin);
      if (url.origin !== location.origin) return;
    } catch (err) { return; }
    e.preventDefault();
    e.stopPropagation();
    /* Still intercepting because the proxy params have to be carried onto the next
       URL, but the request starts immediately — the fade runs during the load. */
    document.body.classList.add('project-clad-leaving');
    try {
      var nextUrl = new URL(href, location.origin);
      var currentParams = new URLSearchParams(location.search);
      currentParams.forEach(function(value, key) {
        if (APP_PROXY_KEYS[key] && !nextUrl.searchParams.has(key)) {
          nextUrl.searchParams.set(key, value);
        }
      });
      window.location.href = nextUrl.pathname + nextUrl.search + nextUrl.hash;
    } catch (err) {
      window.location.href = href;
    }
  }, true);
  window.addEventListener('pageshow', function(ev) {
    /* A restored page keeps the class it left with, so clear it before anything else
       or the document comes back invisible. */
    document.body.classList.remove('project-clad-leaving');
    if (ev.persisted) window.location.reload();
  });
})();
          