-- ViibeView Phase 2, part 2: member profiles.
--
-- What exists today and what does not
-- -----------------------------------
-- app_members.display_name and app_members.avatar_url have existed since the
-- original loyalty schema. NOTHING WRITES EITHER OF THEM at any layer — not the
-- App Builder, not the customer app, not social.js. renderProfileIdentity()
-- reads display_name and always falls through to the first/last name it got at
-- signup. This migration is the first writer.
--
-- ⚠️⚠️ THE BACKFILL IS THE DANGEROUS PART OF THIS RELEASE ⚠️⚠️
-- ----------------------------------------------------------
-- `profile_public BOOLEAN DEFAULT false` also already exists, and it is
-- LOAD-BEARING ON A DIFFERENT FEATURE: it gates get_app_leaderboard
-- (database/customer-apps-migration.sql:655) and idx_app_members_leaderboard
-- (:160-161) is a partial index on it.
--
-- An unscoped `UPDATE app_members SET profile_public = true` would put every
-- member of every Royalty loyalty tenant onto that tenant's public leaderboard,
-- under a flag they never opted into. That is a cross-tenant privacy incident,
-- not a data cleanup. Three mitigations, all applied:
--
--   1. The backfill is scoped to ONE explicit app id, verified against prod
--      before this file was written:
--        SELECT id, slug, app_type FROM customer_apps WHERE slug = 'viibeview';
--        -> 6119865e-83f8-4731-b320-8ea705a2ac18 | viibeview | social
--      NOT scoped by app_type. The documented values are
--      'loyalty' | 'rewards' | 'membership' | 'custom'
--      (customer-apps-migration.sql:21); 'social' is real data but is not in
--      that list, so filtering on it is filtering on an undocumented value.
--      An id is a fact.
--   2. NO `ALTER COLUMN profile_public SET DEFAULT true`. That would flip the
--      default for every future Royalty signup, everywhere. The default is set
--      on the INSERT inside social_member_signup instead — which only social
--      apps call.
--   3. The off switch ships in the SAME release. update_social_profile takes
--      p_profile_public and the Edit Profile sheet has the toggle. Public by
--      default only means what it says if it can be turned off.
--
-- One gate, not two: the member column. customer_apps.features->>'profile_public'
-- is App Builder chrome that no runtime path reads, and a second gate means a
-- blank profile with no obvious cause.
--
-- Anon-readable functions are PUBLIC API
-- --------------------------------------
-- app_members has no anon and no cross-member SELECT policy — only read-own and
-- update-own (20260821000002:53-62). So a profile view cannot be a table select;
-- it has to be a SECURITY DEFINER RPC, and because it must serve signed-out
-- visitors it carries NO grant footer, which means anyone holding the anon key
-- can call it. Written accordingly: explicit column lists, never m.*, and never
-- email, phone, points_balance, tier, pin_hash, auth_token or last_name.
-- Name fallback follows house precedent (customer-apps-migration.sql:649):
-- COALESCE(display_name, first_name, 'Member') — first name only.
--
-- Touches: app_members (one new column, one scoped UPDATE), social_member_signup,
-- get_social_member, and creates update_social_profile / get_member_profile /
-- get_member_posts.
--
-- Rollback
-- --------
--   DROP FUNCTION IF EXISTS get_member_posts(UUID, UUID, INTEGER, INTEGER);
--   DROP FUNCTION IF EXISTS get_member_profile(UUID, UUID);
--   DROP FUNCTION IF EXISTS update_social_profile(UUID, TEXT, TEXT, TEXT, BOOLEAN);
--   -- restore get_social_member from 20260828000007 (and re-issue its footer)
--   -- restore social_member_signup from 20260821000002
--   UPDATE app_members SET profile_public = false
--    WHERE app_id = '6119865e-83f8-4731-b320-8ea705a2ac18';
--   ALTER TABLE app_members DROP COLUMN IF EXISTS bio;


-- ===== 1. bio =====

ALTER TABLE app_members
    ADD COLUMN IF NOT EXISTS bio TEXT;

COMMENT ON COLUMN app_members.bio IS
    'Short free-text profile line for social app types. Written only by update_social_profile(), which trims and caps it. NULL for loyalty members.';


-- ===== 2. The scoped profile_public backfill =====
--
-- Read the header before touching this statement. The WHERE clause is the whole
-- safety story: one app id, live members only.

UPDATE app_members
SET profile_public = true
WHERE app_id = '6119865e-83f8-4731-b320-8ea705a2ac18'   -- viibeview, pinned by id
  AND deleted_at IS NULL
  AND profile_public IS DISTINCT FROM true;


