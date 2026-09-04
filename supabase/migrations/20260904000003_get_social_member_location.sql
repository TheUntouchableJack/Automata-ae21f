-- ViibeView: get_social_member gains `location`.
--
-- Why this is a separate migration from 20260904000002 rather than part of it:
-- …0002 was already pushed. Editing an applied migration leaves the file and
-- the database describing different things, and the next `db reset` builds the
-- wrong schema from a version the ledger already calls done.
--
-- Why it is needed at all
-- -----------------------
-- update_social_profile is a FULL WRITE: every text field is set from its
-- argument, so a field the Edit Profile sheet cannot PREFILL is a field the
-- next Save silently CLEARS. …0002 added app_members.location and taught
-- get_member_profile to return it, but the edit sheet does not read
-- get_member_profile — it reads get_social_member, via SocialAuth.loadMember()
-- (social.js:3190). Without location here, a member sets their location, opens
-- the sheet to change their bio, saves, and their location is gone.
--
-- Reading it from get_member_profile instead would work, but it makes the one
-- form read its own row through two different RPCs with two different privacy
-- models, and that is exactly the kind of split that drifts. get_social_member
-- is the canonical "my own member row" reader; every other field on the form
-- already comes from it.
--
-- ⚠️ DROP + CREATE, not CREATE OR REPLACE: RETURNS TABLE gains a column, and
-- CREATE OR REPLACE cannot change a return type.
--
-- ⚠️ THIS FUNCTION HAS A GRANT FOOTER AND DROP DESTROYS IT. Unlike the
-- anon-readable profile RPCs, get_social_member returns the caller's own email,
-- phone, points_balance and tier. All three footer lines are re-issued below.
-- Forgetting them hands that row to anyone holding the anon key — silently,
-- because Supabase's ALTER DEFAULT PRIVILEGES grants anon EXECUTE directly
-- (measured in 20260828000005), so the function would simply start working for
-- everyone.
--
-- ⚠️ Keep `m.joined_at AS created_at`. There is no created_at column on
-- app_members; 20260828000007 exists solely because an earlier version selected
-- one.
--
-- Touches: get_social_member only. No table, no column, no other function.
--
-- Rollback
-- --------
--   -- restore get_social_member from 20260903000002 (and re-issue its footer)

DROP FUNCTION IF EXISTS get_social_member(UUID);

CREATE FUNCTION get_social_member(p_app_id UUID)
RETURNS TABLE (
    id UUID,
    email TEXT,
    phone TEXT,
    first_name TEXT,
    last_name TEXT,
    display_name TEXT,
    avatar_url TEXT,
    bio TEXT,
    location TEXT,
    profile_public BOOLEAN,
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
           m.display_name, m.avatar_url, m.bio, m.location,
           COALESCE(m.profile_public, false),
           m.points_balance, m.tier,
           m.notifications_enabled,
           m.joined_at AS created_at
    FROM app_members m
    WHERE m.app_id = p_app_id
      AND m.user_id = auth.uid()
      AND m.deleted_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION get_social_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_social_member(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION get_social_member(UUID) TO authenticated;


-- ===== Post-install assertion =====
--
-- The footer above is the only thing standing between the anon key and every
-- member's email, phone and points balance. A DROP that lands without its
-- re-GRANT fails OPEN, and nothing on screen would show it. Assert it here.

DO $$
DECLARE
    v_anon BOOLEAN;
    v_auth BOOLEAN;
BEGIN
    SELECT has_function_privilege('anon', 'public.get_social_member(uuid)', 'EXECUTE'),
           has_function_privilege('authenticated', 'public.get_social_member(uuid)', 'EXECUTE')
    INTO v_anon, v_auth;

    IF v_anon THEN
        RAISE EXCEPTION
            'get_social_member: anon can EXECUTE it — the REVOKE ... FROM anon line did not take, and every member''s email and points balance is now readable with the anon key';
    END IF;

    IF NOT v_auth THEN
        RAISE EXCEPTION
            'get_social_member: authenticated CANNOT execute it — the GRANT was lost with the DROP, and every signed-in member is now locked out of their own profile';
    END IF;
END;
$$;
