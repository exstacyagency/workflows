-- Ensure job.type uses JobType enum (not text)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'job'
      AND column_name = 'type'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE "job"
    ALTER COLUMN "type" TYPE "JobType"
    USING "type"::"JobType";
  END IF;
END $$;
