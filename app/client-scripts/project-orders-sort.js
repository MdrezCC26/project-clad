
(function() {
  var cluster = document.querySelector('[data-projectclad-orders-sort-cluster]');
  if (!(cluster instanceof HTMLElement)) return;
  var grid = document.querySelector('.project-clad-orders-shell__list');
  if (!(grid instanceof HTMLElement)) return;

  var rows = function() {
    return Array.prototype.slice.call(
      grid.querySelectorAll(':scope > [data-projectclad-order-row]'),
    );
  };

  function num(el, attr) {
    var v = el.getAttribute(attr);
    return v == null ? 0 : Number(v) || 0;
  }
  function str(el, attr) {
    return (el.getAttribute(attr) || '').toString();
  }

  function recentFirst(a, b) {
    return num(b, 'data-pc-order-created-ms') - num(a, 'data-pc-order-created-ms');
  }

  function comparator(key) {
    if (key === 'oldest') {
      return function(a, b) {
        return num(a, 'data-pc-order-created-ms') - num(b, 'data-pc-order-created-ms');
      };
    }
    if (key === 'name-asc') {
      return function(a, b) {
        var d = str(a, 'data-pc-order-name').localeCompare(
          str(b, 'data-pc-order-name'),
          undefined,
          { sensitivity: 'base' },
        );
        if (d !== 0) return d;
        return recentFirst(a, b);
      };
    }
    if (key === 'name-desc') {
      return function(a, b) {
        var d = str(b, 'data-pc-order-name').localeCompare(
          str(a, 'data-pc-order-name'),
          undefined,
          { sensitivity: 'base' },
        );
        if (d !== 0) return d;
        return recentFirst(a, b);
      };
    }
    if (key === 'total-desc') {
      return function(a, b) {
        var d = num(b, 'data-pc-order-subtotal') - num(a, 'data-pc-order-subtotal');
        if (d !== 0) return d;
        return recentFirst(a, b);
      };
    }
    if (key === 'total-asc') {
      return function(a, b) {
        var d = num(a, 'data-pc-order-subtotal') - num(b, 'data-pc-order-subtotal');
        if (d !== 0) return d;
        return recentFirst(a, b);
      };
    }
    if (key === 'status') {
      return function(a, b) {
        var d = num(a, 'data-pc-order-status-rank') - num(b, 'data-pc-order-status-rank');
        if (d !== 0) return d;
        return recentFirst(a, b);
      };
    }
    return recentFirst;
  }

  function setActive(key) {
    var btns = cluster.querySelectorAll('[data-pc-orders-sort]');
    for (var i = 0; i < btns.length; i++) {
      var btn = btns[i];
      if (!(btn instanceof HTMLElement)) continue;
      if (btn.getAttribute('data-pc-orders-sort') === key) {
        btn.classList.add('is-active');
        btn.setAttribute('aria-pressed', 'true');
      } else {
        btn.classList.remove('is-active');
        btn.setAttribute('aria-pressed', 'false');
      }
    }
  }

  function applySort(key) {
    var ordered = rows().slice().sort(comparator(key));
    /* Re-append in order. Browsers move the existing node (no reflow per row
       beyond the natural cost of a DOM move) so any open <details> stays
       open and any inline event listeners stay attached. */
    for (var i = 0; i < ordered.length; i++) {
      grid.appendChild(ordered[i]);
    }
    setActive(key);
  }

  /* Init: mark the default chip active. The DOM is already in "recent" order
     via the SSR memo, so we don't need to re-sort on load. */
  setActive('recent');

  cluster.addEventListener('click', function(ev) {
    var target = ev.target;
    if (target && target.nodeType === 3 /* TEXT_NODE */ && target.parentElement) {
      target = target.parentElement;
    }
    if (!(target instanceof Element)) return;
    var btn = target.closest('[data-pc-orders-sort]');
    if (!(btn instanceof HTMLElement)) return;
    ev.preventDefault();
    var key = btn.getAttribute('data-pc-orders-sort') || 'recent';
    applySort(key);
  });
})();
          