-- =====================================================
-- FIX: Replace "apps" with "customer_apps" in data collection functions
-- Bug: Migrations 20260209000011/13 referenced non-existent "apps" table
-- Impact: Customer signup fails because trigger on app_members INSERT
--         calls initialize_member_data_gaps() which queries "apps"
-- =====================================================

-- 1. Fix get_data_coverage_stats (line 39: JOIN apps → JOIN customer_apps)
CREATE OR REPLACE FUNCTION get_data_coverage_stats(
  p_organization_id UUID,
  p_field TEXT DEFAULT 'all'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'total_members', COUNT(*),
    'phone_count', COUNT(*) FILTER (WHERE phone IS NOT NULL AND phone != ''),
    'phone_pct', ROUND(100.0 * COUNT(*) FILTER (WHERE phone IS NOT NULL AND phone != '') / NULLIF(COUNT(*), 0), 1),
    'email_count', COUNT(*) FILTER (WHERE email IS NOT NULL AND email != ''),
    'email_pct', ROUND(100.0 * COUNT(*) FILTER (WHERE email IS NOT NULL AND email != '') / NULLIF(COUNT(*), 0), 1),
    'birthday_count', COUNT(*) FILTER (WHERE birthday IS NOT NULL),
    'birthday_pct', ROUND(100.0 * COUNT(*) FILTER (WHERE birthday IS NOT NULL) / NULLIF(COUNT(*), 0), 1),
    'complete_profiles', COUNT(*) FILTER (
      WHERE phone IS NOT NULL AND phone != ''
      AND email IS NOT NULL AND email != ''
      AND birthday IS NOT NULL
    ),
    'complete_pct', ROUND(100.0 * COUNT(*) FILTER (
      WHERE phone IS NOT NULL AND phone != ''
      AND email IS NOT NULL AND email != ''
      AND birthday IS NOT NULL
    ) / NULLIF(COUNT(*), 0), 1)
  ) INTO result
  FROM app_members m
  JOIN customer_apps a ON m.app_id = a.id
  WHERE a.organization_id = p_organization_id
  AND m.deleted_at IS NULL;

  RETURN result;
END;
$$;

