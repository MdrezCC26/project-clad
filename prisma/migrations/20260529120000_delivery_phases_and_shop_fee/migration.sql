-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN "deliveryFeeAmount" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "JobDeliveryPhase" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "scheduledDeliveryDate" TEXT,
    "scheduledDeliveryWindow" TEXT,
    "deliveryFeeAmount" DECIMAL(10,2),
    "fulfillmentPhotoStorageKey" TEXT,
    "fulfillmentNotifiedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobDeliveryPhase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobDeliveryPhaseLine" (
    "id" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "jobItemId" TEXT NOT NULL,
    "quantityPlanned" INTEGER NOT NULL DEFAULT 0,
    "quantityDelivered" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "JobDeliveryPhaseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobDeliveryPhaseDraftOrderLink" (
    "id" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "shopifyDraftOrderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobDeliveryPhaseDraftOrderLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobDeliveryPhase_jobId_idx" ON "JobDeliveryPhase"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobDeliveryPhase_jobId_sequence_key" ON "JobDeliveryPhase"("jobId", "sequence");

-- CreateIndex
CREATE INDEX "JobDeliveryPhaseLine_phaseId_idx" ON "JobDeliveryPhaseLine"("phaseId");

-- CreateIndex
CREATE INDEX "JobDeliveryPhaseLine_jobItemId_idx" ON "JobDeliveryPhaseLine"("jobItemId");

-- CreateIndex
CREATE UNIQUE INDEX "JobDeliveryPhaseLine_phaseId_jobItemId_key" ON "JobDeliveryPhaseLine"("phaseId", "jobItemId");

-- CreateIndex
CREATE UNIQUE INDEX "JobDeliveryPhaseDraftOrderLink_phaseId_key" ON "JobDeliveryPhaseDraftOrderLink"("phaseId");

-- CreateIndex
CREATE UNIQUE INDEX "JobDeliveryPhaseDraftOrderLink_shopifyDraftOrderId_key" ON "JobDeliveryPhaseDraftOrderLink"("shopifyDraftOrderId");

-- AddForeignKey
ALTER TABLE "JobDeliveryPhase" ADD CONSTRAINT "JobDeliveryPhase_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDeliveryPhaseLine" ADD CONSTRAINT "JobDeliveryPhaseLine_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "JobDeliveryPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDeliveryPhaseLine" ADD CONSTRAINT "JobDeliveryPhaseLine_jobItemId_fkey" FOREIGN KEY ("jobItemId") REFERENCES "JobItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDeliveryPhaseDraftOrderLink" ADD CONSTRAINT "JobDeliveryPhaseDraftOrderLink_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "JobDeliveryPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
