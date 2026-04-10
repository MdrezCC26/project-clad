-- CreateEnum
CREATE TYPE "ProjectReceiveMode" AS ENUM ('delivery', 'pickup');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "receiveMode" "ProjectReceiveMode" NOT NULL DEFAULT 'delivery';
