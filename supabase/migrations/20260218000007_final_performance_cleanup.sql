-- Final performance cleanup: clear remaining 8 auth_rls_initplan warnings
-- 1. Drop 7 redundant service_role policies (service_role bypasses RLS)
-- 2. Fix discovery_questions InitPlan (auth.role() → (SELECT auth.role()))

-- ============================================================
-- PART 1: Drop redundant service_role policies
-- ============================================================
DROP POLICY IF EXISTS "Service role full access to message_batches" ON app_message_batches;
DROP POLICY IF EXISTS "Service role full access to promotions" ON app_promotions;
DROP POLICY IF EXISTS "Service role full access to automation_definitions" ON automation_definitions;
DROP POLICY IF EXISTS "Service role full access to automation_executions" ON automation_executions;
DROP POLICY IF EXISTS "Service role full access to message_templates" ON message_templates;
DROP POLICY IF EXISTS "Service role full access to pause_events" ON automation_pause_events;
DROP POLICY IF EXISTS "Service role full access to digest_snapshots" ON weekly_digest_snapshots;

-- ============================================================
-- PART 2: Fix discovery_questions InitPlan
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can view questions" ON discovery_questions;
CREATE POLICY "Authenticated users can view questions" ON discovery_questions
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((SELECT auth.role()) = 'authenticated');
