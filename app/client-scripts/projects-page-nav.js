
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
  /* The proxy params have to be carried onto the next URL or the signed context is lost. */
  function proxyNavUrl(href) {
    try {
      var nextUrl = new URL(href, location.origin);
      var currentParams = new URLSearchParams(location.search);
      currentParams.forEach(function(value, key) {
        if (APP_PROXY_KEYS[key] && !nextUrl.searchParams.has(key)) {
          nextUrl.searchParams.set(key, value);
        }
      });
      return nextUrl.pathname + nextUrl.search + nextUrl.hash;
    } catch (err) {
      return href;
    }
  }

  function cardLinkHref(target) {
    if (target && target.nodeType === Node.TEXT_NODE) target = target.parentElement;
    if (!(target instanceof Element)) return null;
    var a = target.closest('a.project-clad-card-link[href]');
    if (!a || a.target === '_blank') return null;
    var href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return null;
    try {
      if (new URL(href, location.origin).origin !== location.origin) return null;
    } catch (err) { return null; }
    return href;
  }

  /* Proxy HTML is sent no-cache, so the browser may discard the prefetched document. The win that
     survives either way is server-side: the detail loader memoizes its Shopify catalog and customer
     lookups, so a click after a hover lands on warm caches instead of cold ones. Capped and
     hover-delayed so idly sweeping the grid does not fire a render per tile. */
  var PREFETCH_HOVER_MS = 150;
  var PREFETCH_MAX = 8;
  var prefetched = Object.create(null);
  var prefetchCount = 0;
  var hoverTimer = null;

  function prefetch(href) {
    if (!href || prefetched[href] || prefetchCount >= PREFETCH_MAX) return;
    prefetched[href] = true;
    prefetchCount += 1;
    var link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = href;
    document.head.appendChild(link);
  }

  document.addEventListener('mouseover', function(e) {
    var href = cardLinkHref(e.target);
    if (!href) return;
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function() {
      hoverTimer = null;
      prefetch(proxyNavUrl(href));
    }, PREFETCH_HOVER_MS);
  });
  document.addEventListener('mouseout', function() {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  });
  document.addEventListener('touchstart', function(e) {
    var href = cardLinkHref(e.target);
    if (href) prefetch(proxyNavUrl(href));
  }, { passive: true });

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
    /* We drive this navigation ourselves, so ask about unsaved work here rather than
       letting beforeunload fire on top of it and prompt twice. */
    if (typeof window.pcConfirmLeave === 'function' && !window.pcConfirmLeave()) return;
    /* Still intercepting because the proxy params have to be carried onto the next
       URL, but the request starts immediately — the fade runs during the load. */
    document.body.classList.add('project-clad-leaving');
    window.location.href = proxyNavUrl(href);
  }, true);
  window.addEventListener('pageshow', function(ev) {
    /* A restored page keeps the class it left with, so clear it before anything else
       or the document comes back invisible. */
    document.body.classList.remove('project-clad-leaving');
    if (!ev.persisted) return;
    /* A bfcache restore is instant and keeps scroll position; the only thing wrong with
       one is that a project the user just edited may now be out of date. Ask whether
       anything actually changed rather than paying for a reload on every back press.
       Without the guard there is no stamp and therefore no answer, and it is also the
       script that would have preserved anything typed here — guessing "reload" would burn
       the restore on every navigation to cover a case we cannot detect, so leave it be. */
    if (typeof window.pcDataChangedSince !== 'function') return;
    if (!window.pcDataChangedSince()) return;
    /* bfcache restores the typed values with the document; keep them over a refresh. */
    window.pcReload({ skipIfDirty: true, mutation: false });
  });
})();
          