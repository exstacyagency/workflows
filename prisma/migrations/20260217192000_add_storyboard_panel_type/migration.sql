DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PanelType') THEN
    CREATE TYPE "PanelType" AS ENUM ('ON_CAMERA', 'B_ROLL_ONLY');
  END IF;
END $$;

ALTER TABLE "storyboard_scene"
ADD COLUMN IF NOT EXISTS "panelType" "PanelType" DEFAULT 'ON_CAMERA';