-- 2. Fix get_eligible_collection_targets (line 227: JOIN apps → JOIN customer_apps)
CREATE OR REPLACE FUNCTION get_eligible_collection_targets(
  p_organization_id UUID,
  p_target_field TEXT,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  member_id UUID,
  member_name TEXT,
  phone TEXT,
  email TEXT,
  priority_score INTEGER,
  last_ask_at TIMESTAMPTZ,
  ask_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id as member_id,
    m.name as member_name,
    m.phone,
    m.email,
    COALESCE(g.priority_score, 50) as priority_score,
    g.last_ask_at,
    COALESCE(g.ask_count, 0) as ask_count
  FROM app_members m
  JOIN customer_apps a ON m.app_id = a.id
  LEFT JOIN customer_data_gaps g ON g.member_id = m.id AND g.missing_field = p_target_field
  LEFT JOIN customer_preferences p ON p.member_id = m.id
  WHERE a.organization_id = p_organization_id
  AND m.deleted_at IS NULL
  AND m.pending_collection_type IS NULL
  AND (
    (p_target_field = 'phone' AND (m.phone IS NULL OR m.phone = ''))
    OR (p_target_field = 'email' AND (m.email IS NULL OR m.email = ''))
    OR (p_target_field = 'birthday' AND m.birthday IS NULL)
  )
  AND COALESCE(g.do_not_ask, false) = false
  AND COALESCE(p.do_not_ask_for_data, false) = false
  AND (g.next_ask_eligible_at IS NULL OR g.next_ask_eligible_at <= now())
  AND (g.ask_count IS NULL OR g.ask_count < g.max_asks)
  ORDER BY
    COALESCE(g.priority_score, 50) DESC,
    COALESCE(g.ask_count, 0) ASC,
    m.created_at DESC
  LIMIT p_limit;
END;
$$;

-- 3. Fix initialize_member_data_gaps trigger (line 434: FROM apps → FROM customer_apps)
-- THIS IS THE CRITICAL FIX - this trigger fires on every app_members INSERT
CREATE OR REPLACE FUNCTION initialize_member_data_gaps()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_organization_id UUID;
BEGIN
  SELECT organization_id INTO v_organization_id
  FROM customer_apps
  WHERE id = NEW.app_id;

  IF NEW.phone IS NULL OR NEW.phone = '' THEN
    INSERT INTO customer_data_gaps (member_id, organization_id, missing_field, priority_score)
    VALUES (NEW.id, v_organization_id, 'phone', 70)
    ON CONFLICT DO NOTHING;
  END IF;

  IF NEW.email IS NULL OR NEW.email = '' THEN
    INSERT INTO customer_data_gaps (member_id, organization_id, missing_field, priority_score)
    VALUES (NEW.id, v_organization_id, 'email', 60)
    ON CONFLICT DO NOTHING;
  END IF;

  IF NEW.birthday IS NULL THEN
    INSERT INTO customer_data_gaps (member_id, organization_id, missing_field, priority_score)
    VALUES (NEW.id, v_organization_id, 'birthday', 50)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Fix aggregate_collection_learnings cron (lines 25-26: JOIN apps → JOIN customer_apps)
CREATE OR REPLACE FUNCTION aggregate_collection_learnings()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO collection_strategy_performance (
    industry, business_size, target_field, strategy_type, touchpoint,
    total_attempts, total_successes, total_declines, avg_conversion_rate,
    sample_size, confidence_score, best_value_proposition, optimal_incentive_points,
    updated_at
  )
  SELECT
    bp.industry,
    CASE
      WHEN (SELECT COUNT(*) FROM app_members m JOIN customer_apps ap ON m.app_id = ap.id WHERE ap.organization_id = o.id AND m.deleted_at IS NULL) < 500 THEN 'small'
      WHEN (SELECT COUNT(*) FROM app_members m JOIN customer_apps ap ON m.app_id = ap.id WHERE ap.organization_id = o.id AND m.deleted_at IS NULL) < 2000 THEN 'medium'
      ELSE 'large'
    END as business_size,
    c.target_field,
    c.strategy_type,
    mode() WITHIN GROUP (ORDER BY a.touchpoint) as touchpoint,
    SUM(c.attempts) as total_attempts,
    SUM(c.successes) as total_successes,
    SUM(c.declines) as total_declines,
    CASE WHEN SUM(c.attempts) > 0
      THEN ROUND(SUM(c.successes)::decimal / SUM(c.attempts), 4)
      ELSE 0
    END as avg_conversion_rate,
    COUNT(DISTINCT c.organization_id) as sample_size,
    LEAST(1.0, COUNT(DISTINCT c.organization_id)::decimal / 20) as confidence_score,
    (
      SELECT c2.value_proposition
      FROM data_collection_campaigns c2
      WHERE c2.target_field = c.target_field
      AND c2.strategy_type = c.strategy_type
      AND c2.attempts >= 10
      ORDER BY (c2.successes::decimal / NULLIF(c2.attempts, 0)) DESC
      LIMIT 1
    ) as best_value_proposition,
    COALESCE(AVG(c.incentive_points) FILTER (WHERE c.successes > 0), 0)::INTEGER as optimal_incentive_points,
    now() as updated_at
  FROM data_collection_campaigns c
  JOIN organizations o ON c.organization_id = o.id
  LEFT JOIN business_profiles bp ON bp.organization_id = o.id
  LEFT JOIN collection_attempts a ON a.campaign_id = c.id
  WHERE c.attempts >= 5
  GROUP BY bp.industry, o.id, c.target_field, c.strategy_type
  ON CONFLICT (industry, business_size, target_field, strategy_type)
  DO UPDATE SET
    total_attempts = EXCLUDED.total_attempts,
    total_successes = EXCLUDED.total_successes,
    total_declines = EXCLUDED.total_declines,
    avg_conversion_rate = EXCLUDED.avg_conversion_rate,
    sample_size = EXCLUDED.sample_size,
    confidence_score = EXCLUDED.confidence_score,
    best_value_proposition = EXCLUDED.best_value_proposition,
    optimal_incentive_points = EXCLUDED.optimal_incentive_points,
    updated_at = now();
END;
$$;
