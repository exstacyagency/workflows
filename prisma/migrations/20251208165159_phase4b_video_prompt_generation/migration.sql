-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'VIDEO_PROMPT_GENERATION';

-- AlterTable
ALTER TABLE "StoryboardScene" ADD COLUMN     "videoPrompt" TEXT;
