const CANADA_PROVINCE_OPTIONS: { code: string; label: string }[] = [
  { code: "AB", label: "Alberta" },
  { code: "BC", label: "British Columbia" },
  { code: "MB", label: "Manitoba" },
  { code: "NB", label: "New Brunswick" },
  { code: "NL", label: "Newfoundland and Labrador" },
  { code: "NS", label: "Nova Scotia" },
  { code: "NT", label: "Northwest Territories" },
  { code: "NU", label: "Nunavut" },
  { code: "ON", label: "Ontario" },
  { code: "PE", label: "Prince Edward Island" },
  { code: "QC", label: "Quebec" },
  { code: "SK", label: "Saskatchewan" },
  { code: "YT", label: "Yukon" },
];

export function JobDeliveryAddressFields({
  idPrefix,
  shipAddress1,
  shipCity,
  shipProvince,
  shipPostal,
  hidden,
}: {
  idPrefix: string;
  shipAddress1: string | null;
  shipCity: string | null;
  shipProvince: string | null;
  shipPostal: string | null;
  hidden?: boolean;
}) {
  if (hidden) return null;

  const provinceDefault =
    shipProvince?.trim() &&
    CANADA_PROVINCE_OPTIONS.some((p) => p.code === shipProvince.trim())
      ? shipProvince.trim()
      : "ON";

  return (
    <div className="project-clad-job-delivery-address" data-projectclad-job-delivery-address>
      <label htmlFor={`${idPrefix}-ship-address1`}>Address</label>
      <input
        id={`${idPrefix}-ship-address1`}
        name="shipAddress1"
        type="text"
        defaultValue={shipAddress1 ?? ""}
        placeholder="Street address"
        autoComplete="street-address"
        className="project-clad-pricing-password-input"
        data-projectclad-delivery-address-input
      />
      <div className="project-clad-form-grid">
        <div className="project-clad-form-grid__cell">
          <label htmlFor={`${idPrefix}-ship-city`}>City</label>
          <input
            id={`${idPrefix}-ship-city`}
            name="shipCity"
            type="text"
            defaultValue={shipCity ?? ""}
            autoComplete="address-level2"
            className="project-clad-pricing-password-input"
            data-projectclad-delivery-address-input
          />
        </div>
        <div className="project-clad-form-grid__cell">
          <label htmlFor={`${idPrefix}-ship-postal`}>Postal</label>
          <input
            id={`${idPrefix}-ship-postal`}
            name="shipPostal"
            type="text"
            defaultValue={shipPostal ?? ""}
            autoComplete="postal-code"
            className="project-clad-pricing-password-input"
            data-projectclad-delivery-address-input
          />
        </div>
      </div>
      <div className="project-clad-form-grid">
        <div className="project-clad-form-grid__cell">
          <label htmlFor={`${idPrefix}-ship-province`}>Province</label>
          <select
            id={`${idPrefix}-ship-province`}
            name="shipProvince"
            defaultValue={provinceDefault}
            className="project-clad-pricing-password-input"
            data-projectclad-delivery-address-input
          >
            <option value="">—</option>
            {CANADA_PROVINCE_OPTIONS.map(({ code, label }) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="project-clad-form-grid__cell">
          <label htmlFor={`${idPrefix}-ship-country`}>Country</label>
          <select
            id={`${idPrefix}-ship-country`}
            name="shipCountry"
            defaultValue="Canada"
            className="project-clad-pricing-password-input"
            data-projectclad-delivery-address-input
          >
            <option value="">—</option>
            <option value="Canada">Canada</option>
          </select>
        </div>
      </div>
    </div>
  );
}

export function ProjectReceiveModeRadios({
  name,
  defaultMode,
}: {
  name: string;
  defaultMode: "pickup" | "delivery";
}) {
  return (
    <fieldset className="project-clad-delivery-mode-radios" data-projectclad-receive-mode-fieldset>
      <legend className="project-clad-sr-only">Default receive method</legend>
      <label className="project-clad-delivery-mode__option">
        <input
          type="radio"
          name={name}
          value="pickup"
          defaultChecked={defaultMode === "pickup"}
        />
        <span className="project-clad-delivery-mode__label">Store pickup</span>
      </label>
      <label className="project-clad-delivery-mode__option">
        <input
          type="radio"
          name={name}
          value="delivery"
          defaultChecked={defaultMode === "delivery"}
        />
        <span className="project-clad-delivery-mode__label">Delivery</span>
      </label>
    </fieldset>
  );
}

export function JobDeliveryModeRadios({
  name,
  defaultMode,
}: {
  name: string;
  defaultMode: "inherit" | "pickup" | "delivery";
}) {
  return (
    <fieldset className="project-clad-delivery-mode-radios" data-projectclad-job-delivery-mode-fieldset>
      <legend className="project-clad-sr-only">Order delivery</legend>
      <label className="project-clad-delivery-mode__option">
        <input
          type="radio"
          name={name}
          value="inherit"
          defaultChecked={defaultMode === "inherit"}
          data-projectclad-delivery-mode-radio
        />
        <span className="project-clad-delivery-mode__label">
          Use project delivery settings
        </span>
      </label>
      <label className="project-clad-delivery-mode__option">
        <input
          type="radio"
          name={name}
          value="pickup"
          defaultChecked={defaultMode === "pickup"}
          data-projectclad-delivery-mode-radio
        />
        <span className="project-clad-delivery-mode__label">
          Store pickup (this order)
        </span>
      </label>
      <label className="project-clad-delivery-mode__option">
        <input
          type="radio"
          name={name}
          value="delivery"
          defaultChecked={defaultMode === "delivery"}
          data-projectclad-delivery-mode-radio
        />
        <span className="project-clad-delivery-mode__label">
          Delivery (this order)
        </span>
      </label>
    </fieldset>
  );
}
