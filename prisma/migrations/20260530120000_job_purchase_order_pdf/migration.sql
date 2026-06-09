-- AlterTable
ALTER TABLE "Job" ADD COLUMN "purchaseOrderPdfStorageKey" TEXT,
ADD COLUMN "purchaseOrderPdfFileName" TEXT;

-- CreateTable
CREATE TABLE "PurchaseOrderPdf" (
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderPdf_pkey" PRIMARY KEY ("storageKey")
);
