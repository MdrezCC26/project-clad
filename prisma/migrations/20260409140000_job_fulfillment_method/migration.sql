-- CreateEnum
CREATE TYPE "JobFulfillmentMethod" AS ENUM ('delivery', 'pickup');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "fulfillmentMethod" "JobFulfillmentMethod";
