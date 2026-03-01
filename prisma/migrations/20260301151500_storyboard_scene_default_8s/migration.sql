-- Change default storyboard scene clip duration from 10s to 8s
ALTER TABLE "storyboard_scene"
ALTER COLUMN "clipDurationSeconds" SET DEFAULT 8;
