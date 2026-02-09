/*
  Warnings:

  - Added the required column `updatedAt` to the `research_row` table without a default value. This is not possible if the table is not empty.
  - Made the column `type` on table `research_row` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('MAIN_PRODUCT', 'COMPETITOR_1', 'COMPETITOR_2', 'COMPETITOR_3');

-- AlterTable
ALTER TABLE "research_row" ADD COLUMN     "problemKeyword" TEXT,
ADD COLUMN     "productAsin" TEXT,
ADD COLUMN     "productName" TEXT,
ADD COLUMN     "productType" "ProductType",
ADD COLUMN     "rating" INTEGER,
ADD COLUMN     "redditCreatedUtc" BIGINT,
ADD COLUMN     "redditId" TEXT,
ADD COLUMN     "redditParentId" TEXT,
ADD COLUMN     "searchQueryUsed" TEXT,
ADD COLUMN     "solutionKeyword" TEXT,
ADD COLUMN     "subreddit" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "type" SET NOT NULL;

-- CreateTable
CREATE TABLE "amazon_review" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "jobId" TEXT,
    "reviewText" TEXT NOT NULL,
    "rating" INTEGER,
    "verified" BOOLEAN,
    "reviewDate" TIMESTAMP(3),
    "rawJson" JSONB,
    "productType" "ProductType" NOT NULL,
    "productAsin" TEXT NOT NULL,
    "productName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "amazon_review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "amazon_review_projectId_idx" ON "amazon_review"("projectId");

-- CreateIndex
CREATE INDEX "amazon_review_jobId_idx" ON "amazon_review"("jobId");

-- CreateIndex
CREATE INDEX "amazon_review_productType_idx" ON "amazon_review"("productType");

-- CreateIndex
CREATE INDEX "research_row_jobId_idx" ON "research_row"("jobId");

-- CreateIndex
CREATE INDEX "research_row_source_idx" ON "research_row"("source");

-- CreateIndex
CREATE INDEX "research_row_productType_idx" ON "research_row"("productType");

-- CreateIndex
CREATE INDEX "research_row_subreddit_idx" ON "research_row"("subreddit");

-- CreateIndex
CREATE INDEX "research_row_solutionKeyword_idx" ON "research_row"("solutionKeyword");

-- CreateIndex
CREATE INDEX "research_row_redditCreatedUtc_idx" ON "research_row"("redditCreatedUtc");

-- AddForeignKey
ALTER TABLE "amazon_review" ADD CONSTRAINT "amazon_review_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amazon_review" ADD CONSTRAINT "amazon_review_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
