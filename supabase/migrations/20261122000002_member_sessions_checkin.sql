-- ============================================================================
-- 20261122000002 — Loyalty members get real sessions; check-in works again (B1a)
-- ============================================================================
--
-- Plan: ~/.claude/plans/royalty-in-store-loop.md, round B1 step (a).
--
-- Until now a loyalty member's identity was an app_members.id in localStorage,
-- and the RPCs behind the customer app took that id from the caller. QR
-- check-in (record_member_visit) was revoked on 2026-09-03 for exactly that
-- reason, and returning-member login has been broken since 20260315000007.
--
-- This migration ADDS the session-keyed replacements. It removes nothing: the
-- old member-id RPCs stay callable until the phone test passes, and a separate
-- migration (B1b) revokes them. Every function below keys on auth.uid().
--
--   member_login_codes + member_code_issue/member_code_check
--       Emailed 6-digit sign-in codes, stored as HMACs. service_role only: the
--       member-code edge function is the only caller.
--   join_app(app, first, last, phone, tz)   create or link the caller's membership
--   check_in(app)                           one visit, points + streak, in one txn
--   member_get_profile / member_get_activity
--   member_redeem_reward                    30-day code, points deducted atomically
--   member_submit_reward_suggestion
--   member_get_tickets / member_get_unread_count / member_get_ticket_messages /
--   member_get_ticket_ai_history / member_reply_to_ticket
--   member_update_profile                   names + phone; the email is the login
--
-- ⚠️ New functions in `public` inherit Supabase's default EXECUTE grant to anon.
--    Every one is REVOKEd from PUBLIC and anon explicitly (§9), and the
--    post-flight (§10) fails the migration if anon can still execute any of them.
-- ============================================================================


-- ===== 0. Pre-flight: everything this file reads must exist =====
DO $preflight$
DECLARE
    v_need TEXT[] := ARRAY[
        'customer_apps.id','customer_apps.organization_id','customer_apps.name','customer_apps.slug',
        'customer_apps.settings','customer_apps.is_published','customer_apps.is_active',
        'customer_apps.deleted_at','customer_apps.app_type',
        'app_members.id','app_members.app_id','app_members.user_id','app_members.customer_id',
        'app_members.email','app_members.phone','app_members.first_name','app_members.last_name',
        'app_members.display_name','app_members.points_balance','app_members.total_points_earned',
        'app_members.total_points_redeemed','app_members.tier','app_members.profile_public',
        'app_members.notifications_enabled','app_members.joined_at','app_members.updated_at',
        'app_members.deleted_at','app_members.last_login_at','app_members.visit_count',
        'app_members.current_streak','app_members.longest_streak','app_members.last_visit_at',
        'app_members.timezone','app_members.referral_code',
        'member_visits.member_id','member_visits.app_id','member_visits.visited_at',
        'member_visits.points_awarded','member_visits.streak_bonus','member_visits.milestone_bonus',
        'points_transactions.member_id','points_transactions.app_id','points_transactions.type',
        'points_transactions.points_change','points_transactions.balance_after',
        'points_transactions.description','points_transactions.created_at',
        'app_rewards.id','app_rewards.app_id','app_rewards.name','app_rewards.points_cost',
        'app_rewards.is_active','app_rewards.deleted_at','app_rewards.start_date','app_rewards.end_date',
        'app_rewards.quantity_available','app_rewards.quantity_redeemed','app_rewards.tier_required',
        'app_rewards.max_per_member','app_rewards.updated_at',
        'reward_redemptions.id','reward_redemptions.app_id','reward_redemptions.member_id',
        'reward_redemptions.reward_id','reward_redemptions.points_spent','reward_redemptions.reward_name',
        'reward_redemptions.status','reward_redemptions.redemption_code','reward_redemptions.expires_at',
        'reward_suggestions.app_id','reward_suggestions.member_id','reward_suggestions.organization_id',
        'reward_suggestions.reward_name','reward_suggestions.description',
        'reward_suggestions.suggested_points','reward_suggestions.created_at',
        'support_tickets.id','support_tickets.app_id','support_tickets.member_id',
        'support_tickets.ticket_number','support_tickets.subject','support_tickets.status',
        'support_tickets.priority','support_tickets.created_at','support_tickets.updated_at',
        'support_tickets.customer_last_read_at','support_tickets.metadata',
        'ticket_messages.id','ticket_messages.ticket_id','ticket_messages.sender_type',
        'ticket_messages.sender_id','ticket_messages.sender_name','ticket_messages.message',
        'ticket_messages.created_at','ticket_messages.is_internal',
        'ai_support_messages.id','ai_support_messages.session_id','ai_support_messages.role',
        'ai_support_messages.content','ai_support_messages.created_at',
        'customers.id','customers.organization_id','customers.first_name','customers.last_name',
        'customers.email','customers.phone','customers.source','customers.tags',
        'app_events.app_id','app_events.member_id','app_events.event_type','app_events.event_data'
    ];
    v_item TEXT;
    v_missing TEXT[] := '{}';
    v_def TEXT;
