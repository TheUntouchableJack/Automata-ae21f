-- Phase 1: Automation Performance Metrics
-- Adds views and functions to calculate automation performance from message batches

-- ============================================================================
-- 1. PERFORMANCE FUNCTION - Calculate metrics for automations
-- ============================================================================

CREATE OR REPLACE FUNCTION get_automation_performance(
    p_organization_id UUID,
    p_app_id UUID DEFAULT NULL,
    p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
    automation_id UUID,
    name TEXT,
    category TEXT,
    is_enabled BOOLEAN,
    trigger_count INTEGER,
    success_count INTEGER,
    failure_count INTEGER,
    success_rate_pct DECIMAL(5,1),
    -- Message metrics from batches
    total_sent INTEGER,
    total_delivered INTEGER,
    total_opened INTEGER,
    total_clicked INTEGER,
    total_bounced INTEGER,
    open_rate_pct DECIMAL(5,1),
    click_rate_pct DECIMAL(5,1),
    bounce_rate_pct DECIMAL(5,1),
    -- Recent activity
    last_triggered_at TIMESTAMPTZ,
    batches_in_period INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        ad.id as automation_id,
        ad.name,
        ad.category,
        ad.is_enabled,
        ad.trigger_count,
        ad.success_count,
        ad.failure_count,
        CASE
            WHEN ad.trigger_count > 0
            THEN ROUND((ad.success_count::DECIMAL / ad.trigger_count) * 100, 1)
            ELSE 0
        END as success_rate_pct,
        -- Aggregate from message batches
        COALESCE(batch_stats.total_sent, 0)::INTEGER as total_sent,
        COALESCE(batch_stats.total_delivered, 0)::INTEGER as total_delivered,
        COALESCE(batch_stats.total_opened, 0)::INTEGER as total_opened,
        COALESCE(batch_stats.total_clicked, 0)::INTEGER as total_clicked,
        COALESCE(batch_stats.total_bounced, 0)::INTEGER as total_bounced,
        -- Calculate rates
        CASE
            WHEN COALESCE(batch_stats.total_delivered, 0) > 0
            THEN ROUND((batch_stats.total_opened::DECIMAL / batch_stats.total_delivered) * 100, 1)
            ELSE 0
        END as open_rate_pct,
        CASE
            WHEN COALESCE(batch_stats.total_opened, 0) > 0
            THEN ROUND((batch_stats.total_clicked::DECIMAL / batch_stats.total_opened) * 100, 1)
            ELSE 0
        END as click_rate_pct,
        CASE
            WHEN COALESCE(batch_stats.total_sent, 0) > 0
            THEN ROUND((batch_stats.total_bounced::DECIMAL / batch_stats.total_sent) * 100, 1)
            ELSE 0
        END as bounce_rate_pct,
        ad.last_triggered_at,
        COALESCE(batch_stats.batch_count, 0)::INTEGER as batches_in_period
    FROM automation_definitions ad
    LEFT JOIN LATERAL (
        SELECT
            SUM(mb.total_recipients) as total_sent,
            SUM(mb.delivered) as total_delivered,
            SUM(mb.opened) as total_opened,
            SUM(mb.clicked) as total_clicked,
            SUM(mb.bounced) as total_bounced,
            COUNT(*) as batch_count
        FROM app_message_batches mb
        WHERE mb.automation_id = ad.id
            AND mb.sent_at > NOW() - (p_days || ' days')::INTERVAL
            AND mb.status IN ('sent', 'partially_sent')
    ) batch_stats ON TRUE
    WHERE ad.organization_id = p_organization_id
        AND ad.is_archived = FALSE
        AND (p_app_id IS NULL OR ad.app_id = p_app_id)
    ORDER BY ad.is_enabled DESC, batch_stats.total_sent DESC NULLS LAST;
END;
$$;

-- ============================================================================
-- 2. TOP/BOTTOM PERFORMERS FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION get_automation_rankings(
    p_organization_id UUID,
    p_days INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_top_performer JSONB;
    v_underperformer JSONB;
    v_avg_open_rate DECIMAL;
BEGIN
    -- Get average open rate across all automations
    SELECT AVG(perf.open_rate_pct) INTO v_avg_open_rate
    FROM get_automation_performance(p_organization_id, NULL, p_days) perf
    WHERE perf.total_sent > 0;

    -- Get top performer (highest open rate with minimum 10 sends)
    SELECT jsonb_build_object(
        'automation_id', perf.automation_id,
        'name', perf.name,
        'open_rate_pct', perf.open_rate_pct,
        'total_sent', perf.total_sent
    ) INTO v_top_performer
    FROM get_automation_performance(p_organization_id, NULL, p_days) perf
    WHERE perf.total_sent >= 10
    ORDER BY perf.open_rate_pct DESC
    LIMIT 1;

    -- Get underperformer (lowest open rate with minimum 10 sends)
    SELECT jsonb_build_object(
        'automation_id', perf.automation_id,
        'name', perf.name,
        'open_rate_pct', perf.open_rate_pct,
        'total_sent', perf.total_sent,
        'issue', CASE
            WHEN perf.bounce_rate_pct > 10 THEN 'high_bounce_rate'
            WHEN perf.open_rate_pct < 10 THEN 'very_low_opens'
            ELSE 'below_average'
        END
    ) INTO v_underperformer
    FROM get_automation_performance(p_organization_id, NULL, p_days) perf
    WHERE perf.total_sent >= 10
        AND perf.open_rate_pct < COALESCE(v_avg_open_rate, 20)
    ORDER BY perf.open_rate_pct ASC
    LIMIT 1;

    RETURN jsonb_build_object(
        'avg_open_rate_pct', COALESCE(v_avg_open_rate, 0),
        'top_performer', v_top_performer,
        'underperformer', v_underperformer
    );
END;
$$;

-- ============================================================================
-- 3. COMMENTS
-- ============================================================================

COMMENT ON FUNCTION get_automation_performance IS 'Returns performance metrics for all automations in an organization, including message open/click rates from the past N days';
COMMENT ON FUNCTION get_automation_rankings IS 'Returns top and bottom performing automations for an organization';
