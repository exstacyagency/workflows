-- Drop legacy Plan table (no longer used; pricing is enforced via Subscription.planId + lib/billing/*)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Plan') THEN
    EXECUTE 'DROP TABLE "Plan"';
  END IF;
END $$;