BEGIN
    FOREACH v_item IN ARRAY v_need LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = split_part(v_item, '.', 1)
              AND column_name = split_part(v_item, '.', 2)
        ) THEN
            v_missing := v_missing || v_item;
        END IF;
    END LOOP;
    IF array_length(v_missing, 1) > 0 THEN
        RAISE EXCEPTION 'pre-flight: missing column(s): %', array_to_string(v_missing, ', ');
    END IF;

    IF to_regprocedure('public.award_points(uuid,uuid,integer,text,text,jsonb)') IS NULL THEN
        RAISE EXCEPTION 'pre-flight: award_points(uuid,uuid,integer,text,text,jsonb) is missing.';
    END IF;
    IF to_regprocedure('public.check_member_limit(uuid)') IS NULL THEN
        RAISE EXCEPTION 'pre-flight: check_member_limit(uuid) is missing.';
    END IF;

    -- 🔴 The member-code function creates auth users with user_type=app_member.
    -- If the live trigger lacks that branch, every member sign-in would create a
    -- Royalty organization, notify the admin and enrol the customer in SMB email.
    v_def := pg_get_functiondef('public.handle_new_user()'::regprocedure);
    IF position('app_member' IN v_def) = 0 THEN
        RAISE EXCEPTION 'pre-flight: live handle_new_user() has no app_member branch. '
            'Do not ship member sign-in until 20260821000004 is re-applied.';
    END IF;

    RAISE NOTICE 'pre-flight OK. app_members: % live (% with a user_id). daily_scan_limit values in use: %',
        (SELECT count(*) FROM public.app_members WHERE deleted_at IS NULL),
        (SELECT count(*) FROM public.app_members WHERE deleted_at IS NULL AND user_id IS NOT NULL),
        (SELECT coalesce(string_agg(DISTINCT coalesce(settings->>'daily_scan_limit', '∅'), ','), '-')
           FROM public.customer_apps WHERE deleted_at IS NULL);
END
$preflight$;


-- ===== 1. Sign-in codes =====
--
-- One row per code sent. code_hash = HMAC-SHA256(app_id:email:code) computed in
-- the edge function with a server secret, so a leaked table cannot be brute-
-- forced offline. A new code for the same app+email expires the previous one.
-- 5 wrong tries lock a code; the send limits below cap guesses per hour.

