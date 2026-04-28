-- Internal sequential order number for placed orders.
CREATE SEQUENCE IF NOT EXISTS "Job_orderNumber_seq"
  START WITH 1100
  INCREMENT BY 1
  MINVALUE 1100;

ALTER TABLE "Job"
ADD COLUMN IF NOT EXISTS "orderNumber" INTEGER;

-- One-time backfill for historical placed orders (oldest first).
WITH ordered_jobs AS (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "Job"
  WHERE "orderNumber" IS NULL
    AND "orderLifecycleStatus" IN ('ordered', 'delivered', 'paid')
)
UPDATE "Job" AS j
SET "orderNumber" = 1099 + ordered_jobs.rn
FROM ordered_jobs
WHERE j.id = ordered_jobs.id;

CREATE UNIQUE INDEX IF NOT EXISTS "Job_orderNumber_key"
ON "Job"("orderNumber");

-- Keep sequence aligned so next new order gets max + 1.
SELECT setval(
  '"Job_orderNumber_seq"',
  GREATEST(1099, COALESCE((SELECT MAX("orderNumber") FROM "Job"), 1099)) + 1,
  false
);
