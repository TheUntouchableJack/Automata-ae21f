-- Phase 2: Customer Fatigue Tracking
-- Tracks communication frequency and calculates fatigue scores to prevent over-messaging

-- ============================================================================
-- 1. COMMUNICATION LOG - Track every message sent to a member
-- ============================================================================

CREATE TABLE IF NOT EXISTS member_communication_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES app_members(id) ON DELETE CASCADE,

    -- Message details
    channel TEXT NOT NULL CHECK (channel IN ('email', 'push', 'sms', 'in_app')),
    message_type TEXT,  -- 'automation', 'campaign', 'transactional'

    -- Source tracking
    source_automation_id UUID REFERENCES automation_definitions(id) ON DELETE SET NULL,
    source_batch_id UUID REFERENCES app_message_batches(id) ON DELETE SET NULL,

    -- Engagement (updated via webhook)
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    opened_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,
    unsubscribed_at TIMESTAMPTZ,

    -- For deduplication
    external_message_id TEXT
);

-- Indexes for fast fatigue calculations
CREATE INDEX idx_comm_log_member_sent ON member_communication_log(member_id, sent_at DESC);
CREATE INDEX idx_comm_log_org ON member_communication_log(organization_id);
CREATE INDEX idx_comm_log_automation ON member_communication_log(source_automation_id) WHERE source_automation_id IS NOT NULL;
CREATE INDEX idx_comm_log_sent_at ON member_communication_log(sent_at DESC);

-- ============================================================================
-- 2. FATIGUE SCORING FUNCTION
-- ============================================================================
-- Returns fatigue scores for members in an organization
-- Score 0-100: higher = more fatigued, should NOT send

