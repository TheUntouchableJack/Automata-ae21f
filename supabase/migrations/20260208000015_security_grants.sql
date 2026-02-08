-- Security Fix: Add missing GRANT statements for SECURITY DEFINER functions
-- Using DO blocks to handle functions that may not exist

-- ============================================================================
-- GRANT HELPER: Wraps grants in exception handling
-- ============================================================================

-- Helper to safely grant execute on a function
CREATE OR REPLACE FUNCTION safe_grant_execute(func_signature TEXT, role_name TEXT)
RETURNS VOID AS $$
BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', func_signature, role_name);
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'Function % does not exist, skipping grant', func_signature;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 1. AUTOMATION FUNCTIONS
-- ============================================================================

SELECT safe_grant_execute('get_active_promotions_for_member(UUID, UUID, TEXT)', 'authenticated');
SELECT safe_grant_execute('get_active_promotions_for_member(UUID, UUID, TEXT)', 'service_role');
SELECT safe_grant_execute('should_fire_automation(UUID, UUID)', 'authenticated');
SELECT safe_grant_execute('should_fire_automation(UUID, UUID)', 'service_role');

-- ============================================================================
-- 2. RESEARCH FUNCTIONS
-- ============================================================================

SELECT safe_grant_execute('cleanup_old_search_cache()', 'service_role');
SELECT safe_grant_execute('cleanup_old_search_cache(INTEGER)', 'service_role');

-- ============================================================================
-- 3. SECURITY HARDENING FUNCTIONS
-- ============================================================================

SELECT safe_grant_execute('claim_pending_actions(INTEGER, TEXT)', 'service_role');
SELECT safe_grant_execute('release_abandoned_actions(INTEGER)', 'service_role');
SELECT safe_grant_execute('batch_award_points(JSONB)', 'service_role');
SELECT safe_grant_execute('safe_check_rate_limit(UUID, TEXT, INTEGER, INTERVAL)', 'authenticated');
SELECT safe_grant_execute('safe_check_rate_limit(UUID, TEXT, INTEGER, INTERVAL)', 'service_role');

-- ============================================================================
-- 4. EMAIL/SMS TRACKING FUNCTIONS
-- ============================================================================

SELECT safe_grant_execute('process_email_event(TEXT, TEXT, JSONB, TIMESTAMPTZ)', 'service_role');
SELECT safe_grant_execute('process_sms_event(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ)', 'service_role');

-- ============================================================================
-- 5. AUTOMATION PERFORMANCE METRICS
-- ============================================================================

SELECT safe_grant_execute('get_automation_performance(UUID, UUID, INTEGER)', 'authenticated');
SELECT safe_grant_execute('get_automation_performance(UUID, UUID, INTEGER)', 'service_role');
SELECT safe_grant_execute('get_automation_rankings(UUID, INTEGER)', 'authenticated');
SELECT safe_grant_execute('get_automation_rankings(UUID, INTEGER)', 'service_role');

-- ============================================================================
-- 6. FATIGUE TRACKING FUNCTIONS
-- ============================================================================

SELECT safe_grant_execute('calculate_member_fatigue(UUID, UUID[])', 'authenticated');
SELECT safe_grant_execute('calculate_member_fatigue(UUID, UUID[])', 'service_role');
SELECT safe_grant_execute('get_segment_fatigue_summary(UUID, TEXT, INTEGER)', 'authenticated');
SELECT safe_grant_execute('get_segment_fatigue_summary(UUID, TEXT, INTEGER)', 'service_role');
SELECT safe_grant_execute('should_skip_for_fatigue(UUID, INTEGER)', 'authenticated');
SELECT safe_grant_execute('should_skip_for_fatigue(UUID, INTEGER)', 'service_role');
SELECT safe_grant_execute('log_member_communication(UUID, TEXT, TEXT, UUID, UUID, TEXT)', 'service_role');

-- ============================================================================
-- 7. CUSTOM AUTOMATION GUARDRAILS
-- ============================================================================

SELECT safe_grant_execute('validate_automation_config(JSONB)', 'authenticated');
SELECT safe_grant_execute('validate_automation_config(JSONB)', 'service_role');
SELECT safe_grant_execute('check_automation_duplicate(UUID, TEXT, JSONB, JSONB)', 'authenticated');
SELECT safe_grant_execute('check_automation_duplicate(UUID, TEXT, JSONB, JSONB)', 'service_role');
SELECT safe_grant_execute('calculate_automation_confidence(JSONB, JSONB)', 'authenticated');
SELECT safe_grant_execute('calculate_automation_confidence(JSONB, JSONB)', 'service_role');
SELECT safe_grant_execute('create_custom_automation(UUID, UUID, TEXT, TEXT, TEXT, JSONB, JSONB, JSONB)', 'authenticated');
SELECT safe_grant_execute('create_custom_automation(UUID, UUID, TEXT, TEXT, TEXT, JSONB, JSONB, JSONB)', 'service_role');

-- ============================================================================
-- 8. VISIT CORRELATION FUNCTIONS
-- ============================================================================

SELECT safe_grant_execute('attribute_visit_to_automations(UUID, UUID, TIMESTAMPTZ)', 'service_role');
SELECT safe_grant_execute('measure_automation_outcomes(INTEGER)', 'service_role');
SELECT safe_grant_execute('get_automation_correlation(UUID, INTEGER)', 'authenticated');
SELECT safe_grant_execute('get_automation_correlation(UUID, INTEGER)', 'service_role');
SELECT safe_grant_execute('get_automation_performance_with_correlation(UUID, UUID, INTEGER)', 'authenticated');
SELECT safe_grant_execute('get_automation_performance_with_correlation(UUID, UUID, INTEGER)', 'service_role');

-- ============================================================================
-- 9. ADDITIONAL RLS POLICIES (Missing INSERT/UPDATE)
-- ============================================================================

-- automation_executions: Allow service_role to insert/update
DO $$ BEGIN
  CREATE POLICY "Service role can insert automation executions"
      ON automation_executions FOR INSERT
      TO service_role
      WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Policy already exists, skipping';
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role can update automation executions"
      ON automation_executions FOR UPDATE
      TO service_role
      USING (true)
      WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Policy already exists, skipping';
END $$;

-- member_communication_log: Allow service_role to insert/update
DO $$ BEGIN
  CREATE POLICY "Service role can insert communication logs"
      ON member_communication_log FOR INSERT
      TO service_role
      WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Policy already exists, skipping';
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role can update communication logs"
      ON member_communication_log FOR UPDATE
      TO service_role
      USING (true)
      WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Policy already exists, skipping';
END $$;

-- ============================================================================
-- CLEANUP: Drop helper function
-- ============================================================================

DROP FUNCTION IF EXISTS safe_grant_execute(TEXT, TEXT);

-- ============================================================================
-- COMMENTS
-- ============================================================================

DO $$ BEGIN
  COMMENT ON FUNCTION process_email_event IS 'Processes email webhook events - service_role only';
EXCEPTION WHEN undefined_function THEN NULL; END $$;

DO $$ BEGIN
  COMMENT ON FUNCTION process_sms_event IS 'Processes SMS webhook events - service_role only';
EXCEPTION WHEN undefined_function THEN NULL; END $$;
