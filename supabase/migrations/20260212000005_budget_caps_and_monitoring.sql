-- Budget Caps & Monitoring Views (Phase 3)
-- System-wide safety cap prevents any org from running up unbounded AI costs
-- Monitoring views provide operator visibility into cost anomalies

-- ============================================================================
-- 1. BUDGET ALERTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS budget_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL CHECK (alert_type IN ('ai_cost', 'sms_cost', 'email_volume')),
    threshold_cents INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    is_exceeded BOOLEAN DEFAULT FALSE,
    last_triggered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, alert_type)
);

CREATE INDEX idx_budget_alerts_active ON budget_alerts(is_active, is_exceeded);

-- System-wide default: $50/org/month AI cap (5000 cents)
-- Applied when org has no custom alert configured

-- ============================================================================
-- 2. CHECK BUDGET FUNCTION
-- Called by AI edge functions before making API calls
-- Returns whether org is within budget
-- ============================================================================

CREATE OR REPLACE FUNCTION check_ai_budget(
    p_org_id UUID,
    p_default_cap_cents INTEGER DEFAULT 5000  -- $50 default
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_cost INTEGER;
    v_cap INTEGER;
    v_custom_alert RECORD;
BEGIN
    -- Check for custom alert threshold
    SELECT threshold_cents, is_exceeded INTO v_custom_alert
    FROM budget_alerts
    WHERE organization_id = p_org_id
    AND alert_type = 'ai_cost'
    AND is_active = TRUE;

    -- Use custom threshold or system default
    v_cap := COALESCE(v_custom_alert.threshold_cents, p_default_cap_cents);

    -- Get current month's AI cost
    SELECT COALESCE(SUM(estimated_cost_cents), 0) INTO v_current_cost
    FROM ai_usage_tracking
    WHERE organization_id = p_org_id
    AND period_start >= DATE_TRUNC('month', CURRENT_DATE);

    -- Check if exceeded
    IF v_current_cost >= v_cap THEN
        -- Mark as exceeded if custom alert exists
        IF v_custom_alert.threshold_cents IS NOT NULL THEN
            UPDATE budget_alerts
            SET is_exceeded = TRUE, last_triggered_at = NOW()
            WHERE organization_id = p_org_id AND alert_type = 'ai_cost';
        END IF;

        RETURN jsonb_build_object(
            'within_budget', FALSE,
            'current_cost_cents', v_current_cost,
            'cap_cents', v_cap,
            'remaining_cents', 0,
            'usage_percent', LEAST(100, (v_current_cost * 100 / NULLIF(v_cap, 0)))
        );
    END IF;

    RETURN jsonb_build_object(
        'within_budget', TRUE,
        'current_cost_cents', v_current_cost,
        'cap_cents', v_cap,
        'remaining_cents', v_cap - v_current_cost,
        'usage_percent', (v_current_cost * 100 / NULLIF(v_cap, 0))
    );
END;
$$;

-- ============================================================================
-- 3. MONITORING VIEWS
-- ============================================================================

-- Cost summary by org (for operator dashboard)
CREATE OR REPLACE VIEW v_ai_cost_summary AS
SELECT
    o.id as organization_id,
    o.name as org_name,
    o.plan_type,
    o.subscription_tier,
    a.period_start,
    a.sonnet_requests,
    a.haiku_requests,
    a.sonnet_requests + a.haiku_requests as total_requests,
    a.input_tokens_total,
    a.output_tokens_total,
    a.estimated_cost_cents,
    ROUND(a.estimated_cost_cents / 100.0, 2) as estimated_cost_usd,
    a.royal_ai_prompt_requests,
    a.generate_article_requests,
    a.owner_assistant_requests,
    a.support_agent_requests,
    a.autonomous_requests
FROM ai_usage_tracking a
JOIN organizations o ON o.id = a.organization_id
ORDER BY a.estimated_cost_cents DESC;

-- Anomaly detection: orgs spending 3x their 30-day average
CREATE OR REPLACE VIEW v_ai_cost_anomalies AS
WITH org_avg AS (
    SELECT
        organization_id,
        AVG(estimated_cost_cents) as avg_daily_cost,
        COUNT(*) as days_tracked
    FROM ai_usage_tracking
    WHERE period_start >= CURRENT_DATE - 30
    GROUP BY organization_id
    HAVING COUNT(*) >= 3  -- Need at least 3 days of data
)
SELECT
    a.organization_id,
    o.name as org_name,
    a.period_start,
    a.estimated_cost_cents as today_cost_cents,
    ROUND(oa.avg_daily_cost) as avg_daily_cost_cents,
    ROUND(a.estimated_cost_cents / NULLIF(oa.avg_daily_cost, 0), 1) as cost_multiplier,
    a.sonnet_requests + a.haiku_requests as total_requests,
    oa.days_tracked
FROM ai_usage_tracking a
JOIN org_avg oa ON oa.organization_id = a.organization_id
JOIN organizations o ON o.id = a.organization_id
WHERE a.period_start = CURRENT_DATE
AND a.estimated_cost_cents > oa.avg_daily_cost * 3
ORDER BY cost_multiplier DESC;

-- Top consumers this month
CREATE OR REPLACE VIEW v_ai_top_consumers AS
SELECT
    a.organization_id,
    o.name as org_name,
    o.subscription_tier,
    SUM(a.estimated_cost_cents) as month_cost_cents,
    ROUND(SUM(a.estimated_cost_cents) / 100.0, 2) as month_cost_usd,
    SUM(a.sonnet_requests) as total_sonnet,
    SUM(a.haiku_requests) as total_haiku,
    SUM(a.input_tokens_total) as total_input_tokens,
    SUM(a.output_tokens_total) as total_output_tokens
FROM ai_usage_tracking a
JOIN organizations o ON o.id = a.organization_id
WHERE a.period_start >= DATE_TRUNC('month', CURRENT_DATE)
GROUP BY a.organization_id, o.name, o.subscription_tier
ORDER BY month_cost_cents DESC
LIMIT 50;

-- ============================================================================
-- 4. RLS
-- ============================================================================

ALTER TABLE budget_alerts ENABLE ROW LEVEL SECURITY;

-- Org owners/admins can view and manage their budget alerts
CREATE POLICY "Org admins can manage budget alerts" ON budget_alerts
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = budget_alerts.organization_id
            AND organization_members.user_id = auth.uid()
            AND organization_members.role IN ('owner', 'admin')
        )
    );

-- ============================================================================
-- 5. HOURLY BUDGET CHECK CRON
-- Marks alerts as exceeded when thresholds are crossed
-- ============================================================================

SELECT cron.schedule(
    'check-budget-alerts',
    '0 * * * *',
    $$
    UPDATE budget_alerts ba
    SET is_exceeded = TRUE, last_triggered_at = NOW()
    FROM (
        SELECT organization_id, SUM(estimated_cost_cents) as month_cost
        FROM ai_usage_tracking
        WHERE period_start >= DATE_TRUNC('month', CURRENT_DATE)
        GROUP BY organization_id
    ) usage
    WHERE ba.organization_id = usage.organization_id
    AND ba.alert_type = 'ai_cost'
    AND ba.is_active = TRUE
    AND ba.is_exceeded = FALSE
    AND usage.month_cost >= ba.threshold_cents
    $$
);

-- Reset exceeded flags at start of each month
SELECT cron.schedule(
    'reset-budget-alerts-monthly',
    '0 0 1 * *',
    $$UPDATE budget_alerts SET is_exceeded = FALSE WHERE is_exceeded = TRUE$$
);
