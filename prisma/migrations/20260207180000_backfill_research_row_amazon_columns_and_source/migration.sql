-- Backfill denormalized Amazon fields on research_row from metadata for legacy rows.
UPDATE "research_row"
SET "productType" = CASE
    WHEN COALESCE("metadata"->>'productType', '') = 'MAIN_PRODUCT' THEN 'MAIN_PRODUCT'::"ProductType"
    WHEN COALESCE("metadata"->>'productType', '') = 'COMPETITOR_1' THEN 'COMPETITOR_1'::"ProductType"
    WHEN COALESCE("metadata"->>'productType', '') = 'COMPETITOR_2' THEN 'COMPETITOR_2'::"ProductType"
    WHEN COALESCE("metadata"->>'productType', '') = 'COMPETITOR_3' THEN 'COMPETITOR_3'::"ProductType"
    ELSE "productType"
  END,
  "productAsin" = COALESCE(NULLIF("metadata"->>'productAsin', ''), NULLIF("metadata"->>'asin', ''), "productAsin"),
  "rating" = CASE
    WHEN COALESCE("metadata"->>'rating', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
      THEN ROUND(("metadata"->>'rating')::numeric)::int
    ELSE "rating"
  END,
  "productName" = COALESCE(NULLIF("metadata"->>'productName', ''), NULLIF("metadata"->>'product_name', ''), "productName")
WHERE "source" = 'AMAZON'::"ResearchSource";

-- Reclassify legacy AMAZON rows now that productType is populated.
UPDATE "research_row"
SET "source" = 'AMAZON_MAIN_PRODUCT'::"ResearchSource"
WHERE "source" = 'AMAZON'::"ResearchSource" AND "productType" = 'MAIN_PRODUCT'::"ProductType";

UPDATE "research_row"
SET "source" = 'AMAZON_COMPETITOR_1'::"ResearchSource"
WHERE "source" = 'AMAZON'::"ResearchSource" AND "productType" = 'COMPETITOR_1'::"ProductType";

UPDATE "research_row"
SET "source" = 'AMAZON_COMPETITOR_2'::"ResearchSource"
WHERE "source" = 'AMAZON'::"ResearchSource" AND "productType" = 'COMPETITOR_2'::"ProductType";

UPDATE "research_row"
SET "source" = 'AMAZON_COMPETITOR_3'::"ResearchSource"
WHERE "source" = 'AMAZON'::"ResearchSource" AND "productType" = 'COMPETITOR_3'::"ProductType";
