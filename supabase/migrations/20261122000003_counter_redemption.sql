-- ============================================================================
-- 20261122000003 — Staff give rewards at the counter (B2)
-- ============================================================================
--
-- Plan: ~/.claude/plans/royalty-in-store-loop.md, round B2.
--
-- A member redeems in the app (member_redeem_reward, 20261122000002) and gets an
-- 8-character code. Until now no staff screen read reward_redemptions; the code
-- only flashed in a toast. This adds:
--
--   member_get_redemptions(app)     the member's own unused, unexpired codes ("My rewards")
--   lookup_redemption(code)         staff: what is this code, whose, still good?
--   fulfill_redemption(code)        staff: give it (status fulfilled, by whom, when), once
--   counter_summary(app, since)     staff: rewards given since a time, codes still waiting
--
-- Staff = any organization_members row for the org that owns the code's app
-- (owner, admin or member), or a super admin (profiles.is_admin).
-- A code from another business answers 'other_business' and shows nothing about it.
-- ============================================================================

DO $preflight$
DECLARE
    v_need TEXT[] := ARRAY[
        'reward_redemptions.status','reward_redemptions.redemption_code','reward_redemptions.fulfilled_by',
        'reward_redemptions.fulfilled_at','reward_redemptions.redeemed_at','reward_redemptions.expires_at',
        'reward_redemptions.reward_name','reward_redemptions.points_spent','reward_redemptions.member_id',
        'reward_redemptions.app_id','organization_members.organization_id','organization_members.user_id',
        'profiles.is_admin','profiles.first_name','profiles.last_name'
    ];
    v_item TEXT;
    v_missing TEXT[] := '{}';
BEGIN
    FOREACH v_item IN ARRAY v_need LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = split_part(v_item, '.', 1)
                         AND column_name = split_part(v_item, '.', 2)) THEN
            v_missing := v_missing || v_item;
        END IF;
    END LOOP;
    IF array_length(v_missing, 1) > 0 THEN
        RAISE EXCEPTION 'pre-flight: missing column(s): %', array_to_string(v_missing, ', ');
    END IF;
    IF to_regprocedure('public.member_redeem_reward(uuid,uuid)') IS NULL THEN
        RAISE EXCEPTION 'pre-flight: 20261122000002 (member_redeem_reward) is not applied.';
    END IF;
    RAISE NOTICE 'pre-flight OK. reward_redemptions: % rows, statuses: %',
        (SELECT count(*) FROM public.reward_redemptions),
        (SELECT coalesce(string_agg(DISTINCT coalesce(status, '∅'), ','), '-') FROM public.reward_redemptions);
END
$preflight$;

-- ===== Fix from 20261122000002: a resend expires the earlier codes =====
-- (20261122000002 relied on "newest wins" alone; a created_at tie made the pick arbitrary.
-- Grants are unchanged by CREATE OR REPLACE: still service_role only.)
CREATE OR REPLACE FUNCTION public.member_code_issue(
    p_app_id UUID,
    p_email TEXT,
    p_code_hash TEXT,
    p_ip TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email TEXT := lower(trim(coalesce(p_email, '')));
    v_ip TEXT := nullif(left(trim(coalesce(p_ip, '')), 64), '');
BEGIN
    IF p_app_id IS NULL OR v_email = '' OR length(v_email) > 254
       OR coalesce(length(p_code_hash), 0) < 32 THEN
        RETURN 'invalid';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM customer_apps
        WHERE id = p_app_id AND is_published = true AND is_active = true
          AND deleted_at IS NULL AND app_type IS DISTINCT FROM 'social'
    ) THEN
        RETURN 'app_not_found';
    END IF;

    -- Serialise sends for one address so the counts below cannot be raced.
    PERFORM pg_advisory_xact_lock(hashtext('member_code:' || v_email));

    IF (SELECT count(*) FROM member_login_codes
        WHERE email = v_email AND created_at > NOW() - INTERVAL '15 minutes') >= 3
       OR (SELECT count(*) FROM member_login_codes
           WHERE email = v_email AND created_at > NOW() - INTERVAL '24 hours') >= 10 THEN
        RETURN 'rate_email';
    END IF;

    IF v_ip IS NOT NULL AND (SELECT count(*) FROM member_login_codes
        WHERE ip = v_ip AND created_at > NOW() - INTERVAL '1 hour') >= 20 THEN
        RETURN 'rate_ip';
    END IF;

    IF (SELECT count(*) FROM member_login_codes
        WHERE app_id = p_app_id AND created_at > NOW() - INTERVAL '1 hour') >= 200 THEN
        RETURN 'rate_app';
    END IF;

    -- Only the newest code works. member_code_check reads the newest row, but two sends in
    -- the same instant would tie on created_at; expiring the earlier ones removes the tie.
    UPDATE member_login_codes
       SET expires_at = LEAST(expires_at, NOW())
     WHERE app_id = p_app_id AND email = v_email AND consumed_at IS NULL AND expires_at > NOW();

    INSERT INTO member_login_codes (app_id, email, code_hash, ip, expires_at)
    VALUES (p_app_id, v_email, p_code_hash, v_ip, NOW() + INTERVAL '10 minutes');

    -- Housekeeping: rows older than 2 days have no use (the longest window is 24 h).
    DELETE FROM member_login_codes WHERE created_at < NOW() - INTERVAL '2 days';

    RETURN 'ok';
