-- CreateEnum
CREATE TYPE "JobDeliveryMode" AS ENUM ('inherit', 'pickup', 'delivery');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "deliveryMode" "JobDeliveryMode" NOT NULL DEFAULT 'inherit',
ADD COLUMN "shipAddress1" TEXT,
ADD COLUMN "shipCity" TEXT,
ADD COLUMN "shipProvince" TEXT,
ADD COLUMN "shipPostal" TEXT,
ADD COLUMN "shipCountry" TEXT;
