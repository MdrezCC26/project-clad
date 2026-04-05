-- AlterTable
ALTER TABLE "JobItem" ADD COLUMN     "catalogProductId" TEXT,
ADD COLUMN     "catalogSku" TEXT;

-- CreateIndex
CREATE INDEX "JobItem_catalogSku_idx" ON "JobItem"("catalogSku");