-- ===== 3. social_member_signup — new members are public =====
--
-- Only the INSERT branch. The two earlier branches (already a member; adopting a
-- PIN-era row with the same email) deliberately leave profile_public alone: an
-- existing member's visibility is theirs to change in Edit Profile, and a login
-- must never silently republish a profile someone turned off.
--
-- Signature unchanged -> CREATE OR REPLACE keeps the grants 20260903000000 set.

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
        first_name, last_name, last_login_at,
        -- Set HERE, not as a column default. A column default would change
        -- every future Royalty loyalty signup; this reaches only members
        -- created through the social flow. See the header.
        profile_public
    )
    VALUES (
        p_app_id, v_customer_id, v_user_id, lower(v_email), p_phone,
        p_first_name, p_last_name, NOW(),
        true
    )
    RETURNING id INTO v_member_id;

    RETURN QUERY SELECT true, v_member_id, NULL::TEXT;
END;
$$;


-- ===== 4. update_social_profile =====
--
-- Family A status row. FULL WRITE, not a patch: every field is set from its
-- argument, so NULL clears. The client sends the whole form every time, which is
-- what makes "remove my bio" and "remove my avatar" expressible at all — a
-- COALESCE-style partial update cannot distinguish "unchanged" from "cleared".
-- p_profile_public is the one exception: NULL leaves it alone, so a future
-- caller that only edits text cannot accidentally republish a hidden profile.
--
-- ⚠️ avatar_url is validated against the storage public prefix. It is rendered
-- as an <img src> on every feed card and every profile row, so an unvalidated
-- value is an arbitrary third-party URL that every visitor's browser fetches —
-- a tracking pixel with a member's name on it. Phase 2 uploads avatars to the
-- EXISTING venue-media bucket under members/{auth.uid()}/, which the member
-- storage policy (20260828000002:263-285) already permits and whose mime
-- allowlist already includes image/jpeg. No new bucket, no new policy, no CSP
-- change.

