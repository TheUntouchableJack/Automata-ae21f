-- Self-Tuning Infrastructure
-- Adds auto-pause, weekly digest, and recovery capabilities for automations

-- ============================================================================
-- 1. NEW COLUMNS ON automation_definitions
-- ============================================================================

ALTER TABLE automation_definitions ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
ALTER TABLE automation_definitions ADD COLUMN IF NOT EXISTS pause_reason TEXT;
ALTER TABLE automation_definitions ADD COLUMN IF NOT EXISTS recovery_attempts INTEGER DEFAULT 0;
ALTER TABLE automation_definitions ADD COLUMN IF NOT EXISTS last_recovery_at TIMESTAMPTZ;
ALTER TABLE automation_definitions ADD COLUMN IF NOT EXISTS original_frequency_days INTEGER;

-- Index for finding paused automations ready for recovery
CREATE INDEX IF NOT EXISTS idx_automation_defs_paused
    ON automation_definitions(paused_at)
    WHERE paused_at IS NOT NULL;

-- ============================================================================
-- 2. PAUSE EVENTS TABLE - Audit trail for pause/resume actions
-- ============================================================================

CREATE TABLE IF NOT EXISTS automation_pause_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    automation_id UUID NOT NULL REFERENCES automation_definitions(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Event type
    event_type TEXT NOT NULL CHECK (event_type IN ('auto_pause', 'manual_pause', 'auto_resume', 'manual_resume', 'recovery_suggested')),

    -- Pause reason (for pauses)
    reason TEXT,
    metrics_snapshot JSONB,  -- {bounce_rate_pct, open_rate_pct, click_rate_pct, total_sent}

    -- Recovery tracking (for resumes)
    recovery_config JSONB,  -- {original_frequency_days, suggested_frequency_days, frequency_reduction_pct}
    days_paused INTEGER,

    -- Who/what triggered
    triggered_by TEXT CHECK (triggered_by IN ('cron', 'ai', 'user')),
    user_id UUID,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pause_events_automation ON automation_pause_events(automation_id, created_at DESC);
CREATE INDEX idx_pause_events_org ON automation_pause_events(organization_id, event_type);

-- RLS
ALTER TABLE automation_pause_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their org pause events" ON automation_pause_events
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Service role full access to pause_events" ON automation_pause_events
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- ============================================================================
-- 3. WEEKLY DIGEST SNAPSHOTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS weekly_digest_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Period
    week_start DATE NOT NULL,
    week_end DATE NOT NULL,

    -- Aggregate metrics
    total_automations INTEGER DEFAULT 0,
    active_automations INTEGER DEFAULT 0,
    paused_automations INTEGER DEFAULT 0,

    -- Performance summary
    total_messages_sent INTEGER DEFAULT 0,
    total_delivered INTEGER DEFAULT 0,
    total_opened INTEGER DEFAULT 0,
    total_clicked INTEGER DEFAULT 0,
    total_bounced INTEGER DEFAULT 0,
    avg_open_rate DECIMAL(5,2),
    avg_click_rate DECIMAL(5,2),
    avg_bounce_rate DECIMAL(5,2),

    -- Top/bottom performers (JSONB arrays)
    top_performers JSONB DEFAULT '[]',  -- [{automation_id, name, open_rate_pct, total_sent}]
    underperformers JSONB DEFAULT '[]',  -- [{automation_id, name, open_rate_pct, issue}]
    newly_paused JSONB DEFAULT '[]',  -- [{automation_id, name, reason, paused_at}]
    recovery_candidates JSONB DEFAULT '[]',  -- [{automation_id, name, days_paused}]

    -- Visit correlation
    attributed_visits INTEGER DEFAULT 0,
    visit_rate DECIMAL(5,2),

    -- Digest delivery tracking
    digest_sent_at TIMESTAMPTZ,
    digest_channel TEXT CHECK (digest_channel IN ('email', 'in_app', 'both')),

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(organization_id, week_start)
);

CREATE INDEX idx_digest_snapshots_org ON weekly_digest_snapshots(organization_id, week_start DESC);

