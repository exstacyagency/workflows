-- Remove deprecated creator library table.
DROP TABLE IF EXISTS "creator_library" CASCADE;

-- Add Sora character workflow columns to product table.
ALTER TABLE "product"
  ADD COLUMN IF NOT EXISTS "product_reference_image_url" text,
  ADD COLUMN IF NOT EXISTS "character_reference_video_url" text,
  ADD COLUMN IF NOT EXISTS "sora_character_id" text,
  ADD COLUMN IF NOT EXISTS "character_cameo_created_at" timestamptz;
