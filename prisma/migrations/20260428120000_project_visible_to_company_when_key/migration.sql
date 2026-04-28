-- Projects with a stamped `ownerCompanyKey` are intended for the Company scope.
-- After the opt-out default flip (20260423180000), these rows stayed `visibleToCompany = false`
-- with no create-path setting it, so coworkers saw an empty Company tab.

UPDATE "Project"
SET "visibleToCompany" = true
WHERE "ownerCompanyKey" IS NOT NULL
  AND TRIM("ownerCompanyKey") <> '';
