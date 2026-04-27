-- Flip the default for the company-visibility opt-in toggle from `true` to `false`.
-- Owners must now explicitly opt in to share a project with coworkers at their company.
-- Also reset existing rows to `false` because the feature only just shipped and no one
-- has had a chance to consciously opt in yet.

ALTER TABLE "Project" ALTER COLUMN "visibleToCompany" SET DEFAULT false;
UPDATE "Project" SET "visibleToCompany" = false WHERE "visibleToCompany" = true;
