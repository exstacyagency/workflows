-- Fix schema drift: CHARACTER_VOICE_SETUP already exists in DB, this is a no-op
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'CHARACTER_VOICE_SETUP';

-- Fix schema drift: elevenLabs columns already exist in DB, these are no-ops
ALTER TABLE "character" ADD COLUMN IF NOT EXISTS "elevenLabsVoiceId" TEXT;
ALTER TABLE "character" ADD COLUMN IF NOT EXISTS "elevenLabsVoiceName" TEXT;

-- Phase 1 OpenClaw: add session key to user table
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "openClawSessionKey" TEXT;

-- Phase 1 OpenClaw: create ProjectAgentBinding table
CREATE TABLE IF NOT EXISTS "ProjectAgentBinding" (
  "id"                  TEXT         NOT NULL,
  "projectId"           TEXT         NOT NULL,
  "spaceBotWebhookUrl"  TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectAgentBinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectAgentBinding_projectId_key"
  ON "ProjectAgentBinding"("projectId");
