
(function() {
  var SEARCH_URL = '/apps/project-clad/api/customers/search';
  var DEBOUNCE_MS = 220;
  /* WeakMap keyed by input element -> per-input state. Event delegation attaches
     listeners at document level so React-rendered modals work without re-init. */
  var stateByInput = new WeakMap();

  function renderLabel(c) {
    var name = ((c.firstName || '') + ' ' + (c.lastName || '')).trim();
    if (name && c.email) return name + ' <' + c.email + '>';
    return name || c.email || c.id;
  }

  function setHidden(container, value) {
    var form = container.closest('form');
    if (!form) return;
    var hidden = form.querySelector('input[name="memberCustomerId"]');
    if (hidden instanceof HTMLInputElement) {
      hidden.value = value || '';
    }
  }

  function closeList(list) {
    if (!(list instanceof HTMLElement)) return;
    list.hidden = true;
    list.innerHTML = '';
  }

  function getState(input) {
    var s = stateByInput.get(input);
    if (s) return s;
    var container = input.closest('[data-projectclad-member-typeahead]');
    var list = container ? container.querySelector('[data-projectclad-member-typeahead-list]') : null;
    s = {
      container: container,
      list: list,
      timer: null,
      lastQ: '',
      disabled: false,
    };
    stateByInput.set(input, s);
    return s;
  }

  function runSearch(input) {
    var s = getState(input);
    if (!s.container || !(s.list instanceof HTMLElement)) return;
    var q = (input.value || '').trim();
    if (q === s.lastQ) return;
    s.lastQ = q;
    if (q.length < 2) { closeList(s.list); return; }

    fetch(SEARCH_URL + '?q=' + encodeURIComponent(q), { credentials: 'include' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!s.list) return;
        if (!data || !Array.isArray(data.results)) {
          if (data && data.reason === 'no-b2b-company') {
            s.disabled = true;
            closeList(s.list);
          }
          return;
        }
        s.list.innerHTML = '';
        if (data.results.length === 0) { closeList(s.list); return; }
        data.results.forEach(function(c) {
          var li = document.createElement('li');
          li.setAttribute('role', 'option');
          li.className = 'project-clad-member-typeahead__item';
          li.textContent = renderLabel(c);
          li.tabIndex = 0;
          /* mousedown fires before input blur, so we can populate + close before blur hides us */
          li.addEventListener('mousedown', function(ev) {
            ev.preventDefault();
            input.value = c.email || '';
            setHidden(s.container, c.id);
            s.lastQ = input.value;
            closeList(s.list);
          });
          s.list.appendChild(li);
        });
        s.list.hidden = false;
      })
      .catch(function() { if (s.list) closeList(s.list); });
  }

  document.addEventListener('input', function(ev) {
    var input = ev.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (!input.matches('[data-projectclad-member-typeahead-input]')) return;
    var s = getState(input);
    if (s.disabled) return;
    setHidden(s.container, '');
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(function() { runSearch(input); }, DEBOUNCE_MS);
  });

  document.addEventListener('focusin', function(ev) {
    var input = ev.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (!input.matches('[data-projectclad-member-typeahead-input]')) return;
    var s = getState(input);
    if (!s.disabled && (input.value || '').trim().length >= 2) runSearch(input);
  });

  document.addEventListener('focusout', function(ev) {
    var input = ev.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (!input.matches('[data-projectclad-member-typeahead-input]')) return;
    var s = getState(input);
    setTimeout(function() { if (s.list) closeList(s.list); }, 120);
  });

  document.addEventListener('keydown', function(ev) {
    if (ev.key !== 'Escape') return;
    var input = ev.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (!input.matches('[data-projectclad-member-typeahead-input]')) return;
    var s = getState(input);
    if (s.list) closeList(s.list);
  });
})();
          