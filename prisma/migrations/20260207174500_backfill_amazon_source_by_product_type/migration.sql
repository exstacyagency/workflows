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
