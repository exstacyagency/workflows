/*
  Warnings:

  - You are about to drop the column `accountId` on the `job` table. All the data in the column will be lost.
  - You are about to drop the column `campaignId` on the `job` table. All the data in the column will be lost.
  - You are about to drop the column `campaignId` on the `project` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "job" DROP CONSTRAINT "job_accountId_fkey";

-- DropForeignKey
ALTER TABLE "job" DROP CONSTRAINT "job_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "project" DROP CONSTRAINT "project_campaignId_fkey";

-- DropIndex
DROP INDEX "job_accountId_idx";

-- DropIndex
DROP INDEX "job_campaignId_idx";

-- DropIndex
DROP INDEX "project_campaignId_idx";

-- AlterTable
ALTER TABLE "job" DROP COLUMN "accountId",
DROP COLUMN "campaignId";

-- AlterTable
ALTER TABLE "project" DROP COLUMN "campaignId";
