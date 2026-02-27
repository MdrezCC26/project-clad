-- AlterTable (PostgreSQL)
ALTER TABLE "Job" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "Job_projectId_sortOrder_idx" ON "Job"("projectId", "sortOrder");
