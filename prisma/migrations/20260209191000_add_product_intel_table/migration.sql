-- CreateTable
CREATE TABLE "product_intel" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "tagline" TEXT,
    "keyFeatures" TEXT[] NOT NULL,
    "ingredientsOrSpecs" TEXT[] NOT NULL,
    "price" TEXT,
    "keyClaims" TEXT[] NOT NULL,
    "targetAudience" TEXT,
    "usp" TEXT,
    "rawHtml" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_intel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_intel_projectId_idx" ON "product_intel"("projectId");

-- CreateIndex
CREATE INDEX "product_intel_jobId_idx" ON "product_intel"("jobId");

-- AddForeignKey
ALTER TABLE "product_intel" ADD CONSTRAINT "product_intel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_intel" ADD CONSTRAINT "product_intel_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
