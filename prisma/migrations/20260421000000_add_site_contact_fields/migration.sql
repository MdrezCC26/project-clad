-- AlterTable: per-order on-site contact (autofilled from project default)
ALTER TABLE "Job" ADD COLUMN "siteContactName" TEXT;
ALTER TABLE "Job" ADD COLUMN "siteContactPhone" TEXT;

-- AlterTable: project-level defaults (used to prefill new orders)
ALTER TABLE "Project" ADD COLUMN "defaultSiteContactName" TEXT;
ALTER TABLE "Project" ADD COLUMN "defaultSiteContactPhone" TEXT;
