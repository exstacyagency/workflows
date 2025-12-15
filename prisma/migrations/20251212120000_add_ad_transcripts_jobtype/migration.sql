-- Add AD_TRANSCRIPTS to JobType enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'JobType' AND e.enumlabel = 'AD_TRANSCRIPTS'
  ) THEN
    EXECUTE 'ALTER TYPE "JobType" ADD ' || 'VALUE ''AD_TRANSCRIPTS''';
  END IF;
END$$;
