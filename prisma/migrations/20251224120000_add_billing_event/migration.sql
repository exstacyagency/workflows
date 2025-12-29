-- CreateTable
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND c.relname = 'BillingEvent'
      AND n.nspname = 'public'
  ) THEN
    CREATE TABLE "BillingEvent" (
        "id" TEXT NOT NULL,
        "stripeEventId" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "stripeCustomerId" TEXT,
        "stripeSubscriptionId" TEXT,
        "userId" TEXT,
        "payloadJson" JSONB NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BillingEvent_stripeEventId_key" ON "BillingEvent"("stripeEventId");
