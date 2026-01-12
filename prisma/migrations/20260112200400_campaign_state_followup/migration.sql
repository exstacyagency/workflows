/*
  Warnings:

  - You are about to drop the `AdAsset` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AdPatternReference` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AdPatternResult` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AuditLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AuthThrottle` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `BillingEvent` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Character` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CustomerAvatar` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Job` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProductIntelligence` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Project` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ResearchRow` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Script` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Storyboard` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `StoryboardScene` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Subscription` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Usage` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "AdAsset" DROP CONSTRAINT "AdAsset_jobId_fkey";

-- DropForeignKey
ALTER TABLE "AdAsset" DROP CONSTRAINT "AdAsset_projectId_fkey";

-- DropForeignKey
ALTER TABLE "AdPatternReference" DROP CONSTRAINT "AdPatternReference_projectId_fkey";

-- DropForeignKey
ALTER TABLE "AdPatternReference" DROP CONSTRAINT "AdPatternReference_resultId_fkey";

-- DropForeignKey
ALTER TABLE "AdPatternResult" DROP CONSTRAINT "AdPatternResult_jobId_fkey";

-- DropForeignKey
ALTER TABLE "AdPatternResult" DROP CONSTRAINT "AdPatternResult_projectId_fkey";

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_jobId_fkey";

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_projectId_fkey";

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_userId_fkey";

-- DropForeignKey
ALTER TABLE "Character" DROP CONSTRAINT "Character_jobId_fkey";

-- DropForeignKey
ALTER TABLE "Character" DROP CONSTRAINT "Character_projectId_fkey";

-- DropForeignKey
ALTER TABLE "CustomerAvatar" DROP CONSTRAINT "CustomerAvatar_jobId_fkey";

-- DropForeignKey
ALTER TABLE "CustomerAvatar" DROP CONSTRAINT "CustomerAvatar_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Job" DROP CONSTRAINT "Job_projectId_fkey";

-- DropForeignKey
ALTER TABLE "ProductIntelligence" DROP CONSTRAINT "ProductIntelligence_jobId_fkey";

-- DropForeignKey
ALTER TABLE "ProductIntelligence" DROP CONSTRAINT "ProductIntelligence_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_userId_fkey";

-- DropForeignKey
ALTER TABLE "ResearchRow" DROP CONSTRAINT "ResearchRow_jobId_fkey";

-- DropForeignKey
ALTER TABLE "ResearchRow" DROP CONSTRAINT "ResearchRow_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Script" DROP CONSTRAINT "Script_jobId_fkey";

-- DropForeignKey
ALTER TABLE "Script" DROP CONSTRAINT "Script_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Storyboard" DROP CONSTRAINT "Storyboard_jobId_fkey";

-- DropForeignKey
ALTER TABLE "Storyboard" DROP CONSTRAINT "Storyboard_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Storyboard" DROP CONSTRAINT "Storyboard_scriptId_fkey";

-- DropForeignKey
ALTER TABLE "StoryboardScene" DROP CONSTRAINT "StoryboardScene_storyboardId_fkey";

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_userId_fkey";

-- DropForeignKey
ALTER TABLE "Usage" DROP CONSTRAINT "Usage_userId_fkey";

-- AlterTable
ALTER TABLE "job" ALTER COLUMN "type" DROP DEFAULT;

-- DropTable
DROP TABLE "AdAsset";

-- DropTable
DROP TABLE "AdPatternReference";

-- DropTable
DROP TABLE "AdPatternResult";

-- DropTable
DROP TABLE "AuditLog";

-- DropTable
DROP TABLE "AuthThrottle";

-- DropTable
DROP TABLE "BillingEvent";

-- DropTable
DROP TABLE "Character";

-- DropTable
DROP TABLE "CustomerAvatar";

-- DropTable
DROP TABLE "Job";

-- DropTable
DROP TABLE "ProductIntelligence";

-- DropTable
DROP TABLE "Project";

-- DropTable
DROP TABLE "ResearchRow";

-- DropTable
DROP TABLE "Script";

-- DropTable
DROP TABLE "Storyboard";

-- DropTable
DROP TABLE "StoryboardScene";

-- DropTable
DROP TABLE "Subscription";

-- DropTable
DROP TABLE "Usage";

-- DropTable
DROP TABLE "User";
