ALTER TABLE "product"
  ADD COLUMN IF NOT EXISTS "creator_reference_image_url" TEXT;

CREATE TABLE IF NOT EXISTS "creator_library" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "image_url" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "creator_library_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "creator_library_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "product"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "creator_library_product_id_idx" ON "creator_library" ("product_id");
