-- Post lifetime, part 2: the four readers, and a 24-hour default.
--
-- Why
-- ---
-- 20260922000003 added venue_media.is_permanent, backfilled it and taught
-- create_social_post to write it. Nothing read it. This file is what makes it
-- mean something, and it is the migration that changes behaviour.
--
-- The predicate, identical in all four functions:
--
--     AND (v_ttl_hours IS NULL
--          OR vm.is_permanent
--          OR vm.created_at > now() - make_interval(secs => (v_ttl_hours * 3600)::DOUBLE PRECISION))
--
-- Before: TTL applied to the HOME FEED only, and the default was "never".
-- After:  TTL applies to the home feed, venue pages and the map; team posts
--         never expire anywhere; and every member keeps their own posts on
--         their own profile forever.
--
-- ⚠️ FIVE THINGS THAT WILL BREAK THIS FILE IF IGNORED
--
-- 1. ⚠️ NO GRANT FOOTER on get_venue_feed_v3, get_venue_page_feed or
--    get_recent_post_pins. All three depend on the default EXECUTE TO PUBLIC,
--    and that default is the only reason a signed-out visitor can browse
--    ViibeView. Appending `REVOKE … FROM PUBLIC; GRANT … TO authenticated`
--    empties all three surfaces for every anonymous visitor and fails
--    SILENTLY — a 200 with zero rows, rendered as "No posts yet".
--    get_following_feed_v3 DOES keep its real three-line footer; it is
--    authenticated-only by design. Asserted in section 6, both directions.
--
-- 2. ⚠️ get_member_posts is DELIBERATELY EXEMPT and is not touched here.
--    See section 5 for why, at length. A test asserts the predicate does NOT
--    appear in it.
--
-- 3. ⚠️ The two v3 functions must stay byte-identical in this predicate.
--    Neither gains or loses a column, so the RETURNS TABLE equality test in
--    tests/viibeview-follows.test.js keeps passing whatever happens to the
--    BODIES — it cannot see a divergence there. They are edited in one pass
--    here and a body-level predicate-equality assertion is added to the tests.
--
-- 4. ⚠️ social_feed_ttl_hours is NOT changed, and must not be. Its whole design
--    (20260907000002:140-150) is that every unparseable shape returns NULL,
--    i.e. no expiry, because the other direction empties every tenant on this
--    database at once. The 24-hour default is a SEEDED VALUE (section 4), not
--    a change of semantics.
--
-- 5. ⚠️ get_recent_post_pins has been missing `SET search_path = public` since
--    20260904000001 re-created it without the line 20260901000001 had added.
--    That is a pre-existing regression, not something this file introduces —
--    but this file re-creates the function, so it is restored here rather than
--    carried forward one more time.
--
-- Rollback
-- --------
-- Re-run get_venue_feed_v3 and get_following_feed_v3 from 20260907000002,
-- get_venue_page_feed and get_recent_post_pins from 20260904000001 — all four
-- verbatim, with NO grant footer on three of them. Then, to restore "no
-- expiry" behaviour, clear the seeded setting:
--   UPDATE customer_apps SET settings = settings - 'post_ttl_hours'
--   WHERE app_type = 'social';
-- (That also clears a value an owner chose deliberately. Prefer leaving it.)


-- ===== 1. get_venue_feed_v3 — + the is_permanent disjunct =====
--
-- CREATE OR REPLACE, not DROP: no column is added or removed, so the return
-- type is unchanged and there is no outage window. Everything outside the one
-- new line is carried forward verbatim from 20260907000002:190-335.

