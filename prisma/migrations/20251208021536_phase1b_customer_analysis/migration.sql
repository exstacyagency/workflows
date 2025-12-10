-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'CUSTOMER_ANALYSIS';

-- CreateTable
CREATE TABLE "CustomerAvatar" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "jobId" TEXT,
    "rawJson" JSONB NOT NULL,
    "age" INTEGER,
    "gender" TEXT,
    "income" INTEGER,
    "jobTitle" TEXT,
    "location" TEXT,
    "ethnicity" TEXT,
    "primaryPain" TEXT,
    "primaryGoal" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAvatar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductIntelligence" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "jobId" TEXT,
    "rawJson" JSONB NOT NULL,
    "heroIngredient" TEXT,
    "heroMechanism" TEXT,
    "form" TEXT,
    "initialTimeline" TEXT,
    "peakTimeline" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductIntelligence_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CustomerAvatar" ADD CONSTRAINT "CustomerAvatar_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAvatar" ADD CONSTRAINT "CustomerAvatar_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductIntelligence" ADD CONSTRAINT "ProductIntelligence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductIntelligence" ADD CONSTRAINT "ProductIntelligence_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
