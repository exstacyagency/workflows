-- Add userId to jobs and backfill from project
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "userId" TEXT;
UPDATE "job" j
SET "userId" = p."userId"
FROM "project" p
WHERE j."projectId" = p."id" AND j."userId" IS NULL;
ALTER TABLE "job" ALTER COLUMN "userId" SET NOT NULL;

-- Ensure idempotencyKey is non-null and composite unique
UPDATE "job"
SET "idempotencyKey" = CONCAT('legacy:', "id")
WHERE "idempotencyKey" IS NULL;
ALTER TABLE "job" ALTER COLUMN "idempotencyKey" SET NOT NULL;
DROP INDEX IF EXISTS "job_idempotencyKey_key";
CREATE UNIQUE INDEX IF NOT EXISTS "job_userId_projectId_idempotencyKey_key" ON "job" ("userId", "projectId", "idempotencyKey");

-- Add runtime/determinism fields
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "runtimeMode" TEXT NOT NULL DEFAULT 'alpha';
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "determinism" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "failureCode" TEXT;
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "fixtureVersion" TEXT;

-- Convert error to JSONB
ALTER TABLE "job" ALTER COLUMN "error" TYPE JSONB
USING CASE WHEN "error" IS NULL THEN NULL ELSE to_jsonb("error") END;
