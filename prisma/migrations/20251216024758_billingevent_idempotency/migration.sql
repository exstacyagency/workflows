DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'BillingEvent'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "BillingEvent_stripeEventId_key"
      ON "BillingEvent"("stripeEventId");
  END IF;
END$$;
