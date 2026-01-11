-- RLS POLICY INSTALLATION (SAFE)
-- This migration installs helper functions and policies, but intentionally does NOT enable RLS on tables.
-- Enabling RLS is a manual one-time step (see scripts/enable_rls.sql) after application code sets session context.

CREATE SCHEMA IF NOT EXISTS app;

-- Current request user context (set via SET LOCAL / set_config in transaction)
CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT current_setting('app.user_id', true)
$$;

CREATE OR REPLACE FUNCTION app.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(current_setting('app.is_admin', true), 'false')::boolean
$$;

-- Project ownership predicate
CREATE OR REPLACE FUNCTION app.project_owner(project_id text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    app.is_admin()
    OR EXISTS (
      SELECT 1
      FROM "Project" p
      WHERE p.id = project_id
        AND p."userId" = app.current_user_id()
    )
$$;

-- Storyboard ownership predicate
CREATE OR REPLACE FUNCTION app.storyboard_owner(storyboard_id text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    app.is_admin()
    OR EXISTS (
      SELECT 1
      FROM "Storyboard" s
      JOIN "Project" p ON p.id = s."projectId"
      WHERE s.id = storyboard_id
        AND p."userId" = app.current_user_id()
    )
$$;

-- Helper: create policy if missing (SAFE for all commands)
CREATE OR REPLACE FUNCTION app.create_policy_if_missing(
  tbl regclass,
  pol_name text,
  pol_cmd text,
  pol_using text,
  pol_check text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  tname text;
  exists_pol boolean;
  sql text;
BEGIN
  SELECT relname INTO tname FROM pg_class WHERE oid = tbl;

  SELECT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = tname
      AND policyname = pol_name
  ) INTO exists_pol;

  IF exists_pol THEN
    RETURN;
  END IF;

  -- SELECT / DELETE → USING only
  IF pol_cmd IN ('SELECT', 'DELETE') THEN
    sql := format(
      'CREATE POLICY %I ON %s FOR %s USING (%s);',
      pol_name, tbl::text, pol_cmd, pol_using
    );

  -- INSERT → WITH CHECK only
  ELSIF pol_cmd = 'INSERT' THEN
    sql := format(
      'CREATE POLICY %I ON %s FOR INSERT WITH CHECK (%s);',
      pol_name, tbl::text, pol_check
    );

  -- UPDATE → USING + WITH CHECK
  ELSIF pol_cmd = 'UPDATE' THEN
    sql := format(
      'CREATE POLICY %I ON %s FOR UPDATE USING (%s) WITH CHECK (%s);',
      pol_name, tbl::text, pol_using, pol_check
    );

  ELSE
    RAISE EXCEPTION 'Unsupported policy command: %', pol_cmd;
  END IF;

  EXECUTE sql;
END;
$$;

-- NOTE: Policies are installed for key multi-tenant tables if they exist.
DO $$
BEGIN
  IF to_regclass('public."Project"') IS NOT NULL THEN
    PERFORM app.create_policy_if_missing('public."Project"', 'project_select_owner', 'SELECT',
      '(app.is_admin() OR "userId" = app.current_user_id())',
      '(app.is_admin() OR "userId" = app.current_user_id())'
    );
    PERFORM app.create_policy_if_missing('public."Project"', 'project_update_owner', 'UPDATE',
      '(app.is_admin() OR "userId" = app.current_user_id())',
      '(app.is_admin() OR "userId" = app.current_user_id())'
    );
    PERFORM app.create_policy_if_missing('public."Project"', 'project_delete_owner', 'DELETE',
      '(app.is_admin() OR "userId" = app.current_user_id())',
      '(app.is_admin() OR "userId" = app.current_user_id())'
    );
    PERFORM app.create_policy_if_missing('public."Project"', 'project_insert_owner', 'INSERT',
      '(true)',
      '(app.is_admin() OR "userId" = app.current_user_id())'
    );
  END IF;

  IF to_regclass('public."Job"') IS NOT NULL THEN
    PERFORM app.create_policy_if_missing('public."Job"', 'job_select_owner', 'SELECT',
      '(app.project_owner("projectId"))',
      '(app.project_owner("projectId"))'
    );
    PERFORM app.create_policy_if_missing('public."Job"', 'job_update_owner', 'UPDATE',
      '(app.project_owner("projectId"))',
      '(app.project_owner("projectId"))'
    );
    PERFORM app.create_policy_if_missing('public."Job"', 'job_delete_owner', 'DELETE',
      '(app.project_owner("projectId"))',
      '(app.project_owner("projectId"))'
    );
    PERFORM app.create_policy_if_missing('public."Job"', 'job_insert_owner', 'INSERT',
      '(true)',
      '(app.project_owner("projectId"))'
    );
  END IF;

  IF to_regclass('public."Script"') IS NOT NULL THEN
    PERFORM app.create_policy_if_missing('public."Script"', 'script_select_owner', 'SELECT',
      '(app.project_owner("projectId"))',
      '(app.project_owner("projectId"))'
    );
    PERFORM app.create_policy_if_missing('public."Script"', 'script_update_owner', 'UPDATE',
      '(app.project_owner("projectId"))',
      '(app.project_owner("projectId"))'
    );
    PERFORM app.create_policy_if_missing('public."Script"', 'script_delete_owner', 'DELETE',
      '(app.project_owner("projectId"))',
      '(app.project_owner("projectId"))'
    );
    PERFORM app.create_policy_if_missing('public."Script"', 'script_insert_owner', 'INSERT',
      '(true)',
      '(app.project_owner("projectId"))'
    );
  END IF;

  IF to_regclass('public."Storyboard"') IS NOT NULL THEN
    PERFORM app.create_policy_if_missing('public."Storyboard"', 'storyboard_select_owner', 'SELECT',
      '(app.project_owner("projectId"))',
      '(app.project_owner("projectId"))'
    );
    PERFORM app.create_policy_if_missing('public."Storyboard"', 'storyboard_update_owner', 'UPDATE',
      '(app.project_owner("projectId"))',
      '(app.project_owner("projectId"))'
    );
    PERFORM app.create_policy_if_missing('public."Storyboard"', 'storyboard_delete_owner', 'DELETE',
      '(app.project_owner("projectId"))',
      '(app.project_owner("projectId"))'
    );
    PERFORM app.create_policy_if_missing('public."Storyboard"', 'storyboard_insert_owner', 'INSERT',
      '(true)',
      '(app.project_owner("projectId"))'
    );
  END IF;

  IF to_regclass('public."StoryboardScene"') IS NOT NULL THEN
    PERFORM app.create_policy_if_missing('public."StoryboardScene"', 'scene_select_owner', 'SELECT',
      '(app.storyboard_owner("storyboardId"))',
      '(app.storyboard_owner("storyboardId"))'
    );
    PERFORM app.create_policy_if_missing('public."StoryboardScene"', 'scene_update_owner', 'UPDATE',
      '(app.storyboard_owner("storyboardId"))',
      '(app.storyboard_owner("storyboardId"))'
    );
    PERFORM app.create_policy_if_missing('public."StoryboardScene"', 'scene_delete_owner', 'DELETE',
      '(app.storyboard_owner("storyboardId"))',
      '(app.storyboard_owner("storyboardId"))'
    );
    PERFORM app.create_policy_if_missing('public."StoryboardScene"', 'scene_insert_owner', 'INSERT',
      '(true)',
      '(app.storyboard_owner("storyboardId"))'
    );
  END IF;

  IF to_regclass('public."ResearchRow"') IS NOT NULL THEN
    PERFORM app.create_policy_if_missing('public."ResearchRow"', 'research_select_owner', 'SELECT',
      '(app.project_owner("projectId"))',
      '(app.project_owner("projectId"))'
    );
    PERFORM app.create_policy_if_missing('public."ResearchRow"', 'research_update_owner', 'UPDATE',
      '(app.project_owner("projectId"))',
      '(app.project_owner("projectId"))'
    );
    PERFORM app.create_policy_if_missing('public."ResearchRow"', 'research_delete_owner', 'DELETE',
      '(app.project_owner("projectId"))',
      '(app.project_owner("projectId"))'
    );
    PERFORM app.create_policy_if_missing('public."ResearchRow"', 'research_insert_owner', 'INSERT',
      '(true)',
      '(app.project_owner("projectId"))'
    );
  END IF;

  IF to_regclass('public."ProductIntelligence"') IS NOT NULL THEN
    PERFORM app.create_policy_if_missing('public."ProductIntelligence"', 'pi_select_owner', 'SELECT',
      '(app.project_owner("projectId"))',
      '(app.project_owner("projectId"))'
    );
    PERFORM app.create_policy_if_missing('public."ProductIntelligence"', 'pi_update_owner', 'UPDATE',
      '(app.project_owner("projectId"))',
      '(app.project_owner("projectId"))'
    );
    PERFORM app.create_policy_if_missing('public."ProductIntelligence"', 'pi_delete_owner', 'DELETE',
      '(app.project_owner("projectId"))',
      '(app.project_owner("projectId"))'
    );
    PERFORM app.create_policy_if_missing('public."ProductIntelligence"', 'pi_insert_owner', 'INSERT',
      '(true)',
      '(app.project_owner("projectId"))'
    );
  END IF;

  IF to_regclass('public."CustomerAvatar"') IS NOT NULL THEN
    PERFORM app.create_policy_if_missing('public."CustomerAvatar"', 'avatar_select_owner', 'SELECT',
      '(app.project_owner("projectId"))',
      '(app.project_owner("projectId"))'
    );
    PERFORM app.create_policy_if_missing('public."CustomerAvatar"', 'avatar_update_owner', 'UPDATE',
      '(app.project_owner("projectId"))',
      '(app.project_owner("projectId"))'
    );
    PERFORM app.create_policy_if_missing('public."CustomerAvatar"', 'avatar_delete_owner', 'DELETE',
      '(app.project_owner("projectId"))',
      '(app.project_owner("projectId"))'
    );
    PERFORM app.create_policy_if_missing('public."CustomerAvatar"', 'avatar_insert_owner', 'INSERT',
      '(true)',
      '(app.project_owner("projectId"))'
    );
  END IF;
END $$;