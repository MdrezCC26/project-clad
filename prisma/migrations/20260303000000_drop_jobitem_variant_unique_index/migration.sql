-- JobItem_jobId_variantId_key was created as a UNIQUE INDEX, not a constraint.
-- Drop the index so multiple JobItems per (jobId, variantId) are allowed
-- (e.g. multiple uploads or calculator configs for the same variant).
DROP INDEX IF EXISTS "JobItem_jobId_variantId_key";
