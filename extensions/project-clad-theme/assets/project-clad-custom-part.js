(function () {
  const root = document.querySelector("[data-projectclad-custom-part]");
  if (!root) return;

  const priceUrl = root.dataset.priceUrl || "";
  const shapeType = root.dataset.shapeType || "L";
  const L1Input = root.querySelector("[data-projectclad-l1]");
  const L2Input = root.querySelector("[data-projectclad-l2]");
  const A1Input = root.querySelector("[data-projectclad-a1]");
  const L3Input = root.querySelector("[data-projectclad-l3]");
  const gaugeSelect = root.querySelector("[data-projectclad-gauge]");
  const quantityInput = root.querySelector("[data-projectclad-quantity]");
  const priceValueEl = root.querySelector("[data-projectclad-price-value]");
  const form = root.querySelector("[data-projectclad-add-form]");
  const formQty = root.querySelector("[data-projectclad-form-qty]");
  const formL1 = root.querySelector("[data-projectclad-form-l1]");
  const formL2 = root.querySelector("[data-projectclad-form-l2]");
  const formA1 = root.querySelector("[data-projectclad-form-a1]");
  const formL3 = root.querySelector("[data-projectclad-form-l3]");
  const formGauge = root.querySelector("[data-projectclad-form-gauge]");

  if (!priceUrl || !L1Input || !L2Input || !gaugeSelect || !priceValueEl || !form) return;

  let priceTimeout;

  function fetchPrice() {
    const L1 = parseFloat(L1Input.value) || 0;
    const L2 = parseFloat(L2Input.value) || 0;
    const L3 = L3Input ? parseFloat(L3Input.value) || 0 : 0;
    const gauge = gaugeSelect.value || "16";
    const quantity = quantityInput ? parseInt(quantityInput.value, 10) || 1 : 1;

    const params = new URLSearchParams({
      shapeType,
      gauge,
      L1: String(L1),
      L2: String(L2),
      quantity: String(quantity),
    });
    if (shapeType === "Z" || shapeType === "U") {
      params.set("L3", String(L3));
    }

    fetch(priceUrl + "?" + params.toString())
      .then((r) => r.json())
      .then((data) => {
        if (data.totalPrice !== undefined) {
          priceValueEl.textContent = "$" + Number(data.totalPrice).toFixed(2);
        } else {
          priceValueEl.textContent = "—";
        }
      })
      .catch(() => {
        priceValueEl.textContent = "—";
      });
  }

  function schedulePriceFetch() {
    clearTimeout(priceTimeout);
    priceTimeout = setTimeout(fetchPrice, 200);
  }

  [L1Input, L2Input, gaugeSelect, quantityInput]
    .filter(Boolean)
    .forEach((el) => {
      el.addEventListener("input", schedulePriceFetch);
      el.addEventListener("change", schedulePriceFetch);
    });
  if (L3Input) {
    L3Input.addEventListener("input", schedulePriceFetch);
    L3Input.addEventListener("change", schedulePriceFetch);
  }

  form.addEventListener("submit", (e) => {
    const L1 = parseFloat(L1Input.value) || 0;
    const L2 = parseFloat(L2Input.value) || 0;
    if (L1 <= 0 || L2 <= 0) {
      e.preventDefault();
      return;
    }
    if (formQty) formQty.value = quantityInput ? quantityInput.value : "1";
    if (formL1) formL1.value = L1Input.value;
    if (formL2) formL2.value = L2Input.value;
    if (formA1) formA1.value = A1Input ? A1Input.value : "90";
    if (formL3) formL3.value = L3Input ? L3Input.value : "";
    if (formGauge) formGauge.value = gaugeSelect.value;
  });

  fetchPrice();
})();
