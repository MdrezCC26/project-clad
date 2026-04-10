-- AlterTable
ALTER TABLE "Job" ADD COLUMN "purchaseOrderNumber" TEXT;

-- Legacy: cart stored PO inside `name` as "… (#PO)". Move to column and strip suffix.
UPDATE "Job"
SET
  "purchaseOrderNumber" = NULLIF(TRIM((regexp_match("name", ' \((#[^)]+)\)$'))[1]), ''),
  "name" = regexp_replace(TRIM("name"), ' \(#[^)]+\)$', '')
WHERE "name" ~ ' \(#[^)]+\)$';
