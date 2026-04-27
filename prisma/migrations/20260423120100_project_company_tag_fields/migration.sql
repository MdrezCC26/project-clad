-- AlterTable
ALTER TABLE "Project" ADD COLUMN "ownerCompanyKey" TEXT;
ALTER TABLE "Project" ADD COLUMN "visibleToCompany" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Project_shop_ownerCompanyKey_idx" ON "Project"("shop", "ownerCompanyKey");
