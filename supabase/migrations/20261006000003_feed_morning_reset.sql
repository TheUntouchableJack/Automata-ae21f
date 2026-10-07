-- The home feed and the map reset every morning at 7am Pacific.
--
-- Why
-- ---
-- Jay, 2026-10-06: old posts were still in the home feed. The 24-hour TTL
-- itself works — the three non-permanent prod posts are already hidden — but
-- 20260922000004 exempted is_permanent posts from it on EVERY surface, and all
-- four stale posts still visible are permanent (team posts, plus one seeded
-- NULL-author row). Jay's decision: the home feed is "tonight", for everyone,
-- team posts included, and it clears daily at 7am Pacific.
--
-- What changes
-- ------------
--   social_feed_cutoff(app_id)   NEW. The most recent 7am America/Los_Angeles
--                                at or before now(). DST-correct: 7am exists on
--                                both transition days (they happen at 2am).
--                                p_app_id is unused today; it is the seam for a
--                                per-tenant timezone later.
--
--   get_venue_feed_v3            TTL/permanent predicate → `created_at >= cutoff`
--   get_following_feed_v3        same, character for character
--   get_recent_post_pins         same, plus `AND NOT vm.is_flyer`
--
--   get_venue_page_feed          KEEPS its TTL and team-posts-permanent rule —
--                                venue pages are where permanence still means
--                                something — and gains an is_flyer column and
--                                `ORDER BY is_flyer DESC, created_at DESC` so
--                                flyers pin to the top. The new OUT column
--                                needs DROP + CREATE (42P13 otherwise).
--
-- ⚠️ FOUR THINGS THAT WILL BREAK THIS FILE IF IGNORED
--
-- 1. ⚠️ NO GRANT FOOTER on get_venue_feed_v3, get_venue_page_feed or
--    get_recent_post_pins. Anonymous browsing depends on the default EXECUTE
--    TO PUBLIC; a footer empties all three for every signed-out visitor,
--    silently (200, zero rows, "No posts yet"). get_following_feed_v3 keeps its
--    real three-line footer. Asserted in section 6, both directions.
--
-- 2. ⚠️ ON DEPLOY THE HOME FEED AND THE MAP GO EMPTY. Every post in prod
--    predates this morning's 7am. That is the decision working, not a bug —
--    tell Jay and the testers before applying.
--
-- 3. ⚠️ The two v3 functions must stay byte-identical in this predicate. The
--    RETURNS TABLE equality test cannot see a body divergence; a
--    predicate-equality assertion in the tests covers it.
--
-- 4. ⚠️ social_feed_ttl_hours and the post_ttl_hours setting are untouched.
--    They now govern venue pages only. The owner's settings hint says so.
--
-- Everything outside the edited lines is carried forward verbatim from
-- 20260922000004.
--
-- Rollback
-- --------
-- Re-run sections 1-4 of 20260922000004 verbatim (no footer on three of them;
-- get_venue_page_feed needs `DROP FUNCTION get_venue_page_feed(UUID, UUID,
-- INTEGER, INTEGER)` first, because this file added a column).
-- social_feed_cutoff can stay; nothing else calls it.


-- ===== 0. social_feed_cutoff =====
--
-- now() AT TIME ZONE 'America/Los_Angeles' is the local wall clock. Shifting it
-- back 7 hours makes 7am the start of the "feed day", date_trunc finds that
-- day, the 7 hours go back on, and the final AT TIME ZONE reads that local
-- 7am as a real instant. Before 7am the answer is yesterday's 7am.
--
-- STABLE, not IMMUTABLE: it reads now(). Plain SQL, not SECURITY DEFINER — it
-- touches no table. No grant footer: the three open readers call it as the
-- definer, and an anonymous caller asking what the cutoff is learns nothing.

