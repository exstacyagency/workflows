-- CreateTable
CREATE TABLE "AdPatternResult" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "jobId" TEXT,
    "rawJson" JSONB NOT NULL,
    "baselineRetention3s" DOUBLE PRECISION,
    "baselineCtr" DOUBLE PRECISION,
    "totalConverters" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdPatternResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdPatternReference" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "patternName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "timing" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "example" TEXT NOT NULL,
    "exampleTimestamp" INTEGER,
    "visualNotes" TEXT NOT NULL,
    "occurrenceRate" DOUBLE PRECISION,
    "sampleCount" INTEGER,
    "performanceLift" TEXT NOT NULL,
    "productionComplexity" TEXT,
    "standaloneViable" BOOLEAN,
    "canCoexist" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdPatternReference_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AdPatternResult" ADD CONSTRAINT "AdPatternResult_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdPatternResult" ADD CONSTRAINT "AdPatternResult_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdPatternReference" ADD CONSTRAINT "AdPatternReference_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdPatternReference" ADD CONSTRAINT "AdPatternReference_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "AdPatternResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
