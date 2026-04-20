-- Optional per-shop toggles for automated notification emails (JSON).
ALTER TABLE "ShopSettings" ADD COLUMN IF NOT EXISTS "emailNotificationPrefsJson" TEXT;
