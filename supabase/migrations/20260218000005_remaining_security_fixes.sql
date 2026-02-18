-- Fix remaining security warnings:
-- 1. Pin search_path on all public functions (catches non-SECURITY DEFINER ones missed by 000003)
-- 2. Revoke API access to mv_member_fatigue materialized view
-- 3. Drop redundant service_role RLS policies (service_role bypasses RLS anyway)

-- ============================================================
-- PART 1: Fix remaining function search_path warnings
-- ============================================================
DO $$
DECLARE
  func_oid OID;
  func_sig TEXT;
  fixed_count INTEGER := 0;
BEGIN
  FOR func_oid IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prolang != (SELECT oid FROM pg_language WHERE lanname = 'c')
      AND p.prolang != (SELECT oid FROM pg_language WHERE lanname = 'internal')
      AND (p.proconfig IS NULL
           OR NOT p.proconfig @> ARRAY['search_path=public'])
  LOOP
    func_sig := func_oid::regprocedure::text;
    EXECUTE format('ALTER FUNCTION %s SET search_path = ''public''', func_sig);
    fixed_count := fixed_count + 1;
    RAISE NOTICE 'Fixed: %', func_sig;
  END LOOP;
  RAISE NOTICE 'Total functions fixed: %', fixed_count;
END $$;

-- ============================================================
-- PART 2: Revoke API access to materialized view
-- ============================================================
REVOKE SELECT ON mv_member_fatigue FROM anon, authenticated;

-- ============================================================
-- PART 3: Drop redundant service_role policies
-- ============================================================
DROP POLICY IF EXISTS "Service role can manage preferences" ON customer_preferences;
DROP POLICY IF EXISTS "Service role can manage attempts" ON data_collection_attempts;
DROP POLICY IF EXISTS "Service role full access on communication_log" ON member_communication_log;
DROP POLICY IF EXISTS "Service role full access on message_recipients" ON message_recipients;
DROP POLICY IF EXISTS "System can manage usage" ON usage_tracking;
