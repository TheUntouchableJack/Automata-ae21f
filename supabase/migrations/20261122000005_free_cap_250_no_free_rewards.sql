-- Free plan holds 250 customers; no reward is free (2026-11-22)
--
-- Plan cool-anything-here-wiggly-valiant, items 5 and 6.
--
-- 5. The UI and pricing promise 250 customers on Free (app/plan-limits.js, index.html, pricing.html)
--    but get_org_member_limit() (20260315000007) returned 50, so customer #51 of a free business
--    got "program is full" from join_app. Free is now 250, the published promise. Paid tiers,
--    AppSumo tiers and plan_limits_override are unchanged. The dashboard warns the owner at 80%.
--
-- 6. member_redeem_reward() (20261122000002) let a member redeem a 0-point reward with no cap,
--    every day: the dashboard seeded a 0-point "Birthday Bonus" on every auto-created app. The
--    seed is gone (app/dashboard.js) and the RPC now refuses points_cost < 1. Existing 0-point
--    rows are owner data and stay; the NOTICE below counts them for Jay.
--
-- Both functions are replaced in place (same signatures): their grants stay as they are.

DO $$
DECLARE
    v_free_over_50 INTEGER;
    v_zero_rewards INTEGER;
    v_zero_apps INTEGER;
BEGIN
    IF to_regprocedure('public.get_org_member_limit(uuid)') IS NULL THEN
        RAISE EXCEPTION 'pre-flight: get_org_member_limit(uuid) is missing.';
    END IF;
    IF to_regprocedure('public.member_redeem_reward(uuid,uuid)') IS NULL THEN
        RAISE EXCEPTION 'pre-flight: member_redeem_reward(uuid,uuid) (20261122000002) is missing.';
    END IF;

    SELECT count(*) INTO v_free_over_50
    FROM organizations o
    WHERE coalesce(o.plan_type, 'free') NOT IN ('appsumo_lifetime', 'subscription')
      AND (o.plan_limits_override IS NULL OR NOT (o.plan_limits_override ? 'members'))
      AND (SELECT count(*) FROM app_members am JOIN customer_apps ca ON ca.id = am.app_id
           WHERE ca.organization_id = o.id AND am.deleted_at IS NULL) >= 50;

    SELECT count(*), count(DISTINCT r.app_id) INTO v_zero_rewards, v_zero_apps
    FROM app_rewards r
    WHERE coalesce(r.points_cost, 0) < 1 AND r.is_active = true AND r.deleted_at IS NULL;

    RAISE NOTICE 'pre-flight OK. Free orgs at or over the old 50 cap: %. Active rewards under 1 point: % in % app(s) (left as they are; now refused at redeem).',
        v_free_over_50, v_zero_rewards, v_zero_apps;
END $$;


-- ===== 5. Free = 250 =====