CREATE OR REPLACE FUNCTION get_venue_feed_v3(
    p_app_id UUID,
    p_category TEXT DEFAULT NULL,
    p_genre TEXT DEFAULT NULL,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lng DOUBLE PRECISION DEFAULT NULL,
    p_radius_miles DOUBLE PRECISION DEFAULT NULL,
    p_limit INTEGER DEFAULT 20,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    venue_id UUID,
    venue_name TEXT,
    venue_handle TEXT,
    venue_category TEXT,
    venue_music_genres TEXT[],
    venue_city TEXT,
    venue_state TEXT,
    venue_latitude DECIMAL,
    venue_longitude DECIMAL,
    venue_profile_image_url TEXT,
    media_type TEXT,
    url TEXT,
    thumbnail_url TEXT,
    storage_path TEXT,
    caption TEXT,
    duration_seconds INTEGER,
    view_count INTEGER,
    like_count INTEGER,
    created_at TIMESTAMPTZ,
    uploaded_by_user_id UUID,
    author_first_name TEXT,
    author_last_name TEXT,
    author_display_name TEXT,
    author_avatar_url TEXT,
    post_latitude DECIMAL,
    post_longitude DECIMAL
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ttl_hours NUMERIC;
    v_radius DOUBLE PRECISION;
    v_lat_delta DOUBLE PRECISION;
    v_lng_delta DOUBLE PRECISION;
    v_use_bbox BOOLEAN := false;
BEGIN
    v_ttl_hours := social_feed_ttl_hours(p_app_id);

    -- A radius without a fix filters nothing. See the header: a denied location
    -- permission must never produce an empty feed.
    v_radius := CASE
        WHEN p_lat IS NULL OR p_lng IS NULL THEN NULL
        WHEN p_radius_miles IS NULL OR p_radius_miles <= 0 THEN NULL
        ELSE p_radius_miles
    END;

    IF v_radius IS NOT NULL THEN
        -- Degrees of latitude are ~69 miles everywhere. Degrees of longitude
        -- shrink with cos(lat), so the box is widened near the poles rather
        -- than divided by something approaching zero.
        v_lat_delta := v_radius / 69.0;
        v_lng_delta := v_radius / GREATEST(69.172 * cos(radians(p_lat)), 0.01);

        -- The box is a PREFILTER, not the answer — haversine still decides. So
        -- it is simply skipped wherever it would be wrong (antimeridian wrap,
        -- polar blow-up) instead of being made clever. Skipping costs a scan;
        -- getting it wrong DROPS valid rows, silently.
        v_use_bbox := v_lng_delta < 180.0
                  AND p_lng - v_lng_delta > -180.0
                  AND p_lng + v_lng_delta < 180.0
                  AND abs(p_lat) + v_lat_delta < 89.0;
    END IF;

    RETURN QUERY
    SELECT
        vm.id, vm.venue_id,
        v.name AS venue_name,
        v.handle AS venue_handle,
        v.category AS venue_category,
        v.music_genres AS venue_music_genres,
        v.city AS venue_city,
        v.state AS venue_state,
        v.latitude AS venue_latitude,
        v.longitude AS venue_longitude,
        v.profile_image_url AS venue_profile_image_url,
        vm.media_type, vm.url, vm.thumbnail_url, vm.storage_path,
        vm.caption, vm.duration_seconds,
        vm.view_count, vm.like_count,
        vm.created_at,
        vm.uploaded_by_user_id,
        p.first_name AS author_first_name,
        p.last_name  AS author_last_name,
        am.display_name AS author_display_name,
        am.avatar_url   AS author_avatar_url,
        vm.latitude  AS post_latitude,
        vm.longitude AS post_longitude
    FROM venue_media vm
    LEFT JOIN venues v
           ON v.id = vm.venue_id
          AND v.is_active = true
          AND v.deleted_at IS NULL
    LEFT JOIN profiles p ON p.id = vm.uploaded_by_user_id
    LEFT JOIN app_members am
           ON am.user_id = vm.uploaded_by_user_id
          AND am.app_id  = vm.app_id
          AND am.deleted_at IS NULL
    WHERE vm.app_id = p_app_id
      AND vm.status = 'approved'
      AND (vm.venue_id IS NULL OR v.id IS NOT NULL)
      AND (p_category IS NULL OR v.category = p_category)
      AND (p_genre    IS NULL OR v.music_genres @> ARRAY[p_genre]::TEXT[])
      -- (#12) Home feed is video. Photos live on venue pages, profile grids and
      -- the map, which read other functions entirely.
      AND vm.media_type = 'video'
      -- Server-side TTL. NULL = no expiry. is_permanent = the venue's own team
      -- posted it, so it never ages out of any public surface.
      AND (v_ttl_hours IS NULL
           OR vm.is_permanent
           OR vm.created_at > now() - make_interval(secs => (v_ttl_hours * 3600)::DOUBLE PRECISION))
      -- (#5) Distance. Whole predicate short-circuits when v_radius IS NULL.
      AND (v_radius IS NULL OR (
              COALESCE(vm.latitude, v.latitude) IS NOT NULL
          AND COALESCE(vm.longitude, v.longitude) IS NOT NULL
          AND (NOT v_use_bbox OR (
                  COALESCE(vm.latitude, v.latitude)::DOUBLE PRECISION
                      BETWEEN p_lat - v_lat_delta AND p_lat + v_lat_delta
              AND COALESCE(vm.longitude, v.longitude)::DOUBLE PRECISION
                      BETWEEN p_lng - v_lng_delta AND p_lng + v_lng_delta
              ))
          AND social_haversine_miles(
                  p_lat, p_lng,
                  COALESCE(vm.latitude, v.latitude)::DOUBLE PRECISION,
                  COALESCE(vm.longitude, v.longitude)::DOUBLE PRECISION
              ) <= v_radius
      ))
    ORDER BY vm.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

-- ⚠️ NO GRANT FOOTER HERE. See header note 1.


-- ===== 2. get_following_feed_v3 — the byte-identical edit =====
--
-- ⚠️ The predicate added below is character-for-character the one in §1. If
-- you change one, change both in the same edit. The RETURNS TABLE equality
-- test cannot see a body divergence — a predicate-equality assertion in
-- tests/viibeview-feed-v3.test.js is what covers it.
--
-- Grant footer here is the REAL one, all three lines.

CREATE OR REPLACE FUNCTION get_following_feed_v3(
    p_app_id UUID,
    p_category TEXT DEFAULT NULL,
    p_genre TEXT DEFAULT NULL,
    p_lat DOUBLE PRECISION DEFAULT NULL,
    p_lng DOUBLE PRECISION DEFAULT NULL,
    p_radius_miles DOUBLE PRECISION DEFAULT NULL,
    p_limit INTEGER DEFAULT 20,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    venue_id UUID,
    venue_name TEXT,
    venue_handle TEXT,
    venue_category TEXT,
    venue_music_genres TEXT[],
    venue_city TEXT,
    venue_state TEXT,
    venue_latitude DECIMAL,
    venue_longitude DECIMAL,
    venue_profile_image_url TEXT,
    media_type TEXT,
    url TEXT,
    thumbnail_url TEXT,
    storage_path TEXT,
    caption TEXT,
    duration_seconds INTEGER,
    view_count INTEGER,
    like_count INTEGER,
    created_at TIMESTAMPTZ,
    uploaded_by_user_id UUID,
    author_first_name TEXT,
    author_last_name TEXT,
    author_display_name TEXT,
    author_avatar_url TEXT,
    post_latitude DECIMAL,
    post_longitude DECIMAL
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_ttl_hours NUMERIC;
    v_radius DOUBLE PRECISION;
    v_lat_delta DOUBLE PRECISION;
    v_lng_delta DOUBLE PRECISION;
    v_use_bbox BOOLEAN := false;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN;
    END IF;

    v_ttl_hours := social_feed_ttl_hours(p_app_id);

    v_radius := CASE
        WHEN p_lat IS NULL OR p_lng IS NULL THEN NULL
        WHEN p_radius_miles IS NULL OR p_radius_miles <= 0 THEN NULL
        ELSE p_radius_miles
    END;

    IF v_radius IS NOT NULL THEN
        v_lat_delta := v_radius / 69.0;
        v_lng_delta := v_radius / GREATEST(69.172 * cos(radians(p_lat)), 0.01);
        v_use_bbox := v_lng_delta < 180.0
                  AND p_lng - v_lng_delta > -180.0
                  AND p_lng + v_lng_delta < 180.0
                  AND abs(p_lat) + v_lat_delta < 89.0;
    END IF;

    RETURN QUERY
    SELECT
        vm.id, vm.venue_id,
        v.name AS venue_name,
        v.handle AS venue_handle,
        v.category AS venue_category,
        v.music_genres AS venue_music_genres,
        v.city AS venue_city,
        v.state AS venue_state,
        v.latitude AS venue_latitude,
        v.longitude AS venue_longitude,
        v.profile_image_url AS venue_profile_image_url,
        vm.media_type, vm.url, vm.thumbnail_url, vm.storage_path,
        vm.caption, vm.duration_seconds,
        vm.view_count, vm.like_count,
        vm.created_at,
        vm.uploaded_by_user_id,
        p.first_name AS author_first_name,
        p.last_name  AS author_last_name,
        am.display_name AS author_display_name,
        am.avatar_url   AS author_avatar_url,
        vm.latitude  AS post_latitude,
        vm.longitude AS post_longitude
    FROM venue_media vm
    LEFT JOIN venues v
           ON v.id = vm.venue_id
          AND v.is_active = true
          AND v.deleted_at IS NULL
    LEFT JOIN profiles p ON p.id = vm.uploaded_by_user_id
    LEFT JOIN app_members am
           ON am.user_id = vm.uploaded_by_user_id
          AND am.app_id  = vm.app_id
          AND am.deleted_at IS NULL
    WHERE vm.app_id = p_app_id
      AND vm.status = 'approved'
      AND (vm.venue_id IS NULL OR v.id IS NOT NULL)
      AND (p_category IS NULL OR v.category = p_category)
      AND (p_genre    IS NULL OR v.music_genres @> ARRAY[p_genre]::TEXT[])
      AND vm.media_type = 'video'
      AND (v_ttl_hours IS NULL
           OR vm.is_permanent
           OR vm.created_at > now() - make_interval(secs => (v_ttl_hours * 3600)::DOUBLE PRECISION))
      AND (v_radius IS NULL OR (
              COALESCE(vm.latitude, v.latitude) IS NOT NULL
          AND COALESCE(vm.longitude, v.longitude) IS NOT NULL
          AND (NOT v_use_bbox OR (
                  COALESCE(vm.latitude, v.latitude)::DOUBLE PRECISION
                      BETWEEN p_lat - v_lat_delta AND p_lat + v_lat_delta
              AND COALESCE(vm.longitude, v.longitude)::DOUBLE PRECISION
                      BETWEEN p_lng - v_lng_delta AND p_lng + v_lng_delta
              ))
          AND social_haversine_miles(
                  p_lat, p_lng,
                  COALESCE(vm.latitude, v.latitude)::DOUBLE PRECISION,
                  COALESCE(vm.longitude, v.longitude)::DOUBLE PRECISION
              ) <= v_radius
      ))
      -- Not mine.
      AND (vm.uploaded_by_user_id IS NULL OR vm.uploaded_by_user_id <> v_user_id)
      AND (
            EXISTS (
                SELECT 1 FROM social_follows f
                WHERE f.app_id = p_app_id
                  AND f.follower_user_id = v_user_id
                  AND f.followee_user_id = vm.uploaded_by_user_id
            )
         OR EXISTS (
                SELECT 1 FROM social_follows f
                WHERE f.app_id = p_app_id
                  AND f.follower_user_id = v_user_id
                  AND f.followee_venue_id = vm.venue_id
            )
          )
    ORDER BY vm.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION get_following_feed_v3(UUID, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_following_feed_v3(UUID, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION get_following_feed_v3(UUID, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER) TO authenticated;


-- ===== 3. get_venue_page_feed — v_ttl_hours + the predicate =====
--
-- This function had no TTL at all: it is the surface where "posts live on venue
-- pages forever" was literally implemented. It gains a DECLARE block, the
-- social_feed_ttl_hours call and the predicate. Everything else is carried
-- forward verbatim from 20260904000001:46-101.

CREATE OR REPLACE FUNCTION get_venue_page_feed(
    p_app_id UUID,
    p_venue_id UUID,
    p_limit INTEGER DEFAULT 20,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    venue_id UUID,
    media_type TEXT,
    url TEXT,
    thumbnail_url TEXT,
    caption TEXT,
    duration_seconds INTEGER,
    created_at TIMESTAMPTZ,
    -- Load-bearing beyond the header: the post options sheet decides Delete vs
    -- Report from this, and an explicit select list that omits it makes the
    -- menu silently wrong on this page while it is right on the main feed.
    uploaded_by_user_id UUID,
    author_first_name TEXT,
    author_last_name TEXT,
    author_display_name TEXT,
    author_avatar_url TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ttl_hours NUMERIC;
BEGIN
    v_ttl_hours := social_feed_ttl_hours(p_app_id);

    RETURN QUERY
    SELECT
        vm.id, vm.venue_id,
        vm.media_type, vm.url, vm.thumbnail_url,
        vm.caption, vm.duration_seconds, vm.created_at,
        vm.uploaded_by_user_id,
        p.first_name AS author_first_name,
        p.last_name  AS author_last_name,
        am.display_name AS author_display_name,
        am.avatar_url   AS author_avatar_url
    FROM venue_media vm
    LEFT JOIN profiles p ON p.id = vm.uploaded_by_user_id
    -- The member row, for the display name and the avatar. `profiles` has
    -- neither for a ViibeView member. Scoped to the same app so an author who
    -- is a member of two tenants shows this tenant's identity.
    LEFT JOIN app_members am
           ON am.user_id = vm.uploaded_by_user_id
          AND am.app_id  = vm.app_id
          AND am.deleted_at IS NULL
    WHERE vm.app_id   = p_app_id
      AND vm.venue_id = p_venue_id
      AND vm.status   = 'approved'
      AND (v_ttl_hours IS NULL
           OR vm.is_permanent
           OR vm.created_at > now() - make_interval(secs => (v_ttl_hours * 3600)::DOUBLE PRECISION))
    ORDER BY vm.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

-- ⚠️ NO GRANT FOOTER HERE. See header note 1.


-- ===== 4. get_recent_post_pins — v_ttl_hours + the predicate =====
--
-- ⚠️ Also restores `SET search_path = public`, which 20260904000001 dropped
-- when it re-created this function. See header note 5. That is a fix, not a
-- change of behaviour — public is where every table it touches lives.
--
-- CREATE OR REPLACE is not usable here: the function currently has no
-- `SET search_path`, and adding a configuration parameter is fine, but
-- 20260904000001 created it with DROP + CREATE and the pattern is kept so a
-- future return-type change does not silently no-op. No column changes, so
-- the DROP window costs nothing the client can see.

DROP FUNCTION IF EXISTS get_recent_post_pins(UUID, INTEGER);

CREATE FUNCTION get_recent_post_pins(
    p_app_id UUID,
    p_limit INTEGER DEFAULT 200
)
RETURNS TABLE (
    id UUID,
    venue_id UUID,
    venue_name TEXT,
    latitude DECIMAL,
    longitude DECIMAL,
    -- true  = recorded with a device fix; this pin marks a real place.
    -- false = inherited from the venue; the venue pin already marks it, so the
    --         client must not draw a second pin on the same point.
    has_own_coords BOOLEAN,
    url TEXT,
    thumbnail_url TEXT,
    caption TEXT,
    uploaded_by_user_id UUID,
    author_first_name TEXT,
    author_last_name TEXT,
    author_display_name TEXT,
    author_avatar_url TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ttl_hours NUMERIC;
BEGIN
    v_ttl_hours := social_feed_ttl_hours(p_app_id);

    RETURN QUERY
    SELECT
        vm.id, vm.venue_id,
        v.name AS venue_name,
        COALESCE(vm.latitude,  v.latitude)  AS latitude,
        COALESCE(vm.longitude, v.longitude) AS longitude,
        (vm.latitude IS NOT NULL AND vm.longitude IS NOT NULL) AS has_own_coords,
        vm.url, vm.thumbnail_url, vm.caption,
        vm.uploaded_by_user_id,
        p.first_name AS author_first_name,
        p.last_name  AS author_last_name,
        am.display_name AS author_display_name,
        am.avatar_url   AS author_avatar_url,
        vm.created_at
    FROM venue_media vm
    LEFT JOIN venues v
           ON v.id = vm.venue_id
          AND v.is_active = true
          AND v.deleted_at IS NULL
    LEFT JOIN profiles p ON p.id = vm.uploaded_by_user_id
    LEFT JOIN app_members am
           ON am.user_id = vm.uploaded_by_user_id
          AND am.app_id  = vm.app_id
          AND am.deleted_at IS NULL
    WHERE vm.app_id = p_app_id
      AND vm.status = 'approved'
      AND (vm.venue_id IS NULL OR v.id IS NOT NULL)
      AND COALESCE(vm.latitude,  v.latitude)  IS NOT NULL
      AND COALESCE(vm.longitude, v.longitude) IS NOT NULL
      AND (v_ttl_hours IS NULL
           OR vm.is_permanent
           OR vm.created_at > now() - make_interval(secs => (v_ttl_hours * 3600)::DOUBLE PRECISION))
    ORDER BY vm.created_at DESC
    LIMIT p_limit;
END;
$$;

-- ⚠️ NO GRANT FOOTER HERE. See header note 1.


-- ===== 5. get_member_posts is EXEMPT, deliberately =====
--
-- It is not touched by this file, and a test asserts the predicate does not
-- appear in it. Three reasons, in order of how much they matter:
--
--   1. A profile that empties every 24 hours reads as an abandoned account.
--      The entire reason to follow someone is that their profile is worth
--      coming back to; expiring it removes the payoff of the feature the
--      Follow button exists to serve.
--
--   2. The "should other people see it?" version of this question resolves the
--      same way. get_member_posts is already gated on profile_public OR self
--      (20260903000002:491), so it is not an open firehose — the visitor
--      either has access to the profile or has none.
--
--   3. A self-vs-visitor divergence ("I see 12 posts, you see 0") generates
--      support tickets with nothing in the logs to explain them. One rule for
--      both is the only version anyone can reason about.
--
-- ⚠️ This is also why the purge job in the plan cannot be built as specified:
-- you cannot delete a row that a requirement obliges you to keep showing. A
-- second, much longer retention ceiling (e.g. 90 days, profile included) is the
-- future lever, and it needs a product decision first.


-- ===== 6. Seed a 24-hour default — WITHOUT changing semantics =====
--
-- ⚠️ social_feed_ttl_hours() is NOT edited. Making NULL mean "24 hours" instead
-- of "no expiry" would apply to every tenant on this database, including every
-- non-ViibeView social app, and would do it silently — any settings JSON this
-- function cannot parse would start emptying a feed instead of leaving it
-- alone. The value is seeded instead, which is reversible by one UPDATE and
-- visible in the owner's own settings panel.
--
-- Two guards on the UPDATE:
--   - app_type = 'social'    — nothing else reads post_ttl_hours
--   - NOT (settings ? '…')   — an owner who already chose a value, INCLUDING
--                              "Never expire", is not overridden
--
-- COALESCE on settings: it is nullable, and NULL || anything is NULL, which
-- would discard the write. Same trap update_social_app_settings documents.

UPDATE customer_apps
SET settings = COALESCE(settings, '{}'::JSONB) || jsonb_build_object('post_ttl_hours', 24)
WHERE app_type = 'social'
  AND deleted_at IS NULL
  AND NOT (COALESCE(settings, '{}'::JSONB) ? 'post_ttl_hours');

-- No change to update_social_app_settings's two-key allow-list is needed:
-- post_ttl_hours is already one of the keys it accepts. This adds no third
-- setting and no new writer.


-- ===== 7. Post-install assertions =====
--
-- The must-stay-OPEN direction first, because it is the one that fails
-- silently. A grant footer accidentally added to any of the three below gives
-- every signed-out visitor a 200 with zero rows, rendered as "No posts yet".

DO $$
DECLARE
    v_anon BOOLEAN;
    v_auth BOOLEAN;
    v_seeded BIGINT;
BEGIN
    -- 7a. The three that must stay PUBLIC.
    SELECT has_function_privilege('anon',
        'public.get_venue_feed_v3(uuid, text, text, double precision, double precision, double precision, integer, integer)',
        'EXECUTE') INTO v_anon;
    IF NOT v_anon THEN
        RAISE EXCEPTION
            'get_venue_feed_v3: anon CANNOT execute it — the home feed is empty for every signed-out visitor, with nothing on screen';
    END IF;

    SELECT has_function_privilege('anon',
        'public.get_venue_page_feed(uuid, uuid, integer, integer)', 'EXECUTE') INTO v_anon;
    IF NOT v_anon THEN
        RAISE EXCEPTION
            'get_venue_page_feed: anon CANNOT execute it — every venue page shows no posts for signed-out visitors';
    END IF;

    SELECT has_function_privilege('anon',
        'public.get_recent_post_pins(uuid, integer)', 'EXECUTE') INTO v_anon;
    IF NOT v_anon THEN
        RAISE EXCEPTION
            'get_recent_post_pins: anon CANNOT execute it — the map has no post pins for signed-out visitors';
    END IF;

    -- 7b. The one that must stay CLOSED.
    SELECT has_function_privilege('anon',
               'public.get_following_feed_v3(uuid, text, text, double precision, double precision, double precision, integer, integer)', 'EXECUTE'),
           has_function_privilege('authenticated',
               'public.get_following_feed_v3(uuid, text, text, double precision, double precision, double precision, integer, integer)', 'EXECUTE')
    INTO v_anon, v_auth;
    IF v_anon THEN
        RAISE EXCEPTION 'get_following_feed_v3: anon can EXECUTE it — the REVOKE ... FROM anon line did not take';
    END IF;
    IF NOT v_auth THEN
        RAISE EXCEPTION 'get_following_feed_v3: authenticated CANNOT execute it — the Following chip is dead';
    END IF;

    -- 7c. search_path, restored. A SECURITY DEFINER function without it is the
    -- exact class of bug three earlier migrations exist to fix.
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = 'public.get_recent_post_pins(uuid, integer)'::regprocedure
          AND proconfig @> ARRAY['search_path=public']
    ) THEN
        RAISE EXCEPTION 'get_recent_post_pins is missing SET search_path = public';
    END IF;

    -- 7d. The seed landed somewhere. Non-emptiness guard: a WHERE clause that
    -- matched nothing would leave every social app on "never expire" and this
    -- whole file inert, with every test still green.
    SELECT COUNT(*) INTO v_seeded
    FROM customer_apps
    WHERE app_type = 'social'
      AND deleted_at IS NULL
      AND settings ? 'post_ttl_hours';

    IF v_seeded = 0 THEN
        RAISE WARNING
            'No social app carries post_ttl_hours after the seed — either this database has no social apps, or the UPDATE matched nothing';
    END IF;
END $$;
