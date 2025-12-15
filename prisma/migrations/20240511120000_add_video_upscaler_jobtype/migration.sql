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
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'JobType' AND e.enumlabel = 'VIDEO_UPSCALER'
  ) THEN
    EXECUTE 'ALTER TYPE "JobType" ADD ' || 'VALUE ''VIDEO_UPSCALER''';
  END IF;
END$$;