CREATE OR REPLACE FUNCTION social_feed_cutoff(p_app_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT (date_trunc('day', (now() AT TIME ZONE 'America/Los_Angeles') - interval '7 hours')
            + interval '7 hours') AT TIME ZONE 'America/Los_Angeles';
$$;


-- ===== 1. get_venue_feed_v3 — the cutoff replaces the TTL =====
--
-- CREATE OR REPLACE: no column change, no outage window.

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
    v_cutoff TIMESTAMPTZ;
    v_radius DOUBLE PRECISION;
    v_lat_delta DOUBLE PRECISION;
    v_lng_delta DOUBLE PRECISION;
    v_use_bbox BOOLEAN := false;
BEGIN
    v_cutoff := social_feed_cutoff(p_app_id);

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
      -- The morning reset: everything posted before today's 7am Pacific is
      -- gone from the home feed, team posts included. See the header.
      AND vm.created_at >= v_cutoff
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
-- ⚠️ The predicate below is character-for-character the one in §1. Grant
-- footer here is the REAL one, all three lines.

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
    v_cutoff TIMESTAMPTZ;
    v_radius DOUBLE PRECISION;
    v_lat_delta DOUBLE PRECISION;
    v_lng_delta DOUBLE PRECISION;
    v_use_bbox BOOLEAN := false;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN;
    END IF;

    v_cutoff := social_feed_cutoff(p_app_id);

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
      AND vm.created_at >= v_cutoff
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


-- ===== 3. get_venue_page_feed — + is_flyer, flyers first =====
--
-- Keeps the TTL with the team-posts-permanent disjunct: flyers are written
-- is_permanent = true, so they never age out of their venue page.
--
-- DROP + CREATE because the OUT column list grows. The DROP takes no grants
-- with it — there are none; the function runs on the default EXECUTE TO
-- PUBLIC, which CREATE restores. Section 6 proves anon can still call it.

DROP FUNCTION IF EXISTS get_venue_page_feed(UUID, UUID, INTEGER, INTEGER);

CREATE FUNCTION get_venue_page_feed(
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
    author_avatar_url TEXT,
    -- New: the client badges flyer tiles from this.
    is_flyer BOOLEAN
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
        am.avatar_url   AS author_avatar_url,
        vm.is_flyer
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
    -- Flyers pin to the top of the venue page, newest first among them.
    ORDER BY vm.is_flyer DESC, vm.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;


-- ⚠️ NO GRANT FOOTER HERE. See header note 1.


-- ===== 4. get_recent_post_pins — the cutoff, and no flyers =====
--
-- CREATE OR REPLACE now: the return type is unchanged and the function already
-- carries `SET search_path = public` (restored by 20260922000004).

CREATE OR REPLACE FUNCTION get_recent_post_pins(
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
    v_cutoff TIMESTAMPTZ;
BEGIN
    v_cutoff := social_feed_cutoff(p_app_id);

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
      AND vm.created_at >= v_cutoff
      -- Flyers belong to the venue page, not the map.
      AND NOT vm.is_flyer
    ORDER BY vm.created_at DESC
    LIMIT p_limit;
END;
$$;


-- ⚠️ NO GRANT FOOTER HERE. See header note 1.


-- ===== 5. get_member_posts is untouched =====
--
-- A member's own profile keeps every post they have made, as 20260922000004
-- section 5 explains. The morning reset is a home-feed and map rule only.


-- ===== 6. Post-install assertions, both directions =====

DO $$
DECLARE
    v_anon BOOLEAN;
    v_auth BOOLEAN;
    v_cutoff TIMESTAMPTZ;
    v_fn TEXT;
    v_src TEXT;
BEGIN
    -- 6a. The three that must stay PUBLIC — the silent direction first.
    FOREACH v_fn IN ARRAY ARRAY[
        'public.get_venue_feed_v3(uuid, text, text, double precision, double precision, double precision, integer, integer)',
        'public.get_venue_page_feed(uuid, uuid, integer, integer)',
        'public.get_recent_post_pins(uuid, integer)'
    ] LOOP
        IF NOT has_function_privilege('anon', v_fn, 'EXECUTE') THEN
            RAISE EXCEPTION '%: anon CANNOT execute it — signed-out visitors see nothing, with no error', v_fn;
        END IF;
    END LOOP;

    -- 6b. The one that must stay CLOSED.
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

    -- 6c. The cutoff is sane: in the past, within a day, and 7am local.
    v_cutoff := social_feed_cutoff(NULL);
    IF v_cutoff > now() THEN
        RAISE EXCEPTION 'social_feed_cutoff is in the future (%): the home feed would be empty all day', v_cutoff;
    END IF;
    IF v_cutoff <= now() - interval '24 hours' THEN
        RAISE EXCEPTION 'social_feed_cutoff is more than a day old (%)', v_cutoff;
    END IF;
    IF (v_cutoff AT TIME ZONE 'America/Los_Angeles')::TIME <> TIME '07:00' THEN
        RAISE EXCEPTION 'social_feed_cutoff is not 7am Pacific (% local)', v_cutoff AT TIME ZONE 'America/Los_Angeles';
    END IF;

    -- 6d. The three readers use the cutoff and no longer the TTL.
    FOREACH v_fn IN ARRAY ARRAY[
        'public.get_venue_feed_v3(uuid, text, text, double precision, double precision, double precision, integer, integer)',
        'public.get_following_feed_v3(uuid, text, text, double precision, double precision, double precision, integer, integer)',
        'public.get_recent_post_pins(uuid, integer)'
    ] LOOP
        SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_fn::regprocedure;
        IF position('v_cutoff' IN v_src) = 0 OR position('is_permanent' IN v_src) > 0
           OR position('v_ttl_hours' IN v_src) > 0 THEN
            RAISE EXCEPTION '%: still carries the TTL/permanent predicate, or lost the cutoff', v_fn;
        END IF;
    END LOOP;

    SELECT prosrc INTO v_src FROM pg_proc
    WHERE oid = 'public.get_recent_post_pins(uuid, integer)'::regprocedure;
    IF position('NOT vm.is_flyer' IN v_src) = 0 THEN
        RAISE EXCEPTION 'get_recent_post_pins: flyers would appear as map pins';
    END IF;

    -- 6e. The venue page keeps its TTL and pins flyers.
    SELECT prosrc INTO v_src FROM pg_proc
    WHERE oid = 'public.get_venue_page_feed(uuid, uuid, integer, integer)'::regprocedure;
    IF position('vm.is_permanent' IN v_src) = 0 OR position('vm.is_flyer DESC' IN v_src) = 0 THEN
        RAISE EXCEPTION 'get_venue_page_feed: lost its permanence rule or its flyer ordering';
    END IF;

    -- 6f. search_path on the pins function, still.
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = 'public.get_recent_post_pins(uuid, integer)'::regprocedure
          AND proconfig @> ARRAY['search_path=public']
    ) THEN
        RAISE EXCEPTION 'get_recent_post_pins is missing SET search_path = public';
    END IF;
END $$;
