-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('CUSTOMER_RESEARCH', 'CUSTOMER_ANALYSIS', 'PATTERN_ANALYSIS', 'SCRIPT_GENERATION', 'STORYBOARD_GENERATION', 'VIDEO_PROMPT_GENERATION', 'VIDEO_IMAGE_GENERATION', 'VIDEO_GENERATION', 'VIDEO_REVIEW', 'VIDEO_UPSCALER', 'AD_PERFORMANCE', 'PRODUCT_DATA_COLLECTION', 'PRODUCT_ANALYSIS', 'AD_QUALITY_GATE', 'IMAGE_PROMPT_GENERATION', 'CREATOR_AVATAR_GENERATION', 'CHARACTER_SEED_VIDEO', 'CHARACTER_REFERENCE_VIDEO');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('MAIN_PRODUCT', 'COMPETITOR_1', 'COMPETITOR_2', 'COMPETITOR_3');

-- CreateEnum
CREATE TYPE "ResearchSource" AS ENUM ('REDDIT_PRODUCT', 'REDDIT_PROBLEM', 'AMAZON', 'G2', 'UPLOADED', 'AMAZON_MAIN_PRODUCT', 'AMAZON_COMPETITOR_1', 'AMAZON_COMPETITOR_2', 'AMAZON_COMPETITOR_3');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PlanId" AS ENUM ('FREE', 'GROWTH', 'SCALE');

-- CreateEnum
CREATE TYPE "AccountTier" AS ENUM ('FREE', 'GROWTH', 'SCALE');

-- CreateEnum
CREATE TYPE "AdPlatform" AS ENUM ('TIKTOK', 'META');

-- CreateEnum
CREATE TYPE "CampaignState" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ScriptStatus" AS ENUM ('seeded', 'PENDING', 'READY', 'upscaled', 'upscale_pending', 'upscale_failed');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PanelType" AS ENUM ('ON_CAMERA', 'B_ROLL_ONLY', 'PRODUCT_ONLY');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "stripeCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestSession" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "creatorReferenceImageUrl" TEXT,
    "productReferenceImageUrl" TEXT,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "tier" "AccountTier" NOT NULL DEFAULT 'FREE',
    "spendCap" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "spend" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "state" "CampaignState" NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spend_event" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spend_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_run" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT,

    CONSTRAINT "research_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "resultSummary" JSONB,
    "estimatedCost" INTEGER,
    "actualCost" INTEGER,
    "costBreakdown" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "currentStep" TEXT,
    "userId" TEXT NOT NULL,
    "determinism" TEXT,
    "failureCode" TEXT,
    "fixtureVersion" INTEGER,
    "runtimeMode" TEXT,
    "error" JSONB,
    "runId" TEXT,

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "projectId" TEXT,
    "jobId" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_row" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "jobId" TEXT,
    "source" "ResearchSource" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "problemKeyword" TEXT,
    "productAsin" TEXT,
    "productName" TEXT,
    "productType" "ProductType",
    "rating" INTEGER,
    "redditCreatedUtc" BIGINT,
    "redditId" TEXT,
    "redditParentId" TEXT,
    "searchQueryUsed" TEXT,
    "solutionKeyword" TEXT,
    "subreddit" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "amazon_review" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "jobId" TEXT,
    "reviewText" TEXT NOT NULL,
    "rating" INTEGER,
    "verified" BOOLEAN,
    "reviewDate" TIMESTAMP(3),
    "rawJson" JSONB,
    "productType" "ProductType" NOT NULL,
    "productAsin" TEXT NOT NULL,
    "productName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "amazon_review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "script" (
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
);

