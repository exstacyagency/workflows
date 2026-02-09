/*
  Warnings:

  - You are about to drop the column `cinematicScore` on the `ResearchRow` table. All the data in the column will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ResearchSource" ADD VALUE 'AMAZON';
ALTER TYPE "ResearchSource" ADD VALUE 'G2';
ALTER TYPE "ResearchSource" ADD VALUE 'UPLOADED';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "actualCost" DOUBLE PRECISION,
ADD COLUMN     "costBreakdown" JSONB,
ADD COLUMN     "estimatedCost" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ResearchRow" DROP COLUMN "cinematicScore";
