import { useFetcher, useLoaderData } from "react-router";
import { GAUGE_CATALOG_METAFIELD } from "../utils/gaugeCatalogConstants";
import type {
  GaugeCatalogActionData,
  GaugeCatalogLoaderData,
} from "../utils/gaugeCatalogAdminRoute.types";

export { gaugeCatalogAction as action, gaugeCatalogLoader as loader } from "../utils/gaugeCatalogAdminRoute.server";

export default function GaugeCatalogPage() {
  const { gauges } = useLoaderData<GaugeCatalogLoaderData>();
  const fetcher = useFetcher<GaugeCatalogActionData>();

  return (
    <s-page heading="Gauge → catalog prices">
      <s-section heading="Master rate drives Shopify variant prices">
        <s-paragraph>
          Your custom pricing uses <code>GaugeConfig.value</code> per gauge. To
          push changes into{" "}
          <strong>existing Shopify variant prices</strong>, tag each variant with
          metafield{" "}
          <strong>
            {GAUGE_CATALOG_METAFIELD.namespace}.{GAUGE_CATALOG_METAFIELD.key}
          </strong>{" "}
          (e.g. <code>26</code>) matching the gauge number. Prices scale{" "}
          <strong>proportionally</strong>: new price = old price × (new master ÷
          last baseline).
        </s-paragraph>
        <s-paragraph>
          Workflow: (1) Set master values and match Shopify prices. (2){" "}
          <strong>Record baseline</strong> for each gauge. (3) When you change a
          master value, run <strong>Apply to Shopify</strong> for that gauge so
          every tagged variant updates.
        </s-paragraph>

        {fetcher.data?.ok === false ? (
          <s-banner tone="critical">{fetcher.data.error}</s-banner>
        ) : null}
        {fetcher.data?.ok === true ? (
          <s-banner tone={fetcher.data.warnings?.length ? "warning" : "success"}>
            {fetcher.data.message}
            {fetcher.data.warnings?.length ? (
              <>
                {" "}
                Details: {fetcher.data.warnings.slice(0, 5).join("; ")}
              </>
            ) : null}
          </s-banner>
        ) : null}

        <s-stack direction="block" gap="base">
          {gauges.map((g) => (
            <div
              key={g.id}
              style={{
                border: "1px solid rgba(0,0,0,0.12)",
                borderRadius: 8,
                padding: "12px 16px",
              }}
            >
              <p style={{ margin: "0 0 8px", fontWeight: 600 }}>
                {g.gauge} ga — master: {g.value}
                {g.baseline != null ? (
                  <span style={{ fontWeight: 400, opacity: 0.85 }}>
                    {" "}
                    (baseline: {g.baseline})
                  </span>
                ) : (
                  <span style={{ fontWeight: 400, opacity: 0.85 }}>
                    {" "}
                    (no baseline yet)
                  </span>
                )}
              </p>
              <fetcher.Form method="post" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <input type="hidden" name="gauge" value={g.gauge} />
                <button type="submit" name="intent" value="preview" disabled={fetcher.state !== "idle"}>
                  Count Shopify variants
                </button>
                <button
                  type="submit"
                  name="intent"
                  value="recordBaseline"
                  disabled={fetcher.state !== "idle"}
                >
                  Record baseline
                </button>
                <button
                  type="submit"
                  name="intent"
                  value="pushCatalog"
                  disabled={fetcher.state !== "idle"}
                >
                  Apply to Shopify
                </button>
              </fetcher.Form>
            </div>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}
