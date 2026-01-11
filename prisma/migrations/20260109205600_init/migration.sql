DO $init$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'user'
  ) THEN
    RAISE NOTICE 'Base schema already exists. Skipping init migration.';
  ELSE
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'JobType') THEN
      EXECUTE $$CREATE TYPE "JobType" AS ENUM ('CUSTOMER_RESEARCH', 'CUSTOMER_ANALYSIS', 'PATTERN_ANALYSIS', 'SCRIPT_GENERATION', 'STORYBOARD_GENERATION', 'VIDEO_PROMPT_GENERATION', 'VIDEO_IMAGE_GENERATION', 'VIDEO_GENERATION', 'VIDEO_REVIEW', 'VIDEO_UPSCALER', 'AD_PERFORMANCE')$$;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ResearchSource') THEN
      EXECUTE $$CREATE TYPE "ResearchSource" AS ENUM ('REDDIT_PRODUCT', 'REDDIT_PROBLEM', 'AMAZON', 'G2', 'LOCAL_BUSINESS')$$;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'JobStatus') THEN
      EXECUTE $$CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')$$;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PlanId') THEN
      EXECUTE $$CREATE TYPE "PlanId" AS ENUM ('FREE', 'GROWTH', 'SCALE')$$;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AdPlatform') THEN
      EXECUTE $$CREATE TYPE "AdPlatform" AS ENUM ('TIKTOK', 'META')$$;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ScriptStatus') THEN
      EXECUTE $$CREATE TYPE "ScriptStatus" AS ENUM ('seeded', 'PENDING', 'READY', 'upscaled', 'upscale_pending', 'upscale_failed')$$;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccountTier') THEN
      EXECUTE $$CREATE TYPE "AccountTier" AS ENUM ('FREE', 'GROWTH', 'SCALE')$$;
    END IF;

    EXECUTE $$CREATE TABLE "account" (
      "id" TEXT NOT NULL,
      "tier" "AccountTier" NOT NULL DEFAULT 'FREE',
      "spend" INTEGER NOT NULL DEFAULT 0,
      "spendCap" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "account_pkey" PRIMARY KEY ("id")
    )$$;

    EXECUTE $$CREATE TABLE "user" (
      "id" TEXT NOT NULL,
      "email" TEXT NOT NULL,
      "name" TEXT,
      "passwordHash" TEXT,
      "stripeCustomerId" TEXT,
      "accountId" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "user_pkey" PRIMARY KEY ("id")
    )$$;

    EXECUTE $$CREATE TABLE "project" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "project_pkey" PRIMARY KEY ("id")
    )$$;

    EXECUTE $$CREATE TABLE "job" (
      "id" TEXT NOT NULL,
      "projectId" TEXT NOT NULL,
      "type" "JobType" NOT NULL,
      "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
      "idempotencyKey" TEXT,
      "payload" JSONB,
      "resultSummary" TEXT,
      "error" TEXT,
      "estimatedCost" DOUBLE PRECISION,
      "actualCost" DOUBLE PRECISION,
      "costBreakdown" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "job_pkey" PRIMARY KEY ("id")
    )$$;

    EXECUTE $$CREATE TABLE "audit_log" (
      "id" TEXT NOT NULL,
      "userId" TEXT,
      "projectId" TEXT,
      "jobId" TEXT,
      "action" TEXT NOT NULL,
      "metadata" JSONB,
      "ip" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
    )$$;

    EXECUTE $$CREATE TABLE "research_row" (
      "id" TEXT NOT NULL,
      "projectId" TEXT NOT NULL,
      "jobId" TEXT,
      "source" "ResearchSource" NOT NULL,
      "content" TEXT NOT NULL,
      "metadata" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "research_row_pkey" PRIMARY KEY ("id")
    )$$;

    EXECUTE $$CREATE TABLE "script" (
      "id" TEXT NOT NULL,
      "projectId" TEXT NOT NULL,
      "jobId" TEXT,
      "mergedVideoUrl" TEXT,
      "upscaledVideoUrl" TEXT,
      "status" "ScriptStatus" NOT NULL,
      "rawJson" JSONB NOT NULL,
      "wordCount" INTEGER,
      "upscaleError" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "script_pkey" PRIMARY KEY ("id")
    )$$;

    EXECUTE $$CREATE TABLE "storyboard" (
      "id" TEXT NOT NULL,
      "projectId" TEXT NOT NULL,
      "jobId" TEXT,
      "scriptId" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "storyboard_pkey" PRIMARY KEY ("id")
    )$$;

    EXECUTE $$CREATE TABLE "storyboard_scene" (
      "id" TEXT NOT NULL,
      "storyboardId" TEXT NOT NULL,
      "sceneNumber" INTEGER NOT NULL,
      "rawJson" JSONB,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "storyboard_scene_pkey" PRIMARY KEY ("id")
    )$$;

    EXECUTE $$CREATE TABLE "character" (
      "id" TEXT NOT NULL,
      "projectId" TEXT NOT NULL,
      "jobId" TEXT,
      "name" TEXT,
      "metadata" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "character_pkey" PRIMARY KEY ("id")
    )$$;

    EXECUTE $$CREATE TABLE "ad_asset" (
      "id" TEXT NOT NULL,
      "projectId" TEXT NOT NULL,
      "jobId" TEXT,
      "platform" "AdPlatform" NOT NULL,
      "rawJson" JSONB NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "ad_asset_pkey" PRIMARY KEY ("id")
    )$$;

    EXECUTE $$CREATE TABLE "ad_pattern_result" (
      "id" TEXT NOT NULL,
      "projectId" TEXT NOT NULL,
      "jobId" TEXT,
      "summary" TEXT,
      "rawJson" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ad_pattern_result_pkey" PRIMARY KEY ("id")
    )$$;

    EXECUTE $$CREATE TABLE "ad_pattern_reference" (
      "id" TEXT NOT NULL,
      "projectId" TEXT NOT NULL,
      "source" TEXT NOT NULL,
      "metadata" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ad_pattern_reference_pkey" PRIMARY KEY ("id")
    )$$;

    EXECUTE $$CREATE TABLE "customer_avatar" (
      "id" TEXT NOT NULL,
      "projectId" TEXT NOT NULL,
      "name" TEXT,
      "persona" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "customer_avatar_pkey" PRIMARY KEY ("id")
    )$$;

    EXECUTE $$CREATE TABLE "product_intelligence" (
      "id" TEXT NOT NULL,
      "projectId" TEXT NOT NULL,
      "insights" JSONB NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "product_intelligence_pkey" PRIMARY KEY ("id")
    )$$;

    EXECUTE $$CREATE TABLE "subscription" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "planId" "PlanId" NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'active',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
    )$$;

    EXECUTE $$CREATE TABLE "usage" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "period" TIMESTAMP(3) NOT NULL,
      "jobsUsed" INTEGER NOT NULL DEFAULT 0,
      CONSTRAINT "usage_pkey" PRIMARY KEY ("id")
    )$$;

    EXECUTE $$CREATE TABLE "campaign" (
      "id" TEXT NOT NULL,
      "accountId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "campaign_pkey" PRIMARY KEY ("id")
    )$$;

    EXECUTE $$CREATE TABLE "spend_event" (
      "id" TEXT NOT NULL,
      "accountId" TEXT NOT NULL,
      "amount" INTEGER NOT NULL,
      "sourceId" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "spend_event_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "spend_event_sourceId_key" UNIQUE ("sourceId")
    )$$;

    EXECUTE $$CREATE UNIQUE INDEX "user_email_key" ON "user"("email")$$;
    EXECUTE $$CREATE UNIQUE INDEX "user_stripeCustomerId_key" ON "user"("stripeCustomerId")$$;
    EXECUTE $$CREATE INDEX "campaign_accountId_idx" ON "campaign"("accountId")$$;
    EXECUTE $$CREATE INDEX "spend_event_accountId_idx" ON "spend_event"("accountId")$$;
    EXECUTE $$CREATE INDEX "project_userId_idx" ON "project"("userId")$$;
    EXECUTE $$CREATE INDEX "job_projectId_idx" ON "job"("projectId")$$;
    EXECUTE $$CREATE UNIQUE INDEX "job_projectId_type_idempotencyKey_key" ON "job"("projectId", "type", "idempotencyKey")$$;
    EXECUTE $$CREATE INDEX "audit_log_userId_idx" ON "audit_log"("userId")$$;
    EXECUTE $$CREATE INDEX "audit_log_projectId_idx" ON "audit_log"("projectId")$$;
    EXECUTE $$CREATE INDEX "audit_log_jobId_idx" ON "audit_log"("jobId")$$;
    EXECUTE $$CREATE INDEX "research_row_projectId_idx" ON "research_row"("projectId")$$;
    EXECUTE $$CREATE INDEX "storyboard_projectId_idx" ON "storyboard"("projectId")$$;
    EXECUTE $$CREATE INDEX "storyboard_scene_storyboardId_idx" ON "storyboard_scene"("storyboardId")$$;
    EXECUTE $$CREATE INDEX "character_projectId_idx" ON "character"("projectId")$$;
    EXECUTE $$CREATE INDEX "ad_asset_projectId_idx" ON "ad_asset"("projectId")$$;
    EXECUTE $$CREATE INDEX "ad_pattern_result_projectId_idx" ON "ad_pattern_result"("projectId")$$;
    EXECUTE $$CREATE INDEX "ad_pattern_reference_projectId_idx" ON "ad_pattern_reference"("projectId")$$;
    EXECUTE $$CREATE INDEX "customer_avatar_projectId_idx" ON "customer_avatar"("projectId")$$;
    EXECUTE $$CREATE INDEX "product_intelligence_projectId_idx" ON "product_intelligence"("projectId")$$;
    EXECUTE $$CREATE UNIQUE INDEX "subscription_userId_key" ON "subscription"("userId")$$;
    EXECUTE $$CREATE UNIQUE INDEX "usage_userId_period_key" ON "usage"("userId", "period")$$;

    EXECUTE $$ALTER TABLE "user" ADD CONSTRAINT "user_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "project" ADD CONSTRAINT "project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "job" ADD CONSTRAINT "job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "research_row" ADD CONSTRAINT "research_row_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "research_row" ADD CONSTRAINT "research_row_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "script" ADD CONSTRAINT "script_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "script" ADD CONSTRAINT "script_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "storyboard" ADD CONSTRAINT "storyboard_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "storyboard" ADD CONSTRAINT "storyboard_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "storyboard" ADD CONSTRAINT "storyboard_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "script"("id") ON DELETE SET NULL ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "storyboard_scene" ADD CONSTRAINT "storyboard_scene_storyboardId_fkey" FOREIGN KEY ("storyboardId") REFERENCES "storyboard"("id") ON DELETE CASCADE ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "character" ADD CONSTRAINT "character_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "character" ADD CONSTRAINT "character_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "ad_asset" ADD CONSTRAINT "ad_asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "ad_asset" ADD CONSTRAINT "ad_asset_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "ad_pattern_result" ADD CONSTRAINT "ad_pattern_result_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "ad_pattern_result" ADD CONSTRAINT "ad_pattern_result_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "ad_pattern_reference" ADD CONSTRAINT "ad_pattern_reference_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "customer_avatar" ADD CONSTRAINT "customer_avatar_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "product_intelligence" ADD CONSTRAINT "product_intelligence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "subscription" ADD CONSTRAINT "subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "usage" ADD CONSTRAINT "usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "campaign" ADD CONSTRAINT "campaign_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE$$;
    EXECUTE $$ALTER TABLE "spend_event" ADD CONSTRAINT "spend_event_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE$$;
  END IF;
END $init$;
