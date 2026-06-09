/** Order lifecycle values that count toward project-level subtotal / tax / total rollups. */
const PROJECT_SUBTOTAL_LIFECYCLE_STATUSES = new Set([
  "ordered",
  "delivered",
  "paid",
]);

export function jobCountsTowardProjectSubtotal(status: string): boolean {
  return PROJECT_SUBTOTAL_LIFECYCLE_STATUSES.has(status);
}

/** Short label for the order tile header chip (pre-placed orders). */
export function prePlacedOrderHeaderChipLabel(status: string): string | null {
  switch (status) {
    case "draft":
      return "Quote";
    case "pending_review":
      return "Review";
    case "ready_to_order":
      return "Ready";
    default:
      return null;
  }
}

export function isPrePlacedOrderLifecycle(status: string): boolean {
  return (
    status === "draft" ||
    status === "pending_review" ||
    status === "ready_to_order"
  );
}
