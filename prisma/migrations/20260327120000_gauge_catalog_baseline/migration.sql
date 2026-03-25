-- Snapshot of master rate when catalog prices were last aligned (for proportional Shopify updates).
ALTER TABLE "GaugeConfig" ADD COLUMN "valueAtLastCatalogSync" DECIMAL(65,30);
