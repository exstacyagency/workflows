-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_planId_fkey";

-- AlterTable
ALTER TABLE "Subscription"
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT,
ADD COLUMN     "stripePriceId" TEXT,
ADD COLUMN     "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;

-- Backfill existing plan ids -> plan keys (best effort)
UPDATE "Subscription" s
SET "planId" = CASE p."name"
  WHEN 'Scale' THEN 'SCALE'
  WHEN 'Growth' THEN 'GROWTH'
  ELSE 'FREE'
END
FROM "Plan" p
WHERE s."planId" = p."id";

