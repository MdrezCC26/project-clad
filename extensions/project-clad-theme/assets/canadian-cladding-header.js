(function () {
  var root = document.querySelector("[data-cc-header]");
  if (!root) return;
  var ham = root.querySelector(".cc-ham");
  if (!ham) return;
  ham.addEventListener("click", function () {
    root.classList.toggle("cc-nav-open");
  });
})();
