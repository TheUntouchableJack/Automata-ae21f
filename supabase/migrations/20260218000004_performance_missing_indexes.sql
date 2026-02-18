-- Add missing indexes for unindexed foreign keys and RLS performance
-- All use IF NOT EXISTS for idempotency

-- ============================================================
-- CRITICAL: RLS lookup index (18+ policies query this per request)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_org_members_user_org
  ON organization_members(user_id, organization_id);

-- ============================================================
-- AI Intelligence tables
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_business_knowledge_thread
  ON business_knowledge(source_thread_id);

CREATE INDEX IF NOT EXISTS idx_discovery_progress_question
  ON org_discovery_progress(question_id);

CREATE INDEX IF NOT EXISTS idx_discovery_progress_thread
  ON org_discovery_progress(answer_thread_id);

CREATE INDEX IF NOT EXISTS idx_owner_interactions_user
  ON owner_interactions(user_id);

CREATE INDEX IF NOT EXISTS idx_owner_interactions_thread
  ON owner_interactions(thread_id);

-- ============================================================
-- Action Queue / Audit
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_action_queue_thread
  ON ai_action_queue(thread_id);

CREATE INDEX IF NOT EXISTS idx_action_queue_prompt
  ON ai_action_queue(prompt_id);

CREATE INDEX IF NOT EXISTS idx_action_queue_approved_by
  ON ai_action_queue(approved_by);

CREATE INDEX IF NOT EXISTS idx_audit_log_user
  ON ai_audit_log(user_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_thread
  ON ai_audit_log(thread_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_prompt
  ON ai_audit_log(prompt_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_action_queue
  ON ai_audit_log(action_queue_id);

-- ============================================================
-- Messaging / Communication
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_automation_exec_batch
  ON automation_executions(batch_id);

CREATE INDEX IF NOT EXISTS idx_message_events_recipient
  ON message_events(recipient_id);

CREATE INDEX IF NOT EXISTS idx_message_events_member
  ON message_events(member_id);

CREATE INDEX IF NOT EXISTS idx_comm_log_org
  ON member_communication_log(organization_id);

CREATE INDEX IF NOT EXISTS idx_comm_log_source_automation
  ON member_communication_log(source_automation_id);

CREATE INDEX IF NOT EXISTS idx_comm_log_source_batch
  ON member_communication_log(source_batch_id);

-- ============================================================
-- Rewards
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_reward_suggestions_org
  ON reward_suggestions(organization_id);
