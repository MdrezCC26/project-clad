-- Single invite link row per project: keep the newest token row per projectId, then enforce uniqueness.

DELETE FROM "ProjectShareToken" p1
WHERE EXISTS (
  SELECT 1 FROM "ProjectShareToken" p2
  WHERE p2."projectId" = p1."projectId"
    AND (
      p2."createdAt" > p1."createdAt"
      OR (
        p2."createdAt" = p1."createdAt"
        AND p2."id" > p1."id"
      )
    )
);

DROP INDEX IF EXISTS "ProjectShareToken_projectId_idx";

CREATE UNIQUE INDEX "ProjectShareToken_projectId_key" ON "ProjectShareToken"("projectId");
