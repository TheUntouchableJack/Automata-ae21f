-- Social app type (ViibeView) — Phase 1: member accounts
--
-- ViibeView members authenticate with Supabase Auth (email + password) rather
-- than Royalty's PIN flow, because the social features coming in Phases 2–3
-- (profiles, follows, member-posted Viibes) need RLS that can tell one member
-- from another. Royalty's PIN sessions are a localStorage token with no
-- auth.uid(), so every member write would have to go through a SECURITY DEFINER
-- RPC trusting a client-supplied member_id — spoofable, and unacceptable once
-- members can post and delete content.
--
-- THE COMPANION MIGRATION
-- -----------------------
-- Signup ALSO requires handle_new_user() to stop making every new auth.users
-- row a Royalty business owner. That rewrite lives in
-- 20260821000004_social_signup_trigger.sql, deliberately split out because it
-- is the only non-additive change in the series — it replaces the trigger
-- function behind every Royalty signup. Read its header before pushing it.
--
-- Everything in THIS file is additive and independently safe: a new nullable
-- column, two new indexes, two new RLS policies that only widen access to a
-- caller's own row, and three new RPCs under names nothing else uses. It can
-- be applied and verified on its own, and needs no rollback if the trigger
-- half misbehaves.
--
-- Applied without 20260821000004, member signup still works end to end, but
-- each new member also gets an organization they own — so apply both, in
-- order, or neither.
--
-- Isolated migration: touches app_members and adds new RPCs.

-- ===== 1. Link app_members to auth.users =====
-- Keeps ViibeView members visible to Royalty loyalty, automations and Royal AI
-- (they are still app_members + customers rows) while giving RLS a real
-- auth.uid() to key on.

ALTER TABLE app_members
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

COMMENT ON COLUMN app_members.user_id IS
    'Supabase Auth user for social app types. NULL for PIN-based loyalty members. One member row per (app_id, user_id).';

-- One membership per user per app.
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_members_app_user
    ON app_members(app_id, user_id)
    WHERE user_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_app_members_user
    ON app_members(user_id)
    WHERE user_id IS NOT NULL;

-- RLS: a member can read and update their own row. The existing
-- "Org can manage app members" policy still covers the owner side.
DROP POLICY IF EXISTS "Members can read own membership" ON app_members;
CREATE POLICY "Members can read own membership" ON app_members
    FOR SELECT
    USING (user_id IS NOT NULL AND user_id = auth.uid());

DROP POLICY IF EXISTS "Members can update own membership" ON app_members;
CREATE POLICY "Members can update own membership" ON app_members
    FOR UPDATE
    USING (user_id IS NOT NULL AND user_id = auth.uid())
    WITH CHECK (user_id IS NOT NULL AND user_id = auth.uid());

-- ===== 2. Signup =====
-- Called AFTER supabase.auth.signUp() succeeds. Identity comes from the JWT
-- (auth.uid() / auth.email()), never from the client, so a caller cannot create
-- a membership for somebody else. Idempotent: safe to call on every login.

