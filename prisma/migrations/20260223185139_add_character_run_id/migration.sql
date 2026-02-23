-- AlterTable
ALTER TABLE "character" ADD COLUMN     "runId" TEXT;

-- CreateIndex
CREATE INDEX "character_runId_idx" ON "character"("runId");

-- AddForeignKey
ALTER TABLE "character" ADD CONSTRAINT "character_runId_fkey" FOREIGN KEY ("runId") REFERENCES "research_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;
