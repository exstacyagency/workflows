DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'JobType') THEN
    -- Create enum with all current JobType values from prisma/schema.prisma
    CREATE TYPE "JobType" AS ENUM (
      'CUSTOMER_RESEARCH',
      'AD_PERFORMANCE',
      'AD_TRANSCRIPTS',
      'PATTERN_ANALYSIS',
      'SCRIPT_GENERATION',
      'STORYBOARD_GENERATION',
      'CUSTOMER_ANALYSIS',
      'CHARACTER_GENERATION',
      'VIDEO_IMAGE_GENERATION',
      'VIDEO_PROMPT_GENERATION',
      'VIDEO_REVIEW',
      'VIDEO_UPSCALER'
    );
  END IF;
END $$;

-- Add VIDEO_UPSCALER enum value for JobType
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'VIDEO_UPSCALER';
