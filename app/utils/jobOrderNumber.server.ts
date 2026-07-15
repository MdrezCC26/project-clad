import prisma from "../db.server";
import { shopStringFilter } from "./projectAccess.server";

/**
 * Allocates the next value from `Job_orderNumber_seq` and sets `Job.orderNumber`
 * when it is currently null. Verifies the job belongs to the shop.
 *
 * When `opts.allowExisting` is true (default for auto-assign on → ordered),
 * returns the existing number instead of erroring if one is already set.
 */
export async function assignNextJobOrderNumberForShop(
  shop: string,
  jobId: string,
  opts?: { allowExisting?: boolean },
): Promise<
  { ok: true; orderNumber: number } | { ok: false; error: string }
> {
  const allowExisting = opts?.allowExisting === true;
  try {
    return await prisma.$transaction(async (tx) => {
      const job = await tx.job.findFirst({
        where: { id: jobId, project: { shop: shopStringFilter(shop) } },
        select: { id: true, orderNumber: true },
      });
      if (!job) {
        return { ok: false, error: "Order not found." };
      }
      if (job.orderNumber != null) {
        if (allowExisting) {
          return { ok: true, orderNumber: job.orderNumber };
        }
        return {
          ok: false,
          error: `This order already has number #${job.orderNumber}.`,
        };
      }
      const rows = await tx.$queryRaw<Array<{ nextval: bigint | number }>>`
        SELECT nextval('"Job_orderNumber_seq"') AS nextval
      `;
      const raw = rows[0]?.nextval;
      const next =
        typeof raw === "bigint" ? Number(raw) : Number(raw ?? Number.NaN);
      if (!Number.isFinite(next)) {
        return { ok: false, error: "Could not allocate order number." };
      }
      await tx.job.update({
        where: { id: job.id },
        data: { orderNumber: next },
      });
      return { ok: true, orderNumber: next };
    });
  } catch (e) {
    const isUnique =
      e &&
      typeof e === "object" &&
      "code" in e &&
      (e as { code?: string }).code === "P2002";
    if (isUnique) {
      return {
        ok: false,
        error: "That number is already in use. Try again or set a different number.",
      };
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not assign order number.",
    };
  }
}

/**
 * Idempotent: assign next sequence number if missing. Use whenever lifecycle
 * becomes `ordered` (staff dropdown, admin work orders, etc.).
 */
export async function ensureJobOrderNumberForShop(
  shop: string,
  jobId: string,
): Promise<{ ok: true; orderNumber: number } | { ok: false; error: string }> {
  return assignNextJobOrderNumberForShop(shop, jobId, { allowExisting: true });
}

const MIN_MANUAL_ORDER_NUMBER = 1100;

/**
 * Sets `Job.orderNumber` to a specific value (for corrections). Enforces uniqueness.
 */
export async function setManualJobOrderNumberForShop(
  shop: string,
  jobId: string,
  orderNumber: number,
): Promise<
  { ok: true; orderNumber: number } | { ok: false; error: string }
> {
  if (!Number.isInteger(orderNumber) || orderNumber < MIN_MANUAL_ORDER_NUMBER) {
    return {
      ok: false,
      error: `Order number must be a whole number ≥ ${MIN_MANUAL_ORDER_NUMBER}.`,
    };
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId, project: { shop: shopStringFilter(shop) } },
    select: { id: true },
  });
  if (!job) {
    return { ok: false, error: "Order not found." };
  }

  const conflict = await prisma.job.findFirst({
    where: { orderNumber, NOT: { id: jobId } },
    select: { id: true },
  });
  if (conflict) {
    return {
      ok: false,
      error: `Number #${orderNumber} is already used by another order.`,
    };
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { orderNumber },
  });
  return { ok: true, orderNumber };
}
