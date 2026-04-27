# Prisma migration drift — cleanup TODO

> Created 2026-04-23. The dev DB and the `prisma/migrations/` folder are out of
> sync. This file is a reminder to fix that *without* losing production data.
> **Never run `prisma migrate reset` against the Render `canadian_cladding` DB.**

## What's wrong

Running `npx prisma migrate dev` reports three drift items:

1. **Missing local migration** — applied in DB, no folder locally:
   - `20260409193000_project_receive_mode_default_pickup`
2. **Checksum mismatch** — local SQL was edited after being applied:
   - `20260124040114_add_job_item_sort_order`
   - `20260124071000_drop_jobitem_variant_unique`

Until this is resolved, `prisma migrate dev` will refuse to run new migrations
and will offer `prisma migrate reset` (which would WIPE the database).

## How we ship new migrations in the meantime

Skip `prisma migrate dev`. Apply the SQL directly and record it as applied:

```powershell
# 1. Run the SQL on the DB.
npx prisma db execute `
  --file prisma/migrations/<TIMESTAMP>_<name>/migration.sql `
  --schema prisma/schema.prisma

# 2. Record it in _prisma_migrations so future migrate runs skip it.
npx prisma migrate resolve --applied <TIMESTAMP>_<name>

# 3. Regenerate the client.
npx prisma generate
```

The `20260423180000_project_visible_to_company_default_false` migration was
shipped this way on 2026-04-23.

## How to fix the drift permanently (do this when you have a quiet window)

1. **Recreate the missing local migration folder.** Make
   `prisma/migrations/20260409193000_project_receive_mode_default_pickup/migration.sql`
   containing the SQL that was actually applied (check `git log` and the later
   `20260414223000_project_receive_mode_pickup_default` migration for hints).
   Verify the contents against the live DB schema. No `migrate resolve` needed
   — the row is already in `_prisma_migrations`.
2. **Restore the two checksum-mismatched migration files** to the exact bytes
   that were originally applied. Use git history:
   ```powershell
   git log -- prisma/migrations/20260124040114_add_job_item_sort_order/migration.sql
   git log -- prisma/migrations/20260124071000_drop_jobitem_variant_unique/migration.sql
   ```
   Restore each to the commit that added it, then commit the revert.
3. **Verify** with `npx prisma migrate status`. It should report "Database
   schema is up to date" with no drift warnings.
4. Delete this file once the above is green.

## Why this happened (avoid repeating)

- Migrations were edited in place after being applied (don't do this — write a
  new migration instead).
- A migration was applied to the dev DB and then deleted from the folder
  (probably during a branch swap). Always commit migrations alongside the
  schema change that produced them.