CREATE TABLE IF NOT EXISTS public.member_login_codes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id      UUID NOT NULL REFERENCES public.customer_apps(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    code_hash   TEXT NOT NULL,
    ip          TEXT,
    attempts    INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_member_login_codes_email
    ON public.member_login_codes (email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_login_codes_ip
    ON public.member_login_codes (ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_login_codes_app
    ON public.member_login_codes (app_id, created_at DESC);

ALTER TABLE public.member_login_codes ENABLE ROW LEVEL SECURITY;
-- No policies: no client role may read or write this table.
REVOKE ALL ON public.member_login_codes FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.member_login_codes IS
    'Emailed sign-in codes for loyalty members (HMACs, never the code). Written and read '
    'only by member_code_issue/member_code_check via the member-code edge function.';


-- Returns 'ok', or why not: 'invalid', 'app_not_found', 'rate_email', 'rate_ip', 'rate_app'.
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

    -- No need to expire earlier codes: member_code_check reads only the newest.
    INSERT INTO member_login_codes (app_id, email, code_hash, ip, expires_at)
    VALUES (p_app_id, v_email, p_code_hash, v_ip, NOW() + INTERVAL '10 minutes');

    -- Housekeeping: rows older than 2 days have no use (the longest window is 24 h).
    DELETE FROM member_login_codes WHERE created_at < NOW() - INTERVAL '2 days';

    RETURN 'ok';
END;
$$;


-- Returns 'ok' (and consumes the code), 'wrong', 'locked' or 'expired'.
CREATE OR REPLACE FUNCTION public.member_code_check(
    p_app_id UUID,
    p_email TEXT,
    p_code_hash TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email TEXT := lower(trim(coalesce(p_email, '')));
    v_row member_login_codes%ROWTYPE;
BEGIN
    SELECT * INTO v_row
    FROM member_login_codes
    WHERE app_id = p_app_id AND email = v_email
      AND consumed_at IS NULL AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN 'expired';
    END IF;

    IF v_row.attempts >= 5 THEN
        RETURN 'locked';
    END IF;

    -- Every try costs an attempt, right or wrong, so parallel guesses cannot
    -- exceed the cap.
    UPDATE member_login_codes SET attempts = attempts + 1 WHERE id = v_row.id;

    IF v_row.code_hash = p_code_hash THEN
        UPDATE member_login_codes SET consumed_at = NOW() WHERE id = v_row.id;
        RETURN 'ok';
    END IF;

    RETURN CASE WHEN v_row.attempts + 1 >= 5 THEN 'locked' ELSE 'wrong' END;
END;
$$;


-- ===== 2. Helpers (internal: no client role may call them) =====

-- A positive integer setting from customer_apps.settings, tolerating junk.
CREATE OR REPLACE FUNCTION public.app_setting_int(
    p_settings JSONB,
    p_keys TEXT[],
    p_default INTEGER,
    p_min INTEGER,
    p_max INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    v_key TEXT;
    v_raw TEXT;
BEGIN
    FOREACH v_key IN ARRAY p_keys LOOP
        v_raw := trim(coalesce(p_settings ->> v_key, ''));
        IF v_raw ~ '^\d{1,7}$' THEN
            RETURN GREATEST(p_min, LEAST(p_max, v_raw::INTEGER));
        END IF;
    END LOOP;
    RETURN p_default;
END;
$$;

-- A timezone name Postgres knows, or New York (the app_members default).
CREATE OR REPLACE FUNCTION public.member_tz(p_tz TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT name FROM pg_timezone_names WHERE name = p_tz LIMIT 1),
        'America/New_York'
    );
$$;

-- 8 characters from an alphabet without 0/O/1/I, unique across all redemptions.
-- Randomness comes from gen_random_uuid() (core Postgres), skipping its version
-- and variant bytes; 256 is a multiple of 32, so every letter is equally likely.
CREATE OR REPLACE FUNCTION public.new_redemption_code()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
    v_alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    v_bytes BYTEA;
    v_code TEXT;
    v_idx INTEGER[] := ARRAY[0,1,2,3,4,5,9,10];
    i INTEGER;
BEGIN
    LOOP
        v_bytes := uuid_send(gen_random_uuid());
        v_code := '';
        FOREACH i IN ARRAY v_idx LOOP
            v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % 32), 1);
        END LOOP;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM reward_redemptions WHERE redemption_code = v_code);
    END LOOP;
    RETURN v_code;
END;
$$;


-- ===== 3. join_app =====
--
-- Called right after a code sign-in, by both "Join" and "Log in". Identity is
-- the session: auth.uid() and that user's email, never a client argument.
--   • already a member (by user_id)               → is_new = false
--   • a PIN-era row with this email, no user_id   → linked to this user, is_new = false
--   • otherwise a new member, if a first name came with the call → welcome points once
-- error_code: not_signed_in, no_email, app_not_found, name_required, phone_required,
-- phone_invalid, phone_taken, email_taken, removed, member_limit, failed.

CREATE OR REPLACE FUNCTION public.join_app(
    p_app_id UUID,
    p_first_name TEXT DEFAULT NULL,
    p_last_name TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL,
    p_timezone TEXT DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    member_id UUID,
    is_new BOOLEAN,
    welcome_points INTEGER,
    error_code TEXT,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_variable
DECLARE
    v_uid UUID := auth.uid();
    v_email TEXT;
    v_app RECORD;
    v_row RECORD;
    v_first TEXT := nullif(left(trim(coalesce(p_first_name, '')), 100), '');
    v_last TEXT := nullif(left(trim(coalesce(p_last_name, '')), 100), '');
    v_phone TEXT := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
    v_limit JSONB;
    v_customer_id UUID;
    v_member_id UUID;
    v_welcome INTEGER;
BEGIN
    IF v_uid IS NULL THEN
        RETURN QUERY SELECT false, NULL::UUID, false, 0, 'not_signed_in', 'Please sign in first.';
        RETURN;
    END IF;

    SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_uid;
    IF v_email IS NULL OR v_email = '' THEN
        RETURN QUERY SELECT false, NULL::UUID, false, 0, 'no_email', 'Your account has no email address.';
        RETURN;
    END IF;

    SELECT a.id, a.organization_id, a.settings INTO v_app
    FROM customer_apps a
    WHERE a.id = p_app_id AND a.is_published = true AND a.is_active = true
      AND a.deleted_at IS NULL AND a.app_type IS DISTINCT FROM 'social';
    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, false, 0, 'app_not_found', 'This program is not available.';
        RETURN;
    END IF;

    -- Already a member of this app.
    SELECT m.id INTO v_member_id
    FROM app_members m
    WHERE m.app_id = p_app_id AND m.user_id = v_uid AND m.deleted_at IS NULL;
    IF FOUND THEN
        UPDATE app_members m SET last_login_at = NOW() WHERE m.id = v_member_id;
        RETURN QUERY SELECT true, v_member_id, false, 0, NULL::TEXT, NULL::TEXT;
        RETURN;
    END IF;

    -- A row with this email (UNIQUE(app_id, email) covers deleted rows too).
    SELECT m.id, m.user_id, m.deleted_at INTO v_row
    FROM app_members m
    WHERE m.app_id = p_app_id AND lower(m.email) = v_email
    ORDER BY m.deleted_at NULLS FIRST
    LIMIT 1
    FOR UPDATE;
    IF FOUND THEN
        IF v_row.deleted_at IS NOT NULL THEN
            RETURN QUERY SELECT false, NULL::UUID, false, 0, 'removed',
                'This email was removed from this program. Please ask the business.';
            RETURN;
        END IF;
        IF v_row.user_id IS NOT NULL AND v_row.user_id <> v_uid THEN
            RETURN QUERY SELECT false, NULL::UUID, false, 0, 'email_taken',
                'This email is linked to another account.';
            RETURN;
        END IF;
        -- PIN-era member: keep their points, attach the session's user.
        UPDATE app_members m
           SET user_id = v_uid,
               last_login_at = NOW(),
               first_name = COALESCE(m.first_name, v_first),
               last_name = COALESCE(m.last_name, v_last),
               updated_at = NOW()
         WHERE m.id = v_row.id;
        RETURN QUERY SELECT true, v_row.id, false, 0, NULL::TEXT, NULL::TEXT;
        RETURN;
    END IF;

    -- New member from here on.
    IF v_first IS NULL THEN
        RETURN QUERY SELECT false, NULL::UUID, false, 0, 'name_required', 'Please add your first name.';
        RETURN;
    END IF;

    IF v_phone IS NOT NULL THEN
        IF v_phone !~ '^\+?[0-9]{7,15}$' THEN
            RETURN QUERY SELECT false, NULL::UUID, false, 0, 'phone_invalid', 'That phone number does not look right.';
            RETURN;
        END IF;
        IF EXISTS (SELECT 1 FROM app_members m WHERE m.app_id = p_app_id AND m.phone = v_phone) THEN
            RETURN QUERY SELECT false, NULL::UUID, false, 0, 'phone_taken',
                'That phone number is already registered here.';
            RETURN;
        END IF;
    ELSIF lower(coalesce(v_app.settings ->> 'require_phone', 'false')) = 'true' THEN
        RETURN QUERY SELECT false, NULL::UUID, false, 0, 'phone_required', 'This program needs a phone number.';
        RETURN;
    END IF;

    v_limit := check_member_limit(v_app.organization_id);
    IF NOT coalesce((v_limit ->> 'allowed')::BOOLEAN, true) THEN
        RETURN QUERY SELECT false, NULL::UUID, false, 0, 'member_limit',
            'This program is full right now. Please ask the business.';
        RETURN;
    END IF;

    INSERT INTO customers (organization_id, first_name, last_name, email, phone, source, tags)
    VALUES (v_app.organization_id, v_first, v_last, v_email, v_phone, 'app', ARRAY['app-member'])
    RETURNING id INTO v_customer_id;

    INSERT INTO app_members (
        app_id, customer_id, user_id, first_name, last_name, email, phone, display_name,
        points_balance, total_points_earned, tier, profile_public, notifications_enabled,
        last_login_at, timezone
    ) VALUES (
        p_app_id, v_customer_id, v_uid, v_first, v_last, v_email, v_phone, v_first,
        0, 0, 'bronze', false, true,
        NOW(), member_tz(p_timezone)
    )
    RETURNING id INTO v_member_id;

    v_welcome := app_setting_int(v_app.settings, ARRAY['welcome_points'], 50, 0, 10000);
    IF v_welcome > 0 THEN
        PERFORM award_points(p_app_id, v_member_id, v_welcome, 'welcome', 'Welcome bonus', '{}'::JSONB);
    END IF;

    INSERT INTO app_events (app_id, member_id, event_type, event_data)
    VALUES (p_app_id, v_member_id, 'member_joined',
            jsonb_build_object('first_name', v_first, 'welcome_points', v_welcome, 'via', 'code'));

    RETURN QUERY SELECT true, v_member_id, true, v_welcome, NULL::TEXT, NULL::TEXT;
EXCEPTION
    WHEN unique_violation THEN
        IF SQLERRM ILIKE '%phone%' THEN
            RETURN QUERY SELECT false, NULL::UUID, false, 0, 'phone_taken',
                'That phone number is already registered here.';
        ELSE
            RETURN QUERY SELECT false, NULL::UUID, false, 0, 'email_taken',
                'This email is already registered here.';
        END IF;
END;
$$;


-- ===== 4. check_in =====
--
-- Replaces record_member_visit (revoked 2026-09-03). The member is the session.
-- Settings: points_per_scan (what the builder writes; points_per_visit as a
-- fallback; default 10) and daily_scan_limit (daily_visit_limit; default 1).
-- "Today" is the member's own timezone, not UTC, so an evening visit in
-- California does not open a second check-in at 4 pm.
-- ⚠️ Known limit (plan B1.3): a photo of a static counter QR works once a day
-- from anywhere. B2's counter page is where staff-confirmed check-in goes.

CREATE OR REPLACE FUNCTION public.check_in(p_app_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_app RECORD;
    v_member RECORD;
    v_tz TEXT;
    v_now TIMESTAMPTZ := NOW();
    v_today DATE;
    v_day_start TIMESTAMPTZ;
    v_last_day DATE;
    v_points INTEGER;
    v_limit INTEGER;
    v_visits_today INTEGER;
    v_streak INTEGER;
    v_streak_bonus INTEGER := 0;
    v_milestone_bonus INTEGER := 0;
    v_total INTEGER;
    v_visit_id UUID;
    v_balance INTEGER;
    v_tier TEXT;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'not_signed_in',
            'error_message', 'Please sign in to check in.');
    END IF;

    SELECT a.id, a.settings INTO v_app
    FROM customer_apps a
    WHERE a.id = p_app_id AND a.is_published = true AND a.is_active = true AND a.deleted_at IS NULL;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'app_not_found',
            'error_message', 'This program is not available.');
    END IF;

    -- Lock the member row: concurrent check-ins queue here, so the count below
    -- always sees the previous one.
    SELECT m.* INTO v_member
    FROM app_members m
    WHERE m.app_id = p_app_id AND m.user_id = v_uid AND m.deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'not_a_member',
            'error_message', 'Join this program first.');
    END IF;

    v_points := app_setting_int(v_app.settings, ARRAY['points_per_scan', 'points_per_visit'], 10, 0, 1000);
    v_limit  := app_setting_int(v_app.settings, ARRAY['daily_scan_limit', 'daily_visit_limit'], 1, 1, 20);

    v_tz := member_tz(v_member.timezone);
    v_today := (v_now AT TIME ZONE v_tz)::DATE;
    v_day_start := v_today::TIMESTAMP AT TIME ZONE v_tz;

    SELECT count(*) INTO v_visits_today
    FROM member_visits
    WHERE member_id = v_member.id AND visited_at >= v_day_start;

    IF v_visits_today >= v_limit THEN
        RETURN jsonb_build_object('success', false, 'code', 'daily_limit',
            'error_message', CASE WHEN v_limit = 1
                THEN 'You already checked in today. See you tomorrow!'
                ELSE format('You already checked in %s times today. See you tomorrow!', v_limit) END,
            'visits_today', v_visits_today, 'daily_limit', v_limit,
            'next_at', ((v_today + 1)::TIMESTAMP AT TIME ZONE v_tz));
    END IF;

    v_last_day := (v_member.last_visit_at AT TIME ZONE v_tz)::DATE;
    IF v_last_day = v_today THEN
        v_streak := GREATEST(coalesce(v_member.current_streak, 1), 1);
    ELSIF v_last_day = v_today - 1 THEN
        v_streak := coalesce(v_member.current_streak, 0) + 1;
    ELSE
        v_streak := 1;
    END IF;

    -- Streak bonuses only on the day's first visit; otherwise a limit above 1
    -- would pay the same streak bonus again on every extra visit.
    IF v_last_day IS DISTINCT FROM v_today THEN
        v_streak_bonus := CASE v_streak WHEN 3 THEN 5 WHEN 7 THEN 15 WHEN 30 THEN 50 ELSE 0 END;
    END IF;
    v_milestone_bonus := CASE coalesce(v_member.visit_count, 0) + 1
        WHEN 10 THEN 25 WHEN 50 THEN 100 WHEN 100 THEN 250 ELSE 0 END;
    v_total := v_points + v_streak_bonus + v_milestone_bonus;

    INSERT INTO member_visits (member_id, app_id, visited_at, points_awarded, streak_bonus, milestone_bonus)
    VALUES (v_member.id, p_app_id, v_now, v_points, v_streak_bonus, v_milestone_bonus)
    RETURNING id INTO v_visit_id;

    UPDATE app_members m
       SET visit_count = coalesce(m.visit_count, 0) + 1,
           current_streak = v_streak,
           longest_streak = GREATEST(coalesce(m.longest_streak, 0), v_streak),
           last_visit_at = v_now,
           updated_at = v_now
     WHERE m.id = v_member.id;

    v_balance := coalesce(v_member.points_balance, 0);
    v_tier := v_member.tier;
    IF v_total > 0 THEN
        SELECT ap.new_balance, ap.new_tier INTO v_balance, v_tier
        FROM award_points(
            p_app_id, v_member.id, v_total, 'visit',
            CASE WHEN v_streak_bonus > 0 AND v_milestone_bonus > 0 THEN format('Visit + %s-day streak + milestone bonus', v_streak)
                 WHEN v_streak_bonus > 0 THEN format('Visit + %s-day streak bonus', v_streak)
                 WHEN v_milestone_bonus > 0 THEN 'Visit + milestone bonus'
                 ELSE 'Check-in visit' END,
            jsonb_build_object('visit_id', v_visit_id, 'base_points', v_points,
                'streak_bonus', v_streak_bonus, 'milestone_bonus', v_milestone_bonus,
                'streak_days', v_streak)
        ) ap;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'points_awarded', v_total,
        'base_points', v_points,
        'streak_bonus', v_streak_bonus,
        'milestone_bonus', v_milestone_bonus,
        'current_streak', v_streak,
        'visit_count', coalesce(v_member.visit_count, 0) + 1,
        'new_balance', v_balance,
        'tier', v_tier,
        'visits_today', v_visits_today + 1,
        'daily_limit', v_limit
    );
