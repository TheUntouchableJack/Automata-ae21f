-- Fix mutable search_path on all SECURITY DEFINER functions in public schema
-- Uses dynamic SQL to automatically find and fix all affected functions
-- Safe to re-run (idempotent)

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
      AND p.prosecdef = true
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
