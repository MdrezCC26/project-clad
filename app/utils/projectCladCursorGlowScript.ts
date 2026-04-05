/**
 * Inline script for storefront proxy pages: soft cursor-following highlight on
 * `.project-clad-button` and project list `.project-clad-card-link`.
 * Paired with CSS using --pc-glow-x / --pc-glow-y in project-clad-proxy.css.
 */
export const PROJECT_CLAD_CURSOR_GLOW_SCRIPT = `
(function() {
  if (typeof window === "undefined" || window.__pcCursorGlow) return;
  window.__pcCursorGlow = true;
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  } catch (e) {}
  var last = null;
  function resolveHit(el) {
    if (!(el instanceof Element)) return null;
    var btn = el.closest(".project-clad-button");
    if (btn instanceof HTMLButtonElement && btn.disabled) btn = null;
    if (btn) return btn;
    var link = el.closest(".project-clad-card-link");
    var tile = link && link.closest(".project-clad-page--projects") ? link : null;
    return tile;
  }
  document.addEventListener(
    "pointermove",
    function (e) {
      var hit = resolveHit(e.target);
      if (!hit) {
        if (last) last.classList.remove("project-clad--glow-hover");
        last = null;
        return;
      }
      if (last !== hit) {
        if (last) last.classList.remove("project-clad--glow-hover");
        last = hit;
        hit.classList.add("project-clad--glow-hover");
      }
      var r = hit.getBoundingClientRect();
      hit.style.setProperty("--pc-glow-x", e.clientX - r.left + "px");
      hit.style.setProperty("--pc-glow-y", e.clientY - r.top + "px");
    },
    { passive: true }
  );
})();
`.trim();
