-- Materialized Fatigue View
-- Pre-computes fatigue scores for all members, refreshed every 15 minutes
-- Replaces per-member RPC calls in message-sender with a single batch query

-- ============================================================================
-- MATERIALIZED VIEW
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_member_fatigue AS
SELECT
    m.id as member_id,
    ca.organization_id,
    COUNT(*) FILTER (WHERE cl.sent_at > NOW() - INTERVAL '24 hours') as comms_24h,
    COUNT(*) FILTER (WHERE cl.sent_at > NOW() - INTERVAL '7 days') as comms_7d,
    COUNT(*) FILTER (WHERE cl.sent_at > NOW() - INTERVAL '30 days') as comms_30d,
    MAX(cl.sent_at) as last_comm_at,
    -- Same scoring logic as calculate_member_fatigue()
    LEAST(100, CASE
        WHEN COUNT(*) FILTER (WHERE cl.sent_at > NOW() - INTERVAL '24 hours') >= 3 THEN 90
        WHEN COUNT(*) FILTER (WHERE cl.sent_at > NOW() - INTERVAL '24 hours') >= 2 THEN 70
        WHEN COUNT(*) FILTER (WHERE cl.sent_at > NOW() - INTERVAL '7 days') >= 7 THEN 65
        WHEN COUNT(*) FILTER (WHERE cl.sent_at > NOW() - INTERVAL '7 days') >= 5 THEN 50
        ELSE (COUNT(*) FILTER (WHERE cl.sent_at > NOW() - INTERVAL '7 days') * 8)
    END)::INTEGER as fatigue_score,
    CASE
        WHEN COUNT(*) FILTER (WHERE cl.sent_at > NOW() - INTERVAL '24 hours') >= 3 THEN 'critical'
        WHEN COUNT(*) FILTER (WHERE cl.sent_at > NOW() - INTERVAL '24 hours') >= 2
            OR COUNT(*) FILTER (WHERE cl.sent_at > NOW() - INTERVAL '7 days') >= 7 THEN 'high'
        WHEN COUNT(*) FILTER (WHERE cl.sent_at > NOW() - INTERVAL '7 days') >= 5 THEN 'medium'
        WHEN COUNT(*) FILTER (WHERE cl.sent_at > NOW() - INTERVAL '7 days') >= 2 THEN 'low'
        ELSE 'none'
    END as fatigue_level
FROM app_members m
JOIN customer_apps ca ON ca.id = m.app_id
LEFT JOIN member_communication_log cl ON cl.member_id = m.id
WHERE m.deleted_at IS NULL
GROUP BY m.id, ca.organization_id;

-- Unique index required for CONCURRENTLY refresh
CREATE UNIQUE INDEX idx_mv_fatigue_member ON mv_member_fatigue(member_id);
CREATE INDEX idx_mv_fatigue_org ON mv_member_fatigue(organization_id);
CREATE INDEX idx_mv_fatigue_score ON mv_member_fatigue(fatigue_score) WHERE fatigue_score >= 50;

-- ============================================================================
-- BATCH FATIGUE CHECK FUNCTION
-- Returns fatigue data for a set of member IDs in a single query
-- Used by message-sender instead of per-member should_skip_for_fatigue()
-- ============================================================================

CREATE OR REPLACE FUNCTION batch_check_fatigue(
    p_member_ids UUID[],
    p_threshold INTEGER DEFAULT 70
)
RETURNS TABLE (
    member_id UUID,
    fatigue_score INTEGER,
    fatigue_level TEXT,
    should_skip BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        mf.member_id,
        COALESCE(mf.fatigue_score, 0)::INTEGER,
        COALESCE(mf.fatigue_level, 'none')::TEXT,
        (COALESCE(mf.fatigue_score, 0) >= p_threshold) as should_skip
    FROM unnest(p_member_ids) AS input_id
    LEFT JOIN mv_member_fatigue mf ON mf.member_id = input_id;
END;
$$;

-- ============================================================================
-- CRON JOB: Refresh materialized view every 15 minutes
-- ============================================================================

SELECT cron.schedule(
    'refresh-fatigue-view',
    '*/15 * * * *',
    $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_member_fatigue$$
);

-- Initial refresh
REFRESH MATERIALIZED VIEW mv_member_fatigue;
