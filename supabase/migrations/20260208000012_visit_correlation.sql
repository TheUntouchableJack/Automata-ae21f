-- Phase 4: Visit Correlation
-- Links automation executions to customer return visits for outcome measurement

-- ============================================================================
-- 1. ADD ATTRIBUTION COLUMN TO MEMBER VISITS
-- ============================================================================

-- Add column if not exists (safe for re-running)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'member_visits' AND column_name = 'attributed_to'
    ) THEN
        ALTER TABLE member_visits ADD COLUMN attributed_to JSONB;
    END IF;
END
$$;

COMMENT ON COLUMN member_visits.attributed_to IS 'Automations that may have influenced this visit: [{automation_id, execution_id, days_since}]';

-- ============================================================================
-- 2. VISIT ATTRIBUTION FUNCTION
-- ============================================================================
-- Called when a member visits to find recent automations that might have caused it

CREATE OR REPLACE FUNCTION attribute_visit_to_automations(
    p_member_id UUID,
    p_visit_timestamp TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_attributions JSONB := '[]'::JSONB;
    v_execution RECORD;
    v_days_since INTEGER;
BEGIN
    -- Find automation executions sent to this member in the last 7 days
    FOR v_execution IN
        SELECT
            ae.id as execution_id,
            ae.automation_id,
            ad.name as automation_name,
            ae.executed_at,
            ad.category
        FROM automation_executions ae
        JOIN automation_definitions ad ON ad.id = ae.automation_id
        WHERE ae.member_id = p_member_id
            AND ae.status = 'completed'
            AND ae.executed_at IS NOT NULL
            AND ae.executed_at > p_visit_timestamp - INTERVAL '7 days'
            AND ae.executed_at < p_visit_timestamp
        ORDER BY ae.executed_at DESC
        LIMIT 5  -- Attribute to max 5 recent automations
    LOOP
        v_days_since := EXTRACT(DAY FROM (p_visit_timestamp - v_execution.executed_at))::INTEGER;

        v_attributions := v_attributions || jsonb_build_object(
            'automation_id', v_execution.automation_id,
            'execution_id', v_execution.execution_id,
            'automation_name', v_execution.automation_name,
            'category', v_execution.category,
            'days_since', v_days_since
        );
    END LOOP;

    RETURN v_attributions;
END;
$$;

-- ============================================================================
-- 3. VISIT ATTRIBUTION TRIGGER
-- ============================================================================
-- Automatically attributes visits to recent automations when inserted

CREATE OR REPLACE FUNCTION trigger_visit_attribution()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_attributions JSONB;
BEGIN
    -- Only attribute if not already set
    IF NEW.attributed_to IS NULL THEN
        v_attributions := attribute_visit_to_automations(NEW.member_id, COALESCE(NEW.visited_at, NOW()));

        IF jsonb_array_length(v_attributions) > 0 THEN
            NEW.attributed_to := v_attributions;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trigger_visit_attribution ON member_visits;

-- Create trigger
CREATE TRIGGER trigger_visit_attribution
    BEFORE INSERT ON member_visits
    FOR EACH ROW
    EXECUTE FUNCTION trigger_visit_attribution();

-- ============================================================================
-- 4. OUTCOME MEASUREMENT FUNCTION
-- ============================================================================
-- Run periodically to measure success of automation executions

CREATE OR REPLACE FUNCTION measure_automation_outcomes(
    p_batch_size INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_execution RECORD;
    v_visit_count INTEGER;
    v_days_to_visit DECIMAL;
    v_success_score DECIMAL;
    v_processed INTEGER := 0;
    v_successes INTEGER := 0;
BEGIN
    -- Find executions that are ready for measurement (48+ hours old, not yet measured)
    FOR v_execution IN
        SELECT ae.id, ae.member_id, ae.automation_id, ae.executed_at
        FROM automation_executions ae
        WHERE ae.status = 'completed'
            AND ae.executed_at IS NOT NULL
            AND ae.measured_at IS NULL
            AND ae.executed_at < NOW() - INTERVAL '48 hours'
        ORDER BY ae.executed_at ASC
        LIMIT p_batch_size
    LOOP
        -- Check if member visited within 7 days after execution
        SELECT COUNT(*), MIN(EXTRACT(DAY FROM (mv.visited_at - v_execution.executed_at)))
        INTO v_visit_count, v_days_to_visit
        FROM member_visits mv
        WHERE mv.member_id = v_execution.member_id
            AND mv.visited_at > v_execution.executed_at
            AND mv.visited_at < v_execution.executed_at + INTERVAL '7 days';

        -- Calculate success score
        IF v_visit_count > 0 THEN
            -- Base score: 0.5 for any visit within 7 days
            v_success_score := 0.5;

            -- Bonus for quick response (within 2 days): +0.3
            IF v_days_to_visit <= 2 THEN
                v_success_score := v_success_score + 0.3;
            END IF;

            -- Bonus for same-day response: +0.2
            IF v_days_to_visit < 1 THEN
                v_success_score := v_success_score + 0.2;
            END IF;

            v_successes := v_successes + 1;

            -- Update success count on automation definition
            UPDATE automation_definitions
            SET success_count = COALESCE(success_count, 0) + 1
            WHERE id = v_execution.automation_id;
        ELSE
            v_success_score := 0;
        END IF;

        -- Update execution with outcome
        UPDATE automation_executions
        SET
            measured_at = NOW(),
            outcome = jsonb_build_object(
                'visited', v_visit_count > 0,
                'visit_count', v_visit_count,
                'days_to_visit', v_days_to_visit
            ),
            success_score = v_success_score
        WHERE id = v_execution.id;

        v_processed := v_processed + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'processed', v_processed,
        'successes', v_successes,
        'success_rate', CASE WHEN v_processed > 0
            THEN ROUND((v_successes::DECIMAL / v_processed) * 100, 1)
            ELSE 0 END
    );
END;
$$;

-- ============================================================================
-- 5. CORRELATION SUMMARY FUNCTION
-- ============================================================================
-- Returns visit correlation stats for an automation

CREATE OR REPLACE FUNCTION get_automation_correlation(
    p_automation_id UUID,
    p_days INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_total_executions INTEGER;
    v_attributed_visits INTEGER;
    v_avg_success_score DECIMAL;
    v_avg_days_to_visit DECIMAL;
BEGIN
    -- Count executions in period
    SELECT COUNT(*), AVG(success_score), AVG((outcome->>'days_to_visit')::DECIMAL)
    INTO v_total_executions, v_avg_success_score, v_avg_days_to_visit
    FROM automation_executions
    WHERE automation_id = p_automation_id
        AND executed_at > NOW() - (p_days || ' days')::INTERVAL
        AND measured_at IS NOT NULL;

    -- Count visits attributed to this automation
    SELECT COUNT(*)
    INTO v_attributed_visits
    FROM member_visits mv,
         jsonb_array_elements(mv.attributed_to) as attr
    WHERE (attr->>'automation_id')::UUID = p_automation_id
        AND mv.visited_at > NOW() - (p_days || ' days')::INTERVAL;

    RETURN jsonb_build_object(
        'automation_id', p_automation_id,
        'period_days', p_days,
        'executions', COALESCE(v_total_executions, 0),
        'attributed_visits', COALESCE(v_attributed_visits, 0),
        'visit_rate_pct', CASE
            WHEN v_total_executions > 0
            THEN ROUND((v_attributed_visits::DECIMAL / v_total_executions) * 100, 1)
            ELSE 0
        END,
        'avg_success_score', COALESCE(ROUND(v_avg_success_score, 2), 0),
        'avg_days_to_visit', COALESCE(ROUND(v_avg_days_to_visit, 1), NULL)
    );
END;
$$;

-- ============================================================================
-- 6. ENHANCED PERFORMANCE FUNCTION (adds correlation data)
-- ============================================================================
-- Updates get_automation_performance to include correlation

CREATE OR REPLACE FUNCTION get_automation_performance_with_correlation(
    p_organization_id UUID,
    p_app_id UUID DEFAULT NULL,
    p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
    automation_id UUID,
    name TEXT,
    category TEXT,
    is_enabled BOOLEAN,
    -- Basic stats
    trigger_count INTEGER,
    success_count INTEGER,
    success_rate_pct DECIMAL(5,1),
    -- Message metrics
    total_sent INTEGER,
    open_rate_pct DECIMAL(5,1),
    click_rate_pct DECIMAL(5,1),
    -- Correlation metrics
    executions_in_period INTEGER,
    attributed_visits INTEGER,
    visit_rate_pct DECIMAL(5,1),
    avg_success_score DECIMAL(3,2),
    avg_days_to_visit DECIMAL(4,1)
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
        CASE WHEN ad.trigger_count > 0
             THEN ROUND((ad.success_count::DECIMAL / ad.trigger_count) * 100, 1)
             ELSE 0 END as success_rate_pct,
        -- Message metrics from batches
        COALESCE(batch_stats.total_sent, 0)::INTEGER as total_sent,
        CASE WHEN COALESCE(batch_stats.total_delivered, 0) > 0
             THEN ROUND((batch_stats.total_opened::DECIMAL / batch_stats.total_delivered) * 100, 1)
             ELSE 0 END as open_rate_pct,
        CASE WHEN COALESCE(batch_stats.total_opened, 0) > 0
             THEN ROUND((batch_stats.total_clicked::DECIMAL / batch_stats.total_opened) * 100, 1)
             ELSE 0 END as click_rate_pct,
        -- Correlation metrics
        COALESCE(exec_stats.exec_count, 0)::INTEGER as executions_in_period,
        COALESCE(exec_stats.attributed_count, 0)::INTEGER as attributed_visits,
        CASE WHEN COALESCE(exec_stats.exec_count, 0) > 0
             THEN ROUND((exec_stats.attributed_count::DECIMAL / exec_stats.exec_count) * 100, 1)
             ELSE 0 END as visit_rate_pct,
        COALESCE(exec_stats.avg_score, 0)::DECIMAL(3,2) as avg_success_score,
        exec_stats.avg_days::DECIMAL(4,1) as avg_days_to_visit
    FROM automation_definitions ad
    LEFT JOIN LATERAL (
        SELECT
            SUM(mb.total_recipients) as total_sent,
            SUM(mb.delivered) as total_delivered,
            SUM(mb.opened) as total_opened,
            SUM(mb.clicked) as total_clicked
        FROM app_message_batches mb
        WHERE mb.automation_id = ad.id
            AND mb.sent_at > NOW() - (p_days || ' days')::INTERVAL
    ) batch_stats ON TRUE
    LEFT JOIN LATERAL (
        SELECT
            COUNT(*) as exec_count,
            COUNT(*) FILTER (WHERE ae.success_score > 0) as attributed_count,
            AVG(ae.success_score) as avg_score,
            AVG((ae.outcome->>'days_to_visit')::DECIMAL) as avg_days
        FROM automation_executions ae
        WHERE ae.automation_id = ad.id
            AND ae.executed_at > NOW() - (p_days || ' days')::INTERVAL
            AND ae.measured_at IS NOT NULL
    ) exec_stats ON TRUE
    WHERE ad.organization_id = p_organization_id
        AND ad.is_archived = FALSE
        AND (p_app_id IS NULL OR ad.app_id = p_app_id)
    ORDER BY ad.is_enabled DESC, exec_stats.attributed_count DESC NULLS LAST;
END;
$$;

-- ============================================================================
-- 7. INDEX FOR FAST ATTRIBUTION LOOKUP
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_automation_exec_member_status
    ON automation_executions(member_id, status, executed_at DESC)
    WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS idx_automation_exec_unmeasured
    ON automation_executions(executed_at)
    WHERE measured_at IS NULL AND status = 'completed';

-- ============================================================================
-- 8. COMMENTS
-- ============================================================================

COMMENT ON FUNCTION attribute_visit_to_automations IS 'Finds automations that may have influenced a member visit (within 7 days prior)';
COMMENT ON FUNCTION trigger_visit_attribution IS 'Trigger function to auto-attribute visits to recent automations';
COMMENT ON FUNCTION measure_automation_outcomes IS 'Batch process to measure automation success 48+ hours after execution';
COMMENT ON FUNCTION get_automation_correlation IS 'Returns visit correlation stats for a specific automation';
COMMENT ON FUNCTION get_automation_performance_with_correlation IS 'Enhanced performance metrics including visit correlation data';
