CREATE TABLE IF NOT EXISTS "character" (
  "id" text PRIMARY KEY,
  "projectId" text,
  "productId" text,
  "jobId" text,
  "name" text NOT NULL,
  "metadata" jsonb,
  "soraCharacterId" text,
  "characterUserName" text,
  "seedVideoTaskId" text,
  "seedVideoUrl" text,
  "creatorVisualPrompt" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "character"
  ADD COLUMN IF NOT EXISTS "projectId" text,
  ADD COLUMN IF NOT EXISTS "productId" text,
  ADD COLUMN IF NOT EXISTS "jobId" text,
  ADD COLUMN IF NOT EXISTS "metadata" jsonb,
  ADD COLUMN IF NOT EXISTS "soraCharacterId" text,
  ADD COLUMN IF NOT EXISTS "characterUserName" text,
  ADD COLUMN IF NOT EXISTS "seedVideoTaskId" text,
  ADD COLUMN IF NOT EXISTS "seedVideoUrl" text,
  ADD COLUMN IF NOT EXISTS "creatorVisualPrompt" text,
  ADD COLUMN IF NOT EXISTS "createdAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "updatedAt" timestamptz;

UPDATE "character" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;
UPDATE "character" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL;

ALTER TABLE "character"
  ALTER COLUMN "createdAt" SET DEFAULT now(),
  ALTER COLUMN "updatedAt" SET DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'character_productId_fkey'
  ) THEN
    ALTER TABLE "character"
      ADD CONSTRAINT "character_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "product"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "character_productId_idx" ON "character" ("productId");
