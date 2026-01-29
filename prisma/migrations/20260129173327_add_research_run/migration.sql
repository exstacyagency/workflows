-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "job" ADD COLUMN     "runId" TEXT;

-- CreateTable
CREATE TABLE "research_run" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "research_run_projectId_idx" ON "research_run"("projectId");

-- CreateIndex
CREATE INDEX "job_runId_idx" ON "job"("runId");

-- AddForeignKey
ALTER TABLE "research_run" ADD CONSTRAINT "research_run_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_runId_fkey" FOREIGN KEY ("runId") REFERENCES "research_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;