END;
$$;

CREATE INDEX IF NOT EXISTS idx_reward_redemptions_app_fulfilled
    ON public.reward_redemptions (app_id, fulfilled_at DESC) WHERE fulfilled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_member_status
    ON public.reward_redemptions (member_id, status);


-- Can the caller give rewards for this app? (internal)
CREATE OR REPLACE FUNCTION public.staff_manages_app(p_app_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT auth.uid() IS NOT NULL AND (
        EXISTS (SELECT 1 FROM customer_apps a
                JOIN organization_members om ON om.organization_id = a.organization_id
                WHERE a.id = p_app_id AND om.user_id = auth.uid())
        OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
    );
$$;

-- Typed or scanned: upper case, letters and digits only (old codes are hex, new ones skip 0/O/1/I).
CREATE OR REPLACE FUNCTION public.normalize_redemption_code(p_code TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT nullif(left(regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g'), 32), '');
$$;

-- The shape both staff functions answer with.
CREATE OR REPLACE FUNCTION public.redemption_view(p_id UUID, p_result TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'result', p_result,
        'code', rr.redemption_code,
        'reward_name', rr.reward_name,
        'points_spent', rr.points_spent,
        'member_first_name', coalesce(nullif(m.first_name, ''), nullif(m.display_name, ''), 'Member'),
        'app_name', a.name,
        'redeemed_at', rr.redeemed_at,
        'expires_at', rr.expires_at,
        'fulfilled_at', rr.fulfilled_at,
        'fulfilled_by_name', nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
    )
    FROM reward_redemptions rr
    JOIN customer_apps a ON a.id = rr.app_id
    LEFT JOIN app_members m ON m.id = rr.member_id
    LEFT JOIN profiles p ON p.id = rr.fulfilled_by
    WHERE rr.id = p_id;
$$;


-- result: ready | given (already) | expired | cancelled | not_found | other_business | not_signed_in
CREATE OR REPLACE FUNCTION public.lookup_redemption(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code TEXT := normalize_redemption_code(p_code);
    v_row RECORD;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('result', 'not_signed_in');
    END IF;
    IF v_code IS NULL THEN
        RETURN jsonb_build_object('result', 'not_found');
    END IF;

    SELECT rr.id, rr.app_id, rr.status, rr.expires_at INTO v_row
    FROM reward_redemptions rr WHERE rr.redemption_code = v_code;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('result', 'not_found');
    END IF;
    IF NOT staff_manages_app(v_row.app_id) THEN
        RETURN jsonb_build_object('result', 'other_business');
    END IF;

    RETURN redemption_view(v_row.id, CASE
        WHEN v_row.status = 'fulfilled' THEN 'given'
        WHEN v_row.status IN ('cancelled', 'expired') THEN v_row.status
        WHEN v_row.expires_at IS NOT NULL AND v_row.expires_at <= NOW() THEN 'expired'
        ELSE 'ready' END);
END;
$$;


-- result: given_now | given (already) | expired | cancelled | not_found | other_business | not_signed_in
CREATE OR REPLACE FUNCTION public.fulfill_redemption(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code TEXT := normalize_redemption_code(p_code);
    v_row RECORD;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('result', 'not_signed_in');
    END IF;
    IF v_code IS NULL THEN
        RETURN jsonb_build_object('result', 'not_found');
    END IF;

    -- Locked: two staff tapping "Give" on the same code give it once.
    SELECT rr.id, rr.app_id, rr.member_id, rr.status, rr.expires_at, rr.reward_name INTO v_row
    FROM reward_redemptions rr WHERE rr.redemption_code = v_code
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('result', 'not_found');
    END IF;
    IF NOT staff_manages_app(v_row.app_id) THEN
        RETURN jsonb_build_object('result', 'other_business');
    END IF;
    IF v_row.status = 'fulfilled' THEN
        RETURN redemption_view(v_row.id, 'given');
    END IF;
    IF v_row.status IN ('cancelled', 'expired') THEN
        RETURN redemption_view(v_row.id, v_row.status);
    END IF;
    IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= NOW() THEN
        RETURN redemption_view(v_row.id, 'expired');
    END IF;

    UPDATE reward_redemptions
       SET status = 'fulfilled', fulfilled_by = auth.uid(), fulfilled_at = NOW()
     WHERE id = v_row.id;

    INSERT INTO app_events (app_id, member_id, event_type, event_data)
    VALUES (v_row.app_id, v_row.member_id, 'reward_fulfilled',
            jsonb_build_object('redemption_id', v_row.id, 'reward_name', v_row.reward_name,
                               'fulfilled_by', auth.uid()));

    RETURN redemption_view(v_row.id, 'given_now');
END;
$$;


-- Rewards given since p_since (the caller's local midnight) and codes still waiting.
CREATE OR REPLACE FUNCTION public.counter_summary(p_app_id UUID, p_since TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT staff_manages_app(p_app_id) THEN
        RETURN jsonb_build_object('allowed', false);
    END IF;
    RETURN jsonb_build_object(
        'allowed', true,
        'given_since', (SELECT count(*) FROM reward_redemptions rr
                         WHERE rr.app_id = p_app_id AND rr.status = 'fulfilled'
                           AND rr.fulfilled_at >= coalesce(p_since, NOW() - INTERVAL '1 day')),
        'waiting', (SELECT count(*) FROM reward_redemptions rr
                     WHERE rr.app_id = p_app_id AND rr.status IN ('pending', 'confirmed')
                       AND (rr.expires_at IS NULL OR rr.expires_at > NOW()))
    );
END;
$$;


-- The member's own codes that can still be used.
CREATE OR REPLACE FUNCTION public.member_get_redemptions(p_app_id UUID)
RETURNS TABLE (
    id UUID,
    reward_name TEXT,
    redemption_code TEXT,
    points_spent INTEGER,
    redeemed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT rr.id, rr.reward_name, rr.redemption_code, rr.points_spent, rr.redeemed_at, rr.expires_at
    FROM reward_redemptions rr
    JOIN app_members m ON m.id = rr.member_id
    WHERE rr.app_id = p_app_id AND m.app_id = p_app_id
      AND m.user_id = auth.uid() AND m.deleted_at IS NULL AND auth.uid() IS NOT NULL
      AND rr.status IN ('pending', 'confirmed')
      AND (rr.expires_at IS NULL OR rr.expires_at > NOW())
    ORDER BY rr.redeemed_at DESC
    LIMIT 20;
$$;


DO $grants$
DECLARE
    v_client TEXT[] := ARRAY[
        'public.lookup_redemption(text)', 'public.fulfill_redemption(text)',
        'public.counter_summary(uuid,timestamp with time zone)', 'public.member_get_redemptions(uuid)'
    ];
    v_internal TEXT[] := ARRAY[
        'public.staff_manages_app(uuid)', 'public.normalize_redemption_code(text)',
        'public.redemption_view(uuid,text)'
    ];
    v_fn TEXT;
BEGIN
    FOREACH v_fn IN ARRAY v_client LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_fn);
    END LOOP;
    FOREACH v_fn IN ARRAY v_internal LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn);
    END LOOP;
END
$grants$;

DO $postflight$
DECLARE
    v_bad TEXT[] := '{}';
    v_fn TEXT;
BEGIN
    FOREACH v_fn IN ARRAY ARRAY['public.lookup_redemption(text)', 'public.fulfill_redemption(text)',
                                'public.counter_summary(uuid,timestamp with time zone)',
                                'public.member_get_redemptions(uuid)'] LOOP
        IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN v_bad := v_bad || ('anon:' || v_fn); END IF;
        IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN v_bad := v_bad || ('auth-missing:' || v_fn); END IF;
    END LOOP;
    FOREACH v_fn IN ARRAY ARRAY['public.staff_manages_app(uuid)', 'public.normalize_redemption_code(text)',
                                'public.redemption_view(uuid,text)'] LOOP
        IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
            v_bad := v_bad || ('client:' || v_fn);
        END IF;
    END LOOP;
    IF array_length(v_bad, 1) > 0 THEN
        RAISE EXCEPTION 'post-flight: wrong grants: %', array_to_string(v_bad, '; ');
    END IF;
    RAISE NOTICE 'post-flight OK: 4 functions authenticated-only, 3 helpers service_role-only.';
END
$postflight$;

NOTIFY pgrst, 'reload schema';
