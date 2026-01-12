-- CreateEnum
CREATE TYPE "CampaignState" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "campaign" ADD COLUMN "state" "CampaignState" NOT NULL DEFAULT 'DRAFT';
