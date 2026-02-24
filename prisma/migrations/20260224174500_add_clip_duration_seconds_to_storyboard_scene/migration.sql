ALTER TABLE "storyboard_scene"
ADD COLUMN IF NOT EXISTS "clipDurationSeconds" INTEGER DEFAULT 10;
