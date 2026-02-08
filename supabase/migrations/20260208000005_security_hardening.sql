-- Migration: Security Hardening
-- Adds distributed locking, batch operations, and structured logging support

-- ============================================================================
-- 1. DISTRIBUTED LOCKING FOR ACTION QUEUE
-- ============================================================================

-- Add executing_instance column for tracking which instance is processing
ALTER TABLE ai_action_queue
ADD COLUMN IF NOT EXISTS executing_instance UUID;

-- Add index for efficient instance tracking
CREATE INDEX IF NOT EXISTS idx_action_queue_executing_instance
ON ai_action_queue(executing_instance)
WHERE executing_instance IS NOT NULL;

-- Create claim function for atomic action claiming
-- Uses FOR UPDATE SKIP LOCKED to prevent race conditions
CREATE OR REPLACE FUNCTION claim_pending_actions(
  p_instance_id UUID,
  p_limit INTEGER DEFAULT 10
) RETURNS SETOF ai_action_queue AS $$
BEGIN
  RETURN QUERY
  UPDATE ai_action_queue
  SET status = 'executing',
      executing_instance = p_instance_id,
      updated_at = NOW()
  WHERE id IN (
    SELECT id FROM ai_action_queue
    WHERE status = 'approved'
    AND scheduled_for <= NOW()
    AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY scheduled_for
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Release abandoned actions (instance crashed without completing)
CREATE OR REPLACE FUNCTION release_abandoned_actions(
  p_timeout_minutes INTEGER DEFAULT 15
) RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE ai_action_queue
  SET status = 'approved',
      executing_instance = NULL,
      updated_at = NOW(),
      error_message = 'Released: execution timeout exceeded'
  WHERE status = 'executing'
  AND updated_at < NOW() - (p_timeout_minutes || ' minutes')::INTERVAL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 2. BATCH POINTS AWARD FUNCTION
-- ============================================================================

-- Batch award points to multiple members atomically
CREATE OR REPLACE FUNCTION batch_award_points(
  p_member_ids UUID[],
  p_points INTEGER,
  p_reason TEXT,
  p_app_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_awarded INTEGER;
BEGIN
  -- Validate inputs
  IF p_points <= 0 OR p_points > 10000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Points must be between 1 and 10000');
  END IF;

  IF array_length(p_member_ids, 1) > 1000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Maximum 1000 members per batch');
  END IF;

  -- Update all members in single query
  UPDATE app_members
  SET
    points_balance = COALESCE(points_balance, 0) + p_points,
    total_points_earned = COALESCE(total_points_earned, 0) + p_points,
    updated_at = NOW()
  WHERE id = ANY(p_member_ids)
  AND app_id = p_app_id
  AND deleted_at IS NULL;

  GET DIAGNOSTICS v_awarded = ROW_COUNT;

  -- Create events for all awarded members
  INSERT INTO app_events (app_id, member_id, event_type, event_data)
  SELECT
    p_app_id,
    m.id,
    'bonus_points_awarded',
    jsonb_build_object(
      'points', p_points,
      'reason', p_reason,
      'source', 'ai_autonomous',
      'batch_size', array_length(p_member_ids, 1)
    )
  FROM app_members m
  WHERE m.id = ANY(p_member_ids)
  AND m.app_id = p_app_id
  AND m.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'success', true,
    'awarded', v_awarded,
    'requested', array_length(p_member_ids, 1)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 3. SAFE RATE LIMIT CHECK
-- ============================================================================

-- Rate limit check that fails closed on errors
CREATE OR REPLACE FUNCTION safe_check_rate_limit(
  p_org_id UUID,
  p_action_type TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_daily_limit INTEGER;
  v_today_start TIMESTAMPTZ;
  v_used INTEGER;
  v_remaining INTEGER;
BEGIN
  -- Get org's daily limit with fallback
  SELECT COALESCE(ai_daily_action_limit, 20)
  INTO v_daily_limit
  FROM organizations
  WHERE id = p_org_id;

  -- If org not found, fail closed
  IF v_daily_limit IS NULL THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'limit', 20,
      'reason', 'Organization not found'
    );
  END IF;

  -- Calculate today's start
  v_today_start := date_trunc('day', NOW() AT TIME ZONE 'UTC');

  -- Count today's executed/executing actions
  SELECT COUNT(*)
  INTO v_used
  FROM ai_action_queue
  WHERE organization_id = p_org_id
  AND status IN ('executed', 'executing')
  AND executed_at >= v_today_start;

  v_remaining := GREATEST(0, v_daily_limit - v_used);

  RETURN jsonb_build_object(
    'allowed', v_remaining > 0,
    'remaining', v_remaining,
    'limit', v_daily_limit,
    'used', v_used
  );
EXCEPTION WHEN OTHERS THEN
  -- Fail closed on any error
  RETURN jsonb_build_object(
    'allowed', false,
    'remaining', 0,
    'limit', 20,
    'reason', 'Rate limit check error: ' || SQLERRM
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 4. AUDIT LOG ENHANCEMENTS
-- ============================================================================

-- Add request_id for tracing
ALTER TABLE ai_audit_log
ADD COLUMN IF NOT EXISTS request_id UUID;

-- Add index for request tracing
CREATE INDEX IF NOT EXISTS idx_audit_log_request_id
ON ai_audit_log(request_id)
WHERE request_id IS NOT NULL;

-- ============================================================================
-- 5. COMMENTS
-- ============================================================================

COMMENT ON FUNCTION claim_pending_actions IS 'Atomically claim actions for processing with distributed lock';
COMMENT ON FUNCTION release_abandoned_actions IS 'Release actions stuck in executing state (instance crash recovery)';
COMMENT ON FUNCTION batch_award_points IS 'Award points to multiple members in single transaction';
COMMENT ON FUNCTION safe_check_rate_limit IS 'Check rate limit with fail-closed behavior on errors';
