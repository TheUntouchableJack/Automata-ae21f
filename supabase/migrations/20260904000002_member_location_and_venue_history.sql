-- ViibeView: member location, venue history, and a privacy gate on the follow lists.
--
-- Three proposal cards close here: "Add Profile Details" (a location field),
-- "Visited Locations / Check-in History", and the venue half of "Viewing A
-- Profile".
--
-- Check-in history is DERIVED FROM POSTS, not from a check-in
-- ----------------------------------------------------------
-- Choosing a venue when you post already IS the check-in (social.js:2150), and
-- get_member_posts already carries venue_id + venue_name. So this ships no new
-- write path — which matters: record_member_visit was deliberately revoked from
-- anon and authenticated in 20260903000005 because it was a points-forgery
-- endpoint, and any "real" check-in button would be a request to re-open it.
--
-- The honest framing, which the UI copy matches, is "venues they posted at" —
-- not attendance. Deduped by venue with a count and a last-seen date, so five
-- Viibes at one bar read as one venue rather than five.
--
-- ⚠️ CREATE OR REPLACE CANNOT DO THIS ALONE
-- -----------------------------------------
-- Two of the three function changes below alter a signature, and CREATE OR
-- REPLACE cannot change a return type or an argument list. Both need an
-- explicit DROP first:
--
--   get_member_profile   gains `location` in RETURNS TABLE.
--   update_social_profile gains p_location.
--
-- update_social_profile is the dangerous one. EVERY argument has a DEFAULT, so
-- adding a parameter WITHOUT dropping does not error — it creates an OVERLOAD,
-- and every existing named-argument call (social.js sends p_app_id,
-- p_display_name, p_bio, p_avatar_url, p_profile_public) then resolves
-- ambiguously at RUN time, not at install time. The migration would report
-- success and the Edit Profile sheet would start failing for everyone. Section 2
-- therefore drops the exact 5-arg signature, and section 6 asserts afterwards
-- that exactly one remains.
--
-- ⚠️ Re-GRANT after the drop. Grants do not survive DROP FUNCTION, and
-- update_social_profile's authenticated grant is the only thing that makes the
-- sheet work at all.
--
-- ⚠️ NO GRANT FOOTER on get_member_profile or get_member_venues.
-- 20260903000002:350-357 spells out why: signed-out visitors browse the feed and
-- open the profile behind a post, so a `REVOKE ... FROM PUBLIC; GRANT ... TO
-- authenticated` block empties the overlay for every anonymous visitor and does
-- it SILENTLY. get_member_venues is read by the same anonymous visitor on the
-- same screen, so it follows the same rule. Being anon-callable makes it public
-- API: explicit column list, and nothing from app_members beyond what
-- get_member_profile already returns.
--
-- Touches: app_members (one new column), update_social_profile,
-- get_member_profile, get_member_followers, get_member_following; creates
-- get_member_venues.
--
-- Rollback
-- --------
--   DROP FUNCTION IF EXISTS get_member_venues(UUID, UUID, INTEGER, INTEGER);
--   -- restore get_member_profile + update_social_profile from 20260903000002
--   --   (and re-issue update_social_profile's authenticated grant, 5-arg)
--   -- restore get_member_followers + get_member_following from 20260903000003
--   ALTER TABLE app_members DROP COLUMN IF EXISTS location;


-- ===== 1. location =====

ALTER TABLE app_members
    ADD COLUMN IF NOT EXISTS location TEXT;

COMMENT ON COLUMN app_members.location IS
    'Self-declared free-text home base ("Perpignan, FR") for social app types. Written only by update_social_profile(), which trims and caps it at 80 chars. Never geocoded and never used for distance — venue proximity comes from the device, not from this. NULL for loyalty members.';


-- ===== 2. update_social_profile — + p_location =====
--
-- Still a FULL WRITE, not a patch: every text field is set from its argument, so
-- NULL clears. That is what makes "remove my location" expressible at all, and
-- it means the CLIENT MUST SEND location on every save or it silently wipes what
-- is already stored. handleEditProfileSubmit() reads the field unconditionally
-- for exactly this reason.
--
-- p_profile_public keeps its one exception (NULL leaves it alone), so a future
-- caller that only edits text cannot accidentally republish a hidden profile.
--
-- ⚠️ The DROP is not optional — see the header. Dropping the 5-arg signature is
-- what stops the 6-arg one from becoming an ambiguous overload of it.

DROP FUNCTION IF EXISTS update_social_profile(UUID, TEXT, TEXT, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION update_social_profile(
    p_app_id UUID,
    p_display_name TEXT DEFAULT NULL,
    p_bio TEXT DEFAULT NULL,
    p_avatar_url TEXT DEFAULT NULL,
    p_profile_public BOOLEAN DEFAULT NULL,
    p_location TEXT DEFAULT NULL
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
    v_location TEXT;
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
    -- 80 to match the input's maxlength. It renders on one line under the name;
    -- a 300-char "location" would reflow the whole identity block.
    v_location     := NULLIF(left(btrim(COALESCE(p_location, '')), 80), '');

    IF v_avatar_url IS NOT NULL
       AND v_avatar_url !~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/venue-media/members/' THEN
        RETURN QUERY SELECT false, 'That image could not be used'::TEXT;
        RETURN;
    END IF;

    UPDATE app_members
    SET display_name   = v_display_name,
        bio            = v_bio,
        avatar_url     = v_avatar_url,
        location       = v_location,
        profile_public = COALESCE(p_profile_public, profile_public)
    WHERE id = v_member_id;

    RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION update_social_profile(UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION update_social_profile(UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION update_social_profile(UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;


-- ===== 3. get_member_profile — + location — ANON-READABLE, NO FOOTER =====
--
-- Unchanged except for the new column. location is returned on exactly the same
-- terms as bio: suppressed when a private profile is viewed by somebody else,
-- always visible to yourself. It is self-declared free text, but it is still a
-- statement about where a person is, and it must not leak past the switch that
-- hides their bio.
--
-- ⚠️ The DROP is required: RETURNS TABLE gained a column, which CREATE OR
-- REPLACE cannot do. No grants to restore — this function deliberately has none.

DROP FUNCTION IF EXISTS get_member_profile(UUID, UUID);

CREATE OR REPLACE FUNCTION get_member_profile(
    p_app_id UUID,
    p_user_id UUID
)
RETURNS TABLE (
    user_id UUID,
    display_name TEXT,
    avatar_url TEXT,
    bio TEXT,
    location TEXT,
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
    -- Explicitly typed scalars rather than a RECORD, for the reason
    -- 20260903000002:387-391 records: plpgsql cannot always infer the type of an
    -- untyped record field used in a later query, and it fails at RUN time.
    v_name     TEXT;
    v_avatar   TEXT;
    v_bio      TEXT;
    v_location TEXT;
    v_joined   TIMESTAMPTZ;
    v_public   BOOLEAN;
    v_visible  BOOLEAN;
BEGIN
    IF p_app_id IS NULL OR p_user_id IS NULL THEN
        RETURN;
    END IF;

    SELECT COALESCE(m.display_name, m.first_name, 'Member'),
           m.avatar_url,
           m.bio,
           m.location,
           m.joined_at,
           COALESCE(m.profile_public, false)
    INTO v_name, v_avatar, v_bio, v_location, v_joined, v_public
    FROM app_members m
    WHERE m.app_id = p_app_id
      AND m.user_id = p_user_id
      AND m.deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN;   -- genuinely no such member; the client shows "not found"
    END IF;

    -- You can always see your own profile in full; is_private still reports the
    -- STORED value, so the overlay can say "only you can see this".
    v_visible := v_public OR (auth.uid() IS NOT NULL AND auth.uid() = p_user_id);

    RETURN QUERY
    SELECT
        p_user_id,
        v_name,
        v_avatar,
        CASE WHEN v_visible THEN v_bio ELSE NULL::TEXT END,
        CASE WHEN v_visible THEN v_location ELSE NULL::TEXT END,
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


-- ===== 4. get_member_venues — ANON-READABLE, NO FOOTER =====
--
-- "Been to": the distinct venues this member has posted at, most recent first.
--
-- Returns the row shape renderPeopleList() ALREADY consumes (target_type,
-- target_id, name, avatar_url, subtitle — 20260903000003), so the existing
-- people sheet renders this with no new component. target_type is the literal
-- 'venue', which is the branch that renderer already handles: a venue row opens
-- the venue page. visit_count and last_posted_at ride along as extra columns so
-- the client can rebuild the subtitle in the member's own language and time
-- zone; the `subtitle` returned here is the English fallback, and it is what
-- shows if the i18n lookup misses.
--
-- avatar_url is profile_image_url, NOT cover_image_url: it lands in
-- .people-row-avatar, a 44px circle, and it must match the venue rows
-- get_member_following already puts in that same list.
--
-- ⚠️ The privacy gate is get_member_posts' gate, verbatim (20260903000002:490-500)
-- — same profile_public lookup, same RETURN on not-found, same own-profile
-- exception. This list is strictly derived from the post grid, so any weaker
-- gate here would publish, venue by venue, exactly what the grid is hiding.
--
-- ⚠️ INNER JOIN, unlike get_member_posts' LEFT JOIN. There the LEFT JOIN is
-- load-bearing: an unattached Viibe is a supported post and must survive. Here
-- a venue-less Viibe has no venue to list, so it drops out — which is the same
-- reason get_member_posts needs its `vm.venue_id IS NULL OR v.id IS NOT NULL`
-- escape hatch and this does not.

CREATE OR REPLACE FUNCTION get_member_venues(
    p_app_id UUID,
    p_user_id UUID,
    p_limit INTEGER DEFAULT 24,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    target_type TEXT,
    target_id UUID,
    name TEXT,
    avatar_url TEXT,
    subtitle TEXT,
    visit_count INTEGER,
    last_posted_at TIMESTAMPTZ
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
        'venue'::TEXT,
        v.id,
        v.name::TEXT,
        v.profile_image_url::TEXT,
        (COUNT(*)::TEXT || CASE WHEN COUNT(*) = 1 THEN ' Viibe · ' ELSE ' Viibes · ' END
            || to_char(MAX(vm.created_at), 'Mon DD'))::TEXT,
        COUNT(*)::INTEGER,
        MAX(vm.created_at)
    FROM venue_media vm
    JOIN venues v
      ON v.id = vm.venue_id
     AND v.app_id = vm.app_id
     AND v.is_active = true
     AND v.deleted_at IS NULL
    WHERE vm.app_id = p_app_id
      AND vm.uploaded_by_user_id = p_user_id
      AND vm.status = 'approved'
      AND vm.venue_id IS NOT NULL
    GROUP BY v.id, v.name, v.profile_image_url
    ORDER BY MAX(vm.created_at) DESC
    LIMIT GREATEST(COALESCE(p_limit, 24), 0)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;


-- ===== 5. Privacy fix — the follow lists honour profile_public =====
--
-- The bug: get_member_followers and get_member_following (20260903000003) have
-- no privacy gate at all. get_member_profile suppresses a private member's
-- counts and get_member_posts suppresses their grid, but anyone holding the anon
-- key could still call get_member_following(app, that_member) and read their
-- entire social graph — who they follow, which venues, and when. The profile
-- overlay never shows it, so nothing on screen revealed the hole.
--
-- ⚠️ THIS IS NOT A REVERSAL OF 20260903000003's ASYMMETRY. Read that header
-- before changing this. It documents that the LISTS deliberately do not filter
-- individual rows on profile_public, because the follower COUNT on a profile is
-- social_follower_count() whose only predicate is deleted_at — filter the rows
-- and a profile says "12 followers" above a list of 9 with no explanation. That
-- stays true here. What changes is orthogonal: the WHOLE list is now gated on
-- the profile being viewed, exactly as get_member_posts gates the whole grid.
--
-- The two rules compose without contradiction:
--   * A PRIVATE member's own lists return nothing to anyone but them — and
--     get_member_profile already reports their counts as 0 to those same
--     callers, so list length still equals the count shown.
--   * A private member still APPEARS as a name + avatar row inside a PUBLIC
--     member's lists. That is 20260903000002:360's stated intent, and changing
--     it is a different decision than this one.
--
-- Signatures are unchanged, so CREATE OR REPLACE is correct here and the
-- (absent, by design) grants are untouched.

CREATE OR REPLACE FUNCTION get_member_followers(
    p_app_id UUID,
    p_user_id UUID,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    target_type TEXT,
    target_id UUID,
    name TEXT,
    avatar_url TEXT,
    subtitle TEXT,
    followed_at TIMESTAMPTZ
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
        'user'::TEXT,
        f.follower_user_id,
        COALESCE(am.display_name, am.first_name, 'Member')::TEXT,
        am.avatar_url::TEXT,
        NULL::TEXT AS subtitle,
        f.created_at
    FROM social_follows f
    JOIN app_members am
      ON am.user_id = f.follower_user_id
     AND am.app_id  = f.app_id
     AND am.deleted_at IS NULL
    WHERE f.app_id = p_app_id
      AND f.followee_user_id = p_user_id
    ORDER BY f.created_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 50), 0)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;


CREATE OR REPLACE FUNCTION get_member_following(
    p_app_id UUID,
    p_user_id UUID,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    target_type TEXT,
    target_id UUID,
    name TEXT,
    avatar_url TEXT,
    subtitle TEXT,
    followed_at TIMESTAMPTZ
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
    SELECT * FROM (
        SELECT
            'user'::TEXT AS target_type,
            f.followee_user_id AS target_id,
            COALESCE(am.display_name, am.first_name, 'Member')::TEXT AS name,
            am.avatar_url::TEXT AS avatar_url,
            NULL::TEXT AS subtitle,
            f.created_at AS followed_at
        FROM social_follows f
        JOIN app_members am
          ON am.user_id = f.followee_user_id
         AND am.app_id  = f.app_id
         AND am.deleted_at IS NULL
        WHERE f.app_id = p_app_id
          AND f.follower_user_id = p_user_id
          AND f.followee_user_id IS NOT NULL

        UNION ALL

        SELECT
            'venue'::TEXT AS target_type,
            v.id AS target_id,
            v.name::TEXT AS name,
            v.profile_image_url::TEXT AS avatar_url,
            NULLIF(concat_ws(' · ', v.category, v.city), '')::TEXT AS subtitle,
            f.created_at AS followed_at
        FROM social_follows f
        JOIN venues v
          ON v.id = f.followee_venue_id
         AND v.app_id = f.app_id
         AND v.is_active = true
         AND v.deleted_at IS NULL
        WHERE f.app_id = p_app_id
          AND f.follower_user_id = p_user_id
          AND f.followee_venue_id IS NOT NULL
    ) edges
    ORDER BY edges.followed_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 50), 0)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;


-- ===== 6. Post-install assertion =====
--
-- The failure this guards against is silent by construction: a missed DROP in
-- section 2 leaves TWO update_social_profile overloads, both installable, and
-- the damage only appears the next time a member taps Save. Assert it here,
-- where the migration can still fail loudly, rather than discovering it in prod.

DO $$
DECLARE
    v_count INTEGER;
    v_args  INTEGER;
BEGIN
    SELECT COUNT(*), MAX(pronargs) INTO v_count, v_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_social_profile';

    IF v_count <> 1 OR v_args <> 6 THEN
        RAISE EXCEPTION
            'update_social_profile: expected exactly 1 function with 6 args, found % with % — the 5-arg DROP did not take, and named-arg calls are now ambiguous',
            v_count, v_args;
    END IF;

    -- ⚠️ get_member_profile is legitimately OVERLOADED and must stay that way.
    -- 20260217000004 owns a ONE-arg get_member_profile(p_member_id UUID) that the
    -- LOYALTY customer app calls (customer-app/app.js:427). It is a different
    -- function for a different app type; the DROP above is signature-qualified
    -- to (UUID, UUID) precisely so it survives. Count the 2-arg one only.
    SELECT COUNT(*) INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_member_profile' AND p.pronargs = 2;

    IF v_count <> 1 THEN
        RAISE EXCEPTION
            'get_member_profile: expected exactly 1 two-arg function, found %', v_count;
    END IF;

    SELECT COUNT(*) INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_member_profile' AND p.pronargs = 1;

    IF v_count <> 1 THEN
        RAISE EXCEPTION
            'get_member_profile: the loyalty app''s 1-arg overload was destroyed (found %) — customer-app/app.js:427 is now broken',
            v_count;
    END IF;
END;
$$;
