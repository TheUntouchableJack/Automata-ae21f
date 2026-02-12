-- Fix fatigue functions that reference non-existent app_members.organization_id
-- app_members has app_id -> customer_apps.id -> customer_apps.organization_id
-- These functions are dormant (production uses batch_check_fatigue from mv_member_fatigue)
-- but fixing them prevents errors if called directly.

-- ============================================================================
-- 1. FIX calculate_member_fatigue()
-- Bug: WHERE m.organization_id = p_organization_id (column doesn't exist)
-- Fix: JOIN customer_apps ca ON ca.id = m.app_id, use ca.organization_id
-- ============================================================================

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
        JOIN customer_apps ca ON ca.id = m.app_id
        LEFT JOIN member_communication_log cl ON cl.member_id = m.id
        WHERE ca.organization_id = p_organization_id
            AND (p_member_ids IS NULL OR m.id = ANY(p_member_ids))
        GROUP BY m.id
    )
    SELECT
        ms.member_id,
        COALESCE(ms.comms_24h, 0)::INTEGER,
        COALESCE(ms.comms_7d, 0)::INTEGER,
        COALESCE(ms.comms_30d, 0)::INTEGER,
        ms.last_comm_at,
        LEAST(100, CASE
            WHEN ms.comms_24h >= 3 THEN 90
            WHEN ms.comms_24h >= 2 THEN 70
            WHEN ms.comms_7d >= 7 THEN 65
            WHEN ms.comms_7d >= 5 THEN 50
            ELSE (ms.comms_7d * 8)
        END)::INTEGER as fatigue_score,
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
-- 2. FIX should_skip_for_fatigue()
-- Bug: SELECT organization_id INTO v_org_id FROM app_members (column doesn't exist)
-- Fix: JOIN through customer_apps
-- ============================================================================

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
    SELECT ca.organization_id INTO v_org_id
    FROM app_members m
    JOIN customer_apps ca ON ca.id = m.app_id
    WHERE m.id = p_member_id;

    IF v_org_id IS NULL THEN
        RETURN jsonb_build_object('error', 'Member not found');
    END IF;

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
-- 3. FIX log_member_communication()
-- Bug: SELECT organization_id INTO v_org_id FROM app_members (column doesn't exist)
-- Fix: JOIN through customer_apps
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
    SELECT ca.organization_id INTO v_org_id
    FROM app_members m
    JOIN customer_apps ca ON ca.id = m.app_id
    WHERE m.id = p_member_id;

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
