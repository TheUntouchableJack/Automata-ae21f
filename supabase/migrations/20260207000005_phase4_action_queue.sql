-- Migration: Phase 4 - AI Action Queue and Write Tools
-- Enables AI to propose and execute actions with confidence gating

-- ============================================================================
-- 1. AI ACTION QUEUE
-- Pending/approved/executed actions with outcomes
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_action_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- What action to take
    action_type TEXT NOT NULL,  -- 'create_announcement', 'send_message', 'create_promotion', etc.
    action_payload JSONB NOT NULL,  -- Parameters for the action

    -- AI reasoning
    reasoning TEXT NOT NULL,  -- Why the AI wants to do this
    confidence DECIMAL(3,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),  -- 0.0-1.0

    -- Lifecycle
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'executing', 'executed', 'rejected', 'failed', 'expired')),
    scheduled_for TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 seconds',
    expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours',

    -- Execution
    approved_by UUID REFERENCES profiles(id),
    approved_at TIMESTAMPTZ,
    executed_at TIMESTAMPTZ,
    execution_result JSONB,
    error_message TEXT,

    -- Outcome measurement (populated 24h later)
    measured_at TIMESTAMPTZ,
    measured_outcome JSONB,  -- {opens, clicks, conversions, etc.}
    success_score DECIMAL(3,2),  -- 0.0-1.0 based on outcome

    -- Context
    thread_id UUID REFERENCES ai_threads(id),
    prompt_id UUID REFERENCES ai_prompts(id),

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_action_queue_org_status ON ai_action_queue(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_action_queue_pending ON ai_action_queue(status, scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_action_queue_measure ON ai_action_queue(status, executed_at) WHERE status = 'executed' AND measured_at IS NULL;

-- ============================================================================
-- 2. AI RATE LIMITS
-- Per-action-type rate limiting
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_rate_limits (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    count INTEGER DEFAULT 1,
    max_allowed INTEGER NOT NULL,
    PRIMARY KEY (organization_id, action_type, window_start)
);

-- Index for cleanup
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON ai_rate_limits(window_start);

-- ============================================================================
-- 3. AI AUDIT LOG
-- Complete action history for compliance
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(id),

    -- What happened
    action_category TEXT NOT NULL,  -- 'tool_use', 'knowledge', 'research', 'autonomous', 'queue'
    action_type TEXT NOT NULL,      -- 'read_customers', 'create_announcement', etc.
    action_input JSONB,             -- Sanitized input parameters
    action_result JSONB,            -- Result summary (not full data)

    -- Outcome
    status TEXT NOT NULL CHECK (status IN ('success', 'failure', 'rate_limited', 'rejected', 'timeout')),
    error_message TEXT,
    duration_ms INTEGER,

    -- Context
    thread_id UUID REFERENCES ai_threads(id),
    prompt_id UUID REFERENCES ai_prompts(id),
    action_queue_id UUID REFERENCES ai_action_queue(id),
    confidence_score DECIMAL(3,2),
    auto_executed BOOLEAN DEFAULT FALSE,

    -- Compliance
    pii_detected BOOLEAN DEFAULT FALSE,
    data_accessed TEXT[],           -- List of tables/resources accessed

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for audit queries
CREATE INDEX IF NOT EXISTS idx_audit_org ON ai_audit_log(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON ai_audit_log(action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_category ON ai_audit_log(action_category, created_at DESC);

-- ============================================================================
-- 4. CONFIDENCE THRESHOLDS
-- Per-organization settings for autonomous execution
-- ============================================================================

-- Add to organizations if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'organizations'
                   AND column_name = 'ai_confidence_threshold') THEN
        ALTER TABLE organizations ADD COLUMN ai_confidence_threshold DECIMAL(3,2) DEFAULT 0.70;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'organizations'
                   AND column_name = 'ai_daily_action_limit') THEN
        ALTER TABLE organizations ADD COLUMN ai_daily_action_limit INTEGER DEFAULT 20;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'organizations'
                   AND column_name = 'ai_auto_execute_enabled') THEN
        ALTER TABLE organizations ADD COLUMN ai_auto_execute_enabled BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- ============================================================================
-- 5. RATE LIMIT CHECK FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION check_ai_rate_limit(
    p_org_id UUID,
    p_action_type TEXT,
    p_window_minutes INTEGER DEFAULT 60,
    p_max_allowed INTEGER DEFAULT 10
) RETURNS JSONB AS $$
DECLARE
    v_window_start TIMESTAMPTZ;
    v_current_count INTEGER;
    v_is_allowed BOOLEAN;
BEGIN
    -- Calculate window start (round down to nearest window)
    v_window_start := date_trunc('hour', NOW()) +
                      INTERVAL '1 minute' * (EXTRACT(minute FROM NOW())::INTEGER / p_window_minutes * p_window_minutes);

    -- Get or create rate limit entry
    INSERT INTO ai_rate_limits (organization_id, action_type, window_start, count, max_allowed)
    VALUES (p_org_id, p_action_type, v_window_start, 1, p_max_allowed)
    ON CONFLICT (organization_id, action_type, window_start)
    DO UPDATE SET count = ai_rate_limits.count + 1
    RETURNING count INTO v_current_count;

    v_is_allowed := v_current_count <= p_max_allowed;

    RETURN jsonb_build_object(
        'allowed', v_is_allowed,
        'current_count', v_current_count,
        'max_allowed', p_max_allowed,
        'window_start', v_window_start,
        'resets_at', v_window_start + (p_window_minutes || ' minutes')::INTERVAL
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 6. QUEUE ACTION FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION queue_ai_action(
    p_org_id UUID,
    p_action_type TEXT,
    p_action_payload JSONB,
    p_reasoning TEXT,
    p_confidence DECIMAL(3,2),
    p_thread_id UUID DEFAULT NULL,
    p_prompt_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_threshold DECIMAL(3,2);
    v_auto_enabled BOOLEAN;
    v_action_id UUID;
    v_status TEXT;
    v_rate_check JSONB;
BEGIN
    -- Get org settings
    SELECT
        COALESCE(ai_confidence_threshold, 0.70),
        COALESCE(ai_auto_execute_enabled, FALSE)
    INTO v_threshold, v_auto_enabled
    FROM organizations
    WHERE id = p_org_id;

    -- Check rate limit
    v_rate_check := check_ai_rate_limit(p_org_id, p_action_type);
    IF NOT (v_rate_check->>'allowed')::boolean THEN
        RETURN jsonb_build_object(
            'success', FALSE,
            'error', 'rate_limited',
            'details', v_rate_check
        );
    END IF;

    -- Determine initial status
    IF v_auto_enabled AND p_confidence >= v_threshold THEN
        v_status := 'approved';  -- Will be auto-executed
    ELSE
        v_status := 'pending';   -- Needs approval
    END IF;

    -- Insert action
    INSERT INTO ai_action_queue (
        organization_id,
        action_type,
        action_payload,
        reasoning,
        confidence,
        status,
        thread_id,
        prompt_id,
        scheduled_for
    ) VALUES (
        p_org_id,
        p_action_type,
        p_action_payload,
        p_reasoning,
        p_confidence,
        v_status,
        p_thread_id,
        p_prompt_id,
        CASE WHEN v_status = 'approved' THEN NOW() + INTERVAL '30 seconds' ELSE NULL END
    )
    RETURNING id INTO v_action_id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'action_id', v_action_id,
        'status', v_status,
        'auto_approved', v_status = 'approved',
        'confidence', p_confidence,
        'threshold', v_threshold
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 7. APPROVE/REJECT ACTION FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION update_ai_action_status(
    p_action_id UUID,
    p_new_status TEXT,
    p_user_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_current_status TEXT;
    v_org_id UUID;
BEGIN
    -- Get current status
    SELECT status, organization_id INTO v_current_status, v_org_id
    FROM ai_action_queue
    WHERE id = p_action_id;

    IF v_current_status IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Action not found');
    END IF;

    -- Validate transition
    IF v_current_status NOT IN ('pending', 'approved') THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Cannot modify action in status: ' || v_current_status);
    END IF;

    IF p_new_status NOT IN ('approved', 'rejected') THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Invalid status. Must be approved or rejected');
    END IF;

    -- Update
    UPDATE ai_action_queue
    SET
        status = p_new_status,
        approved_by = CASE WHEN p_new_status = 'approved' THEN p_user_id END,
        approved_at = CASE WHEN p_new_status = 'approved' THEN NOW() END,
        scheduled_for = CASE WHEN p_new_status = 'approved' THEN NOW() + INTERVAL '5 seconds' END,
        updated_at = NOW()
    WHERE id = p_action_id;

    -- Audit log
    INSERT INTO ai_audit_log (
        organization_id,
        user_id,
        action_category,
        action_type,
        action_input,
        status,
        action_queue_id
    ) VALUES (
        v_org_id,
        p_user_id,
        'queue',
        CASE WHEN p_new_status = 'approved' THEN 'approve_action' ELSE 'reject_action' END,
        jsonb_build_object('action_id', p_action_id),
        'success',
        p_action_id
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'action_id', p_action_id,
        'new_status', p_new_status
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 8. GET PENDING ACTIONS FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION get_pending_ai_actions(
    p_org_id UUID,
    p_limit INTEGER DEFAULT 10
) RETURNS JSONB AS $$
BEGIN
    RETURN (
        SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'id', a.id,
                'action_type', a.action_type,
                'action_payload', a.action_payload,
                'reasoning', a.reasoning,
                'confidence', a.confidence,
                'status', a.status,
                'scheduled_for', a.scheduled_for,
                'expires_at', a.expires_at,
                'created_at', a.created_at
            ) ORDER BY a.created_at DESC
        ), '[]'::jsonb)
        FROM ai_action_queue a
        WHERE a.organization_id = p_org_id
        AND a.status IN ('pending', 'approved')
        AND (a.expires_at IS NULL OR a.expires_at > NOW())
        LIMIT p_limit
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 9. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE ai_action_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_audit_log ENABLE ROW LEVEL SECURITY;

-- Action queue policies
CREATE POLICY "Users can view their org's actions" ON ai_action_queue
    FOR SELECT USING (organization_id IN (
        SELECT organization_id FROM organization_members
        WHERE user_id = auth.uid()
    ));

CREATE POLICY "Users can update their org's pending actions" ON ai_action_queue
    FOR UPDATE USING (organization_id IN (
        SELECT organization_id FROM organization_members
        WHERE user_id = auth.uid()
    ));

-- Audit log policies (read-only for users)
CREATE POLICY "Users can view their org's audit logs" ON ai_audit_log
    FOR SELECT USING (organization_id IN (
        SELECT organization_id FROM organization_members
        WHERE user_id = auth.uid()
    ));

-- Rate limits visible to org members
CREATE POLICY "Users can view their org's rate limits" ON ai_rate_limits
    FOR SELECT USING (organization_id IN (
        SELECT organization_id FROM organization_members
        WHERE user_id = auth.uid()
    ));

-- ============================================================================
-- 10. COMMENTS
-- ============================================================================

COMMENT ON TABLE ai_action_queue IS 'Queue of AI-proposed actions pending approval or execution';
COMMENT ON TABLE ai_rate_limits IS 'Per-action-type rate limiting by organization';
COMMENT ON TABLE ai_audit_log IS 'Complete audit trail of all AI actions for compliance';
COMMENT ON FUNCTION check_ai_rate_limit IS 'Check and increment rate limit for an action type';
COMMENT ON FUNCTION queue_ai_action IS 'Queue an AI action with confidence-based auto-approval';
COMMENT ON FUNCTION update_ai_action_status IS 'Approve or reject a pending AI action';
COMMENT ON FUNCTION get_pending_ai_actions IS 'Get pending actions for an organization';
