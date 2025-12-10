-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'VIDEO_IMAGE_GENERATION';

-- AlterTable
ALTER TABLE "StoryboardScene" ADD COLUMN     "firstFrameUrl" TEXT,
ADD COLUMN     "lastFrameUrl" TEXT;
