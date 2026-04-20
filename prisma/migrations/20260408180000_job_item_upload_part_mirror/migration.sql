-- Mirrored Shopify line-item file uploads (staged-upload URLs are ephemeral).
ALTER TABLE "JobItem" ADD COLUMN "uploadPartMirrorKeysJson" TEXT;
