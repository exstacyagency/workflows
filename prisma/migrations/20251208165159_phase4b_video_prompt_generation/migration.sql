-- AlterEnum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'JobType' AND e.enumlabel = 'VIDEO_PROMPT_GENERATION'
  ) THEN
    EXECUTE 'ALTER TYPE "JobType" ADD ' || 'VALUE ''VIDEO_PROMPT_GENERATION''';
  END IF;
END$$;

-- AlterTable
ALTER TABLE "StoryboardScene" ADD COLUMN     "videoPrompt" TEXT;
