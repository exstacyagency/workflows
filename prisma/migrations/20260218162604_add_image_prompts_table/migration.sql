-- CreateTable
CREATE TABLE "image_prompt" (
    "id" TEXT NOT NULL,
    "storyboardId" TEXT NOT NULL,
    "sceneNumber" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "image_prompt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "image_prompt_storyboardId_idx" ON "image_prompt"("storyboardId");

-- CreateIndex
CREATE UNIQUE INDEX "image_prompt_storyboardId_sceneNumber_key" ON "image_prompt"("storyboardId", "sceneNumber");

-- AddForeignKey
ALTER TABLE "image_prompt" ADD CONSTRAINT "image_prompt_storyboardId_fkey" FOREIGN KEY ("storyboardId") REFERENCES "storyboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

