-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_JobItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "priceSnapshot" DECIMAL NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "JobItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_JobItem" ("id", "jobId", "priceSnapshot", "quantity", "variantId") SELECT "id", "jobId", "priceSnapshot", "quantity", "variantId" FROM "JobItem";
DROP TABLE "JobItem";
ALTER TABLE "new_JobItem" RENAME TO "JobItem";
CREATE INDEX "JobItem_jobId_idx" ON "JobItem"("jobId");
CREATE INDEX "JobItem_jobId_sortOrder_idx" ON "JobItem"("jobId", "sortOrder");
CREATE UNIQUE INDEX "JobItem_jobId_variantId_key" ON "JobItem"("jobId", "variantId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
