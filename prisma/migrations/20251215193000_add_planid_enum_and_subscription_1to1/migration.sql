-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PlanId') THEN
    CREATE TYPE "PlanId" AS ENUM ('FREE', 'GROWTH', 'SCALE');
  END IF;
END$$;

-- Ensure Subscription is 1:1 with User (dedupe by userId)
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "userId"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, id DESC
    ) AS rn
  FROM "Subscription"
)
DELETE FROM "Subscription"
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Normalize any unexpected plan keys before casting to enum
UPDATE "Subscription"
SET "planId" = 'FREE'
WHERE "planId" IS NULL
   OR btrim("planId") = ''
   OR "planId" NOT IN ('FREE', 'GROWTH', 'SCALE');

-- AlterTable
ALTER TABLE "Subscription"
ALTER COLUMN "planId" TYPE "PlanId" USING ("planId"::"PlanId");

-- Add 1:1 uniqueness
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- UpdateForeignKey to cascade on user delete
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_userId_fkey";
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

