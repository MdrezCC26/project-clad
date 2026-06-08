/** Shared delivery resolution for project + job (storefront UI and server actions). */

/** Fallback when shop setting is unavailable (see `getShopDeliveryFee`). */
export const PROJECT_DELIVERY_FEE = 15;

export type DeliveryFeeResolver = number | (() => number);

export type JobDeliveryMode = "inherit" | "pickup" | "delivery";

export type ShipToFields = {
  shipAddress1?: string | null;
  shipCity?: string | null;
  shipProvince?: string | null;
  shipPostal?: string | null;
  shipCountry?: string | null;
};

export function hasCompleteShipToDetails(ship: ShipToFields): boolean {
  return Boolean(
    ship.shipAddress1?.trim() &&
      ship.shipCity?.trim() &&
      ship.shipProvince?.trim() &&
      ship.shipPostal?.trim(),
  );
}

export function formatShipToOneLine(ship: ShipToFields): string | null {
  const parts = [
    ship.shipAddress1?.trim(),
    ship.shipCity?.trim(),
    ship.shipProvince?.trim(),
    ship.shipPostal?.trim(),
  ].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  const country = ship.shipCountry?.trim() || "Canada";
  return [...parts, country].join(", ");
}

export function normalizeJobDeliveryMode(
  raw: string | null | undefined,
): JobDeliveryMode {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (v === "pickup" || v === "delivery") return v;
  return "inherit";
}

export type ResolvedJobDelivery = {
  mode: JobDeliveryMode;
  method: "pickup" | "delivery";
  fee: number;
  addressLine: string | null;
  /** True when the displayed address comes from job-level ship fields. */
  usesJobAddress: boolean;
};

function resolveDeliveryFeeAmount(feeResolver?: DeliveryFeeResolver): number {
  if (feeResolver == null) return PROJECT_DELIVERY_FEE;
  return typeof feeResolver === "function" ? feeResolver() : feeResolver;
}

export function resolveJobDelivery(
  job: ShipToFields & {
    deliveryMode?: string | null;
    fulfillmentMethod?: string | null;
  },
  project: ShipToFields & {
    receiveMode?: string | null;
  },
  feeResolver?: DeliveryFeeResolver,
): ResolvedJobDelivery {
  const deliveryFee = resolveDeliveryFeeAmount(feeResolver);
  const mode = normalizeJobDeliveryMode(job.deliveryMode);

  const pickupResolved = (
    resolvedMode: JobDeliveryMode,
  ): ResolvedJobDelivery => ({
    mode: resolvedMode,
    method: "pickup",
    fee: 0,
    addressLine: null,
    usesJobAddress: false,
  });

  if (mode === "pickup") {
    return pickupResolved("pickup");
  }

  if (mode === "delivery") {
    const jobComplete = hasCompleteShipToDetails(job);
    const projectComplete = hasCompleteShipToDetails(project);
    const usesJobAddress = jobComplete;
    const ship = jobComplete ? job : project;
    const addressLine = formatShipToOneLine(ship);
    const canCharge =
      jobComplete || (!jobComplete && projectComplete && !usesJobAddress);
    return {
      mode: "delivery",
      method: "delivery",
      fee: canCharge ? deliveryFee : 0,
      addressLine,
      usesJobAddress,
    };
  }

  /* inherit — legacy: honor fulfillmentMethod once set at Order now */
  const legacyMethod = String(job.fulfillmentMethod || "")
    .trim()
    .toLowerCase();
  if (legacyMethod === "pickup") {
    return pickupResolved("inherit");
  }
  if (legacyMethod === "delivery") {
    const jobComplete = hasCompleteShipToDetails(job);
    const projectComplete = hasCompleteShipToDetails(project);
    const usesJobAddress = jobComplete;
    const ship = jobComplete ? job : project;
    return {
      mode: "inherit",
      method: "delivery",
      fee: projectComplete || jobComplete ? deliveryFee : 0,
      addressLine: formatShipToOneLine(ship),
      usesJobAddress,
    };
  }

  const projectPickup =
    project.receiveMode === "pickup" || !hasCompleteShipToDetails(project);
  if (projectPickup) {
    return pickupResolved("inherit");
  }

  return {
    mode: "inherit",
    method: "delivery",
    fee: deliveryFee,
    addressLine: formatShipToOneLine(project),
    usesJobAddress: false,
  };
}

export function deliveryFeeForJob(
  job: Parameters<typeof resolveJobDelivery>[0],
  project: Parameters<typeof resolveJobDelivery>[1],
  feeResolver?: DeliveryFeeResolver,
): number {
  return resolveJobDelivery(job, project, feeResolver).fee;
}

export function jobIsDeliveryForDisplay(
  job: Parameters<typeof resolveJobDelivery>[0],
  project: Parameters<typeof resolveJobDelivery>[1],
  feeResolver?: DeliveryFeeResolver,
): boolean {
  return resolveJobDelivery(job, project, feeResolver).method === "delivery";
}

/** Prisma `Job` update/create fragment for delivery mode + ship fields. */
export function jobDeliveryPrismaData(
  deliveryMode: JobDeliveryMode,
  ship: ShipToFields & { shipCountry?: string | null },
) {
  if (deliveryMode === "pickup") {
    return {
      deliveryMode: "pickup" as const,
      fulfillmentMethod: "pickup" as const,
      shipAddress1: null,
      shipCity: null,
      shipProvince: null,
      shipPostal: null,
      shipCountry: null,
    };
  }
  if (deliveryMode === "delivery") {
    return {
      deliveryMode: "delivery" as const,
      fulfillmentMethod: "delivery" as const,
      shipAddress1: ship.shipAddress1 ?? null,
      shipCity: ship.shipCity ?? null,
      shipProvince: ship.shipProvince ?? null,
      shipPostal: ship.shipPostal ?? null,
      shipCountry: ship.shipCountry ?? "Canada",
    };
  }
  /* Omit fulfillmentMethod so Prisma leaves the column unset (inherit). */
  return {
    deliveryMode: "inherit" as const,
    shipAddress1: null,
    shipCity: null,
    shipProvince: null,
    shipPostal: null,
    shipCountry: null,
  };
}

/** Customer/staff delivery plan edits are allowed until the order is fully delivered or paid. */
export function isOrderDeliveryPlanLocked(
  orderLifecycleStatus: string | null | undefined,
): boolean {
  const ls = String(orderLifecycleStatus || "")
    .trim()
    .toLowerCase();
  return ls === "delivered" || ls === "paid";
}

/** True when Prisma/client errors indicate Job delivery columns are missing on the DB. */
export function isJobDeliverySchemaError(e: unknown): boolean {
  if (e instanceof Error) {
    const msg = e.message;
    if (
      /deliveryMode|JobDeliveryMode|deliveryPlanMode|deliveryBatchByItemJson|shipAddress1.*Job|Unknown argument/i.test(
        msg,
      )
    ) {
      return true;
    }
  }
  return false;
}
