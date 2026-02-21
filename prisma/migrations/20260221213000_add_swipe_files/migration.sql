ALTER TABLE "ad_asset"
  ADD COLUMN IF NOT EXISTS "isSwipeFile" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "swipeMetadata" jsonb;
