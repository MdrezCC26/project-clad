export type GaugeCatalogLoaderData = {
  gauges: Array<{
    id: string;
    gauge: number;
    value: string;
    baseline: string | null;
  }>;
};

export type GaugeCatalogActionData =
  | {
      ok: true;
      message: string;
      gauge?: number;
      variantCount?: number;
      variantsUpdated?: number;
      warnings?: string[];
    }
  | { ok: false; error: string };
