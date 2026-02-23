/*
  Warnings:

  - Made the column `name` on table `character` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "character" ALTER COLUMN "projectId" DROP NOT NULL,
ALTER COLUMN "name" SET NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT;
