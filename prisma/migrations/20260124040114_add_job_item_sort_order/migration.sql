-- AlterTable (PostgreSQL)
ALTER TABLE "JobItem" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "JobItem_jobId_sortOrder_idx" ON "JobItem"("jobId", "sortOrder");
