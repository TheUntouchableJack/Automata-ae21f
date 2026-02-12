-- Composite Indexes for Hot Query Patterns
-- Targets the heaviest query paths identified in scaling audit

-- Automation executions: frequently queried by (automation_id, member_id, status)
CREATE INDEX IF NOT EXISTS idx_automation_exec_composite
    ON automation_executions(automation_id, member_id, status, executed_at DESC);

-- Message batches: queried by (organization_id, automation_id, status) in performance metrics
CREATE INDEX IF NOT EXISTS idx_message_batches_org_automation
    ON app_message_batches(organization_id, automation_id, sent_at DESC)
    WHERE status IN ('sent', 'partially_sent');

-- AI prompts: monthly usage counting (royal-ai-prompt scans all org prompts per request)
CREATE INDEX IF NOT EXISTS idx_ai_prompts_org_created
    ON ai_prompts(organization_id, created_at DESC);

-- App members: frequently queried by (app_id, tier) for segment filtering
CREATE INDEX IF NOT EXISTS idx_app_members_active_tier
    ON app_members(app_id, tier)
    WHERE deleted_at IS NULL;

-- Member communication log: fatigue calculation needs (member_id, channel, sent_at)
CREATE INDEX IF NOT EXISTS idx_comm_log_member_channel_sent
    ON member_communication_log(member_id, channel, sent_at DESC);
