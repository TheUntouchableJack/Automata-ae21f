-- Data Collection Learning System
-- Phase 2: RPC Functions for data collection operations

-- ============================================================================
-- 1. GET DATA COVERAGE STATS
-- Returns phone/email/birthday coverage percentages for an organization
-- ============================================================================
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
  JOIN apps a ON m.app_id = a.id
  WHERE a.organization_id = p_organization_id
  AND m.deleted_at IS NULL;

  RETURN result;
END;
$$;

-- ============================================================================
-- 2. RECORD COLLECTION ATTEMPT
-- Logs an attempt and updates campaign stats + member cooling off
-- ============================================================================
CREATE OR REPLACE FUNCTION record_collection_attempt(
  p_campaign_id UUID,
  p_member_id UUID,
  p_organization_id UUID,
  p_touchpoint TEXT,
  p_channel TEXT,
  p_outcome TEXT,
  p_collected_value TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_attempt_id UUID;
  v_target_field TEXT;
  v_ask_count INTEGER;
BEGIN
  -- Get target field from campaign
  SELECT target_field INTO v_target_field
  FROM data_collection_campaigns
  WHERE id = p_campaign_id;

  -- Record the attempt
  INSERT INTO data_collection_attempts (
    campaign_id, member_id, organization_id, touchpoint, channel, outcome,
    collected_value, responded_at
  ) VALUES (
    p_campaign_id, p_member_id, p_organization_id, p_touchpoint, p_channel, p_outcome,
    CASE WHEN p_outcome = 'collected' THEN NULL ELSE p_collected_value END, -- Don't store PII
    CASE WHEN p_outcome != 'pending' THEN now() ELSE NULL END
  )
  RETURNING id INTO v_attempt_id;

  -- Update campaign stats
  UPDATE data_collection_campaigns
  SET
    attempts = attempts + 1,
    successes = successes + CASE WHEN p_outcome = 'collected' THEN 1 ELSE 0 END,
    declines = declines + CASE WHEN p_outcome = 'declined' THEN 1 ELSE 0 END,
    updated_at = now()
  WHERE id = p_campaign_id;

  -- Update member's gap record
  IF p_outcome = 'collected' THEN
    -- Remove the gap - data collected successfully
    DELETE FROM customer_data_gaps
    WHERE member_id = p_member_id
    AND missing_field = v_target_field;

    -- Clear pending collection on member
    UPDATE app_members
    SET
      pending_collection_type = NULL,
      pending_collection_campaign_id = NULL,
      pending_collection_sent_at = NULL
    WHERE id = p_member_id;

  ELSIF p_outcome IN ('declined', 'ignored') THEN
    -- Get current ask count
    SELECT ask_count INTO v_ask_count
    FROM customer_data_gaps
    WHERE member_id = p_member_id AND missing_field = v_target_field;

    v_ask_count := COALESCE(v_ask_count, 0) + 1;

    -- Update gap with cooling off (exponential backoff: 7, 14, 30 days)
    INSERT INTO customer_data_gaps (member_id, organization_id, missing_field, last_ask_at, ask_count, last_decline_reason, next_ask_eligible_at)
    VALUES (
      p_member_id,
      p_organization_id,
      v_target_field,
      now(),
      v_ask_count,
      p_outcome,
      now() + (INTERVAL '7 days' * POWER(2, LEAST(v_ask_count - 1, 2)))
    )
    ON CONFLICT (member_id, missing_field)
    DO UPDATE SET
      last_ask_at = now(),
      ask_count = customer_data_gaps.ask_count + 1,
      last_decline_reason = p_outcome,
      next_ask_eligible_at = now() + (INTERVAL '7 days' * POWER(2, LEAST(customer_data_gaps.ask_count, 2))),
      -- Mark as do_not_ask if they've hit max asks
      do_not_ask = CASE WHEN customer_data_gaps.ask_count >= customer_data_gaps.max_asks - 1 THEN true ELSE customer_data_gaps.do_not_ask END,
      updated_at = now();

    -- Clear pending collection on member
    UPDATE app_members
    SET
      pending_collection_type = NULL,
      pending_collection_campaign_id = NULL,
      pending_collection_sent_at = NULL
    WHERE id = p_member_id;
  END IF;

  RETURN v_attempt_id;
END;
$$;

-- ============================================================================
-- 3. START COLLECTION ATTEMPT
-- Marks a member as having a pending collection request
-- ============================================================================
CREATE OR REPLACE FUNCTION start_collection_attempt(
  p_campaign_id UUID,
  p_member_id UUID,
  p_organization_id UUID,
  p_touchpoint TEXT,
  p_channel TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_attempt_id UUID;
  v_target_field TEXT;
BEGIN
  -- Get target field from campaign
  SELECT target_field INTO v_target_field
  FROM data_collection_campaigns
  WHERE id = p_campaign_id;

  -- Record the pending attempt
  INSERT INTO data_collection_attempts (
    campaign_id, member_id, organization_id, touchpoint, channel, outcome
  ) VALUES (
    p_campaign_id, p_member_id, p_organization_id, p_touchpoint, p_channel, 'pending'
  )
  RETURNING id INTO v_attempt_id;

  -- Mark member as having pending collection
  UPDATE app_members
  SET
    pending_collection_type = v_target_field,
    pending_collection_campaign_id = p_campaign_id,
    pending_collection_sent_at = now()
  WHERE id = p_member_id;

  RETURN v_attempt_id;
END;
$$;

-- ============================================================================
-- 4. GET ELIGIBLE MEMBERS FOR COLLECTION
-- Returns members eligible for a specific data collection
-- ============================================================================
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
  JOIN apps a ON m.app_id = a.id
  LEFT JOIN customer_data_gaps g ON g.member_id = m.id AND g.missing_field = p_target_field
  LEFT JOIN customer_preferences p ON p.member_id = m.id
  WHERE a.organization_id = p_organization_id
  AND m.deleted_at IS NULL
  AND m.pending_collection_type IS NULL -- Not already pending
  -- Check if field is actually missing
  AND (
    (p_target_field = 'phone' AND (m.phone IS NULL OR m.phone = ''))
    OR (p_target_field = 'email' AND (m.email IS NULL OR m.email = ''))
    OR (p_target_field = 'birthday' AND m.birthday IS NULL)
  )
  -- Not opted out
  AND COALESCE(g.do_not_ask, false) = false
  AND COALESCE(p.do_not_ask_for_data, false) = false
  -- Cooling off period passed
  AND (g.next_ask_eligible_at IS NULL OR g.next_ask_eligible_at <= now())
  -- Under max asks
  AND (g.ask_count IS NULL OR g.ask_count < g.max_asks)
  ORDER BY
    COALESCE(g.priority_score, 50) DESC, -- High priority first
    COALESCE(g.ask_count, 0) ASC, -- Fewer asks first
    m.created_at DESC -- Newer members first
  LIMIT p_limit;
END;
$$;

-- ============================================================================
-- 5. GET CAMPAIGN PERFORMANCE
-- Returns performance metrics for a campaign
-- ============================================================================
CREATE OR REPLACE FUNCTION get_campaign_performance(
  p_campaign_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'campaign_id', c.id,
    'strategy_name', c.strategy_name,
    'target_field', c.target_field,
    'attempts', c.attempts,
    'successes', c.successes,
    'declines', c.declines,
    'conversion_rate', CASE WHEN c.attempts > 0 THEN ROUND(100.0 * c.successes / c.attempts, 1) ELSE 0 END,
    'decline_rate', CASE WHEN c.attempts > 0 THEN ROUND(100.0 * c.declines / c.attempts, 1) ELSE 0 END,
    'avg_response_time_seconds', (
      SELECT AVG(response_time_seconds)::INTEGER
      FROM data_collection_attempts
      WHERE campaign_id = c.id AND response_time_seconds IS NOT NULL
    ),
    'by_touchpoint', (
      SELECT json_agg(json_build_object(
        'touchpoint', touchpoint,
        'attempts', COUNT(*),
        'successes', COUNT(*) FILTER (WHERE outcome = 'collected'),
        'conversion_rate', ROUND(100.0 * COUNT(*) FILTER (WHERE outcome = 'collected') / NULLIF(COUNT(*), 0), 1)
      ))
      FROM data_collection_attempts
      WHERE campaign_id = c.id
      GROUP BY touchpoint
    ),
    'by_channel', (
      SELECT json_agg(json_build_object(
        'channel', channel,
        'attempts', COUNT(*),
        'successes', COUNT(*) FILTER (WHERE outcome = 'collected'),
        'conversion_rate', ROUND(100.0 * COUNT(*) FILTER (WHERE outcome = 'collected') / NULLIF(COUNT(*), 0), 1)
      ))
      FROM data_collection_attempts
      WHERE campaign_id = c.id
      GROUP BY channel
    )
  ) INTO result
  FROM data_collection_campaigns c
  WHERE c.id = p_campaign_id;

  RETURN result;
END;
$$;

-- ============================================================================
-- 6. AWARD PROFILE COMPLETION POINTS
-- Awards points for completing profile fields with gamification
-- ============================================================================
CREATE OR REPLACE FUNCTION award_profile_completion_points(
  p_member_id UUID,
  p_field TEXT,
  p_organization_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_points INTEGER;
  v_rewards profile_completion_rewards%ROWTYPE;
  v_is_complete BOOLEAN;
  v_bonus_awarded BOOLEAN := false;
  v_result JSON;
BEGIN
  -- Get rewards config (or use defaults)
  SELECT * INTO v_rewards
  FROM profile_completion_rewards
  WHERE organization_id = p_organization_id;

  -- Determine points for this field
  v_points := CASE p_field
    WHEN 'phone' THEN COALESCE(v_rewards.phone_added_points, 25)
    WHEN 'email' THEN COALESCE(v_rewards.email_added_points, 25)
    WHEN 'birthday' THEN COALESCE(v_rewards.birthday_added_points, 50)
    WHEN 'preferences' THEN COALESCE(v_rewards.preferences_added_points, 25)
    ELSE 0
  END;

  -- Award the points
  IF v_points > 0 THEN
    UPDATE app_members
    SET points = COALESCE(points, 0) + v_points
    WHERE id = p_member_id;
  END IF;

  -- Check if profile is now complete
  SELECT (
    phone IS NOT NULL AND phone != ''
    AND email IS NOT NULL AND email != ''
    AND birthday IS NOT NULL
  ) INTO v_is_complete
  FROM app_members
  WHERE id = p_member_id;

  -- Award completion bonus if newly complete
  IF v_is_complete THEN
    -- Check if bonus already awarded (by checking if they already have the achievement)
    -- For now, just award the bonus
    v_bonus_awarded := true;
    UPDATE app_members
    SET points = COALESCE(points, 0) + COALESCE(v_rewards.complete_profile_bonus, 100)
    WHERE id = p_member_id;
  END IF;

  SELECT json_build_object(
    'field', p_field,
    'points_awarded', v_points,
    'profile_complete', v_is_complete,
    'completion_bonus', CASE WHEN v_bonus_awarded THEN COALESCE(v_rewards.complete_profile_bonus, 100) ELSE 0 END,
    'total_awarded', v_points + CASE WHEN v_bonus_awarded THEN COALESCE(v_rewards.complete_profile_bonus, 100) ELSE 0 END
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- 7. CLEAR STALE PENDING COLLECTIONS
-- Clears pending collection flags after 24 hours (called by cron)
-- ============================================================================
CREATE OR REPLACE FUNCTION clear_stale_pending_collections()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH updated AS (
    UPDATE app_members
    SET
      pending_collection_type = NULL,
      pending_collection_campaign_id = NULL,
      pending_collection_sent_at = NULL
    WHERE pending_collection_sent_at < now() - INTERVAL '24 hours'
    AND pending_collection_type IS NOT NULL
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM updated;

  -- Mark the attempts as ignored
  UPDATE data_collection_attempts
  SET
    outcome = 'ignored',
    responded_at = now()
  WHERE outcome = 'pending'
  AND attempted_at < now() - INTERVAL '24 hours';

  RETURN v_count;
END;
$$;

-- ============================================================================
-- 8. INITIALIZE DATA GAPS FOR MEMBER
-- Creates gap records for a new member (called on member creation)
-- ============================================================================
CREATE OR REPLACE FUNCTION initialize_member_data_gaps()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_organization_id UUID;
BEGIN
  -- Get organization ID
  SELECT organization_id INTO v_organization_id
  FROM apps
  WHERE id = NEW.app_id;

  -- Create gap records for missing fields
  IF NEW.phone IS NULL OR NEW.phone = '' THEN
    INSERT INTO customer_data_gaps (member_id, organization_id, missing_field, priority_score)
    VALUES (NEW.id, v_organization_id, 'phone', 70) -- Phone is high priority
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

-- Create trigger for new members
DROP TRIGGER IF EXISTS trigger_initialize_member_data_gaps ON app_members;
CREATE TRIGGER trigger_initialize_member_data_gaps
  AFTER INSERT ON app_members
  FOR EACH ROW
  EXECUTE FUNCTION initialize_member_data_gaps();

-- ============================================================================
-- 9. UPDATE DATA GAPS WHEN MEMBER DATA CHANGES
-- Removes gap records when data is filled in
-- ============================================================================
CREATE OR REPLACE FUNCTION update_member_data_gaps()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Phone filled in
  IF (OLD.phone IS NULL OR OLD.phone = '') AND NEW.phone IS NOT NULL AND NEW.phone != '' THEN
    DELETE FROM customer_data_gaps
    WHERE member_id = NEW.id AND missing_field = 'phone';
  END IF;

  -- Email filled in
  IF (OLD.email IS NULL OR OLD.email = '') AND NEW.email IS NOT NULL AND NEW.email != '' THEN
    DELETE FROM customer_data_gaps
    WHERE member_id = NEW.id AND missing_field = 'email';
  END IF;

  -- Birthday filled in
  IF OLD.birthday IS NULL AND NEW.birthday IS NOT NULL THEN
    DELETE FROM customer_data_gaps
    WHERE member_id = NEW.id AND missing_field = 'birthday';
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger for member updates
DROP TRIGGER IF EXISTS trigger_update_member_data_gaps ON app_members;
CREATE TRIGGER trigger_update_member_data_gaps
  AFTER UPDATE ON app_members
  FOR EACH ROW
  EXECUTE FUNCTION update_member_data_gaps();
