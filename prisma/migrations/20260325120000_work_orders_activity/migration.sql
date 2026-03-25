-- Job work order + receipt
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "workOrderStatus" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "receiptSnapshot" JSONB;

-- Optional display name for order (e.g. #1001), set when paid
ALTER TABLE "JobOrderLink" ADD COLUMN IF NOT EXISTS "orderName" TEXT;

-- Activity (single store; member vs admin visibility)
CREATE TABLE IF NOT EXISTS "ProjectActivityEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "jobId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "visibility" TEXT NOT NULL,
    "actorCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectActivityEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProjectActivityEvent_projectId_idx" ON "ProjectActivityEvent"("projectId");
CREATE INDEX IF NOT EXISTS "ProjectActivityEvent_createdAt_idx" ON "ProjectActivityEvent"("createdAt");

ALTER TABLE "ProjectActivityEvent" ADD CONSTRAINT "ProjectActivityEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Comments (soft delete)
CREATE TABLE IF NOT EXISTS "ProjectComment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "authorCustomerId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedByCustomerId" TEXT,
    "deletedByLabel" TEXT,

    CONSTRAINT "ProjectComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProjectComment_projectId_idx" ON "ProjectComment"("projectId");

ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