CREATE OR REPLACE FUNCTION social_member_signup(
    p_app_id UUID,
    p_first_name TEXT DEFAULT NULL,
    p_last_name TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    member_id UUID,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_email TEXT;
    v_app RECORD;
    v_member_id UUID;
    v_customer_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false, NULL::UUID, 'Not authenticated'::TEXT;
        RETURN;
    END IF;

    SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

    SELECT * INTO v_app
    FROM customer_apps
    WHERE id = p_app_id
      AND is_published = true
      AND is_active = true
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, 'App not found or not published'::TEXT;
        RETURN;
    END IF;

    -- Already a member? Return it rather than erroring — signup and login both
    -- call this, and a half-finished signup must be resumable.
    SELECT id INTO v_member_id
    FROM app_members
    WHERE app_id = p_app_id AND user_id = v_user_id AND deleted_at IS NULL;

    IF FOUND THEN
        UPDATE app_members
        SET last_login_at = NOW(),
            first_name = COALESCE(p_first_name, first_name),
            last_name  = COALESCE(p_last_name, last_name),
            phone      = COALESCE(p_phone, phone)
        WHERE id = v_member_id;

        RETURN QUERY SELECT true, v_member_id, NULL::TEXT;
        RETURN;
    END IF;

    -- Adopt a pre-existing PIN-era member with the same email, so someone who
    -- joined before this migration keeps their points instead of starting over.
    SELECT id, customer_id INTO v_member_id, v_customer_id
    FROM app_members
    WHERE app_id = p_app_id
      AND lower(email) = lower(v_email)
      AND user_id IS NULL
      AND deleted_at IS NULL
    LIMIT 1;

    IF FOUND THEN
        UPDATE app_members
        SET user_id = v_user_id,
            last_login_at = NOW(),
            first_name = COALESCE(p_first_name, first_name),
            last_name  = COALESCE(p_last_name, last_name),
            phone      = COALESCE(p_phone, phone)
        WHERE id = v_member_id;

        RETURN QUERY SELECT true, v_member_id, NULL::TEXT;
        RETURN;
    END IF;

    -- New member: create the org-side customer record too, so Royalty's
    -- customer list, automations and Royal AI can all see them.
    INSERT INTO customers (organization_id, first_name, last_name, email, phone, source, tags)
    VALUES (
        v_app.organization_id,
        p_first_name, p_last_name, lower(v_email), p_phone,
        'social_app', ARRAY['viibeview']
    )
    RETURNING id INTO v_customer_id;

    INSERT INTO app_members (
        app_id, customer_id, user_id, email, phone,
        first_name, last_name, last_login_at
    )
    VALUES (
        p_app_id, v_customer_id, v_user_id, lower(v_email), p_phone,
        p_first_name, p_last_name, NOW()
    )
    RETURNING id INTO v_member_id;

    RETURN QUERY SELECT true, v_member_id, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION social_member_signup(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION social_member_signup(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ===== 3. Read the current member =====

CREATE OR REPLACE FUNCTION get_social_member(p_app_id UUID)
RETURNS TABLE (
    id UUID,
    email TEXT,
    phone TEXT,
    first_name TEXT,
    last_name TEXT,
    display_name TEXT,
    avatar_url TEXT,
    points_balance INTEGER,
    tier TEXT,
    notifications_enabled BOOLEAN,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT m.id, m.email, m.phone, m.first_name, m.last_name,
           m.display_name, m.avatar_url, m.points_balance, m.tier,
           m.notifications_enabled, m.created_at
    FROM app_members m
    WHERE m.app_id = p_app_id
      AND m.user_id = auth.uid()
      AND m.deleted_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION get_social_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_social_member(UUID) TO authenticated;

-- ===== 4. Delete account =====
-- Removes the member's app-side data. The auth.users row itself is deleted by
-- the `delete-social-account` edge function, which holds the service role key —
-- SQL alone cannot remove it, and an account you can still log into is not
-- deleted. The edge function calls this first, then deletes the auth user.

CREATE OR REPLACE FUNCTION delete_social_member_data(p_app_id UUID)
RETURNS TABLE (success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_member RECORD;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false, 'Not authenticated'::TEXT;
        RETURN;
    END IF;

    SELECT * INTO v_member
    FROM app_members
    WHERE app_id = p_app_id AND user_id = v_user_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        -- Nothing to remove is a success, not an error — keeps the edge
        -- function's delete flow idempotent on retry.
        RETURN QUERY SELECT true, NULL::TEXT;
        RETURN;
    END IF;

    UPDATE app_members
    SET deleted_at = NOW(),
        user_id = NULL,      -- release the unique (app_id, user_id) slot
        email = NULL,
        phone = NULL,
        first_name = NULL,
        last_name = NULL,
        display_name = NULL,
        avatar_url = NULL,
        pin_hash = NULL,
        auth_token = NULL
    WHERE id = v_member.id;

    IF v_member.customer_id IS NOT NULL THEN
        UPDATE customers
        SET deleted_at = NOW()
        WHERE id = v_member.customer_id;
    END IF;

    RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION delete_social_member_data(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_social_member_data(UUID) TO authenticated;
