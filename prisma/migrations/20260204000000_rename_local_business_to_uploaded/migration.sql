-- Rename LOCAL_BUSINESS to UPLOADED in existing data
UPDATE "research_row" SET "source" = 'UPLOADED' WHERE "source" = 'LOCAL_BUSINESS';
