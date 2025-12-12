ALTER TABLE "Job"
ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Job_projectId_type_idempotencyKey_key"
ON "Job"("projectId", "type", "idempotencyKey")
WHERE "idempotencyKey" IS NOT NULL;
