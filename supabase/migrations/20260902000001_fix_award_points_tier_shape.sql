-- Fix: award_points() raises 22P02 on nested tier_thresholds
-- ============================================================================
--
-- THE BUG
-- award_points() read tier thresholds as flat integers:
--
--     WHEN v_new_balance >= COALESCE((v_tier_thresholds->>'platinum')::INTEGER, 5000)
--
-- but two writers disagree on the shape of settings.tier_thresholds:
--
--   app-builder.js getAppData()      -> NESTED  {"platinum": {"name": "Platinum", "points": 5000}}
--   dashboard.js autoCreateDefaultApp -> FLAT    {"platinum": 5000}
--
-- On the nested shape, ->>'platinum' returns the JSON object as text and
-- ::INTEGER raises 22P02. COALESCE does not help: the cast errors while the
-- argument is being evaluated, before there is any NULL to fall back from.
-- Every point award on such an app fails. The wizard auto-saves on each Next,
-- so any app ever opened in the builder is already in this state.
--
-- VERIFIED IN PRODUCTION (2026-09-02), not inferred from the repo. Calling
-- award_points() against a nested-shape app with a non-existent member (so the
-- call could only ever abort) returned:
--
--   SQLSTATE 22P02: invalid input syntax for type integer:
--                   "{"name": "Platinum", "points": 5000}"
--
-- while flat-shape apps cleared the tier CASE and failed later, harmlessly, on
-- balance_after NOT NULL. That is a behavioural fingerprint of the flat-only
-- definition being live.
--
-- THE FIX
-- Read both shapes, and read them defensively. tier_threshold_points() tries
-- the nested key first, then the flat key, then the caller's default, and
-- regex-guards every value so a malformed threshold degrades to the default
-- instead of raising. COALESCE short-circuits, so the flat branch is not even
-- evaluated when the nested branch matched.
--
-- No data is rewritten: apps keep whatever shape they already have, and both
-- now award points correctly.
--
-- NOT AFFECTED: batch_award_points() (20260208000005) does not read tiers at
-- all -- it only increments points_balance -- so it needs no change.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Shape-tolerant threshold reader
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tier_threshold_points(
    p_thresholds JSONB,
    p_tier       TEXT,
    p_default    INTEGER
)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
    SELECT COALESCE(
        -- Nested shape: {"silver": {"name": "Slurp Society", "points": 500}}
        (SELECT v::INTEGER
           FROM (SELECT p_thresholds -> p_tier ->> 'points') AS s(v)
          WHERE v ~ '^\s*\d{1,9}\s*$'),
        -- Flat shape: {"silver": 500}
        (SELECT v::INTEGER
           FROM (SELECT p_thresholds ->> p_tier) AS s(v)
          WHERE v ~ '^\s*\d{1,9}\s*$'),
        -- Missing, malformed, negative, or non-numeric -> caller's default
        p_default
    );
$$;

COMMENT ON FUNCTION public.tier_threshold_points(JSONB, TEXT, INTEGER) IS
    'Reads a tier threshold from customer_apps.settings->tier_thresholds, '
    'tolerating both the nested {points: N} shape written by the app builder '
    'and the flat N shape written by autoCreateDefaultApp. Never raises: any '
    'missing or non-numeric value falls back to p_default.';


-- ----------------------------------------------------------------------------
-- award_points(): identical to the deployed definition except the tier CASE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.award_points(
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
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_balance INTEGER;
    v_new_balance INTEGER;
    v_old_tier TEXT;
    v_new_tier TEXT;
    v_tier_thresholds JSONB;
BEGIN
    -- Lock the row to prevent race conditions
    SELECT points_balance, tier INTO v_old_balance, v_old_tier
    FROM public.app_members
    WHERE id = p_member_id AND app_id = p_app_id
    FOR UPDATE;

    -- Calculate new balance
    v_new_balance := v_old_balance + p_points;

    -- Get tier thresholds
    SELECT settings->'tier_thresholds' INTO v_tier_thresholds
    FROM public.customer_apps
    WHERE id = p_app_id;

    -- Determine new tier based on balance. Shape-tolerant: see the header.
    SELECT
        CASE
            WHEN v_new_balance >= public.tier_threshold_points(v_tier_thresholds, 'platinum', 5000) THEN 'platinum'
            WHEN v_new_balance >= public.tier_threshold_points(v_tier_thresholds, 'gold', 1500) THEN 'gold'
            WHEN v_new_balance >= public.tier_threshold_points(v_tier_thresholds, 'silver', 500) THEN 'silver'
            ELSE 'bronze'
        END INTO v_new_tier;

    -- Update member (atomic with the lock)
    UPDATE public.app_members
    SET
        points_balance = v_new_balance,
        total_points_earned = total_points_earned + GREATEST(p_points, 0),
        tier = v_new_tier,
        updated_at = NOW()
    WHERE id = p_member_id;

    -- Record transaction
    INSERT INTO public.points_transactions (app_id, member_id, type, points_change, balance_after, description, metadata)
    VALUES (p_app_id, p_member_id, p_type, p_points, v_new_balance, p_description, p_metadata);

    -- If tier changed, record event
    IF v_new_tier != v_old_tier AND p_points > 0 THEN
        INSERT INTO public.app_events (app_id, member_id, event_type, event_data)
        VALUES (p_app_id, p_member_id, 'tier_upgrade', jsonb_build_object(
            'old_tier', v_old_tier,
            'new_tier', v_new_tier
        ));
    END IF;

    RETURN QUERY SELECT v_new_balance, v_new_tier, (v_new_tier != v_old_tier);
END;
$$;

GRANT EXECUTE ON FUNCTION public.award_points(UUID, UUID, INTEGER, TEXT, TEXT, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
