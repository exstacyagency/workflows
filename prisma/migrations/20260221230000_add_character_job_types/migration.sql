-- prisma/migrations/20260221230000_add_character_job_types/migration.sql
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction.
-- Prisma marks this migration as non-transactional via the directive below.
-- Run with: npx prisma migrate deploy
--
-- If running manually via psql, execute outside any BEGIN/COMMIT block.

ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'CREATOR_AVATAR_GENERATION';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'CHARACTER_SEED_VIDEO';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'CHARACTER_REFERENCE_VIDEO';
