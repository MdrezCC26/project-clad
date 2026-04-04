-- Remove unused storefront color themes (only default styling remains)
ALTER TABLE "ShopSettings" DROP COLUMN IF EXISTS "storefrontTheme";
