/*
  Warnings:

  - The values [AMAZON_PRODUCT_5_STAR,AMAZON_PRODUCT_4_STAR,AMAZON_COMPETITOR_1,AMAZON_COMPETITOR_2] on the enum `ResearchSource` will be removed. If these variants are still used in the database, this will fail.
  - Added the required column `userId` to the `Project` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ResearchSource_new" AS ENUM ('REDDIT_PRODUCT', 'REDDIT_PROBLEM', 'AMAZON', 'G2', 'LOCAL_BUSINESS');
ALTER TABLE "ResearchRow" ALTER COLUMN "source" TYPE "ResearchSource_new" USING ("source"::text::"ResearchSource_new");
ALTER TYPE "ResearchSource" RENAME TO "ResearchSource_old";
ALTER TYPE "ResearchSource_new" RENAME TO "ResearchSource";
DROP TYPE "ResearchSource_old";
COMMIT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "userId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
