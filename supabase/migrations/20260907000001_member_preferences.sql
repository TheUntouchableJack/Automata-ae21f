-- ViibeView #2: per-member category / genre preferences.
--
-- The onboarding sequence (#1) ends on a "what are you into?" step. This is
-- where that answer lives for a signed-in member; a signed-out browser keeps it
-- in localStorage only and social.js merges it into the member row on signup.
--
-- What the preference DOES and does not do
-- ----------------------------------------
-- It ORDERS the filter chips and picks the initially-active one. It does NOT
-- hard-filter the feed. availableFilters() derives the chip row from the venues
-- the tenant actually has, so a member who picks "Rooftop" in a city with no
-- rooftop venue would otherwise land on a permanently empty feed with no
-- indication why — the exact silent-empty class this app keeps producing.
--
-- Why a NEW dedicated RPC and not an argument on update_social_profile
-- -------------------------------------------------------------------
--   1. `authenticated` holds only UPDATE(deleted_at, user_id) on app_members
--      (20260904000007). A write path therefore has to be SECURITY DEFINER, and
--      an RPC means ZERO grant-surface change on a table Royalty also reads.
--   2. ⚠️ EVERY argument of update_social_profile has a DEFAULT. Adding one more
--      creates an OVERLOAD rather than a replacement — the migration reports
--      success and the next 5-argument call from the client fails at RUN time
--      with 42725 (ambiguous). 20260904000002's header records the same trap.
--
-- Why set_member_preferences is a PATCH and update_social_profile is a full
-- write: these two columns have no UI that can express "clear my preferences"
-- other than deselecting everything, which arrives as an empty array, not NULL.
-- NULL here means "not sent" and leaves the column alone, so a future caller
-- that only sets genres cannot wipe categories.
--
-- ⚠️ get_social_member is DROPped and recreated below to return the two new
-- columns, and it HAS a grant footer that the DROP destroys. All three lines
-- are re-issued, and the post-install assertion at the bottom fails the
-- migration if they did not take. Losing them hands every member's email,
-- phone, points_balance and tier to anyone holding the anon key — silently,
-- because Supabase's ALTER DEFAULT PRIVILEGES grants anon EXECUTE directly.
--
-- ⚠️ Why get_social_member must learn the columns at all: it is the PREFILL
-- source for the Edit Profile sheet, and update_social_profile is a full write.
-- A column the sheet cannot read is a column the next Save silently clears.
-- These two are not written by update_social_profile, so they are safe today —
-- returning them is what lets a SECOND DEVICE inherit the choice instead of
-- re-running onboarding.
--
-- Touches: app_members (two new nullable columns), get_social_member
-- (DROP + CREATE), and creates set_member_preferences. No policy changes, no
-- table-level grant changes, no other function.
--
-- Rollback
-- --------
--   DROP FUNCTION IF EXISTS set_member_preferences(UUID, TEXT[], TEXT[]);
--   -- restore get_social_member from 20260904000003 (and re-issue its footer)
--   ALTER TABLE app_members DROP COLUMN IF EXISTS preferred_categories;
--   ALTER TABLE app_members DROP COLUMN IF EXISTS preferred_genres;


-- ===== 1. Columns =====
--
-- Additive and nullable. app_members is shared with the Royalty loyalty app,
-- whose dashboard counts rows with select('*', {count:'exact', head:true})
-- (app/dashboard.js:872) — a nullable column add cannot affect that, but it is
-- the reason nothing here is NOT NULL and nothing has a default.

ALTER TABLE app_members
    ADD COLUMN IF NOT EXISTS preferred_categories TEXT[];

ALTER TABLE app_members
    ADD COLUMN IF NOT EXISTS preferred_genres TEXT[];

COMMENT ON COLUMN app_members.preferred_categories IS
    'Venue categories this social member chose during onboarding. Orders the filter chips; never hard-filters the feed. Written only by set_member_preferences(). NULL for loyalty members.';

COMMENT ON COLUMN app_members.preferred_genres IS
    'Music genres this social member chose during onboarding. Orders the filter chips; never hard-filters the feed. Written only by set_member_preferences(). NULL for loyalty members.';


-- ===== 2. set_member_preferences =====
--
-- The slug vocabularies live in /js/venue-categories.js and /js/music-genres.js
-- and are deliberately NOT duplicated as a CHECK constraint here: two copies of
-- a list drift, and the failure mode of a drifted CHECK is a rejected write on
-- a value the UI legitimately offers. What IS enforced is shape — length caps
-- and de-duplication — so a hostile caller holding a member token cannot use
-- these columns as free storage.
--
-- The caps are generous relative to the real vocabularies (7 categories,
-- 19 genres today) so adding a slug to either list never needs a migration.

CREATE OR REPLACE FUNCTION set_member_preferences(
    p_app_id UUID,
    p_categories TEXT[] DEFAULT NULL,
    p_genres TEXT[] DEFAULT NULL
)
RETURNS TABLE (success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_member_id UUID;
    v_categories TEXT[];
    v_genres TEXT[];
BEGIN
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false, 'You must be signed in'::TEXT;
        RETURN;
    END IF;

    SELECT id INTO v_member_id
    FROM app_members
    WHERE app_id = p_app_id
      AND user_id = v_user_id
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'Join this app first'::TEXT;
        RETURN;
    END IF;

    -- Trim, drop blanks, de-duplicate, cap. An empty array survives as an empty
    -- array (NOT null): it is the honest representation of "I deselected
    -- everything", and NULL already means "not sent" in the UPDATE below.
    IF p_categories IS NOT NULL THEN
        SELECT COALESCE(array_agg(DISTINCT s), '{}'::TEXT[])
        INTO v_categories
        FROM (
            SELECT left(btrim(x), 40) AS s
            FROM unnest(p_categories) AS x
            WHERE btrim(COALESCE(x, '')) <> ''
            LIMIT 40
        ) t;
    END IF;

    IF p_genres IS NOT NULL THEN
        SELECT COALESCE(array_agg(DISTINCT s), '{}'::TEXT[])
        INTO v_genres
        FROM (
            SELECT left(btrim(x), 40) AS s
            FROM unnest(p_genres) AS x
            WHERE btrim(COALESCE(x, '')) <> ''
            LIMIT 60
        ) t;
    END IF;

    UPDATE app_members
    SET preferred_categories = COALESCE(v_categories, preferred_categories),
        preferred_genres     = COALESCE(v_genres, preferred_genres)
    WHERE id = v_member_id;

    RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;

-- The real footer, all three lines. This writes a row keyed on auth.uid(), so
-- anon calling it can only ever fail — but an ungranted anon EXECUTE is still a
-- reachable SECURITY DEFINER entry point on a table Royalty shares, and this
-- repo has shipped that mistake before (award_points, 20260904000004).
REVOKE ALL ON FUNCTION set_member_preferences(UUID, TEXT[], TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_member_preferences(UUID, TEXT[], TEXT[]) FROM anon;
GRANT EXECUTE ON FUNCTION set_member_preferences(UUID, TEXT[], TEXT[]) TO authenticated;


-- ===== 3. get_social_member — + preferred_categories, + preferred_genres =====
--
-- ⚠️ DROP + CREATE, not CREATE OR REPLACE: RETURNS TABLE gains columns and
-- CREATE OR REPLACE cannot change a return type (42P13).
--
-- ⚠️ Keep `m.joined_at AS created_at`. There is no created_at column on
-- app_members; 20260828000007 exists solely because an earlier version selected
-- one.
--
-- Body is otherwise byte-for-byte 20260904000003's.

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
    preferred_categories TEXT[],
    preferred_genres TEXT[],
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
           m.preferred_categories, m.preferred_genres,
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


-- ===== Post-install assertions =====
--
-- The footers above are the only thing between the anon key and every member's
-- email, phone and points balance. A DROP that lands without its re-GRANT fails
-- OPEN, and nothing on screen would show it. Assert BOTH directions: closed to
-- anon, and still open to authenticated — a lost GRANT locks every signed-in
-- member out of their own profile just as silently.

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

    SELECT has_function_privilege('anon', 'public.set_member_preferences(uuid, text[], text[])', 'EXECUTE'),
           has_function_privilege('authenticated', 'public.set_member_preferences(uuid, text[], text[])', 'EXECUTE')
    INTO v_anon, v_auth;

    IF v_anon THEN
        RAISE EXCEPTION
            'set_member_preferences: anon can EXECUTE it — the REVOKE ... FROM anon line did not take';
    END IF;

    IF NOT v_auth THEN
        RAISE EXCEPTION
            'set_member_preferences: authenticated CANNOT execute it — onboarding cannot save a member''s choices';
    END IF;
END;
$$;

-- The two columns must actually exist before the client ships, or the RPC above
-- succeeds against nothing. Cheap, and it catches a partially-applied file.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'app_members'
          AND column_name IN ('preferred_categories', 'preferred_genres')
        GROUP BY table_name HAVING COUNT(*) = 2
    ) THEN
        RAISE EXCEPTION 'app_members is missing preferred_categories / preferred_genres';
    END IF;
END;
$$;
