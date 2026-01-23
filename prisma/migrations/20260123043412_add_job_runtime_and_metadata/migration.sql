/*
  Warnings:

  - The `error` column on the `job` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "job" ADD COLUMN     "determinism" TEXT,
ADD COLUMN     "failureCode" TEXT,
ADD COLUMN     "fixtureVersion" INTEGER,
ADD COLUMN     "runtimeMode" TEXT,
DROP COLUMN "error",
ADD COLUMN     "error" JSONB;
