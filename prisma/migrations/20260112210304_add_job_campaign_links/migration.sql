-- AlterTable
ALTER TABLE "job" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "campaignId" TEXT;

-- AlterTable
ALTER TABLE "project" ADD COLUMN     "campaignId" TEXT;

-- CreateIndex
CREATE INDEX "job_campaignId_idx" ON "job"("campaignId");

-- CreateIndex
CREATE INDEX "job_accountId_idx" ON "job"("accountId");

-- CreateIndex
CREATE INDEX "project_campaignId_idx" ON "project"("campaignId");

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
