-- Add spend column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'account'
      AND column_name = 'spend'
  ) THEN
    ALTER TABLE "account" ADD COLUMN "spend" INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Ensure AccountTier enum exists (noop if already present)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccountTier') THEN
    CREATE TYPE "AccountTier" AS ENUM ('FREE', 'GROWTH', 'SCALE');
  END IF;
END $$;

-- Create spend_event table
CREATE TABLE IF NOT EXISTS "spend_event" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "sourceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "spend_event_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "spend_event_sourceId_key" UNIQUE ("sourceId"),
  CONSTRAINT "spend_event_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "spend_event_accountId_idx" ON "spend_event"("accountId");
