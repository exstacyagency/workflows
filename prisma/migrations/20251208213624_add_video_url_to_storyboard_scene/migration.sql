-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'VIDEO_REVIEW';

-- AlterTable
ALTER TABLE "StoryboardScene" ADD COLUMN     "videoUrl" TEXT;
