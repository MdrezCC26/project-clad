
(function() {
  document.addEventListener('change', function(ev) {
    var input = ev.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.name !== 'file' || !input.hasAttribute('data-projectclad-po-pdf-file')) return;
    var form = input.closest('form[data-projectclad-po-pdf-upload-form]');
    if (!(form instanceof HTMLFormElement)) return;
    if (!input.files || !input.files.length) return;
    form.requestSubmit();
  }, true);
})();
          