ALTER TABLE "product"
ADD COLUMN IF NOT EXISTS "creator_visual_prompt" text;

ALTER TABLE "product"
ADD COLUMN IF NOT EXISTS "character_seed_video_task_id" text;

ALTER TABLE "product"
ADD COLUMN IF NOT EXISTS "character_seed_video_url" text;

ALTER TABLE "product"
ADD COLUMN IF NOT EXISTS "character_user_name" text;
