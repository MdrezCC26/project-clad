-- Create PostgreSQL enum type for ProjectRole and update existing columns

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'ProjectRole'
  ) THEN
    CREATE TYPE "ProjectRole" AS ENUM ('view', 'edit');
  END IF;
END
$$;

ALTER TABLE "ProjectMember"
  ALTER COLUMN "role" TYPE "ProjectRole"
  USING "role"::"ProjectRole";

ALTER TABLE "ProjectShareToken"
  ALTER COLUMN "role" TYPE "ProjectRole"
  USING "role"::"ProjectRole";

