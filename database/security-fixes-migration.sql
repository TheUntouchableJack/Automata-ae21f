-- =====================================================
-- SECURITY FIXES MIGRATION
-- Run this in Supabase SQL Editor
-- Fixes: Race conditions, webhook idempotency, auth rate limiting
-- =====================================================

-- =====================================================
-- 1. WEBHOOK IDEMPOTENCY TABLE
-- Prevents duplicate processing of Stripe webhooks
-- =====================================================

CREATE TABLE IF NOT EXISTS processed_webhook_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    processed_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_processed_webhooks_time
    ON processed_webhook_events(processed_at);

-- RLS (service role only - used by Edge Functions)
ALTER TABLE processed_webhook_events ENABLE ROW LEVEL SECURITY;

-- No public policies - only service role can access
COMMENT ON TABLE processed_webhook_events IS 'Tracks processed Stripe webhook events to prevent duplicate handling';

-- Cleanup function (run daily via cron)
CREATE OR REPLACE FUNCTION cleanup_old_webhook_events()
RETURNS void AS $$
BEGIN
    DELETE FROM processed_webhook_events
    WHERE processed_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =====================================================
-- 2. FIX award_points() - Add FOR UPDATE lock
-- =====================================================

-- Drop existing function first (to allow clean replacement)
DROP FUNCTION IF EXISTS award_points(uuid, uuid, integer, text, text, jsonb);

