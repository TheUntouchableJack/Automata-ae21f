-- Data Collection Learning System
-- Phase 5: Learning Aggregation Cron Jobs

-- ============================================================================
-- AGGREGATE COLLECTION LEARNINGS
-- Runs daily to aggregate strategy performance across businesses
-- ============================================================================

CREATE OR REPLACE FUNCTION aggregate_collection_learnings()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Aggregate successful strategies by industry
  INSERT INTO collection_strategy_performance (
    industry, business_size, target_field, strategy_type, touchpoint,
    total_attempts, total_successes, total_declines, avg_conversion_rate,
    sample_size, confidence_score, best_value_proposition, optimal_incentive_points,
    updated_at
  )
  SELECT
    bp.industry,
    CASE
      WHEN (SELECT COUNT(*) FROM app_members m JOIN apps ap ON m.app_id = ap.id WHERE ap.organization_id = o.id AND m.deleted_at IS NULL) < 500 THEN 'small'
      WHEN (SELECT COUNT(*) FROM app_members m JOIN apps ap ON m.app_id = ap.id WHERE ap.organization_id = o.id AND m.deleted_at IS NULL) < 2000 THEN 'medium'
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
    -- Confidence based on sample size (caps at 1.0 after 20 orgs)
    LEAST(1.0, COUNT(DISTINCT c.organization_id)::decimal / 20) as confidence_score,
    -- Best value proposition (from highest converting campaign)
    (
      SELECT c2.value_proposition
      FROM data_collection_campaigns c2
      WHERE c2.target_field = c.target_field
      AND c2.strategy_type = c.strategy_type
      AND c2.attempts >= 10
      ORDER BY (c2.successes::decimal / NULLIF(c2.attempts, 0)) DESC
      LIMIT 1
    ) as best_value_proposition,
    -- Optimal incentive (median of successful campaigns)
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY c.incentive_points)::INTEGER as optimal_incentive_points,
    now()
  FROM data_collection_campaigns c
  JOIN organizations o ON c.organization_id = o.id
  LEFT JOIN business_profiles bp ON bp.organization_id = o.id
  LEFT JOIN data_collection_attempts a ON a.campaign_id = c.id
  WHERE c.attempts >= 10 -- Minimum sample
  AND c.status != 'paused'
  GROUP BY bp.industry, c.target_field, c.strategy_type, o.id
  ON CONFLICT (
    COALESCE(industry, ''),
    COALESCE(business_size, ''),
    target_field,
    strategy_type,
    COALESCE(touchpoint, '')
  )
  DO UPDATE SET
    total_attempts = EXCLUDED.total_attempts,
    total_successes = EXCLUDED.total_successes,
    total_declines = EXCLUDED.total_declines,
    avg_conversion_rate = EXCLUDED.avg_conversion_rate,
    sample_size = EXCLUDED.sample_size,
    confidence_score = EXCLUDED.confidence_score,
    best_value_proposition = COALESCE(EXCLUDED.best_value_proposition, collection_strategy_performance.best_value_proposition),
    optimal_incentive_points = COALESCE(EXCLUDED.optimal_incentive_points, collection_strategy_performance.optimal_incentive_points),
    updated_at = now();
END;
$$;

-- ============================================================================
-- CRON JOB SCHEDULES
-- ============================================================================

-- Clear stale pending collections (runs every hour)
SELECT cron.schedule(
  'clear-stale-pending-collections',
  '0 * * * *', -- Every hour
  $$SELECT clear_stale_pending_collections()$$
);

-- Aggregate collection learnings (runs daily at 3am)
SELECT cron.schedule(
  'aggregate-collection-learnings',
  '0 3 * * *', -- Daily at 3am
  $$SELECT aggregate_collection_learnings()$$
);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON FUNCTION aggregate_collection_learnings() IS 'Aggregates collection strategy performance across businesses for AI recommendations. Runs daily.';
COMMENT ON FUNCTION clear_stale_pending_collections() IS 'Clears pending collection flags after 24 hours and marks attempts as ignored. Runs hourly.';
