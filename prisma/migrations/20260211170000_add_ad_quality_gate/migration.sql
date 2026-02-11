-- Add AD_QUALITY_GATE job type and quality assessment fields for ad assets
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'AD_QUALITY_GATE';

ALTER TABLE "ad_asset"
  ADD COLUMN IF NOT EXISTS "contentViable" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "qualityIssue" TEXT,
  ADD COLUMN IF NOT EXISTS "qualityConfidence" INTEGER,
  ADD COLUMN IF NOT EXISTS "qualityReason" TEXT;
