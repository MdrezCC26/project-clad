ALTER TABLE "ProjectShareToken"
ADD COLUMN "expiresAt" TIMESTAMP(3);

UPDATE "ProjectShareToken"
SET "expiresAt" = "createdAt" + INTERVAL '3 days'
WHERE "expiresAt" IS NULL;

ALTER TABLE "ProjectShareToken"
ALTER COLUMN "expiresAt" SET NOT NULL;

CREATE INDEX "ProjectShareToken_expiresAt_idx"
ON "ProjectShareToken"("expiresAt");
