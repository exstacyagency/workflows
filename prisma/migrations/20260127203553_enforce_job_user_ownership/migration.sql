/*
  Warnings:

  - A unique constraint covering the columns `[id,userId]` on the table `job` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "job_id_userId_key" ON "job"("id", "userId");
