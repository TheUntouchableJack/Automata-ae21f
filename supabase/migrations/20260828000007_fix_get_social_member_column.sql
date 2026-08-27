-- get_social_member has never worked for a signed-in member.
--
-- What was wrong
-- --------------
-- 20260821000002 selects `m.created_at` from `app_members m`. That column does
-- not exist — app_members has `joined_at` and `updated_at`
-- (database/customer-apps-migration.sql:144-145). Every call by a signed-in
-- member fails with:
--
--     column m.created_at does not exist        (SQLSTATE 42703, HTTP 400)
--
-- Why nobody noticed for a week
-- -----------------------------
-- The function returns early when auth.uid() IS NULL, and plpgsql does not
-- resolve column references until the RETURN QUERY actually executes. So the
-- anonymous path — the one every smoke test and anon probe takes — returns an
-- empty result and looks perfectly healthy. Only a real signed-in session ever
-- reaches the broken statement. It surfaced the first time a member logged in.
--
-- Impact was quiet rather than fatal: loadMember() in social-auth.js logs
-- "Failed to load member" to the console and returns null, so the Profile tab
-- fell back to the session email and SocialAuth.getMember() was always null —
-- which is why the Contact Us form never prefilled a name and the profile card
-- never showed the member's own display_name.
--
-- The fix keeps the RETURN TABLE contract identical (callers already read
-- `created_at`) and aliases the real column, rather than renaming the output
-- and breaking social-auth.js.
--
-- Touches get_social_member and nothing else.
--
-- ⚠️ Signature and return type are unchanged, so CREATE OR REPLACE is legal
-- here and no DROP is needed.
--
-- Grants: 20260821000002 ends with REVOKE FROM PUBLIC + GRANT TO authenticated,
-- and CREATE OR REPLACE preserves existing grants, so they are not re-issued.
-- (Note that footer does not actually exclude `anon` — see 20260828000005 —
-- but this function refuses on auth.uid() anyway.)
--
-- Rollback: restore the definition from 20260821000002 (which is broken).

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
           m.notifications_enabled,
           -- app_members records when someone JOINED the app; there is no
           -- created_at. Aliased so the RPC's contract is unchanged.
           m.joined_at AS created_at
    FROM app_members m
    WHERE m.app_id = p_app_id
      AND m.user_id = auth.uid()
      AND m.deleted_at IS NULL;
END;
$$;
