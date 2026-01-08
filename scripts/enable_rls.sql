-- Enable RLS enforcement (RUN MANUALLY ON STAGING FIRST)
-- This enables and forces RLS on key tables. Requires app to set app.user_id/app.is_admin in DB sessions.

DO $$
BEGIN
  IF to_regclass('public."Project"') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE "Project" FORCE ROW LEVEL SECURITY';
  END IF;
  IF to_regclass('public."Job"') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE "Job" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE "Job" FORCE ROW LEVEL SECURITY';
  END IF;
  IF to_regclass('public."Script"') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE "Script" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE "Script" FORCE ROW LEVEL SECURITY';
  END IF;
  IF to_regclass('public."Storyboard"') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE "Storyboard" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE "Storyboard" FORCE ROW LEVEL SECURITY';
  END IF;
  IF to_regclass('public."StoryboardScene"') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE "StoryboardScene" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE "StoryboardScene" FORCE ROW LEVEL SECURITY';
  END IF;
  IF to_regclass('public."ResearchRow"') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE "ResearchRow" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE "ResearchRow" FORCE ROW LEVEL SECURITY';
  END IF;
  IF to_regclass('public."ProductIntelligence"') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE "ProductIntelligence" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE "ProductIntelligence" FORCE ROW LEVEL SECURITY';
  END IF;
  IF to_regclass('public."CustomerAvatar"') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE "CustomerAvatar" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE "CustomerAvatar" FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