CREATE OR REPLACE FUNCTION award_points(
    p_app_id UUID,
    p_member_id UUID,
    p_points INTEGER,
    p_type TEXT DEFAULT 'manual',
    p_description TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS TABLE (
    new_balance INTEGER,
    new_tier TEXT,
    tier_changed BOOLEAN
) AS $$
DECLARE
    v_old_balance INTEGER;
    v_new_balance INTEGER;
    v_old_tier TEXT;
    v_new_tier TEXT;
    v_tier_thresholds JSONB;
BEGIN
    -- SECURITY FIX: Lock the row to prevent race conditions
    SELECT points_balance, tier INTO v_old_balance, v_old_tier
    FROM app_members
    WHERE id = p_member_id AND app_id = p_app_id
    FOR UPDATE;  -- <-- CRITICAL: Prevents concurrent updates

    -- Calculate new balance
    v_new_balance := v_old_balance + p_points;

    -- Get tier thresholds
    SELECT settings->'tier_thresholds' INTO v_tier_thresholds
    FROM customer_apps
    WHERE id = p_app_id;

    -- Determine new tier based on total earned
    SELECT
        CASE
            WHEN v_new_balance >= COALESCE((v_tier_thresholds->>'platinum')::INTEGER, 5000) THEN 'platinum'
            WHEN v_new_balance >= COALESCE((v_tier_thresholds->>'gold')::INTEGER, 1500) THEN 'gold'
            WHEN v_new_balance >= COALESCE((v_tier_thresholds->>'silver')::INTEGER, 500) THEN 'silver'
            ELSE 'bronze'
        END INTO v_new_tier;

    -- Update member (atomic with the lock)
    UPDATE app_members
    SET
        points_balance = v_new_balance,
        total_points_earned = total_points_earned + GREATEST(p_points, 0),
        tier = v_new_tier,
        updated_at = NOW()
    WHERE id = p_member_id;

    -- Record transaction
    INSERT INTO points_transactions (app_id, member_id, type, points_change, balance_after, description, metadata)
    VALUES (p_app_id, p_member_id, p_type, p_points, v_new_balance, p_description, p_metadata);

    -- If tier changed, record event
    IF v_new_tier != v_old_tier AND p_points > 0 THEN
        INSERT INTO app_events (app_id, member_id, event_type, event_data)
        VALUES (p_app_id, p_member_id, 'tier_upgrade', jsonb_build_object(
            'old_tier', v_old_tier,
            'new_tier', v_new_tier
        ));
    END IF;

    RETURN QUERY SELECT v_new_balance, v_new_tier, (v_new_tier != v_old_tier);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =====================================================
-- 3. FIX redeem_reward() - Add FOR UPDATE locks
-- =====================================================

-- Drop existing function first (to allow clean replacement)
DROP FUNCTION IF EXISTS redeem_reward(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION redeem_reward(
    p_app_id UUID,
    p_member_id UUID,
    p_reward_id UUID
)
RETURNS TABLE (
    success BOOLEAN,
    redemption_id UUID,
    redemption_code TEXT,
    error_message TEXT
) AS $$
DECLARE
    v_reward RECORD;
    v_member RECORD;
    v_redemption_id UUID;
    v_redemption_code TEXT;
    v_member_redemption_count INTEGER;
BEGIN
    -- SECURITY FIX: Lock the reward row to prevent overselling
    SELECT * INTO v_reward
    FROM app_rewards
    WHERE id = p_reward_id AND app_id = p_app_id AND is_active = true AND deleted_at IS NULL
    FOR UPDATE;  -- <-- CRITICAL: Prevents inventory race condition

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Reward not found or inactive';
        RETURN;
    END IF;

    -- Check dates
    IF v_reward.start_date IS NOT NULL AND v_reward.start_date > NOW() THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Reward not yet available';
        RETURN;
    END IF;

    IF v_reward.end_date IS NOT NULL AND v_reward.end_date < NOW() THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Reward has expired';
        RETURN;
    END IF;

    -- Check quantity (now safe with FOR UPDATE lock)
    IF v_reward.quantity_available IS NOT NULL AND v_reward.quantity_redeemed >= v_reward.quantity_available THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Reward is out of stock';
        RETURN;
    END IF;

    -- SECURITY FIX: Lock the member row too
    SELECT * INTO v_member
    FROM app_members
    WHERE id = p_member_id AND app_id = p_app_id AND deleted_at IS NULL
    FOR UPDATE;  -- <-- CRITICAL: Prevents double-spend

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Member not found';
        RETURN;
    END IF;

    -- Check tier requirement
    IF v_reward.tier_required IS NOT NULL THEN
        IF v_reward.tier_required = 'platinum' AND v_member.tier NOT IN ('platinum') THEN
            RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Platinum tier required';
            RETURN;
        ELSIF v_reward.tier_required = 'gold' AND v_member.tier NOT IN ('gold', 'platinum') THEN
            RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Gold tier or higher required';
            RETURN;
        ELSIF v_reward.tier_required = 'silver' AND v_member.tier NOT IN ('silver', 'gold', 'platinum') THEN
            RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Silver tier or higher required';
            RETURN;
        END IF;
    END IF;

    -- Check points (now safe with FOR UPDATE lock)
    IF v_member.points_balance < v_reward.points_cost THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Insufficient points';
        RETURN;
    END IF;

    -- Check max per member
    IF v_reward.max_per_member IS NOT NULL THEN
        SELECT COUNT(*) INTO v_member_redemption_count
        FROM reward_redemptions
        WHERE member_id = p_member_id AND reward_id = p_reward_id AND status != 'cancelled';

        IF v_member_redemption_count >= v_reward.max_per_member THEN
            RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Maximum redemptions reached for this reward';
            RETURN;
        END IF;
    END IF;

    -- Generate redemption code
    v_redemption_code := upper(substring(md5(random()::text) from 1 for 8));

    -- Create redemption
    INSERT INTO reward_redemptions (app_id, member_id, reward_id, points_spent, reward_name, redemption_code, expires_at)
    VALUES (p_app_id, p_member_id, p_reward_id, v_reward.points_cost, v_reward.name, v_redemption_code, NOW() + INTERVAL '30 days')
    RETURNING id INTO v_redemption_id;

    -- Deduct points (uses the same transaction, so still locked)
    PERFORM award_points(p_app_id, p_member_id, -v_reward.points_cost, 'reward_redeem',
        'Redeemed: ' || v_reward.name,
        jsonb_build_object('reward_id', p_reward_id, 'redemption_id', v_redemption_id));

    -- Update reward quantity (atomic within same transaction)
    UPDATE app_rewards
    SET quantity_redeemed = quantity_redeemed + 1, updated_at = NOW()
    WHERE id = p_reward_id;

    -- Update member total redeemed
    UPDATE app_members
    SET total_points_redeemed = total_points_redeemed + v_reward.points_cost, updated_at = NOW()
    WHERE id = p_member_id;

    -- Record event
    INSERT INTO app_events (app_id, member_id, event_type, event_data)
    VALUES (p_app_id, p_member_id, 'reward_redeemed', jsonb_build_object(
        'reward_id', p_reward_id,
        'reward_name', v_reward.name,
        'points_spent', v_reward.points_cost,
        'redemption_id', v_redemption_id
    ));

    RETURN QUERY SELECT true, v_redemption_id, v_redemption_code, NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =====================================================
-- 4. FIX record_member_visit() - Add FOR UPDATE lock
-- =====================================================

-- Drop existing function first (parameter names changed)
DROP FUNCTION IF EXISTS record_member_visit(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION record_member_visit(
    p_member_id UUID,
    p_app_id UUID,
    p_location_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_member RECORD;
    v_app RECORD;
    v_visits_today INTEGER;
    v_points_per_visit INTEGER;
    v_daily_limit INTEGER;
    v_today DATE := CURRENT_DATE;
    v_last_visit DATE;
    v_new_streak INTEGER;
    v_streak_bonus INTEGER := 0;
    v_milestone_bonus INTEGER := 0;
    v_total_points INTEGER;
    v_visit_id UUID;
BEGIN
    -- Get app settings
    SELECT * INTO v_app
    FROM customer_apps
    WHERE id = p_app_id AND deleted_at IS NULL;

    IF v_app.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_message', 'App not found');
    END IF;

    -- Get settings from app
    v_points_per_visit := COALESCE((v_app.settings->>'points_per_visit')::INTEGER, 10);
    v_daily_limit := COALESCE((v_app.settings->>'daily_visit_limit')::INTEGER, 1);

    -- SECURITY FIX: Lock the member row to prevent race conditions
    SELECT * INTO v_member
    FROM app_members
    WHERE id = p_member_id
      AND app_id = p_app_id
      AND deleted_at IS NULL
    FOR UPDATE;  -- <-- CRITICAL: Prevents double visit awards

    IF v_member.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_message', 'Member not found');
    END IF;

    -- Check daily limit (now safe with FOR UPDATE lock)
    SELECT COUNT(*) INTO v_visits_today
    FROM member_visits
    WHERE member_id = p_member_id
      AND DATE(visited_at) = v_today;

    IF v_visits_today >= v_daily_limit THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Daily visit limit reached',
            'visits_today', v_visits_today,
            'daily_limit', v_daily_limit
        );
    END IF;

    -- Calculate streak
    v_last_visit := DATE(v_member.last_visit_at);

    IF v_last_visit = v_today - INTERVAL '1 day' THEN
        -- Consecutive day - increment streak
        v_new_streak := COALESCE(v_member.current_streak, 0) + 1;
    ELSIF v_last_visit = v_today THEN
        -- Same day - keep current streak
        v_new_streak := COALESCE(v_member.current_streak, 1);
    ELSE
        -- Streak broken - start fresh
        v_new_streak := 1;
    END IF;

    -- Calculate streak bonus
    IF v_new_streak = 3 THEN v_streak_bonus := 5;
    ELSIF v_new_streak = 7 THEN v_streak_bonus := 15;
    ELSIF v_new_streak = 30 THEN v_streak_bonus := 50;
    END IF;

    -- Calculate milestone bonus (based on total visits + 1)
    IF (v_member.visit_count + 1) = 10 THEN v_milestone_bonus := 25;
    ELSIF (v_member.visit_count + 1) = 50 THEN v_milestone_bonus := 100;
    ELSIF (v_member.visit_count + 1) = 100 THEN v_milestone_bonus := 250;
    END IF;

    v_total_points := v_points_per_visit + v_streak_bonus + v_milestone_bonus;

    -- Record visit
    INSERT INTO member_visits (member_id, app_id, points_awarded, streak_bonus, milestone_bonus, location_id)
    VALUES (p_member_id, p_app_id, v_points_per_visit, v_streak_bonus, v_milestone_bonus, p_location_id)
    RETURNING id INTO v_visit_id;

    -- Update member (atomic with the lock)
    UPDATE app_members
    SET
        points_balance = points_balance + v_total_points,
        total_points_earned = total_points_earned + v_total_points,
        visit_count = visit_count + 1,
        current_streak = v_new_streak,
        longest_streak = GREATEST(longest_streak, v_new_streak),
        last_visit_at = NOW()
    WHERE id = p_member_id;

    -- Record points transaction
    INSERT INTO points_transactions (member_id, app_id, type, points_change, description, metadata)
    VALUES (
        p_member_id,
        p_app_id,
        'visit',
        v_total_points,
        CASE
            WHEN v_streak_bonus > 0 AND v_milestone_bonus > 0 THEN 'Visit + ' || v_new_streak || '-day streak + Milestone bonus!'
            WHEN v_streak_bonus > 0 THEN 'Visit + ' || v_new_streak || '-day streak bonus!'
            WHEN v_milestone_bonus > 0 THEN 'Visit + Milestone bonus!'
            ELSE 'Check-in visit'
        END,
        jsonb_build_object(
            'visit_id', v_visit_id,
            'base_points', v_points_per_visit,
            'streak_bonus', v_streak_bonus,
            'milestone_bonus', v_milestone_bonus,
            'streak_days', v_new_streak
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'points_awarded', v_total_points,
        'base_points', v_points_per_visit,
        'streak_bonus', v_streak_bonus,
        'milestone_bonus', v_milestone_bonus,
        'current_streak', v_new_streak,
        'visit_count', v_member.visit_count + 1,
        'new_balance', v_member.points_balance + v_total_points
    );
END;
$$;


-- =====================================================
-- 5. AUTH RATE LIMITING - Login/Signup protection
-- =====================================================

-- These use the existing rate_limits table and check_and_record_rate_limit function
-- The limits are enforced in auth.js on the client side, calling the RPC

-- Verify rate limit function exists (from rate-limits.sql)
-- Drop first to allow parameter name changes
DROP FUNCTION IF EXISTS check_and_record_rate_limit(text, text, integer, integer);

CREATE OR REPLACE FUNCTION check_and_record_rate_limit(
    p_identifier TEXT,
    p_action_type TEXT,
    p_max_attempts INTEGER,
    p_window_minutes INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INTEGER;
    v_window_start TIMESTAMPTZ;
BEGIN
    v_window_start := NOW() - (p_window_minutes || ' minutes')::INTERVAL;

    -- Count recent attempts
    SELECT COUNT(*) INTO v_count
    FROM rate_limits
    WHERE identifier = p_identifier
      AND action_type = p_action_type
      AND created_at > v_window_start;

    -- Check if over limit
    IF v_count >= p_max_attempts THEN
        RETURN FALSE;
    END IF;

    -- Record this attempt
    INSERT INTO rate_limits (identifier, action_type)
    VALUES (p_identifier, p_action_type);

    RETURN TRUE;
END;
$$;

-- Grant to anon for public rate limiting (login/signup)
GRANT EXECUTE ON FUNCTION check_and_record_rate_limit(TEXT, TEXT, INTEGER, INTEGER) TO anon, authenticated;


-- =====================================================
-- DONE! Run this migration in Supabase SQL Editor
-- =====================================================
-- After running:
-- 1. Deploy updated Edge Functions (stripe-webhook, create-checkout-session)
-- 2. Update auth.js with rate limiting calls
-- 3. Add CAPTCHA to forms
-- =====================================================
