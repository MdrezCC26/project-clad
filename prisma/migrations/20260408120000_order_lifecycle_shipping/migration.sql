-- CreateEnum
CREATE TYPE "OrderLifecycleStatus" AS ENUM ('draft', 'pending_review', 'ready_to_order', 'ordered', 'delivered', 'paid');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "shipAddress1" TEXT,
ADD COLUMN "shipAddress2" TEXT,
ADD COLUMN "shipCity" TEXT,
ADD COLUMN "shipProvince" TEXT,
ADD COLUMN "shipPostal" TEXT,
ADD COLUMN "shipCountry" TEXT;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "orderLifecycleStatus" "OrderLifecycleStatus" NOT NULL DEFAULT 'draft',
ADD COLUMN "scheduledDeliveryDate" TEXT,
ADD COLUMN "scheduledDeliveryWindow" TEXT,
ADD COLUMN "fulfillmentPhotoStorageKey" TEXT,
ADD COLUMN "fulfillmentNotifiedAt" TIMESTAMP(3);
