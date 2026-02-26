ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "character_anchor_prompt" TEXT;
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "character_avatar_image_url" TEXT;
ALTER TABLE "storyboard_scene" ADD COLUMN IF NOT EXISTS "firstFrameImageUrl" TEXT;
ALTER TABLE "storyboard_scene" ADD COLUMN IF NOT EXISTS "lastFrameImageUrl" TEXT;
