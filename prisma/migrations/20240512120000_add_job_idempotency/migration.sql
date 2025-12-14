DO $$
BEGIN
  IF to_regclass('public."Job"') IS NULL THEN
    RAISE NOTICE 'Skipping add_job_idempotency migration because "Job" table does not exist yet.';
    RETURN;
  END IF;

  ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

  CREATE UNIQUE INDEX IF NOT EXISTS "Job_projectId_type_idempotencyKey_key"
  ON "Job"("projectId", "type", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;
END $$;
