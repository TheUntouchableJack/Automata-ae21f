-- Phase 5: Autonomous Loop Enhancements
-- Adds retry tracking and automation linkage

-- Add retry_count to ai_action_queue
ALTER TABLE ai_action_queue ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

-- Add automation_definition_id to link AI actions to automations
ALTER TABLE ai_action_queue ADD COLUMN IF NOT EXISTS automation_definition_id UUID REFERENCES automation_definitions(id);

-- Index for retry processing
CREATE INDEX IF NOT EXISTS idx_action_queue_retry
ON ai_action_queue(status, retry_count, scheduled_for)
WHERE status = 'failed' AND retry_count < 3;
