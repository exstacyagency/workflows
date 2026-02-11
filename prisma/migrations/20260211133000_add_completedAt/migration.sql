-- Add completedAt column to research_run
ALTER TABLE "research_run" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
