import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { GAUGE_CATALOG_METAFIELD } from "./gaugeCatalogConstants";
import {
  bulkUpdateVariantPrices,
  buildProportionalPriceUpdates,
  listVariantPricesForGauge,
} from "./gaugeCatalogSync.server";
import type { GaugeCatalogActionData, GaugeCatalogLoaderData } from "./gaugeCatalogAdminRoute.types";

export const gaugeCatalogLoader = async ({
  request,
}: LoaderFunctionArgs): Promise<GaugeCatalogLoaderData> => {
  const { session } = await authenticate.admin(request);
  const rows = await prisma.gaugeConfig.findMany({
    where: { shop: session.shop },
    orderBy: { gauge: "asc" },
  });
  return {
    gauges: rows.map((r) => ({
      id: r.id,
      gauge: r.gauge,
      value: String(r.value),
      baseline:
        r.valueAtLastCatalogSync != null
          ? String(r.valueAtLastCatalogSync)
          : null,
    })),
  };
};

export const gaugeCatalogAction = async ({
  request,
}: ActionFunctionArgs): Promise<GaugeCatalogActionData> => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const gaugeRaw = String(form.get("gauge") || "");
  const gauge = Number.parseInt(gaugeRaw, 10);
  if (!Number.isFinite(gauge)) {
    return { ok: false, error: "Invalid gauge." };
  }

  const config = await prisma.gaugeConfig.findUnique({
    where: { shop_gauge: { shop: session.shop, gauge } },
  });

  if (!config) {
    return { ok: false, error: `No gauge config for ${gauge}.` };
  }

  const master = Number(config.value);
  if (!Number.isFinite(master) || master <= 0) {
    return {
      ok: false,
      error: `Master value for ${gauge} ga must be a positive number.`,
    };
  }

  if (intent === "preview") {
    try {
      const rows = await listVariantPricesForGauge(admin, gauge);
      return {
        ok: true,
        message: `Found ${rows.length} variant(s) with metafield ${GAUGE_CATALOG_METAFIELD.namespace}.${GAUGE_CATALOG_METAFIELD.key} = ${gauge}.`,
        gauge,
        variantCount: rows.length,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Preview failed.";
      return { ok: false, error: msg };
    }
  }

  if (intent === "recordBaseline") {
    await prisma.gaugeConfig.update({
      where: { id: config.id },
      data: { valueAtLastCatalogSync: config.value },
    });
    return {
      ok: true,
      message: `Baseline recorded for ${gauge} ga at master value ${master}. Shopify prices were not changed. When you change the master value, use “Apply to Shopify” to scale catalog prices proportionally.`,
      gauge,
    };
  }

  if (intent === "pushCatalog") {
    const baseline =
      config.valueAtLastCatalogSync != null
        ? Number(config.valueAtLastCatalogSync)
        : NaN;
    if (!Number.isFinite(baseline) || baseline <= 0) {
      return {
        ok: false,
        error: `Record a baseline for ${gauge} ga first (while Shopify prices already match this master rate).`,
      };
    }

    const ratio = master / baseline;
    if (Math.abs(ratio - 1) < 1e-12) {
      return {
        ok: true,
        message: `Master value equals the recorded baseline (${master}). Nothing to update.`,
        gauge,
        variantsUpdated: 0,
      };
    }

    try {
      const rows = await listVariantPricesForGauge(admin, gauge);
      if (rows.length === 0) {
        return {
          ok: true,
          message: `No variants found with ${GAUGE_CATALOG_METAFIELD.namespace}.${GAUGE_CATALOG_METAFIELD.key} = ${gauge}. Set that metafield on variants to include them.`,
          gauge,
          variantCount: 0,
          variantsUpdated: 0,
        };
      }

      const byProduct = buildProportionalPriceUpdates(rows, ratio);
      const { errors, variantsUpdated } = await bulkUpdateVariantPrices(
        admin,
        byProduct,
      );

      await prisma.gaugeConfig.update({
        where: { id: config.id },
        data: { valueAtLastCatalogSync: config.value },
      });

      return {
        ok: true,
        message: `Scaled ${variantsUpdated} variant price(s) for ${gauge} ga by factor ${ratio.toFixed(6)} (master ${baseline} → ${master}).`,
        gauge,
        variantCount: rows.length,
        variantsUpdated,
        warnings: errors.length ? errors : undefined,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Update failed.";
      return { ok: false, error: msg };
    }
  }

  return { ok: false, error: "Unknown action." };
};
