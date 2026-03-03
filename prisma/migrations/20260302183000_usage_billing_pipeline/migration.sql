-- Usage counters
ALTER TABLE "usage"
  ADD COLUMN IF NOT EXISTS "researchQueries" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "videoJobs" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "imageJobs" INTEGER NOT NULL DEFAULT 0;

-- Usage event ledger (idempotent settlement by job + segment)
CREATE TABLE IF NOT EXISTS "usage_event" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "projectId" TEXT NOT NULL REFERENCES "project"("id") ON DELETE CASCADE,
  "jobId" TEXT NOT NULL REFERENCES "job"("id") ON DELETE CASCADE,
  "period" TIMESTAMP(3) NOT NULL,
  "metric" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT,
  "units" INTEGER NOT NULL DEFAULT 0,
  "costCents" INTEGER NOT NULL DEFAULT 0,
  "segmentKey" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "usage_event_jobId_segmentKey_key" ON "usage_event"("jobId", "segmentKey");
CREATE INDEX IF NOT EXISTS "usage_event_userId_period_idx" ON "usage_event"("userId", "period");
CREATE INDEX IF NOT EXISTS "usage_event_projectId_period_idx" ON "usage_event"("projectId", "period");

-- Quota reservation ledger for safe rollback
CREATE TABLE IF NOT EXISTS "quota_reservation" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "period" TIMESTAMP(3) NOT NULL,
  "metric" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "quota_reservation_userId_period_metric_releasedAt_idx"
  ON "quota_reservation"("userId", "period", "metric", "releasedAt");
