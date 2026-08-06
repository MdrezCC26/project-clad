
(function() {
  var TRIGGER_SELECTOR = '[data-projectclad-line-thumb-preview]';
  var ROOT_CLASS = 'project-clad-line-image-lightbox';
  var FIGURE_CLASS = 'project-clad-line-image-lightbox__figure';
  var IMG_CLASS = 'project-clad-line-image-lightbox__img';
  var CLOSE_CLASS = 'project-clad-line-image-lightbox__close';

  var state = null;

  function close() {
    if (!state) return;
    var s = state;
    state = null;
    document.removeEventListener('keydown', s.onKey, true);
    if (s.previousOverflow !== undefined) {
      document.body.style.overflow = s.previousOverflow;
    }
    if (s.root && s.root.parentNode) {
      s.root.classList.remove('is-open');
      /* Let the 180ms fade-out finish before removing from DOM. Capture node in
         a local so a fast re-open can't yank a still-fading node out from
         under us. */
      var node = s.root;
      window.setTimeout(function() {
        if (node && node.parentNode) node.parentNode.removeChild(node);
      }, 200);
    }
    if (s.opener && typeof s.opener.focus === 'function') {
      try { s.opener.focus(); } catch (e) {}
    }
  }

  function open(trigger) {
    if (state) close();
    var src = trigger.getAttribute('data-pc-image-src') || '';
    if (!src) return;
    var alt = trigger.getAttribute('data-pc-image-alt') || '';

    var root = document.createElement('div');
    root.className = ROOT_CLASS;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Product drawing preview');

    var figure = document.createElement('div');
    figure.className = FIGURE_CLASS;
    /* Image clicks must NOT close the lightbox. */
    figure.addEventListener('click', function(ev) { ev.stopPropagation(); });
    figure.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });

    var img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    img.className = IMG_CLASS;
    img.draggable = false;
    figure.appendChild(img);

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = CLOSE_CLASS;
    closeBtn.setAttribute('aria-label', 'Close product drawing preview');
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>';
    closeBtn.addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    });

    /* Backdrop click (anywhere on the root that isn't the figure / close btn). */
    root.addEventListener('click', function(ev) {
      if (ev.target === root) close();
    });

    root.appendChild(figure);
    root.appendChild(closeBtn);
    document.body.appendChild(root);

    var onKey = function(ev) {
      if (ev.key === 'Escape' || ev.key === 'Esc') {
        ev.stopPropagation();
        ev.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKey, true);

    state = {
      root: root,
      onKey: onKey,
      opener: trigger,
      previousOverflow: document.body.style.overflow,
    };
    document.body.style.overflow = 'hidden';

    /* Two RAFs so the initial paint sees no .is-open, then we flip it on
       and the CSS transition runs. */
    window.requestAnimationFrame(function() {
      window.requestAnimationFrame(function() {
        if (state && state.root === root) root.classList.add('is-open');
      });
    });

    /* Move focus to the close button. setTimeout 0 so it runs after the
       browser's default focus handling for the trigger click. */
    window.setTimeout(function() {
      try { closeBtn.focus(); } catch (e) {}
    }, 0);
  }

  /* Capture phase so we beat the SPA-link interceptor and any other listeners
     that might preventDefault / stopPropagation. */
  document.addEventListener('click', function(ev) {
    var target = ev.target;
    if (target && target.nodeType === 3 /* TEXT_NODE */ && target.parentElement) {
      target = target.parentElement;
    }
    if (!(target instanceof Element)) return;
    var trigger = target.closest(TRIGGER_SELECTOR);
    if (!trigger) return;
    if (!trigger.getAttribute('data-pc-image-src')) return;
    ev.preventDefault();
    ev.stopPropagation();
    open(trigger);
  }, true);

  /* Keyboard activation: Enter / Space on focused trigger. The native button
     element fires a click on Enter/Space, so this is just defense-in-depth for
     non-button triggers added later. */
  document.addEventListener('keydown', function(ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    var target = ev.target;
    if (!(target instanceof Element)) return;
    var trigger = target.closest(TRIGGER_SELECTOR);
    if (!trigger || trigger.tagName === 'BUTTON') return;
    if (!trigger.getAttribute('data-pc-image-src')) return;
    ev.preventDefault();
    open(trigger);
  });
})();
          