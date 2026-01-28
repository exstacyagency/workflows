/*
  Warnings:

  - A unique constraint covering the columns `[userId,name]` on the table `project` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "project_userId_name_key" ON "project"("userId", "name");
