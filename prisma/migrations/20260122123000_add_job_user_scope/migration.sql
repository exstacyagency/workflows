-- Add job.userId and enforce user-scoped idempotency
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "userId" TEXT;

UPDATE "job" j
SET "userId" = p."userId"
FROM "project" p
WHERE j."projectId" = p."id"
  AND j."userId" IS NULL;

UPDATE "job"
SET "userId" = 'unknown'
WHERE "userId" IS NULL;

ALTER TABLE "job" ALTER COLUMN "userId" SET NOT NULL;

ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

UPDATE "job"
SET "idempotencyKey" = concat('backfill-', "id")
WHERE "idempotencyKey" IS NULL;

ALTER TABLE "job" ALTER COLUMN "idempotencyKey" SET NOT NULL;

UPDATE "job"
SET "payload" = '{}'::jsonb
WHERE "payload" IS NULL;

ALTER TABLE "job" ALTER COLUMN "payload" SET NOT NULL;

ALTER TABLE "job" ALTER COLUMN "resultSummary" TYPE JSONB USING to_jsonb("resultSummary");

ALTER TABLE "job" ALTER COLUMN "estimatedCost" TYPE INTEGER USING ROUND("estimatedCost");
ALTER TABLE "job" ALTER COLUMN "actualCost" TYPE INTEGER USING ROUND("actualCost");

DROP INDEX IF EXISTS "job_projectId_type_idempotencyKey_key";
DROP INDEX IF EXISTS "job_projectId_idempotencyKey_key";

CREATE UNIQUE INDEX IF NOT EXISTS "job_userId_projectId_idempotencyKey_key" ON "job" ("userId", "projectId", "idempotencyKey");
