/*
  Warnings:

  - A unique constraint covering the columns `[projectId,type,idempotencyKey]` on the table `Job` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateTable
CREATE TABLE "AuthThrottle" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthThrottle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthThrottle_resetAt_idx" ON "AuthThrottle"("resetAt");

-- CreateIndex
CREATE INDEX "AuthThrottle_lockedUntil_idx" ON "AuthThrottle"("lockedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "AuthThrottle_kind_scope_identifier_key" ON "AuthThrottle"("kind", "scope", "identifier");

-- CreateIndex
CREATE UNIQUE INDEX "Job_projectId_type_idempotencyKey_key" ON "Job"("projectId", "type", "idempotencyKey");
