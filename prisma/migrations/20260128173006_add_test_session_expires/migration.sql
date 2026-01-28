/*
  Warnings:

  - Added the required column `expiresAt` to the `TestSession` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TestSession" ADD COLUMN     "expiresAt" TIMESTAMP(3) NOT NULL;
