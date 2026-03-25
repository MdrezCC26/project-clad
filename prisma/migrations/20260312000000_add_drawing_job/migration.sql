-- CreateTable
CREATE TABLE "DrawingJob" (
    "id" TEXT NOT NULL,
    "jobItemId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "shapeType" TEXT NOT NULL,
    "l1" DOUBLE PRECISION NOT NULL,
    "l2" DOUBLE PRECISION NOT NULL,
    "l3" DOUBLE PRECISION,
    "a1" DOUBLE PRECISION,
    "gauge" INTEGER NOT NULL,
    "partNumber" TEXT,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DrawingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DrawingJob_jobItemId_key" ON "DrawingJob"("jobItemId");

-- CreateIndex
CREATE INDEX "DrawingJob_shop_status_idx" ON "DrawingJob"("shop", "status");

-- CreateIndex
CREATE INDEX "DrawingJob_status_idx" ON "DrawingJob"("status");

-- AddForeignKey
ALTER TABLE "DrawingJob" ADD CONSTRAINT "DrawingJob_jobItemId_fkey" FOREIGN KEY ("jobItemId") REFERENCES "JobItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
