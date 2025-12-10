/*
  Warnings:

  - The values [REDDIT,AMAZON] on the enum `ResearchSource` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ResearchSource_new" AS ENUM ('REDDIT_PRODUCT', 'REDDIT_PROBLEM', 'AMAZON_PRODUCT_5_STAR', 'AMAZON_PRODUCT_4_STAR', 'AMAZON_COMPETITOR_1', 'AMAZON_COMPETITOR_2');
ALTER TABLE "ResearchRow" ALTER COLUMN "source" TYPE "ResearchSource_new" USING ("source"::text::"ResearchSource_new");
ALTER TYPE "ResearchSource" RENAME TO "ResearchSource_old";
ALTER TYPE "ResearchSource_new" RENAME TO "ResearchSource";
DROP TYPE "ResearchSource_old";
COMMIT;

-- AlterTable
ALTER TABLE "ResearchRow" ADD COLUMN     "cinematicScore" INTEGER,
ADD COLUMN     "indexLabel" TEXT,
ADD COLUMN     "rating" DOUBLE PRECISION,
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "verified" BOOLEAN;
