-- CreateEnum
CREATE TYPE "QuoteRequestMode" AS ENUM ('DRAWINGS', 'ITEMIZED');

-- CreateEnum
CREATE TYPE "QuoteRequestFileKind" AS ENUM ('DRAWING', 'DOCUMENT', 'LINE_ITEM');

-- CreateTable
CREATE TABLE "QuoteRequest" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "mode" "QuoteRequestMode" NOT NULL,
    "customerId" TEXT,
    "contactName" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "projectName" TEXT,
    "siteAddress" TEXT,
    "siteCity" TEXT,
    "siteProvince" TEXT,
    "sitePostal" TEXT,
    "neededBy" DATE,
    "fulfillment" TEXT,
    "gauge" TEXT,
    "colours" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "siteNotes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteRequestLineItem" (
    "id" TEXT NOT NULL,
    "quoteRequestId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "length" TEXT,
    "gauge" TEXT,
    "colour" TEXT,
    "notes" TEXT,
    "useOrderDrawings" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "QuoteRequestLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteRequestFile" (
    "id" TEXT NOT NULL,
    "quoteRequestId" TEXT NOT NULL,
    "lineItemId" TEXT,
    "kind" "QuoteRequestFileKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteRequestFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRequest_reference_key" ON "QuoteRequest"("reference");

-- CreateIndex
CREATE INDEX "QuoteRequest_shop_createdAt_idx" ON "QuoteRequest"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "QuoteRequestLineItem_quoteRequestId_sortOrder_idx" ON "QuoteRequestLineItem"("quoteRequestId", "sortOrder");

-- CreateIndex
CREATE INDEX "QuoteRequestFile_quoteRequestId_idx" ON "QuoteRequestFile"("quoteRequestId");

-- CreateIndex
CREATE INDEX "QuoteRequestFile_lineItemId_idx" ON "QuoteRequestFile"("lineItemId");

-- AddForeignKey
ALTER TABLE "QuoteRequestLineItem" ADD CONSTRAINT "QuoteRequestLineItem_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequestFile" ADD CONSTRAINT "QuoteRequestFile_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequestFile" ADD CONSTRAINT "QuoteRequestFile_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "QuoteRequestLineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
