-- Finance invoice PDF storage + Job invoice lifecycle timestamps.
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "invoicePdfStorageKey" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "invoicePdfFileName" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "invoiceUploadedAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "invoiceEmailedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "InvoicePdf" (
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoicePdf_pkey" PRIMARY KEY ("storageKey")
);
