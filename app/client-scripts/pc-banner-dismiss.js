
(function () {
  /*
   * Dismissible error banners on the app-proxy pages.
   *
   * The banners are rendered from query params the action redirected back with
   * (`?scheduleDateError=1`, `?fulfillmentError=...`). React never hydrates here, so the
   * Dismiss buttons cannot be wired with onClick — one delegated listener handles all of
   * them, driven by a declarative attribute in the same spirit as
   * `data-projectclad-confirm`:
   *
   *   <button type="button" data-pc-dismiss-banner="scheduleDateError">Dismiss</button>
   *
   * Hiding alone is not enough: the banner is a function of the URL, so a refresh would
   * bring it straight back and `role="alert"` would announce it again. The param is
   * stripped with history.replaceState, which changes the address bar without a request,
   * a loader refetch or a history entry.
   *
   * Nothing here touches the unsaved-work guard: a dismiss is a click on a
   * `type="button"`, so it fires no submit, no unload and no input/change, and the banner
   * holds no form controls for the guard to have registered.
   */
  if (window.__pcBannerDismissInstalled) return;
  window.__pcBannerDismissInstalled = true;

  var ATTR = 'data-pc-dismiss-banner';

  function stripParam(name) {
    if (!name) return;
    if (!window.history || typeof window.history.replaceState !== 'function') return;
    var url;
    try {
      url = new URL(window.location.href);
    } catch (err) {
      return;
    }
    if (!url.searchParams.has(name)) return;
    url.searchParams.delete(name);
    try {
      window.history.replaceState(window.history.state, '', url.toString());
    } catch (err) {
      /* Some embedded/privacy contexts refuse replaceState; the banner still goes away. */
    }
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    var trigger = target.closest('[' + ATTR + ']');
    if (!trigger) return;
    event.preventDefault();
    var banner = trigger.closest('[role="alert"]') || trigger;
    stripParam(trigger.getAttribute(ATTR));
    if (banner.parentNode) banner.parentNode.removeChild(banner);
  });
})();
