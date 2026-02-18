-- Final search_path fix
-- Migration 000008 broke all functions by setting search_path = 'public, extensions'
-- which PostgreSQL stored in a format that made tables invisible.
-- This migration:
-- 1. Resets ALL public functions to search_path = 'public' (broad reset, no pattern matching)
-- 2. Sets search_path TO public, extensions (correct TO syntax) for pgcrypto functions
-- 3. Reloads PostgREST schema cache

-- ============================================================
-- PART 1: Reset ALL public functions to search_path = 'public'
-- ============================================================
DO $$
DECLARE
  func_oid OID;
  func_sig TEXT;
  func_config TEXT[];
  fixed_count INTEGER := 0;
BEGIN
  FOR func_oid, func_config IN
    SELECT p.oid, p.proconfig
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prolang != (SELECT oid FROM pg_language WHERE lanname = 'c')
      AND p.prolang != (SELECT oid FROM pg_language WHERE lanname = 'internal')
      AND p.proconfig IS NOT NULL
  LOOP
    -- Check if any proconfig element contains search_path but is NOT just 'search_path=public'
    IF EXISTS (
      SELECT 1 FROM unnest(func_config) AS elem
      WHERE elem LIKE 'search_path=%'
        AND elem != 'search_path=public'
    ) THEN
      func_sig := func_oid::regprocedure::text;
      RAISE NOTICE 'Resetting: % (was: %)', func_sig, func_config;
      EXECUTE format('ALTER FUNCTION %s SET search_path = public', func_sig);
      fixed_count := fixed_count + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Total functions reset to search_path=public: %', fixed_count;
END $$;

-- ============================================================
-- PART 2: Set pgcrypto functions to include extensions schema
-- Uses TO syntax for unambiguous comma-separated list
-- ============================================================
ALTER FUNCTION hash_pin_bcrypt(text) SET search_path TO public, extensions;
ALTER FUNCTION verify_pin_bcrypt(text, text) SET search_path TO public, extensions;
ALTER FUNCTION verify_pin_legacy_sha256(text, text) SET search_path TO public, extensions;
ALTER FUNCTION customer_app_signup(uuid, text, text, text, text, text) SET search_path TO public, extensions;

-- ============================================================
-- PART 3: Reload PostgREST schema cache
-- ============================================================
NOTIFY pgrst, 'reload schema';
