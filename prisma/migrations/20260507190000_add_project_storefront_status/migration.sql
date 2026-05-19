-- CreateEnum
CREATE TYPE "ProjectStorefrontStatus" AS ENUM ('active', 'complete', 'inactive');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "storefrontStatus" "ProjectStorefrontStatus" NOT NULL DEFAULT 'active';