END;
$$;


-- ===== 5. Profile and activity =====

CREATE OR REPLACE FUNCTION public.member_get_profile(p_app_id UUID)
RETURNS TABLE (
    id UUID,
    app_id UUID,
    first_name TEXT,
    last_name TEXT,
    display_name TEXT,
    email TEXT,
    phone TEXT,
    points_balance INTEGER,
    total_points_earned INTEGER,
    total_points_redeemed INTEGER,
    tier TEXT,
    profile_public BOOLEAN,
    notifications_enabled BOOLEAN,
    joined_at TIMESTAMPTZ,
    visit_count INTEGER,
    current_streak INTEGER,
    longest_streak INTEGER,
    last_visit_at TIMESTAMPTZ,
    referral_code TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT m.id, m.app_id, m.first_name, m.last_name, m.display_name, m.email, m.phone,
           coalesce(m.points_balance, 0), coalesce(m.total_points_earned, 0),
           coalesce(m.total_points_redeemed, 0), m.tier, m.profile_public, m.notifications_enabled,
           m.joined_at, coalesce(m.visit_count, 0), coalesce(m.current_streak, 0),
           coalesce(m.longest_streak, 0), m.last_visit_at, m.referral_code
    FROM app_members m
    WHERE m.app_id = p_app_id AND m.user_id = auth.uid() AND m.deleted_at IS NULL
      AND auth.uid() IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.member_get_activity(p_app_id UUID, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
    id UUID,
    type TEXT,
    points_change INTEGER,
    balance_after INTEGER,
    description TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT pt.id, pt.type, pt.points_change, pt.balance_after, pt.description, pt.created_at
    FROM points_transactions pt
    JOIN app_members m ON m.id = pt.member_id
    WHERE m.app_id = p_app_id AND m.user_id = auth.uid() AND m.deleted_at IS NULL
      AND pt.app_id = p_app_id
      AND auth.uid() IS NOT NULL
    ORDER BY pt.created_at DESC
    LIMIT GREATEST(1, LEAST(coalesce(p_limit, 10), 50));
$$;


-- ===== 6. Redeem =====
--
-- Same rules as redeem_reward (dates, stock, tier, balance, max per member), with
-- the member taken from the session. Code: 8 unambiguous characters, valid 30 days.

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


-- ===== 7. Reward suggestion =====

CREATE OR REPLACE FUNCTION public.member_submit_reward_suggestion(
    p_app_id UUID,
    p_reward_name TEXT,
    p_description TEXT DEFAULT NULL,
    p_suggested_points INTEGER DEFAULT NULL
)
RETURNS TABLE (success BOOLEAN, suggestion_id UUID, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_variable
DECLARE
    v_member RECORD;
    v_org UUID;
    v_recent INTEGER;
    v_name TEXT := left(trim(coalesce(p_reward_name, '')), 120);
    v_id UUID;
BEGIN
    SELECT m.id INTO v_member
    FROM app_members m
    WHERE m.app_id = p_app_id AND m.user_id = auth.uid() AND m.deleted_at IS NULL
      AND auth.uid() IS NOT NULL;
    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, 'Join this program first.'::TEXT;
        RETURN;
    END IF;

    SELECT a.organization_id INTO v_org
    FROM customer_apps a WHERE a.id = p_app_id AND a.is_active = true AND a.deleted_at IS NULL;
    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, 'App not found'::TEXT;
        RETURN;
    END IF;

    SELECT count(*) INTO v_recent
    FROM reward_suggestions s
    WHERE s.member_id = v_member.id AND s.app_id = p_app_id
      AND s.created_at > NOW() - INTERVAL '24 hours';
    IF v_recent >= 3 THEN
        RETURN QUERY SELECT false, NULL::UUID, 'You can submit up to 3 suggestions per day'::TEXT;
        RETURN;
    END IF;

    IF length(v_name) < 2 THEN
        RETURN QUERY SELECT false, NULL::UUID, 'Reward name is too short'::TEXT;
        RETURN;
    END IF;

    INSERT INTO reward_suggestions (app_id, member_id, organization_id, reward_name, description, suggested_points)
    VALUES (p_app_id, v_member.id, v_org, v_name,
            nullif(left(trim(coalesce(p_description, '')), 1000), ''),
            CASE WHEN p_suggested_points BETWEEN 1 AND 100000 THEN p_suggested_points END)
    RETURNING id INTO v_id;

    RETURN QUERY SELECT true, v_id, NULL::TEXT;
END;
$$;


-- ===== 8. Support tickets (the member's own) =====
--
-- The old customer versions took p_member_id; two of them (messages, AI history)
-- also failed with 42702 because their RETURNS TABLE column `id` shadowed the
-- table column. Every column here is qualified.

CREATE OR REPLACE FUNCTION public.member_get_tickets(p_app_id UUID)
RETURNS TABLE (
    id UUID,
    ticket_number TEXT,
    subject TEXT,
    status TEXT,
    priority TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    last_message_at TIMESTAMPTZ,
    unread_count BIGINT,
    last_message_preview TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT t.id, t.ticket_number::TEXT, t.subject::TEXT, t.status::TEXT, t.priority::TEXT,
           t.created_at, t.updated_at,
           (SELECT max(tm.created_at) FROM ticket_messages tm WHERE tm.ticket_id = t.id),
           (SELECT count(*) FROM ticket_messages tm
             WHERE tm.ticket_id = t.id AND tm.sender_type IN ('staff', 'ai')
               AND coalesce(tm.is_internal, false) = false
               AND tm.created_at > coalesce(t.customer_last_read_at, t.created_at)),
           (SELECT left(tm.message, 100) FROM ticket_messages tm
             WHERE tm.ticket_id = t.id AND coalesce(tm.is_internal, false) = false
             ORDER BY tm.created_at DESC LIMIT 1)
    FROM support_tickets t
    JOIN app_members m ON m.id = t.member_id
    WHERE t.app_id = p_app_id AND m.app_id = p_app_id
      AND m.user_id = auth.uid() AND m.deleted_at IS NULL AND auth.uid() IS NOT NULL
    ORDER BY t.updated_at DESC
    LIMIT 50;
$$;

CREATE OR REPLACE FUNCTION public.member_get_unread_count(p_app_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT count(*)::INTEGER
    FROM support_tickets t
    JOIN app_members m ON m.id = t.member_id
    WHERE t.app_id = p_app_id AND m.app_id = p_app_id
      AND m.user_id = auth.uid() AND m.deleted_at IS NULL AND auth.uid() IS NOT NULL
      AND EXISTS (
          SELECT 1 FROM ticket_messages tm
          WHERE tm.ticket_id = t.id AND tm.sender_type IN ('staff', 'ai')
            AND coalesce(tm.is_internal, false) = false
            AND tm.created_at > coalesce(t.customer_last_read_at, t.created_at));
$$;

-- The caller's own ticket, or NULL.
CREATE OR REPLACE FUNCTION public.member_ticket_owner(p_ticket_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT m.id
    FROM support_tickets t
    JOIN app_members m ON m.id = t.member_id
    WHERE t.id = p_ticket_id AND m.user_id = auth.uid() AND m.deleted_at IS NULL
      AND auth.uid() IS NOT NULL
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.member_get_ticket_messages(p_ticket_id UUID)
RETURNS TABLE (
    id UUID,
    sender_type TEXT,
    sender_name TEXT,
    message TEXT,
    created_at TIMESTAMPTZ,
    is_from_me BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF member_ticket_owner(p_ticket_id) IS NULL THEN
        RETURN;
    END IF;

    UPDATE support_tickets t SET customer_last_read_at = NOW() WHERE t.id = p_ticket_id;

    RETURN QUERY
    SELECT tm.id, tm.sender_type::TEXT,
           COALESCE(tm.sender_name, CASE tm.sender_type
               WHEN 'staff' THEN 'Support Team' WHEN 'ai' THEN 'Support'
               WHEN 'customer' THEN 'You' ELSE 'System' END)::TEXT,
           tm.message::TEXT, tm.created_at, (tm.sender_type = 'customer')
    FROM ticket_messages tm
    WHERE tm.ticket_id = p_ticket_id AND coalesce(tm.is_internal, false) = false
    ORDER BY tm.created_at ASC
    LIMIT 100;
END;
$$;

CREATE OR REPLACE FUNCTION public.member_get_ticket_ai_history(p_ticket_id UUID)
RETURNS TABLE (
    id UUID,
    role TEXT,
    content TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT am.id, am.role::TEXT, am.content::TEXT, am.created_at
    FROM ai_support_messages am
    WHERE member_ticket_owner(p_ticket_id) IS NOT NULL
      AND am.session_id = (
          SELECT CASE WHEN (t.metadata ->> 'ai_session_id') ~* '^[0-9a-f-]{36}$'
                      THEN (t.metadata ->> 'ai_session_id')::UUID END
          FROM support_tickets t WHERE t.id = p_ticket_id)
    ORDER BY am.created_at ASC
    LIMIT 50;
$$;

CREATE OR REPLACE FUNCTION public.member_reply_to_ticket(p_ticket_id UUID, p_message TEXT)
RETURNS TABLE (success BOOLEAN, message_id UUID, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_variable
DECLARE
    v_member_id UUID := member_ticket_owner(p_ticket_id);
    v_name TEXT;
    v_id UUID;
    v_msg TEXT := trim(coalesce(p_message, ''));
BEGIN
    IF v_member_id IS NULL THEN
        RETURN QUERY SELECT false, NULL::UUID, 'Ticket not found'::TEXT;
        RETURN;
    END IF;
    IF v_msg = '' THEN
        RETURN QUERY SELECT false, NULL::UUID, 'Message cannot be empty'::TEXT;
        RETURN;
    END IF;
    IF length(v_msg) > 5000 THEN
        RETURN QUERY SELECT false, NULL::UUID, 'Message too long (max 5000 characters)'::TEXT;
        RETURN;
    END IF;

    SELECT nullif(trim(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, '')), '')
      INTO v_name
    FROM app_members m WHERE m.id = v_member_id;

    INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, sender_name, message)
    VALUES (p_ticket_id, 'customer', v_member_id, coalesce(v_name, 'Customer'), v_msg)
    RETURNING id INTO v_id;

    UPDATE support_tickets t
       SET status = CASE WHEN t.status = 'pending_customer' THEN 'awaiting_response'
                         WHEN t.status IN ('resolved', 'closed') THEN 'open'
                         ELSE t.status END,
           updated_at = NOW()
     WHERE t.id = p_ticket_id;

    RETURN QUERY SELECT true, v_id, NULL::TEXT;
END;
$$;


-- ===== 9. Profile edit =====
-- Names and phone. Not the email: with code sign-in the email IS the login.

CREATE OR REPLACE FUNCTION public.member_update_profile(
    p_app_id UUID,
    p_first_name TEXT,
    p_last_name TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_member RECORD;
    v_first TEXT := nullif(left(trim(coalesce(p_first_name, '')), 100), '');
    v_last TEXT := nullif(left(trim(coalesce(p_last_name, '')), 100), '');
    v_phone TEXT := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
BEGIN
    SELECT m.* INTO v_member
    FROM app_members m
    WHERE m.app_id = p_app_id AND m.user_id = auth.uid() AND m.deleted_at IS NULL
      AND auth.uid() IS NOT NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error_message', 'Join this program first.');
    END IF;
    IF v_first IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error_message', 'Please add your first name.');
    END IF;
    IF v_phone IS NOT NULL AND v_phone !~ '^\+?[0-9]{7,15}$' THEN
        RETURN jsonb_build_object('success', false, 'error_message', 'That phone number does not look right.');
    END IF;
    IF v_phone IS NOT NULL AND EXISTS (
        SELECT 1 FROM app_members m
        WHERE m.app_id = p_app_id AND m.phone = v_phone AND m.id <> v_member.id) THEN
        RETURN jsonb_build_object('success', false, 'error_message', 'That phone number is already registered here.');
    END IF;

    UPDATE app_members m
       SET first_name = v_first,
           last_name = v_last,
           display_name = CASE WHEN m.display_name IS NULL OR m.display_name = m.first_name
                               THEN v_first ELSE m.display_name END,
           phone = v_phone,
           updated_at = NOW()
     WHERE m.id = v_member.id;

    RETURN jsonb_build_object('success', true, 'member', (
        SELECT jsonb_build_object('first_name', m.first_name, 'last_name', m.last_name,
                                  'display_name', m.display_name, 'phone', m.phone)
        FROM app_members m WHERE m.id = v_member.id));
END;
$$;


-- ===== 10. Grants =====
DO $grants$
DECLARE
    v_member_fns TEXT[] := ARRAY[
        'public.join_app(uuid,text,text,text,text)',
        'public.check_in(uuid)',
        'public.member_get_profile(uuid)',
        'public.member_get_activity(uuid,integer)',
        'public.member_redeem_reward(uuid,uuid)',
        'public.member_submit_reward_suggestion(uuid,text,text,integer)',
        'public.member_get_tickets(uuid)',
        'public.member_get_unread_count(uuid)',
        'public.member_get_ticket_messages(uuid)',
        'public.member_get_ticket_ai_history(uuid)',
        'public.member_reply_to_ticket(uuid,text)',
        'public.member_update_profile(uuid,text,text,text)'
    ];
    v_internal_fns TEXT[] := ARRAY[
        'public.member_code_issue(uuid,text,text,text)',
        'public.member_code_check(uuid,text,text)',
        'public.app_setting_int(jsonb,text[],integer,integer,integer)',
        'public.member_tz(text)',
        'public.new_redemption_code()',
        'public.member_ticket_owner(uuid)'
    ];
    v_fn TEXT;
BEGIN
    FOREACH v_fn IN ARRAY v_member_fns LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_fn);
    END LOOP;
    FOREACH v_fn IN ARRAY v_internal_fns LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn);
    END LOOP;
END
$grants$;


-- ===== 11. Post-flight: the grants are what this file says =====
DO $postflight$
DECLARE
    v_member_fns TEXT[] := ARRAY[
        'public.join_app(uuid,text,text,text,text)', 'public.check_in(uuid)',
        'public.member_get_profile(uuid)', 'public.member_get_activity(uuid,integer)',
        'public.member_redeem_reward(uuid,uuid)',
        'public.member_submit_reward_suggestion(uuid,text,text,integer)',
        'public.member_get_tickets(uuid)', 'public.member_get_unread_count(uuid)',
        'public.member_get_ticket_messages(uuid)', 'public.member_get_ticket_ai_history(uuid)',
        'public.member_reply_to_ticket(uuid,text)', 'public.member_update_profile(uuid,text,text,text)'
    ];
    v_internal_fns TEXT[] := ARRAY[
        'public.member_code_issue(uuid,text,text,text)', 'public.member_code_check(uuid,text,text)',
        'public.app_setting_int(jsonb,text[],integer,integer,integer)', 'public.member_tz(text)',
        'public.new_redemption_code()', 'public.member_ticket_owner(uuid)'
    ];
    v_fn TEXT;
    v_bad TEXT[] := '{}';
BEGIN
    FOREACH v_fn IN ARRAY v_member_fns LOOP
        IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN v_bad := v_bad || ('anon:' || v_fn); END IF;
        IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN v_bad := v_bad || ('auth-missing:' || v_fn); END IF;
        IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN v_bad := v_bad || ('service-missing:' || v_fn); END IF;
    END LOOP;
    FOREACH v_fn IN ARRAY v_internal_fns LOOP
        IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN v_bad := v_bad || ('anon:' || v_fn); END IF;
        IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN v_bad := v_bad || ('authenticated:' || v_fn); END IF;
        IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN v_bad := v_bad || ('service-missing:' || v_fn); END IF;
    END LOOP;
    IF has_table_privilege('anon', 'public.member_login_codes', 'SELECT,INSERT,UPDATE,DELETE')
       OR has_table_privilege('authenticated', 'public.member_login_codes', 'SELECT,INSERT,UPDATE,DELETE') THEN
        v_bad := v_bad || 'member_login_codes readable or writable by a client role'::TEXT;
    END IF;
    IF array_length(v_bad, 1) > 0 THEN
        RAISE EXCEPTION 'post-flight: wrong grants: %', array_to_string(v_bad, '; ');
    END IF;
    RAISE NOTICE 'post-flight OK: 12 member functions authenticated-only, 6 internal service_role-only, codes table closed.';
END
$postflight$;

NOTIFY pgrst, 'reload schema';
