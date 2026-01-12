/*
  Safe enum migration for JobType.
  Removes deprecated values without dropping any tables.
*/

BEGIN;

-- Remove default to allow type conversion
ALTER TABLE "job" ALTER COLUMN "type" DROP DEFAULT;

-- Convert enum → text
ALTER TABLE "job"
ALTER COLUMN "type" TYPE TEXT
USING "type"::text;

-- Drop and recreate enum safely
DROP TYPE IF EXISTS "JobType" CASCADE;

CREATE TYPE "JobType" AS ENUM (
  'CUSTOMER_RESEARCH',
  'CUSTOMER_ANALYSIS',
  'PATTERN_ANALYSIS',
  'SCRIPT_GENERATION',
  'STORYBOARD_GENERATION',
  'VIDEO_PROMPT_GENERATION',
  'VIDEO_IMAGE_GENERATION',
  'VIDEO_GENERATION',
  'VIDEO_REVIEW',
  'VIDEO_UPSCALER',
  'AD_PERFORMANCE'
);

-- Convert text → enum
ALTER TABLE "job"
ALTER COLUMN "type" TYPE "JobType"
USING "type"::"JobType";

-- Restore default if needed
ALTER TABLE "job"
ALTER COLUMN "type" SET DEFAULT 'CUSTOMER_RESEARCH';

COMMIT;