CREATE OR REPLACE FUNCTION update_social_profile(
    p_app_id UUID,
    p_display_name TEXT DEFAULT NULL,
    p_bio TEXT DEFAULT NULL,
    p_avatar_url TEXT DEFAULT NULL,
    p_profile_public BOOLEAN DEFAULT NULL
)
RETURNS TABLE (success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_member_id UUID;
    v_display_name TEXT;
    v_bio TEXT;
    v_avatar_url TEXT;
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

    -- Trim, cap, and turn an empty result back into NULL so "  " does not
    -- become a display name made of spaces.
    v_display_name := NULLIF(left(btrim(COALESCE(p_display_name, '')), 60), '');
    v_bio          := NULLIF(left(btrim(COALESCE(p_bio, '')), 300), '');
    v_avatar_url   := NULLIF(btrim(COALESCE(p_avatar_url, '')), '');

    IF v_avatar_url IS NOT NULL
       AND v_avatar_url !~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/venue-media/members/' THEN
        RETURN QUERY SELECT false, 'That image could not be used'::TEXT;
        RETURN;
    END IF;

    UPDATE app_members
    SET display_name   = v_display_name,
        bio            = v_bio,
        avatar_url     = v_avatar_url,
        profile_public = COALESCE(p_profile_public, profile_public)
    WHERE id = v_member_id;

    RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION update_social_profile(UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION update_social_profile(UUID, TEXT, TEXT, TEXT, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION update_social_profile(UUID, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;


-- ===== 5. get_social_member — + bio, + profile_public =====
--
-- ⚠️ Unlike get_venue_feed, this function HAS a grant footer and DROP destroys
-- it. All three lines are re-issued below, in this file. Forgetting them opens
-- the caller's own email and points balance to the anon key, silently.
--
-- ⚠️ Keep `m.joined_at AS created_at`. There is no created_at column on
-- app_members; 20260828000007 exists solely because the original selected one.

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
           m.display_name, m.avatar_url, m.bio,
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


-- ===== 6. get_member_profile — ANON-READABLE, NO FOOTER =====
--
-- ⚠️ NO GRANT FOOTER IN THIS SECTION OR THE NEXT. Signed-out visitors browse
-- the feed, so they must be able to open the profile behind a post. Adding
-- `REVOKE ... FROM PUBLIC; GRANT ... TO authenticated` here empties the overlay
-- for every anonymous visitor and fails SILENTLY — the client renders its empty
-- state over a permission error it only logs (20260828000003:21-28).
--
-- A private profile returns a ROW with is_private = true, not zero rows. Zero
-- rows is indistinguishable from "no such member", and the overlay would open on
-- an unexplainable blank shell instead of saying "this profile is private".
-- Name and avatar are returned either way: they are what the follower lists
-- already show, so hiding them here would be a privacy claim the rest of the
-- app does not honour.

CREATE OR REPLACE FUNCTION get_member_profile(
    p_app_id UUID,
    p_user_id UUID
)
RETURNS TABLE (
    user_id UUID,
    display_name TEXT,
    avatar_url TEXT,
    bio TEXT,
    is_private BOOLEAN,
    follower_count INTEGER,
    following_count INTEGER,
    post_count INTEGER,
    joined_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    -- Explicitly typed scalars rather than a RECORD. plpgsql cannot always infer
    -- the type of an untyped record field used inside a later query, and the
    -- failure mode is "could not determine data type of parameter" at RUN time,
    -- not at CREATE time — i.e. a function that installs cleanly and then throws
    -- the first time a visitor opens a profile.
    v_name    TEXT;
    v_avatar  TEXT;
    v_bio     TEXT;
    v_joined  TIMESTAMPTZ;
    v_public  BOOLEAN;
    -- You can always see your own profile in full. Without this, a member who
    -- turns their profile off would open "View My Profile" and find their own
    -- posts gone and their own follower count reading zero — which looks like
    -- the toggle deleted something rather than hid it.
    -- is_private still reports the STORED value either way, so the overlay can
    -- say "only you can see this".
    v_visible BOOLEAN;
BEGIN
    IF p_app_id IS NULL OR p_user_id IS NULL THEN
        RETURN;
    END IF;

    SELECT COALESCE(m.display_name, m.first_name, 'Member'),
           m.avatar_url,
           m.bio,
           m.joined_at,
           COALESCE(m.profile_public, false)
    INTO v_name, v_avatar, v_bio, v_joined, v_public
    FROM app_members m
    WHERE m.app_id = p_app_id
      AND m.user_id = p_user_id
      AND m.deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN;   -- genuinely no such member; the client shows "not found"
    END IF;

    v_visible := v_public OR (auth.uid() IS NOT NULL AND auth.uid() = p_user_id);

    RETURN QUERY
    SELECT
        p_user_id,
        v_name,
        v_avatar,
        CASE WHEN v_visible THEN v_bio ELSE NULL::TEXT END,
        (NOT v_public),
        CASE WHEN v_visible
             THEN social_follower_count(p_app_id, 'user', p_user_id)
             ELSE 0 END,
        CASE WHEN v_visible THEN (
            SELECT COUNT(*)::INTEGER FROM social_follows f
            WHERE f.app_id = p_app_id AND f.follower_user_id = p_user_id
        ) ELSE 0 END,
        CASE WHEN v_visible THEN (
            SELECT COUNT(*)::INTEGER FROM venue_media vm
            WHERE vm.app_id = p_app_id
              AND vm.uploaded_by_user_id = p_user_id
              AND vm.status = 'approved'
        ) ELSE 0 END,
        v_joined;
END;
$$;


-- ===== 7. get_member_posts — ANON-READABLE, NO FOOTER =====
--
-- The grid on a member's profile. Returns nothing at all for a private profile:
-- the counts are already suppressed above, and a private profile whose posts
-- were still listable would be a privacy setting that does not do anything.
--
-- The one exception, matching get_member_profile: the member themselves always
-- sees their own grid. Turning your profile off hides it from other people; it
-- does not hide your own posts from you.
--
-- Column list is the subset renderMemberGrid() needs. venue_name comes along so
-- a grid tile can say where it was shot without a second round trip.

CREATE OR REPLACE FUNCTION get_member_posts(
    p_app_id UUID,
    p_user_id UUID,
    p_limit INTEGER DEFAULT 24,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    venue_id UUID,
    venue_name TEXT,
    media_type TEXT,
    url TEXT,
    thumbnail_url TEXT,
    caption TEXT,
    duration_seconds INTEGER,
    created_at TIMESTAMPTZ,
    uploaded_by_user_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_public BOOLEAN;
BEGIN
    IF p_app_id IS NULL OR p_user_id IS NULL THEN
        RETURN;
    END IF;

    SELECT COALESCE(m.profile_public, false) INTO v_public
    FROM app_members m
    WHERE m.app_id = p_app_id
      AND m.user_id = p_user_id
      AND m.deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF NOT v_public AND NOT (auth.uid() IS NOT NULL AND auth.uid() = p_user_id) THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        vm.id, vm.venue_id,
        v.name AS venue_name,
        vm.media_type, vm.url, vm.thumbnail_url,
        vm.caption, vm.duration_seconds, vm.created_at,
        vm.uploaded_by_user_id
    FROM venue_media vm
    -- Same LEFT-JOIN shape as get_venue_feed: a venue-less Viibe is a supported
    -- post and must not be filtered out by predicates on a row that is absent.
    LEFT JOIN venues v
           ON v.id = vm.venue_id
          AND v.is_active = true
          AND v.deleted_at IS NULL
    WHERE vm.app_id = p_app_id
      AND vm.uploaded_by_user_id = p_user_id
      AND vm.status = 'approved'
      AND (vm.venue_id IS NULL OR v.id IS NOT NULL)
    ORDER BY vm.created_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 24), 0)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;
