-- Fix search_path regression from migration 000008
-- Problem: SET search_path = 'public, extensions' stores the comma inside quotes,
-- causing PostgreSQL to treat it as a single schema name instead of two schemas.
-- Result: functions can't find tables in 'public' schema ("relation does not exist").
--
-- Fix:
-- 1. Revert ALL functions back to search_path = 'public'
-- 2. Only set search_path TO public, extensions (unquoted TO syntax) for the 4
--    functions that directly call pgcrypto (crypt, gen_salt, digest)
-- 3. Reload PostgREST schema cache

-- ============================================================
-- PART 1: Revert all functions to search_path = 'public'
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
      AND p.proconfig IS NOT NULL
      AND p.proconfig @> ARRAY['search_path=public, extensions']
  LOOP
    func_sig := func_oid::regprocedure::text;
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', func_sig);
    fixed_count := fixed_count + 1;
  END LOOP;
  RAISE NOTICE 'Reverted % functions to search_path = public', fixed_count;
END $$;

-- ============================================================
-- PART 2: Set search_path TO public, extensions for pgcrypto functions only
-- Uses TO syntax (not = with quotes) for proper comma-separated list
-- ============================================================
ALTER FUNCTION hash_pin_bcrypt(text) SET search_path TO public, extensions;
ALTER FUNCTION verify_pin_bcrypt(text, text) SET search_path TO public, extensions;
ALTER FUNCTION verify_pin_legacy_sha256(text, text) SET search_path TO public, extensions;
ALTER FUNCTION customer_app_signup(uuid, text, text, text, text, text) SET search_path TO public, extensions;

-- ============================================================
-- PART 3: Reload PostgREST schema cache
-- ============================================================
NOTIFY pgrst, 'reload schema';
