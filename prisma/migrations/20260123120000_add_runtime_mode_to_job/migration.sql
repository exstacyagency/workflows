-- Add runtimeMode column to job table
ALTER TABLE "job"
ADD COLUMN IF NOT EXISTS "runtimeMode" TEXT NOT NULL DEFAULT 'alpha';
