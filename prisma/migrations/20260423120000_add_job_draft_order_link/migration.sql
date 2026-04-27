-- CreateTable
CREATE TABLE "JobDraftOrderLink" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "shopifyDraftOrderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobDraftOrderLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobDraftOrderLink_jobId_key" ON "JobDraftOrderLink"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobDraftOrderLink_shopifyDraftOrderId_key" ON "JobDraftOrderLink"("shopifyDraftOrderId");

-- AddForeignKey
ALTER TABLE "JobDraftOrderLink" ADD CONSTRAINT "JobDraftOrderLink_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
