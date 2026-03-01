-- Add product character gender metadata for prompt resolution
ALTER TABLE "product"
ADD COLUMN IF NOT EXISTS "character_gender" TEXT;

-- Add per-scene VO-only behavior toggle for video prompt generation
ALTER TABLE "storyboard_scene"
ADD COLUMN IF NOT EXISTS "voiceover_only" BOOLEAN NOT NULL DEFAULT false;