CREATE OR REPLACE FUNCTION public.get_org_member_limit(p_org_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_org RECORD;
BEGIN
    SELECT plan_type, appsumo_tier, subscription_tier, plan_limits_override
    INTO v_org
    FROM organizations
    WHERE id = p_org_id;

    IF NOT FOUND THEN
        RETURN 250;
    END IF;

    IF v_org.plan_limits_override IS NOT NULL AND v_org.plan_limits_override ? 'members' THEN
        RETURN (v_org.plan_limits_override->>'members')::INTEGER;
    END IF;

    CASE v_org.plan_type
        WHEN 'appsumo_lifetime' THEN
            CASE v_org.appsumo_tier
                WHEN 1 THEN RETURN 500;
                WHEN 2 THEN RETURN 2000;
                WHEN 3 THEN RETURN -1;
                ELSE RETURN 500;
            END CASE;
        WHEN 'subscription' THEN
            CASE v_org.subscription_tier
                WHEN 'starter' THEN RETURN 500;
                WHEN 'growth' THEN RETURN 2000;
                WHEN 'scale' THEN RETURN -1;
                ELSE RETURN 500;
            END CASE;
        ELSE
            RETURN 250;
    END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ===== 6. Every reward costs at least 1 point =====

CREATE OR REPLACE FUNCTION public.member_redeem_reward(p_app_id UUID, p_reward_id UUID)
RETURNS TABLE (
    success BOOLEAN,
    redemption_id UUID,
    redemption_code TEXT,
    expires_at TIMESTAMPTZ,
    new_balance INTEGER,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_variable
DECLARE
    v_uid UUID := auth.uid();
    v_reward RECORD;
    v_member RECORD;
    v_count INTEGER;
    v_code TEXT;
    v_id UUID;
    v_expires TIMESTAMPTZ := NOW() + INTERVAL '30 days';
    v_balance INTEGER;
BEGIN
    IF v_uid IS NULL THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::INTEGER, 'Please sign in first.'::TEXT;
        RETURN;
    END IF;

    SELECT r.* INTO v_reward
    FROM app_rewards r
    WHERE r.id = p_reward_id AND r.app_id = p_app_id AND r.is_active = true AND r.deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::INTEGER, 'Reward not found or inactive'::TEXT;
        RETURN;
    END IF;
    -- A reward that costs nothing could be redeemed by every member every day (the auto-seeded
    -- 0-point "Birthday Bonus" did exactly that). Every reward costs at least 1 point.
    IF coalesce(v_reward.points_cost, 0) < 1 THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::INTEGER, 'This reward is not available yet.'::TEXT;
        RETURN;
    END IF;
    IF v_reward.start_date IS NOT NULL AND v_reward.start_date > NOW() THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::INTEGER, 'Reward not yet available'::TEXT;
        RETURN;
    END IF;
    IF v_reward.end_date IS NOT NULL AND v_reward.end_date < NOW() THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::INTEGER, 'Reward has expired'::TEXT;
        RETURN;
    END IF;
    IF v_reward.quantity_available IS NOT NULL
       AND coalesce(v_reward.quantity_redeemed, 0) >= v_reward.quantity_available THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::INTEGER, 'Reward is out of stock'::TEXT;
        RETURN;
    END IF;

    SELECT m.* INTO v_member
    FROM app_members m
    WHERE m.app_id = p_app_id AND m.user_id = v_uid AND m.deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::INTEGER, 'Join this program first.'::TEXT;
        RETURN;
    END IF;

    IF v_reward.tier_required = 'platinum' AND v_member.tier NOT IN ('platinum') THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::INTEGER, 'Platinum tier required'::TEXT;
        RETURN;
    ELSIF v_reward.tier_required = 'gold' AND v_member.tier NOT IN ('gold', 'platinum') THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::INTEGER, 'Gold tier or higher required'::TEXT;
        RETURN;
    ELSIF v_reward.tier_required = 'silver' AND v_member.tier NOT IN ('silver', 'gold', 'platinum') THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::INTEGER, 'Silver tier or higher required'::TEXT;
        RETURN;
    END IF;

    IF coalesce(v_member.points_balance, 0) < v_reward.points_cost THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::INTEGER, 'Not enough points'::TEXT;
        RETURN;
    END IF;

    IF v_reward.max_per_member IS NOT NULL THEN
        SELECT count(*) INTO v_count
        FROM reward_redemptions rr
        WHERE rr.member_id = v_member.id AND rr.reward_id = p_reward_id
          AND rr.status IS DISTINCT FROM 'cancelled';
        IF v_count >= v_reward.max_per_member THEN
            RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ, NULL::INTEGER, 'You have redeemed this reward the maximum number of times'::TEXT;
            RETURN;
        END IF;
    END IF;

    v_code := new_redemption_code();

    INSERT INTO reward_redemptions (app_id, member_id, reward_id, points_spent, reward_name,
                                    redemption_code, status, expires_at)
    VALUES (p_app_id, v_member.id, p_reward_id, v_reward.points_cost, v_reward.name,
            v_code, 'pending', v_expires)
    RETURNING id INTO v_id;

    SELECT ap.new_balance INTO v_balance
    FROM award_points(p_app_id, v_member.id, -v_reward.points_cost, 'reward_redeem',
                      'Redeemed: ' || v_reward.name,
                      jsonb_build_object('reward_id', p_reward_id, 'redemption_id', v_id)) ap;

    UPDATE app_rewards r
       SET quantity_redeemed = coalesce(r.quantity_redeemed, 0) + 1, updated_at = NOW()
     WHERE r.id = p_reward_id;

    UPDATE app_members m
       SET total_points_redeemed = coalesce(m.total_points_redeemed, 0) + v_reward.points_cost,
           updated_at = NOW()
     WHERE m.id = v_member.id;

    INSERT INTO app_events (app_id, member_id, event_type, event_data)
    VALUES (p_app_id, v_member.id, 'reward_redeemed', jsonb_build_object(
        'reward_id', p_reward_id, 'reward_name', v_reward.name,
        'points_spent', v_reward.points_cost, 'redemption_id', v_id));

    RETURN QUERY SELECT true, v_id, v_code, v_expires, v_balance, NULL::TEXT;
END;
$$;
