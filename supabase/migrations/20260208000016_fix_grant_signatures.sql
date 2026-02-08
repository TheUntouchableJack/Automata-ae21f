-- Fix GRANT statements with correct function signatures
-- Previous migration (000015) had incorrect parameter types

-- ============================================================================
-- GRANT HELPER: Wraps grants in exception handling
-- ============================================================================

CREATE OR REPLACE FUNCTION safe_grant_execute(func_signature TEXT, role_name TEXT)
RETURNS VOID AS $$
BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', func_signature, role_name);
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'Function % does not exist, skipping grant', func_signature;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SECURITY HARDENING FUNCTIONS (Corrected signatures)
-- ============================================================================

-- claim_pending_actions(UUID, INTEGER) not (INTEGER, TEXT)
SELECT safe_grant_execute('claim_pending_actions(UUID, INTEGER)', 'service_role');

-- release_abandoned_actions(INTEGER)
SELECT safe_grant_execute('release_abandoned_actions(INTEGER)', 'service_role');

-- batch_award_points(UUID[], INTEGER, TEXT, UUID) not (JSONB)
SELECT safe_grant_execute('batch_award_points(UUID[], INTEGER, TEXT, UUID)', 'service_role');

-- safe_check_rate_limit(UUID, TEXT) not (UUID, TEXT, INTEGER, INTERVAL)
SELECT safe_grant_execute('safe_check_rate_limit(UUID, TEXT)', 'authenticated');
SELECT safe_grant_execute('safe_check_rate_limit(UUID, TEXT)', 'service_role');

-- ============================================================================
-- CUSTOM AUTOMATION GUARDRAILS (Corrected signatures)
-- ============================================================================

-- validate_automation_config(TEXT, JSONB) not (JSONB)
SELECT safe_grant_execute('validate_automation_config(TEXT, JSONB)', 'authenticated');
SELECT safe_grant_execute('validate_automation_config(TEXT, JSONB)', 'service_role');

-- check_automation_duplicate(UUID, TEXT, TEXT, TEXT, TEXT) not (UUID, TEXT, JSONB, JSONB)
SELECT safe_grant_execute('check_automation_duplicate(UUID, TEXT, TEXT, TEXT, TEXT)', 'authenticated');
SELECT safe_grant_execute('check_automation_duplicate(UUID, TEXT, TEXT, TEXT, TEXT)', 'service_role');

-- calculate_automation_confidence(TEXT, JSONB, INTEGER, INTEGER, BOOLEAN) not (JSONB, JSONB)
SELECT safe_grant_execute('calculate_automation_confidence(TEXT, JSONB, INTEGER, INTEGER, BOOLEAN)', 'authenticated');
SELECT safe_grant_execute('calculate_automation_confidence(TEXT, JSONB, INTEGER, INTEGER, BOOLEAN)', 'service_role');

-- create_custom_automation has many params - check exact signature
-- Looking at migration: (UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, INTEGER)
SELECT safe_grant_execute('create_custom_automation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, INTEGER)', 'authenticated');
SELECT safe_grant_execute('create_custom_automation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, INTEGER)', 'service_role');

-- ============================================================================
-- VISIT CORRELATION FUNCTIONS (Corrected signatures)
-- ============================================================================

-- attribute_visit_to_automations(UUID, TIMESTAMPTZ) not (UUID, UUID, TIMESTAMPTZ)
SELECT safe_grant_execute('attribute_visit_to_automations(UUID, TIMESTAMPTZ)', 'service_role');

-- measure_automation_outcomes(INTEGER)
SELECT safe_grant_execute('measure_automation_outcomes(INTEGER)', 'service_role');

-- ============================================================================
-- CLEANUP
-- ============================================================================

DROP FUNCTION IF EXISTS safe_grant_execute(TEXT, TEXT);