-- CreateTable
CREATE TABLE "storyboard" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "jobId" TEXT,
    "scriptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storyboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storyboard_scene" (
    "id" TEXT NOT NULL,
    "storyboardId" TEXT NOT NULL,
    "sceneNumber" INTEGER NOT NULL,
    "rawJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "panelType" "PanelType" DEFAULT 'ON_CAMERA',
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "clipDurationSeconds" INTEGER DEFAULT 10,
    "firstFrameImageUrl" TEXT,
    "lastFrameImageUrl" TEXT,
    "voiceover_only" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "storyboard_scene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_prompt" (
    "id" TEXT NOT NULL,
    "storyboardId" TEXT NOT NULL,
    "sceneNumber" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "image_prompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "jobId" TEXT,
    "name" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "productId" TEXT,
    "soraCharacterId" TEXT,
    "characterUserName" TEXT,
    "seedVideoTaskId" TEXT,
    "seedVideoUrl" TEXT,
    "creatorVisualPrompt" TEXT,
    "runId" TEXT,

    CONSTRAINT "character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_asset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "jobId" TEXT,
    "platform" "AdPlatform" NOT NULL,
    "rawJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "contentViable" BOOLEAN,
    "qualityIssue" TEXT,
    "qualityConfidence" INTEGER,
    "qualityReason" TEXT,
    "retention_3s" DOUBLE PRECISION,
    "retention_10s" DOUBLE PRECISION,
    "retention_3s_ctr" DOUBLE PRECISION,
    "retention_10s_ctr" DOUBLE PRECISION,
    "retention_3s_cvr" DOUBLE PRECISION,
    "retention_10s_cvr" DOUBLE PRECISION,
    "duration" INTEGER,
    "source_type" TEXT,
    "engagement_score" DOUBLE PRECISION,
    "isSwipeFile" BOOLEAN NOT NULL DEFAULT false,
    "swipeMetadata" JSONB,
    "swipeCandidate" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ad_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_pattern_result" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "jobId" TEXT,
    "summary" TEXT,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_pattern_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_pattern_reference" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_pattern_reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_avatar" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT,
    "persona" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "competitiveInsights" JSONB,

    CONSTRAINT "customer_avatar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_intelligence" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "insights" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_intelligence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_intel" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "tagline" TEXT,
    "keyFeatures" TEXT[],
    "ingredientsOrSpecs" TEXT[],
    "price" TEXT,
    "keyClaims" TEXT[],
    "targetAudience" TEXT,
    "usp" TEXT,
    "rawHtml" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_intel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" "PlanId" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" TIMESTAMP(3) NOT NULL,
    "jobsUsed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "product_problem_solved" TEXT,
    "amazon_asin" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creator_reference_image_url" TEXT,
    "product_reference_image_url" TEXT,
    "character_reference_video_url" TEXT,
    "sora_character_id" TEXT,
    "character_cameo_created_at" TIMESTAMPTZ(6),
    "creator_visual_prompt" TEXT,
    "character_seed_video_task_id" TEXT,
    "character_seed_video_url" TEXT,
    "character_user_name" TEXT,
    "character_anchor_prompt" TEXT,
    "character_avatar_image_url" TEXT,
    "character_gender" TEXT,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_stripeCustomerId_key" ON "user"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "TestSession_token_key" ON "TestSession"("token");

-- CreateIndex
CREATE INDEX "project_userId_idx" ON "project"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "project_userId_name_key" ON "project"("userId", "name");

-- CreateIndex
CREATE INDEX "campaign_accountId_idx" ON "campaign"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "spend_event_sourceId_key" ON "spend_event"("sourceId");

-- CreateIndex
CREATE INDEX "spend_event_accountId_idx" ON "spend_event"("accountId");

-- CreateIndex
CREATE INDEX "research_run_projectId_idx" ON "research_run"("projectId");

-- CreateIndex
CREATE INDEX "job_projectId_idx" ON "job"("projectId");

-- CreateIndex
CREATE INDEX "job_runId_idx" ON "job"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "job_id_userId_key" ON "job"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "job_userId_projectId_idempotencyKey_key" ON "job"("userId", "projectId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "audit_log_userId_idx" ON "audit_log"("userId");

-- CreateIndex
CREATE INDEX "audit_log_projectId_idx" ON "audit_log"("projectId");

-- CreateIndex
CREATE INDEX "audit_log_jobId_idx" ON "audit_log"("jobId");

-- CreateIndex
CREATE INDEX "research_row_projectId_idx" ON "research_row"("projectId");

-- CreateIndex
CREATE INDEX "research_row_jobId_idx" ON "research_row"("jobId");

-- CreateIndex
CREATE INDEX "research_row_source_idx" ON "research_row"("source");

-- CreateIndex
CREATE INDEX "research_row_productType_idx" ON "research_row"("productType");

-- CreateIndex
CREATE INDEX "research_row_subreddit_idx" ON "research_row"("subreddit");

-- CreateIndex
CREATE INDEX "research_row_solutionKeyword_idx" ON "research_row"("solutionKeyword");

-- CreateIndex
CREATE INDEX "research_row_redditCreatedUtc_idx" ON "research_row"("redditCreatedUtc");

-- CreateIndex
CREATE INDEX "amazon_review_projectId_idx" ON "amazon_review"("projectId");

-- CreateIndex
CREATE INDEX "amazon_review_jobId_idx" ON "amazon_review"("jobId");

-- CreateIndex
CREATE INDEX "amazon_review_productType_idx" ON "amazon_review"("productType");

-- CreateIndex
CREATE INDEX "storyboard_projectId_idx" ON "storyboard"("projectId");

-- CreateIndex
CREATE INDEX "storyboard_scene_storyboardId_idx" ON "storyboard_scene"("storyboardId");

-- CreateIndex
CREATE INDEX "image_prompt_storyboardId_idx" ON "image_prompt"("storyboardId");

-- CreateIndex
CREATE UNIQUE INDEX "image_prompt_storyboardId_sceneNumber_key" ON "image_prompt"("storyboardId", "sceneNumber");

-- CreateIndex
CREATE INDEX "character_projectId_idx" ON "character"("projectId");

-- CreateIndex
CREATE INDEX "character_productId_idx" ON "character"("productId");

-- CreateIndex
CREATE INDEX "character_runId_idx" ON "character"("runId");

-- CreateIndex
CREATE INDEX "ad_asset_projectId_idx" ON "ad_asset"("projectId");

-- CreateIndex
CREATE INDEX "ad_pattern_result_projectId_idx" ON "ad_pattern_result"("projectId");

-- CreateIndex
CREATE INDEX "ad_pattern_reference_projectId_idx" ON "ad_pattern_reference"("projectId");

-- CreateIndex
CREATE INDEX "customer_avatar_projectId_idx" ON "customer_avatar"("projectId");

-- CreateIndex
CREATE INDEX "product_intelligence_projectId_idx" ON "product_intelligence"("projectId");

-- CreateIndex
CREATE INDEX "product_intel_projectId_idx" ON "product_intel"("projectId");

-- CreateIndex
CREATE INDEX "product_intel_jobId_idx" ON "product_intel"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_userId_key" ON "subscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "usage_userId_period_key" ON "usage"("userId", "period");

-- CreateIndex
CREATE INDEX "product_project_id_idx" ON "product"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_project_name_unique" ON "product"("project_id", "name");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSession" ADD CONSTRAINT "TestSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spend_event" ADD CONSTRAINT "spend_event_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_run" ADD CONSTRAINT "research_run_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_runId_fkey" FOREIGN KEY ("runId") REFERENCES "research_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_row" ADD CONSTRAINT "research_row_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_row" ADD CONSTRAINT "research_row_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amazon_review" ADD CONSTRAINT "amazon_review_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amazon_review" ADD CONSTRAINT "amazon_review_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "script" ADD CONSTRAINT "script_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "script" ADD CONSTRAINT "script_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storyboard" ADD CONSTRAINT "storyboard_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storyboard" ADD CONSTRAINT "storyboard_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storyboard" ADD CONSTRAINT "storyboard_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "script"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storyboard_scene" ADD CONSTRAINT "storyboard_scene_storyboardId_fkey" FOREIGN KEY ("storyboardId") REFERENCES "storyboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_prompt" ADD CONSTRAINT "image_prompt_storyboardId_fkey" FOREIGN KEY ("storyboardId") REFERENCES "storyboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character" ADD CONSTRAINT "character_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character" ADD CONSTRAINT "character_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character" ADD CONSTRAINT "character_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character" ADD CONSTRAINT "character_runId_fkey" FOREIGN KEY ("runId") REFERENCES "research_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_asset" ADD CONSTRAINT "ad_asset_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_asset" ADD CONSTRAINT "ad_asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_pattern_result" ADD CONSTRAINT "ad_pattern_result_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_pattern_result" ADD CONSTRAINT "ad_pattern_result_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_pattern_reference" ADD CONSTRAINT "ad_pattern_reference_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_avatar" ADD CONSTRAINT "customer_avatar_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_intelligence" ADD CONSTRAINT "product_intelligence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_intel" ADD CONSTRAINT "product_intel_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_intel" ADD CONSTRAINT "product_intel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage" ADD CONSTRAINT "usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

