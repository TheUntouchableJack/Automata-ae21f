-- AI Usage Tracking
-- Aggregates token usage and estimated costs per org per day
-- Enables cost monitoring, budget caps, and anomaly detection

-- ============================================================================
-- AI USAGE TRACKING TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_usage_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,

    -- Token usage
    input_tokens_total BIGINT DEFAULT 0,
    output_tokens_total BIGINT DEFAULT 0,
    cache_read_tokens_total BIGINT DEFAULT 0,

    -- Request counts by model
    sonnet_requests INTEGER DEFAULT 0,
    haiku_requests INTEGER DEFAULT 0,

    -- Estimated cost in cents (for monitoring, not billing)
    estimated_cost_cents INTEGER DEFAULT 0,

    -- Breakdown by function
    royal_ai_prompt_requests INTEGER DEFAULT 0,
    generate_article_requests INTEGER DEFAULT 0,
    owner_assistant_requests INTEGER DEFAULT 0,
    support_agent_requests INTEGER DEFAULT 0,
    autonomous_requests INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(organization_id, period_start)
);

-- Fast lookups by org + date
CREATE INDEX idx_ai_usage_org_period ON ai_usage_tracking(organization_id, period_start DESC);

-- ============================================================================
-- INCREMENT RPC
-- Atomically increments usage counters for an org on the current day
-- ============================================================================

CREATE OR REPLACE FUNCTION increment_ai_usage(
    p_org_id UUID,
    p_input_tokens INTEGER,
    p_output_tokens INTEGER,
    p_cache_read_tokens INTEGER DEFAULT 0,
    p_model TEXT DEFAULT 'sonnet',
    p_function_name TEXT DEFAULT 'royal_ai_prompt'
) RETURNS VOID AS $$
DECLARE
    v_cost_cents INTEGER;
    v_today DATE := CURRENT_DATE;
BEGIN
    -- Estimate cost in cents based on model
    -- Sonnet 4: $3/1M input, $15/1M output
    -- Haiku 4.5: $0.80/1M input, $4/1M output
    IF p_model = 'haiku' THEN
        v_cost_cents := GREATEST(1,
            (p_input_tokens * 0.00008 + p_output_tokens * 0.0004)::INTEGER
        );
    ELSE
        v_cost_cents := GREATEST(1,
            (p_input_tokens * 0.0003 + p_output_tokens * 0.0015)::INTEGER
        );
    END IF;

    INSERT INTO ai_usage_tracking (
        organization_id, period_start,
        input_tokens_total, output_tokens_total, cache_read_tokens_total,
        sonnet_requests, haiku_requests,
        estimated_cost_cents,
        royal_ai_prompt_requests, generate_article_requests,
        owner_assistant_requests, support_agent_requests, autonomous_requests
    ) VALUES (
        p_org_id, v_today,
        p_input_tokens, p_output_tokens, p_cache_read_tokens,
        CASE WHEN p_model = 'sonnet' THEN 1 ELSE 0 END,
        CASE WHEN p_model = 'haiku' THEN 1 ELSE 0 END,
        v_cost_cents,
        CASE WHEN p_function_name = 'royal_ai_prompt' THEN 1 ELSE 0 END,
        CASE WHEN p_function_name = 'generate_article' THEN 1 ELSE 0 END,
        CASE WHEN p_function_name = 'owner_assistant' THEN 1 ELSE 0 END,
        CASE WHEN p_function_name = 'support_agent' THEN 1 ELSE 0 END,
        CASE WHEN p_function_name = 'autonomous' THEN 1 ELSE 0 END
    )
    ON CONFLICT (organization_id, period_start) DO UPDATE SET
        input_tokens_total = ai_usage_tracking.input_tokens_total + EXCLUDED.input_tokens_total,
        output_tokens_total = ai_usage_tracking.output_tokens_total + EXCLUDED.output_tokens_total,
        cache_read_tokens_total = ai_usage_tracking.cache_read_tokens_total + EXCLUDED.cache_read_tokens_total,
        sonnet_requests = ai_usage_tracking.sonnet_requests + EXCLUDED.sonnet_requests,
        haiku_requests = ai_usage_tracking.haiku_requests + EXCLUDED.haiku_requests,
        estimated_cost_cents = ai_usage_tracking.estimated_cost_cents + EXCLUDED.estimated_cost_cents,
        royal_ai_prompt_requests = ai_usage_tracking.royal_ai_prompt_requests + EXCLUDED.royal_ai_prompt_requests,
        generate_article_requests = ai_usage_tracking.generate_article_requests + EXCLUDED.generate_article_requests,
        owner_assistant_requests = ai_usage_tracking.owner_assistant_requests + EXCLUDED.owner_assistant_requests,
        support_agent_requests = ai_usage_tracking.support_agent_requests + EXCLUDED.support_agent_requests,
        autonomous_requests = ai_usage_tracking.autonomous_requests + EXCLUDED.autonomous_requests,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

ALTER TABLE ai_usage_tracking ENABLE ROW LEVEL SECURITY;

-- Org members can view their own usage
CREATE POLICY "Org members can view AI usage" ON ai_usage_tracking
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = ai_usage_tracking.organization_id
            AND organization_members.user_id = auth.uid()
        )
    );

-- Only the system (service role) can insert/update via the RPC
-- No direct insert/update policies for regular users
