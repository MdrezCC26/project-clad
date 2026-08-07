
(function () {
  /*
   * Unsaved-work guard for the app-proxy pages.
   *
   * These pages never hydrate, so every mutation ends in a full page reload. The project
   * page hosts a dozen independent forms at once (per-order PO number, site contact,
   * comment box, edit-order quantities, file pickers, the edit-project modal), so a
   * reload triggered by saving one of them used to silently destroy everything typed
   * into the others.
   *
   * Two mechanisms, deliberately split by whether the typed value can be brought back:
   *
   *   - Snapshot and restore, for reloads we trigger ourselves. Before reloading we
   *     write the dirty fields to sessionStorage and re-apply them after the new
   *     document loads. Restoring the work is strictly better than asking permission
   *     to destroy it, so these paths never prompt.
   *   - beforeunload, for departures the browser owns (tab close, back button, address
   *     bar, an ordinary link). We cannot restore anything there, so the native prompt
   *     is the only option. It is armed only when something is genuinely dirty.
   *
   * The two must not overlap: our own reloads suspend the unload guard, or every save
   * would raise a "Leave site?" dialog.
   *
   * False positives are the thing to avoid — one spurious dialog and the whole feature
   * gets ripped out. A control counts as dirty only when BOTH are true:
   *   1. the user fired a trusted input/change event inside its group, and
   *   2. its current value still differs from its server-rendered default.
   * Programmatic `.value =` assignments (modal population, filter scripts) fail (1);
   * typing and then undoing fails (2).
   */
  if (window.__pcDirtyGuardInstalled) return;
  window.__pcDirtyGuardInstalled = true;

  var SNAPSHOT_KEY = 'pc-dirty-snapshot-v1';
  var SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;
  /*
   * How long the unload guard stays down after we hand off to a navigation. Long enough
   * to cover the browser starting the request, short enough that a navigation that never
   * happens (cancelled, blocked, ajax submit) re-arms the guard on its own.
   */
  var SUSPEND_MS = 6000;

  /*
   * These only ever appear when a picked file is at stake. Everything else is snapshotted
   * and handed back, and asking permission to destroy work we could simply restore is how
   * a guard like this earns a reputation for nagging and gets switched off.
   */
  var RELOAD_MESSAGE =
    'A file you selected on this page has not been uploaded yet and will be lost when the page refreshes. Refresh anyway?';
  var LEAVE_MESSAGE =
    'A file you selected on this page has not been uploaded yet and will be lost if you leave. Leave anyway?';

  /* Groups the user has actually typed into. Membership is necessary but not sufficient. */
  var registry = [];
  var suspendUntil = 0;

  /* ------------------------------------------------------------------ controls */

  var IGNORED_TYPES = {
    hidden: 1,
    submit: 1,
    reset: 1,
    button: 1,
    image: 1,
    /* Search boxes filter the page in place; they hold no work to lose. */
    search: 1,
    /* The pricing gate password is cleared every time the modal opens. */
    password: 1,
  };

  function controlType(el) {
    return String(el.type || '').toLowerCase();
  }

  function isTrackableControl(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return false;
    if (el.disabled || el.readOnly) return false;
    if (tag === 'INPUT' && IGNORED_TYPES[controlType(el)]) return false;
    if (typeof el.closest === 'function' && el.closest('[data-pc-no-dirty]')) return false;
    return true;
  }

  /** Dirty means "differs from what the server rendered", never "was touched". */
  function controlChanged(el) {
    if (el.tagName === 'SELECT') {
      for (var i = 0; i < el.options.length; i++) {
        if (el.options[i].selected !== el.options[i].defaultSelected) return true;
      }
      return false;
    }
    var type = controlType(el);
    if (type === 'checkbox' || type === 'radio') return el.checked !== el.defaultChecked;
    if (type === 'file') return Boolean(el.files && el.files.length);
    return String(el.value) !== String(el.defaultValue);
  }

  /** A picked file cannot be written back into an <input type="file"> after a reload. */
  function isRestorable(el) {
    return controlType(el) !== 'file';
  }

  /* -------------------------------------------------------------------- groups */

  /*
   * Most controls belong to a <form>. The per-order PO number, site contact, order name,
   * quantity and unit-price inputs belong to no form at all — they are read straight off
   * the DOM by the save handlers — so the order card stands in as their group.
   */
  var GROUP_SELECTOR =
    'form, [data-pc-dirty-group], details.project-clad-order-row[data-job-id]';
  var FORMLESS_GROUP_SELECTOR =
    '[data-pc-dirty-group], details.project-clad-order-row[data-job-id]';

  function isMutatingForm(form) {
    if (!form || form.tagName !== 'FORM') return false;
    if (form.closest('[data-pc-no-dirty]')) return false;
    if (form.hasAttribute('data-projectclad-ajax')) return true;
    var method = String(form.getAttribute('method') || '').toLowerCase();
    if (method === 'get') return false;
    if (method === 'post') return true;
    /* No declared method: only a form carrying an intent is doing anything worth guarding. */
    return Boolean(form.querySelector('input[name="intent"], input[name="_action"]'));
  }

  function groupFor(el) {
    var explicit = el.closest('[data-pc-dirty-group]');
    if (explicit) return explicit;
    var form = el.form || el.closest('form');
    if (form) return isMutatingForm(form) ? form : null;
    return el.closest(FORMLESS_GROUP_SELECTOR);
  }

  function allGroups() {
    return Array.prototype.slice.call(document.querySelectorAll(GROUP_SELECTOR));
  }

  /*
   * Keys have to survive a reload, so they are derived from server-rendered identity
   * (id, job id, intent) rather than from anything the client mutates. Duplicates get a
   * document-order suffix, which is stable because the SSR output is.
   */
  function rawGroupKey(g) {
    var explicit = g.getAttribute('data-pc-dirty-key');
    if (explicit) return explicit;
    var parts = [g.tagName.toLowerCase()];
    if (g.id) parts.push('#' + g.id);
    var intent = g.getAttribute('data-projectclad-intent') || '';
    if (!intent) {
      var hidden = g.querySelector('input[name="intent"], input[name="_action"]');
      if (hidden) intent = hidden.value || '';
    }
    if (intent) parts.push('i:' + intent);
    var jobHost = g.closest('[data-job-id]');
    if (jobHost) parts.push('j:' + (jobHost.getAttribute('data-job-id') || ''));
    return parts.join('|');
  }

  function keyedGroups() {
    var seen = Object.create(null);
    return allGroups().map(function (g) {
      var base = rawGroupKey(g);
      var n = (seen[base] = (seen[base] || 0) + 1);
      return { el: g, key: n > 1 ? base + '~' + n : base };
    });
  }

  function controlsOf(g) {
    var list = Array.prototype.slice.call(g.querySelectorAll('input, textarea, select'));
    if (g.tagName === 'FORM') {
      /* form.elements also covers controls attached from outside via the form attribute. */
      Array.prototype.slice.call(g.elements).forEach(function (el) {
        if (list.indexOf(el) === -1) list.push(el);
      });
    }
    return list.filter(function (el) {
      if (!isTrackableControl(el)) return false;
      /* A nested form owns its own fields; the enclosing order card must not claim them. */
      return groupFor(el) === g;
    });
  }

  function markerAttr(el) {
    var attrs = el.attributes;
    for (var i = 0; i < attrs.length; i++) {
      if (attrs[i].name.indexOf('data-projectclad-') === 0) return attrs[i].name;
    }
    return '';
  }

  function keyedControls(g) {
    var seen = Object.create(null);
    return controlsOf(g).map(function (el, idx) {
      var parts = [];
      if (el.id) {
        parts.push('#' + el.id);
      } else {
        var name = el.getAttribute('name');
        if (name) parts.push('n:' + name);
        var itemId = el.getAttribute('data-item-id');
        if (itemId) parts.push('t:' + itemId);
        var marker = markerAttr(el);
        if (marker) parts.push('a:' + marker);
        if (!parts.length) parts.push('x:' + idx);
        if (controlType(el) === 'radio') parts.push('v:' + el.value);
      }
      var base = parts.join('|');
      var n = (seen[base] = (seen[base] || 0) + 1);
      return { el: el, key: n > 1 ? base + '~' + n : base };
    });
  }

  /* ------------------------------------------------------------------ registry */

  function remember(g) {
    if (g && registry.indexOf(g) === -1) registry.push(g);
  }

  function forget(g) {
    var i = registry.indexOf(g);
    if (i !== -1) registry.splice(i, 1);
  }

  function forgetWithin(root) {
    if (!root) return;
    registry = registry.filter(function (g) {
      return g !== root && !root.contains(g);
    });
  }

  /**
   * Dirty groups, minus the one whose save is the reason we are navigating. `except` is
   * skipped because its values are on their way to the server; restoring them afterwards
   * would put the user's text back into a box they just successfully emptied.
   */
  function dirtyGroups(except) {
    var out = [];
    registry.forEach(function (g) {
      if (!g.isConnected) return;
      if (except && (g === except || except.contains(g))) return;
      var changed = controlsOf(g).filter(controlChanged);
      if (changed.length) out.push({ el: g, controls: changed });
    });
    return out;
  }

  function hasUnrestorable(entry) {
    return entry.controls.some(function (el) {
      return !isRestorable(el);
    });
  }

  /* ------------------------------------------------------------------ snapshot */

  function clearSnapshot() {
    try {
      window.sessionStorage.removeItem(SNAPSHOT_KEY);
    } catch (err) {
      /* private mode / storage disabled */
    }
  }

  function selectedValues(sel) {
    var out = [];
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].selected) out.push(sel.options[i].value);
    }
    return out;
  }

  function writeSnapshot(groups) {
    if (!groups.length) {
      clearSnapshot();
      return;
    }
    var keyed = keyedGroups();
    var data = {
      v: 1,
      path: window.location.pathname,
      /* The project route is one pathname for every project. Without the id a draft typed
         on one project could be restored onto another. */
      pid: currentProjectId(),
      t: Date.now(),
      groups: {},
    };
    var wrote = false;
    groups.forEach(function (entry) {
      var key = '';
      for (var i = 0; i < keyed.length; i++) {
        if (keyed[i].el === entry.el) {
          key = keyed[i].key;
          break;
        }
      }
      if (!key) return;
      var fields = {};
      var any = false;
      keyedControls(entry.el).forEach(function (f) {
        if (entry.controls.indexOf(f.el) === -1) return;
        if (!isRestorable(f.el)) return;
        var type = controlType(f.el);
        if (type === 'checkbox' || type === 'radio') {
          fields[f.key] = { c: Boolean(f.el.checked) };
        } else if (f.el.tagName === 'SELECT' && f.el.multiple) {
          fields[f.key] = { m: selectedValues(f.el) };
        } else {
          fields[f.key] = { v: String(f.el.value) };
        }
        any = true;
      });
      if (!any) return;
      data.groups[key] = {
        f: fields,
        /* Edit-order mode lives in memory in project-main.js and dies with the document.
           Without this the restored quantities come back inside a hidden panel. */
        edit:
          entry.el.classList && entry.el.classList.contains('project-clad-edit-mode') ? 1 : 0,
      };
      wrote = true;
    });
    if (!wrote) {
      clearSnapshot();
      return;
    }
    try {
      window.sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(data));
    } catch (err) {
      /* quota / private mode: fall back to losing the work, as before */
    }
  }

  function currentProjectId() {
    try {
      return new URLSearchParams(window.location.search).get('id') || '';
    } catch (err) {
      return '';
    }
  }

  /*
   * A snapshot for a different page is left in place rather than discarded: navigating away
   * and coming back within the window should still hand the work back.
   */
  function readSnapshot() {
    var raw = null;
    try {
      raw = window.sessionStorage.getItem(SNAPSHOT_KEY);
    } catch (err) {
      return null;
    }
    if (!raw) return null;
    var data = null;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      clearSnapshot();
      return null;
    }
    if (!data || data.v !== 1 || !data.groups) {
      clearSnapshot();
      return null;
    }
    if (!data.t || Date.now() - data.t > SNAPSHOT_MAX_AGE_MS) {
      clearSnapshot();
      return null;
    }
    if (data.path !== window.location.pathname) return null;
    if ((data.pid || '') !== currentProjectId()) return null;
    clearSnapshot();
    return data;
  }

  function own(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function restoreSnapshot() {
    var data = readSnapshot();
    if (!data) return;
    var restored = 0;
    var revealed = [];

    keyedGroups().forEach(function (entry) {
      if (!own(data.groups, entry.key)) return;
      var stored = data.groups[entry.key];
      if (!stored || !stored.f) return;
      var count = 0;
      keyedControls(entry.el).forEach(function (f) {
        if (!own(stored.f, f.key)) return;
        var rec = stored.f[f.key];
        if (!rec) return;
        var el = f.el;
        /* Never clobber something the user has already retyped on the new page. */
        if (controlChanged(el)) return;
        var type = controlType(el);
        if (type === 'checkbox' || type === 'radio') {
          if (Boolean(el.defaultChecked) === Boolean(rec.c)) return;
          el.checked = Boolean(rec.c);
        } else if (el.tagName === 'SELECT' && el.multiple) {
          if (!rec.m) return;
          var differs = false;
          for (var i = 0; i < el.options.length; i++) {
            if (el.options[i].defaultSelected !== (rec.m.indexOf(el.options[i].value) !== -1)) {
              differs = true;
            }
          }
          /* The save landed and the server now renders this selection. */
          if (!differs) return;
          for (var j = 0; j < el.options.length; j++) {
            el.options[j].selected = rec.m.indexOf(el.options[j].value) !== -1;
          }
        } else {
          if (typeof rec.v !== 'string') return;
          /* The save landed and the server now renders this value — nothing to restore. */
          if (String(el.defaultValue) === rec.v) return;
          el.value = rec.v;
        }
        count += 1;
      });
      if (!count) return;
      restored += count;
      remember(entry.el);
      revealed.push({ el: entry.el, edit: stored.edit });
    });

    if (!restored) return;

    revealed.forEach(function (item) {
      var details =
        item.el.tagName === 'DETAILS' ? item.el : item.el.closest('details');
      if (details && !details.open) details.open = true;
      if (!item.edit) return;
      var jobId = item.el.getAttribute && item.el.getAttribute('data-job-id');
      if (!jobId) return;
      try {
        window.dispatchEvent(
          new CustomEvent('pc-dirty-restore-edit-mode', { detail: { jobId: jobId } }),
        );
      } catch (err) {
        /* CustomEvent unavailable: the values are still restored, just not revealed */
      }
    });

    showRestoreNotice(restored);
  }

  /*
   * Silently putting text back would read as "the save did not work". Say what happened,
   * and say it is still unsaved. Inline styles because this ships without the proxy CSS
   * on some routes and a missing rule would leave an unreadable banner.
   */
  function showRestoreNotice(count) {
    var host = document.createElement('div');
    host.setAttribute('role', 'status');
    host.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483000;' +
      'max-width:min(28rem,calc(100vw - 32px));display:flex;gap:12px;align-items:flex-start;' +
      'padding:12px 14px;border-radius:12px;background:#1f2937;color:#f9fafb;' +
      'box-shadow:0 10px 30px rgba(0,0,0,0.28);font:500 14px/1.45 system-ui,sans-serif;';
    var text = document.createElement('span');
    text.textContent =
      'Restored ' +
      count +
      (count === 1 ? ' unsaved change' : ' unsaved changes') +
      ' from before the page refreshed. They still need to be saved.';
    var close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '\u00d7';
    close.style.cssText =
      'flex:0 0 auto;background:none;border:0;color:inherit;font-size:20px;line-height:1;' +
      'cursor:pointer;padding:0 2px;';
    function dismiss() {
      if (host.parentNode) host.parentNode.removeChild(host);
    }
    close.addEventListener('click', dismiss);
    host.appendChild(text);
    host.appendChild(close);
    document.body.appendChild(host);
    window.setTimeout(dismiss, 12000);
  }

  /* ---------------------------------------------------------------- navigation */

  function suspend(ms) {
    suspendUntil = Date.now() + (ms || SUSPEND_MS);
  }

  function go(mode, href) {
    if (mode === 'assign' && href) {
      window.location.href = href;
    } else if (mode === 'replace' && href) {
      window.location.replace(href);
    } else {
      window.location.reload();
    }
  }

  /**
   * The single door every scripted reload/redirect on these pages goes through.
   *
   * options.except      group element whose save caused this; its fields are not snapshotted
   * options.mode        'reload' (default) | 'assign' | 'replace'
   * options.href        target for assign/replace
   * options.skipIfDirty leave the page alone instead of reloading when work is pending
   *
   * Returns false when the navigation was declined or skipped.
   */
  function pcReload(options) {
    var opts = options || {};
    var except = opts.except && opts.except.nodeType === 1 ? opts.except : null;
    var mode = opts.mode || 'reload';
    var groups = dirtyGroups(except);

    if (!groups.length) {
      clearSnapshot();
      suspend();
      go(mode, opts.href);
      return true;
    }

    if (opts.skipIfDirty) return false;

    /* A picked file cannot be put back, so this is the one path that has to ask. */
    if (groups.some(hasUnrestorable) && !window.confirm(opts.message || RELOAD_MESSAGE)) {
      return false;
    }

    writeSnapshot(groups);
    suspend();
    go(mode, opts.href);
    return true;
  }

  /**
   * For handlers that perform their own `location.href =`. Returns true when it is safe
   * to proceed; snapshots and suspends the unload guard first so the browser's own
   * beforeunload prompt does not fire on top of ours.
   */
  function pcConfirmLeave(options) {
    var opts = options || {};
    var except = opts.except && opts.except.nodeType === 1 ? opts.except : null;
    var groups = dirtyGroups(except);
    if (!groups.length) {
      clearSnapshot();
      suspend();
      return true;
    }
    if (groups.some(hasUnrestorable) && !window.confirm(opts.message || LEAVE_MESSAGE)) {
      return false;
    }
    writeSnapshot(groups);
    suspend();
    return true;
  }

  /* ------------------------------------------------------------------ listeners */

  function onUserEdit(event) {
    /* Trusted only: modal population and the filter scripts assign .value directly and
       must never register a group. */
    if (!event.isTrusted) return;
    var el = event.target;
    if (!isTrackableControl(el)) return;
    remember(groupFor(el));
  }

  document.addEventListener('input', onUserEdit, true);
  document.addEventListener('change', onUserEdit, true);

  document.addEventListener(
    'reset',
    function (event) {
      if (event.target && event.target.tagName === 'FORM') forget(event.target);
    },
    true,
  );

  /*
   * Native submits (the comment box, the PO PDF picker, the staff fulfillment photo form)
   * navigate away without going through pcReload, so snapshot here instead.
   *
   * Bubble phase, and this file loads after project-main.js, so by the time this runs the
   * ajax hub has already called preventDefault on anything it owns — those forms reload
   * through pcReload later and must not be snapshotted twice. A form whose
   * data-projectclad-confirm was declined never reaches here at all: that guard cancels in
   * the capture phase with stopImmediatePropagation.
   */
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || form.tagName !== 'FORM') return;
    if (event.defaultPrevented) return;
    if (!isMutatingForm(form)) return;
    writeSnapshot(dirtyGroups(form));
    forget(form);
    suspend();
  });

  /*
   * Departures the browser owns: tab close, back button, address bar, an ordinary link.
   * Suspended for anything we triggered ourselves, so a save never raises "Leave site?".
   */
  window.addEventListener('beforeunload', function (event) {
    if (Date.now() < suspendUntil) return;
    var groups = dirtyGroups(null);
    if (!groups.length) return;
    /* The browser gives us one synchronous moment here, so take the snapshot before asking:
       if they leave anyway, coming back within the window hands the work back. Writing it
       when they cancel is harmless — the values are still on the page, and the restore pass
       skips any control the user has already filled in. */
    writeSnapshot(groups);
    event.preventDefault();
    event.returnValue = '';
    return '';
  });

  window.pcDirty = {
    count: function () {
      return dirtyGroups(null).length;
    },
    forget: forget,
    forgetWithin: forgetWithin,
    suspend: suspend,
  };
  window.pcReload = pcReload;
  window.pcConfirmLeave = pcConfirmLeave;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restoreSnapshot);
  } else {
    restoreSnapshot();
  }
})();