CREATE OR REPLACE FUNCTION calculate_member_fatigue(
    p_organization_id UUID,
    p_member_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
    member_id UUID,
    comms_24h INTEGER,
    comms_7d INTEGER,
    comms_30d INTEGER,
    last_comm_at TIMESTAMPTZ,
    fatigue_score INTEGER,
    fatigue_level TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH member_stats AS (
        SELECT
            m.id as member_id,
            COUNT(*) FILTER (WHERE cl.sent_at > NOW() - INTERVAL '24 hours') as comms_24h,
            COUNT(*) FILTER (WHERE cl.sent_at > NOW() - INTERVAL '7 days') as comms_7d,
            COUNT(*) FILTER (WHERE cl.sent_at > NOW() - INTERVAL '30 days') as comms_30d,
            MAX(cl.sent_at) as last_comm_at
        FROM app_members m
        LEFT JOIN member_communication_log cl ON cl.member_id = m.id
        WHERE m.organization_id = p_organization_id
            AND (p_member_ids IS NULL OR m.id = ANY(p_member_ids))
        GROUP BY m.id
    )
    SELECT
        ms.member_id,
        COALESCE(ms.comms_24h, 0)::INTEGER,
        COALESCE(ms.comms_7d, 0)::INTEGER,
        COALESCE(ms.comms_30d, 0)::INTEGER,
        ms.last_comm_at,
        -- Fatigue score calculation (0-100)
        LEAST(100, CASE
            -- Critical: 3+ messages in 24h
            WHEN ms.comms_24h >= 3 THEN 90
            -- High: 2 messages in 24h or unsubscribe
            WHEN ms.comms_24h >= 2 THEN 70
            -- Medium-high: 7+ in a week
            WHEN ms.comms_7d >= 7 THEN 65
            -- Medium: 5-6 in a week
            WHEN ms.comms_7d >= 5 THEN 50
            -- Low: based on 7-day count
            ELSE (ms.comms_7d * 8)
        END)::INTEGER as fatigue_score,
        -- Human-readable level
        CASE
            WHEN ms.comms_24h >= 3 THEN 'critical'
            WHEN ms.comms_24h >= 2 OR ms.comms_7d >= 7 THEN 'high'
            WHEN ms.comms_7d >= 5 THEN 'medium'
            WHEN ms.comms_7d >= 2 THEN 'low'
            ELSE 'none'
        END as fatigue_level
    FROM member_stats ms;
END;
$$;

-- ============================================================================
-- 3. SEGMENT FATIGUE SUMMARY
-- ============================================================================
-- Returns aggregate fatigue stats for a segment (for AI decision making)

CREATE OR REPLACE FUNCTION get_segment_fatigue_summary(
    p_organization_id UUID,
    p_segment TEXT DEFAULT 'all',
    p_threshold INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result JSONB;
    v_total INTEGER;
    v_fatigued INTEGER;
    v_critical INTEGER;
    v_avg_score DECIMAL;
    v_recommendation TEXT;
BEGIN
    WITH fatigue_data AS (
        SELECT * FROM calculate_member_fatigue(p_organization_id, NULL)
    )
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE fatigue_score >= p_threshold),
        COUNT(*) FILTER (WHERE fatigue_score >= 80),
        ROUND(AVG(fatigue_score), 1)
    INTO v_total, v_fatigued, v_critical, v_avg_score
    FROM fatigue_data;

    -- Generate recommendation based on fatigue levels
    v_recommendation := CASE
        WHEN v_critical::DECIMAL / NULLIF(v_total, 0) > 0.1 THEN
            'PAUSE - Over 10% of audience is critically fatigued. Wait 48-72 hours.'
        WHEN v_fatigued::DECIMAL / NULLIF(v_total, 0) > 0.3 THEN
            'CAUTION - Over 30% of audience is fatigued. Consider waiting 24 hours or targeting unfatigued members only.'
        WHEN v_avg_score > 40 THEN
            'MODERATE - Audience is moderately messaged. Proceed with targeted, high-value content only.'
        ELSE
            'CLEAR - Audience is receptive. Safe to proceed with messaging.'
    END;

    v_result := jsonb_build_object(
        'total_members', v_total,
        'fatigued_count', v_fatigued,
        'fatigued_pct', ROUND((v_fatigued::DECIMAL / NULLIF(v_total, 0)) * 100, 1),
        'critical_count', v_critical,
        'healthy_count', v_total - v_fatigued,
        'average_fatigue_score', COALESCE(v_avg_score, 0),
        'threshold_used', p_threshold,
        'recommendation', v_recommendation,
        'status', CASE
            WHEN v_critical::DECIMAL / NULLIF(v_total, 0) > 0.1 THEN 'pause'
            WHEN v_fatigued::DECIMAL / NULLIF(v_total, 0) > 0.3 THEN 'caution'
            ELSE 'clear'
        END
    );

    RETURN v_result;
END;
$$;

-- ============================================================================
-- 4. CHECK MEMBER FATIGUE (for automation engine)
-- ============================================================================
-- Quick check before sending to a specific member

CREATE OR REPLACE FUNCTION should_skip_for_fatigue(
    p_member_id UUID,
    p_threshold INTEGER DEFAULT 70
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_org_id UUID;
    v_score INTEGER;
    v_level TEXT;
    v_should_skip BOOLEAN;
BEGIN
    -- Get org ID for member
    SELECT organization_id INTO v_org_id FROM app_members WHERE id = p_member_id;

    IF v_org_id IS NULL THEN
        RETURN jsonb_build_object('error', 'Member not found');
    END IF;

    -- Calculate fatigue
    SELECT fatigue_score, fatigue_level
    INTO v_score, v_level
    FROM calculate_member_fatigue(v_org_id, ARRAY[p_member_id]);

    v_should_skip := v_score >= p_threshold;

    RETURN jsonb_build_object(
        'member_id', p_member_id,
        'fatigue_score', COALESCE(v_score, 0),
        'fatigue_level', COALESCE(v_level, 'none'),
        'threshold', p_threshold,
        'should_skip', v_should_skip,
        'reason', CASE
            WHEN v_should_skip THEN 'Member fatigue score (' || v_score || ') exceeds threshold (' || p_threshold || ')'
            ELSE NULL
        END
    );
END;
$$;

-- ============================================================================
-- 5. LOG COMMUNICATION (called when sending)
-- ============================================================================

CREATE OR REPLACE FUNCTION log_member_communication(
    p_member_id UUID,
    p_channel TEXT,
    p_message_type TEXT DEFAULT 'automation',
    p_source_automation_id UUID DEFAULT NULL,
    p_source_batch_id UUID DEFAULT NULL,
    p_external_message_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_org_id UUID;
    v_log_id UUID;
BEGIN
    SELECT organization_id INTO v_org_id FROM app_members WHERE id = p_member_id;

    INSERT INTO member_communication_log (
        organization_id,
        member_id,
        channel,
        message_type,
        source_automation_id,
        source_batch_id,
        external_message_id
    ) VALUES (
        v_org_id,
        p_member_id,
        p_channel,
        p_message_type,
        p_source_automation_id,
        p_source_batch_id,
        p_external_message_id
    )
    RETURNING id INTO v_log_id;

    RETURN v_log_id;
END;
$$;

-- ============================================================================
-- 6. RLS POLICIES
-- ============================================================================

ALTER TABLE member_communication_log ENABLE ROW LEVEL SECURITY;

-- Org members can view their communication logs
CREATE POLICY "Org members can view communication logs"
    ON member_communication_log FOR SELECT
    USING (
        organization_id IN (
            SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
        )
    );

-- Service role full access
CREATE POLICY "Service role full access on communication_log"
    ON member_communication_log FOR ALL
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- 7. COMMENTS
-- ============================================================================

COMMENT ON TABLE member_communication_log IS 'Tracks all communications sent to members for fatigue scoring';
COMMENT ON FUNCTION calculate_member_fatigue IS 'Calculates fatigue scores (0-100) for members based on recent communication frequency';
COMMENT ON FUNCTION get_segment_fatigue_summary IS 'Returns aggregate fatigue stats for a segment with AI recommendation';
COMMENT ON FUNCTION should_skip_for_fatigue IS 'Quick check whether to skip sending to a member due to fatigue';
COMMENT ON FUNCTION log_member_communication IS 'Records a communication sent to a member for fatigue tracking';
