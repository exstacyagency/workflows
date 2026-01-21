-- Drop legacy unique indexes that conflict with user-scoped idempotency
DROP INDEX IF EXISTS "job_idempotencyKey_key";
DROP INDEX IF EXISTS "Job_idempotencyKey_key";
DROP INDEX IF EXISTS "job_projectId_type_idempotencyKey_key";
DROP INDEX IF EXISTS "Job_projectId_type_idempotencyKey_key";

CREATE UNIQUE INDEX IF NOT EXISTS "job_userId_projectId_idempotencyKey_key" ON "job" ("userId", "projectId", "idempotencyKey");
