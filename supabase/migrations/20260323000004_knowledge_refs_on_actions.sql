-- V3.0: Track which business_knowledge facts informed each AI action
-- This enables "Applied" badges on the Learnings tab showing knowledge → action connections

-- Add knowledge_refs column to ai_action_queue
ALTER TABLE ai_action_queue
ADD COLUMN IF NOT EXISTS knowledge_refs JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN ai_action_queue.knowledge_refs IS 'Array of business_knowledge IDs that informed this action decision';

-- Index for efficient lookups: "which actions reference this knowledge?"
CREATE INDEX IF NOT EXISTS idx_action_queue_knowledge_refs
ON ai_action_queue USING GIN (knowledge_refs);

-- RPC: Get knowledge usage — returns which knowledge IDs are actively used by actions
CREATE OR REPLACE FUNCTION get_knowledge_usage(p_org_id UUID)
RETURNS TABLE (
    knowledge_id UUID,
    action_count BIGINT,
    action_types TEXT[],
    latest_action_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        (ref.value #>> '{}')::UUID AS knowledge_id,
        COUNT(DISTINCT a.id) AS action_count,
        ARRAY_AGG(DISTINCT a.action_type) AS action_types,
        MAX(a.created_at) AS latest_action_at
    FROM ai_action_queue a,
         jsonb_array_elements(a.knowledge_refs) AS ref(value)
    WHERE a.organization_id = p_org_id
      AND a.status IN ('executed', 'approved', 'pending')
      AND jsonb_array_length(a.knowledge_refs) > 0
    GROUP BY (ref.value #>> '{}')::UUID;
$$;

-- Grant access
GRANT EXECUTE ON FUNCTION get_knowledge_usage(UUID) TO authenticated;
