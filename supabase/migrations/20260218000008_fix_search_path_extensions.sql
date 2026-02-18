-- Fix search_path to include extensions schema
-- Migrations 000003/000005 set search_path='public' but pgcrypto functions
-- (crypt, gen_salt, digest) live in the 'extensions' schema on Supabase.
-- This broke verify_app_member_login and other functions using pgcrypto.
-- Fix: update 'public' → 'public, extensions' (still pinned, still secure)

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
      AND p.proconfig IS NOT NULL
      AND p.proconfig @> ARRAY['search_path=public']
      AND NOT p.proconfig @> ARRAY['search_path=public, extensions']
  LOOP
    func_sig := func_oid::regprocedure::text;
    EXECUTE format('ALTER FUNCTION %s SET search_path = ''public, extensions''', func_sig);
    fixed_count := fixed_count + 1;
    RAISE NOTICE 'Fixed: %', func_sig;
  END LOOP;
  RAISE NOTICE 'Total functions updated: %', fixed_count;
END $$;
