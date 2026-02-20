ALTER TABLE "project"
  ADD COLUMN IF NOT EXISTS "creatorReferenceImageUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "productReferenceImageUrl" TEXT;
