/*
  Warnings:

  - A unique constraint covering the columns `[idempotencyKey]` on the table `job` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "job_projectId_type_idempotencyKey_key";

-- CreateIndex
CREATE UNIQUE INDEX "job_idempotencyKey_key" ON "job"("idempotencyKey");
