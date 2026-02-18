-- Fix auth_rls_initplan performance warnings
-- Wraps auth.uid() and auth.email() in (SELECT ...) so PostgreSQL evaluates
-- them once per query (InitPlan) instead of per-row
-- Dynamically finds and recreates all affected RLS policies

DO $$
DECLARE
  pol RECORD;
  new_qual TEXT;
  new_with_check TEXT;
  create_stmt TEXT;
  roles_str TEXT;
  fixed_count INTEGER := 0;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    AND (
      (qual IS NOT NULL AND qual ~ 'auth\.(uid|email)\(\)' AND qual !~ '\(select auth\.')
      OR (with_check IS NOT NULL AND with_check ~ 'auth\.(uid|email)\(\)' AND with_check !~ '\(select auth\.')
    )
  LOOP
    new_qual := pol.qual;
    new_with_check := pol.with_check;

    -- Wrap auth.uid() and auth.email() in (select ...)
    IF new_qual IS NOT NULL THEN
      new_qual := regexp_replace(new_qual, 'auth\.uid\(\)', '(select auth.uid())', 'g');
      new_qual := regexp_replace(new_qual, 'auth\.email\(\)', '(select auth.email())', 'g');
    END IF;
    IF new_with_check IS NOT NULL THEN
      new_with_check := regexp_replace(new_with_check, 'auth\.uid\(\)', '(select auth.uid())', 'g');
      new_with_check := regexp_replace(new_with_check, 'auth\.email\(\)', '(select auth.email())', 'g');
    END IF;

    roles_str := array_to_string(pol.roles, ', ');

    -- Drop old policy
    EXECUTE format('DROP POLICY %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);

    -- Recreate with InitPlan optimization
    create_stmt := format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
      pol.policyname, pol.schemaname, pol.tablename,
      pol.permissive, pol.cmd, roles_str);

    IF new_qual IS NOT NULL THEN
      create_stmt := create_stmt || ' USING (' || new_qual || ')';
    END IF;
    IF new_with_check IS NOT NULL THEN
      create_stmt := create_stmt || ' WITH CHECK (' || new_with_check || ')';
    END IF;

    EXECUTE create_stmt;
    fixed_count := fixed_count + 1;
    RAISE NOTICE 'Fixed: %.% - %', pol.schemaname, pol.tablename, pol.policyname;
  END LOOP;
  RAISE NOTICE 'Total policies fixed: %', fixed_count;
END $$;
