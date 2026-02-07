-- AlterTable
ALTER TABLE "research_row"
ADD COLUMN "productType" "ProductType",
ADD COLUMN "productAsin" TEXT,
ADD COLUMN "rating" INTEGER,
ADD COLUMN "productName" TEXT;

-- CreateIndex
CREATE INDEX "research_row_productType_idx" ON "research_row"("productType");
