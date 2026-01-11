-- Ensure AccountTier enum exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AccountTier') THEN
    CREATE TYPE "AccountTier" AS ENUM ('FREE', 'GROWTH', 'SCALE');
  END IF;
END $$;

-- Add accountId column to user table if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user'
      AND column_name = 'accountId'
  ) THEN
    ALTER TABLE "user" ADD COLUMN "accountId" TEXT;
  END IF;
END $$;

-- Create account table
CREATE TABLE IF NOT EXISTS "account" (
  "id" TEXT NOT NULL,
  "tier" "AccountTier" NOT NULL DEFAULT 'FREE',
  "spendCap" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- Create campaign table
CREATE TABLE IF NOT EXISTS "campaign" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "campaign_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "campaign_accountId_idx" ON "campaign"("accountId");

-- Add foreign keys
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_accountId_fkey'
  ) THEN
    ALTER TABLE "user"
      ADD CONSTRAINT "user_accountId_fkey"
      FOREIGN KEY ("accountId")
      REFERENCES "account"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'campaign_accountId_fkey'
  ) THEN
    ALTER TABLE "campaign"
      ADD CONSTRAINT "campaign_accountId_fkey"
      FOREIGN KEY ("accountId")
      REFERENCES "account"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;