-- RLS
ALTER TABLE weekly_digest_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their org digest snapshots" ON weekly_digest_snapshots
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Service role full access to digest_snapshots" ON weekly_digest_snapshots
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- ============================================================================
-- 4. CHECK AND PAUSE BOUNCY AUTOMATIONS FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION check_and_pause_bouncy_automations(
    p_bounce_threshold DECIMAL DEFAULT 15.0,
    p_min_sends INTEGER DEFAULT 20,
    p_days INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_automation RECORD;
    v_paused_count INTEGER := 0;
    v_paused_ids UUID[] := '{}';
BEGIN
    -- Find automations that exceed bounce threshold
    FOR v_automation IN
        SELECT
            perf.automation_id,
            perf.name,
            ad.organization_id,
            perf.bounce_rate_pct,
            perf.open_rate_pct,
            perf.click_rate_pct,
            perf.total_sent
        FROM get_automation_performance(NULL, NULL, p_days) perf
        JOIN automation_definitions ad ON ad.id = perf.automation_id
        WHERE ad.is_enabled = TRUE
            AND ad.paused_at IS NULL  -- Not already paused
            AND perf.total_sent >= p_min_sends
            AND perf.bounce_rate_pct > p_bounce_threshold
    LOOP
        -- Pause the automation
        UPDATE automation_definitions
        SET
            is_enabled = FALSE,
            paused_at = NOW(),
            pause_reason = 'Auto-paused: Bounce rate ' || v_automation.bounce_rate_pct || '% exceeds ' || p_bounce_threshold || '% threshold',
            updated_at = NOW()
        WHERE id = v_automation.automation_id;

        -- Log the pause event
        INSERT INTO automation_pause_events (
            automation_id,
            organization_id,
            event_type,
            reason,
            metrics_snapshot,
            triggered_by
        ) VALUES (
            v_automation.automation_id,
            v_automation.organization_id,
            'auto_pause',
            'Bounce rate exceeded threshold',
            jsonb_build_object(
                'bounce_rate_pct', v_automation.bounce_rate_pct,
                'open_rate_pct', v_automation.open_rate_pct,
                'click_rate_pct', v_automation.click_rate_pct,
                'total_sent', v_automation.total_sent,
                'threshold', p_bounce_threshold
            ),
            'cron'
        );

        v_paused_count := v_paused_count + 1;
        v_paused_ids := array_append(v_paused_ids, v_automation.automation_id);
    END LOOP;

    RETURN jsonb_build_object(
        'paused_count', v_paused_count,
        'paused_ids', v_paused_ids,
        'threshold_used', p_bounce_threshold,
        'min_sends_required', p_min_sends
    );
END;
$$;

-- ============================================================================
-- 5. GENERATE WEEKLY DIGEST FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_weekly_digest(
    p_organization_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_week_start DATE := date_trunc('week', CURRENT_DATE - INTERVAL '7 days')::DATE;
    v_week_end DATE := v_week_start + INTERVAL '6 days';
    v_total_automations INTEGER;
    v_active_automations INTEGER;
    v_paused_automations INTEGER;
    v_top_performers JSONB := '[]';
    v_underperformers JSONB := '[]';
    v_newly_paused JSONB := '[]';
    v_recovery_candidates JSONB := '[]';
    v_total_sent INTEGER := 0;
    v_total_opened INTEGER := 0;
    v_total_bounced INTEGER := 0;
    v_avg_open_rate DECIMAL := 0;
    v_avg_bounce_rate DECIMAL := 0;
BEGIN
    -- Count automations by status
    SELECT
        COUNT(*)::INTEGER,
        COUNT(*) FILTER (WHERE is_enabled)::INTEGER,
        COUNT(*) FILTER (WHERE paused_at IS NOT NULL)::INTEGER
    INTO v_total_automations, v_active_automations, v_paused_automations
    FROM automation_definitions
    WHERE organization_id = p_organization_id
        AND is_archived = FALSE;

    -- Get aggregate metrics from past week
    SELECT
        COALESCE(SUM(perf.total_sent), 0)::INTEGER,
        COALESCE(SUM(perf.total_opened), 0)::INTEGER,
        COALESCE(SUM(perf.total_bounced), 0)::INTEGER,
        COALESCE(AVG(perf.open_rate_pct), 0),
        COALESCE(AVG(perf.bounce_rate_pct), 0)
    INTO v_total_sent, v_total_opened, v_total_bounced, v_avg_open_rate, v_avg_bounce_rate
    FROM get_automation_performance(p_organization_id, NULL, 7) perf
    WHERE perf.total_sent > 0;

    -- Get top performers (top 3 by open rate, min 10 sends)
    SELECT COALESCE(jsonb_agg(performer), '[]') INTO v_top_performers
    FROM (
        SELECT jsonb_build_object(
            'automation_id', perf.automation_id,
            'name', perf.name,
            'open_rate_pct', perf.open_rate_pct,
            'total_sent', perf.total_sent
        ) as performer
        FROM get_automation_performance(p_organization_id, NULL, 7) perf
        WHERE perf.total_sent >= 10
        ORDER BY perf.open_rate_pct DESC
        LIMIT 3
    ) top;

    -- Get underperformers (open rate < 10% or bounce > 10%)
    SELECT COALESCE(jsonb_agg(underperf), '[]') INTO v_underperformers
    FROM (
        SELECT jsonb_build_object(
            'automation_id', perf.automation_id,
            'name', perf.name,
            'open_rate_pct', perf.open_rate_pct,
            'bounce_rate_pct', perf.bounce_rate_pct,
            'issue', CASE
                WHEN perf.bounce_rate_pct > 10 THEN 'high_bounce'
                WHEN perf.open_rate_pct < 10 THEN 'low_opens'
                ELSE 'below_average'
            END
        ) as underperf
        FROM get_automation_performance(p_organization_id, NULL, 7) perf
        WHERE perf.total_sent >= 10
            AND (perf.bounce_rate_pct > 10 OR perf.open_rate_pct < 10)
        ORDER BY perf.open_rate_pct ASC
        LIMIT 5
    ) low;

    -- Get newly paused this week
    SELECT COALESCE(jsonb_agg(paused), '[]') INTO v_newly_paused
    FROM (
        SELECT jsonb_build_object(
            'automation_id', ad.id,
            'name', ad.name,
            'reason', ad.pause_reason,
            'paused_at', ad.paused_at
        ) as paused
        FROM automation_definitions ad
        WHERE ad.organization_id = p_organization_id
            AND ad.paused_at >= v_week_start
            AND ad.paused_at <= v_week_end + INTERVAL '1 day'
    ) np;

    -- Get recovery candidates (paused 7+ days, < 3 attempts)
    SELECT COALESCE(jsonb_agg(candidate), '[]') INTO v_recovery_candidates
    FROM (
        SELECT jsonb_build_object(
            'automation_id', ad.id,
            'name', ad.name,
            'days_paused', EXTRACT(DAY FROM NOW() - ad.paused_at)::INTEGER,
            'recovery_attempts', ad.recovery_attempts
        ) as candidate
        FROM automation_definitions ad
        WHERE ad.organization_id = p_organization_id
            AND ad.paused_at IS NOT NULL
            AND ad.paused_at < NOW() - INTERVAL '7 days'
            AND COALESCE(ad.recovery_attempts, 0) < 3
        ORDER BY ad.paused_at ASC
        LIMIT 5
    ) rc;

    -- Upsert snapshot
    INSERT INTO weekly_digest_snapshots (
        organization_id,
        week_start,
        week_end,
        total_automations,
        active_automations,
        paused_automations,
        total_messages_sent,
        total_opened,
        total_bounced,
        avg_open_rate,
        avg_bounce_rate,
        top_performers,
        underperformers,
        newly_paused,
        recovery_candidates
    ) VALUES (
        p_organization_id,
        v_week_start,
        v_week_end,
        v_total_automations,
        v_active_automations,
        v_paused_automations,
        v_total_sent,
        v_total_opened,
        v_total_bounced,
        v_avg_open_rate,
        v_avg_bounce_rate,
        v_top_performers,
        v_underperformers,
        v_newly_paused,
        v_recovery_candidates
    )
    ON CONFLICT (organization_id, week_start)
    DO UPDATE SET
        total_automations = EXCLUDED.total_automations,
        active_automations = EXCLUDED.active_automations,
        paused_automations = EXCLUDED.paused_automations,
        total_messages_sent = EXCLUDED.total_messages_sent,
        total_opened = EXCLUDED.total_opened,
        total_bounced = EXCLUDED.total_bounced,
        avg_open_rate = EXCLUDED.avg_open_rate,
        avg_bounce_rate = EXCLUDED.avg_bounce_rate,
        top_performers = EXCLUDED.top_performers,
        underperformers = EXCLUDED.underperformers,
        newly_paused = EXCLUDED.newly_paused,
        recovery_candidates = EXCLUDED.recovery_candidates,
        created_at = NOW();

    RETURN jsonb_build_object(
        'week_start', v_week_start,
        'week_end', v_week_end,
        'total_automations', v_total_automations,
        'active_automations', v_active_automations,
        'paused_automations', v_paused_automations,
        'total_messages_sent', v_total_sent,
        'avg_open_rate', v_avg_open_rate,
        'avg_bounce_rate', v_avg_bounce_rate,
        'top_performers', v_top_performers,
        'underperformers', v_underperformers,
        'newly_paused', v_newly_paused,
        'recovery_candidates', v_recovery_candidates
    );
END;
$$;

-- ============================================================================
-- 6. SUGGEST AUTOMATION RECOVERY FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION suggest_automation_recovery(
    p_automation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_automation automation_definitions%ROWTYPE;
    v_days_paused INTEGER;
    v_original_frequency INTEGER;
    v_new_frequency INTEGER;
    v_recovery_config JSONB;
BEGIN
    SELECT * INTO v_automation
    FROM automation_definitions
    WHERE id = p_automation_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Automation not found');
    END IF;

    IF v_automation.paused_at IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Automation is not paused');
    END IF;

    v_days_paused := EXTRACT(DAY FROM NOW() - v_automation.paused_at)::INTEGER;

    IF v_days_paused < 7 THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Must be paused at least 7 days', 'days_paused', v_days_paused);
    END IF;

    IF COALESCE(v_automation.recovery_attempts, 0) >= 3 THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Max recovery attempts (3) reached');
    END IF;

    -- Calculate reduced frequency (50% reduction = double the days)
    v_original_frequency := COALESCE(v_automation.original_frequency_days, v_automation.max_frequency_days, 7);
    v_new_frequency := GREATEST(v_original_frequency * 2, 7);  -- At least weekly

    v_recovery_config := jsonb_build_object(
        'original_frequency_days', v_original_frequency,
        'suggested_frequency_days', v_new_frequency,
        'frequency_reduction_pct', 50,
        'send_cap', 10,  -- Limit to 10 sends in recovery period
        'recovery_period_days', 14  -- 2 week recovery window
    );

    -- Log recovery suggestion
    INSERT INTO automation_pause_events (
        automation_id,
        organization_id,
        event_type,
        reason,
        recovery_config,
        days_paused,
        triggered_by
    ) VALUES (
        p_automation_id,
        v_automation.organization_id,
        'recovery_suggested',
        'Automation eligible for gradual re-enable after ' || v_days_paused || ' days paused',
        v_recovery_config,
        v_days_paused,
        'cron'
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'automation_id', p_automation_id,
        'name', v_automation.name,
        'days_paused', v_days_paused,
        'recovery_attempts', COALESCE(v_automation.recovery_attempts, 0),
        'suggested_config', v_recovery_config
    );
END;
$$;

-- ============================================================================
-- 7. EXECUTE AUTOMATION RECOVERY FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION execute_automation_recovery(
    p_automation_id UUID,
    p_recovery_config JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_automation automation_definitions%ROWTYPE;
    v_new_frequency INTEGER;
    v_days_paused INTEGER;
    v_config JSONB;
BEGIN
    SELECT * INTO v_automation
    FROM automation_definitions
    WHERE id = p_automation_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Automation not found');
    END IF;

    IF v_automation.paused_at IS NULL THEN
        RETURN jsonb_build_object('success', FALSE, 'error', 'Automation is not paused');
    END IF;

    v_days_paused := EXTRACT(DAY FROM NOW() - v_automation.paused_at)::INTEGER;

    -- Use provided config or generate default
    IF p_recovery_config IS NOT NULL THEN
        v_config := p_recovery_config;
        v_new_frequency := (p_recovery_config->>'suggested_frequency_days')::INTEGER;
    ELSE
        v_new_frequency := GREATEST(COALESCE(v_automation.max_frequency_days, 7) * 2, 7);
        v_config := jsonb_build_object(
            'original_frequency_days', v_automation.max_frequency_days,
            'suggested_frequency_days', v_new_frequency,
            'frequency_reduction_pct', 50
        );
    END IF;

    -- Store original frequency if first recovery
    IF v_automation.original_frequency_days IS NULL THEN
        UPDATE automation_definitions
        SET original_frequency_days = max_frequency_days
        WHERE id = p_automation_id;
    END IF;

    -- Re-enable with reduced frequency
    UPDATE automation_definitions
    SET
        is_enabled = TRUE,
        max_frequency_days = v_new_frequency,
        recovery_attempts = COALESCE(recovery_attempts, 0) + 1,
        last_recovery_at = NOW(),
        paused_at = NULL,
        pause_reason = NULL,
        updated_at = NOW()
    WHERE id = p_automation_id;

    -- Log recovery execution
    INSERT INTO automation_pause_events (
        automation_id,
        organization_id,
        event_type,
        reason,
        recovery_config,
        days_paused,
        triggered_by
    ) VALUES (
        p_automation_id,
        v_automation.organization_id,
        'auto_resume',
        'Automation re-enabled with reduced frequency (' || v_new_frequency || ' day cooldown)',
        v_config,
        v_days_paused,
        'ai'
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'automation_id', p_automation_id,
        'name', v_automation.name,
        'new_frequency_days', v_new_frequency,
        'recovery_attempt', COALESCE(v_automation.recovery_attempts, 0) + 1
    );
END;
$$;

-- ============================================================================
-- 8. GET RECOVERY CANDIDATES FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION get_recovery_candidates(
    p_organization_id UUID DEFAULT NULL,
    p_min_days_paused INTEGER DEFAULT 7
)
RETURNS TABLE (
    automation_id UUID,
    organization_id UUID,
    name TEXT,
    pause_reason TEXT,
    paused_at TIMESTAMPTZ,
    days_paused INTEGER,
    recovery_attempts INTEGER,
    original_frequency_days INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        ad.id as automation_id,
        ad.organization_id,
        ad.name,
        ad.pause_reason,
        ad.paused_at,
        EXTRACT(DAY FROM NOW() - ad.paused_at)::INTEGER as days_paused,
        COALESCE(ad.recovery_attempts, 0) as recovery_attempts,
        ad.original_frequency_days
    FROM automation_definitions ad
    WHERE ad.paused_at IS NOT NULL
        AND ad.paused_at < NOW() - (p_min_days_paused || ' days')::INTERVAL
        AND COALESCE(ad.recovery_attempts, 0) < 3
        AND ad.is_archived = FALSE
        AND (p_organization_id IS NULL OR ad.organization_id = p_organization_id)
    ORDER BY ad.paused_at ASC;
END;
$$;

-- ============================================================================
-- 9. COMMENTS
-- ============================================================================

COMMENT ON TABLE automation_pause_events IS 'Audit trail for automation pause/resume events, including auto-pause for high bounce rates';
COMMENT ON TABLE weekly_digest_snapshots IS 'Weekly aggregated automation performance snapshots for digest emails';
COMMENT ON FUNCTION check_and_pause_bouncy_automations IS 'Cron-callable function to auto-pause automations with bounce rate above threshold';
COMMENT ON FUNCTION generate_weekly_digest IS 'Generates weekly performance snapshot for an organization';
COMMENT ON FUNCTION suggest_automation_recovery IS 'Suggests recovery config for paused automation after 7+ days';
COMMENT ON FUNCTION execute_automation_recovery IS 'Re-enables a paused automation with reduced frequency';
COMMENT ON FUNCTION get_recovery_candidates IS 'Returns automations eligible for recovery (paused 7+ days, < 3 attempts)';
