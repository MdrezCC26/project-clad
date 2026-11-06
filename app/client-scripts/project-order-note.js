/*
 * View comment on the storefront project page.
 *
 * The page is server HTML. React does not hydrate it, so a button onClick
 * never runs. This reads the saved note from its text node and opens a dialog.
 * The note is assigned with textContent, never innerHTML.
 */
(function () {
  if (window.__projectCladOrderNote) return;
  window.__projectCladOrderNote = true;

  var OPEN_SELECTOR = "[data-projectclad-order-note-open]";
  var state = null;

  function noteRoot(trigger) {
    return trigger.closest(".project-clad-order-note");
  }

  function noteText(root) {
    var body = root && root.querySelector("[data-projectclad-order-note-body]");
    return body ? body.textContent || "" : "";
  }

  function noteTitle(root) {
    var label = root && root.querySelector(".project-clad-order-note-print__label");
    var text = label ? (label.textContent || "").trim() : "";
    return text || "Comment";
  }

  function close() {
    if (!state) return;
    var current = state;
    state = null;
    document.removeEventListener("keydown", current.onKey, true);
    document.body.style.overflow = current.previousOverflow;
    if (current.root && current.root.parentNode) {
      current.root.parentNode.removeChild(current.root);
    }
    if (current.opener && typeof current.opener.focus === "function") {
      try {
        current.opener.focus();
      } catch (error) {
        /* the opener may have been removed with the order row */
      }
    }
  }

  function focusableIn(root) {
    return Array.prototype.filter.call(
      root.querySelectorAll("button, [tabindex]:not([tabindex='-1'])"),
      function (el) {
        return !el.hasAttribute("disabled");
      },
    );
  }

  function open(trigger) {
    var root = noteRoot(trigger);
    var text = noteText(root).trim();
    if (!text) return;
    if (state) close();

    var overlay = document.createElement("div");
    overlay.className = "project-clad-order-note-dialog";

    var panel = document.createElement("div");
    panel.className = "project-clad-order-note-dialog__panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");

    var header = document.createElement("div");
    header.className = "project-clad-order-note-dialog__header";

    var title = document.createElement("h2");
    title.id = "project-clad-order-note-title";
    title.textContent = noteTitle(root);
    panel.setAttribute("aria-labelledby", title.id);

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "project-clad-order-note-dialog__close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "\u00d7";
    closeBtn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      close();
    });

    header.appendChild(title);
    header.appendChild(closeBtn);

    var body = document.createElement("div");
    body.className = "project-clad-order-note-dialog__body";
    body.tabIndex = 0;
    body.textContent = text;

    panel.appendChild(header);
    panel.appendChild(body);
    panel.addEventListener("click", function (event) {
      event.stopPropagation();
    });
    overlay.appendChild(panel);
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) close();
    });

    document.body.appendChild(overlay);

    var onKey = function (event) {
      if (event.key === "Escape" || event.key === "Esc") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      var items = focusableIn(panel);
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);

    state = {
      root: overlay,
      opener: trigger,
      onKey: onKey,
      previousOverflow: document.body.style.overflow,
    };
    document.body.style.overflow = "hidden";
    try {
      closeBtn.focus();
    } catch (error) {
      /* focus can fail before the node is painted */
    }
  }

  document.addEventListener(
    "click",
    function (event) {
      var target = event.target;
      if (target && target.nodeType === 3 && target.parentElement) {
        target = target.parentElement;
      }
      if (!(target instanceof Element)) return;
      var trigger = target.closest(OPEN_SELECTOR);
      if (!(trigger instanceof HTMLButtonElement)) return;
      event.preventDefault();
      event.stopPropagation();
      open(trigger);
    },
    true,
  );
})();
