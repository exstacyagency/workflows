-- Baseline migration for existing "product" table found in live database.
-- This migration is intentionally non-destructive.

CREATE TABLE IF NOT EXISTS "product" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "product_problem_solved" TEXT,
    "amazon_asin" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_project_name_unique"
    ON "product"("project_id", "name");

CREATE INDEX IF NOT EXISTS "product_project_id_idx"
    ON "product"("project_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'product_project_id_fkey'
  ) THEN
    ALTER TABLE "product"
      ADD CONSTRAINT "product_project_id_fkey"
      FOREIGN KEY ("project_id")
      REFERENCES "project"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION;
  END IF;
END
$$;
