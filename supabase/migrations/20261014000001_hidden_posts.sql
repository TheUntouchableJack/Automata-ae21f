-- Hide a Viibe (Jay's board, 2026-10-14).
--
-- What
-- ----
-- A member can hide a post from THEIR OWN view, everywhere it would show: the
-- home feed, the Following feed, venue pages, map pins and member profiles.
-- Nothing changes for anyone else. The post is not deleted, not reported and
-- not counted anywhere; it is one row in social_hidden_posts.
--
--   social_hidden_posts            NEW. (user_id, media_id) primary key. RLS:
--                                  a member reads their own rows only. No
--                                  client write path — the two RPCs below are
--                                  the only writers.
--   hide_social_post(media_id)     NEW. Signed-in only. Idempotent.
--   unhide_social_post(media_id)   NEW. Signed-in only. The "Undo" toast.
--
--   get_venue_feed_v3              + one predicate line (below)
--   get_following_feed_v3          + the same line
--   get_venue_page_feed            + the same line
--   get_recent_post_pins           + the same line
--   get_member_posts               + the same line
--
-- The line:
--   AND NOT EXISTS (SELECT 1 FROM social_hidden_posts h WHERE h.media_id = vm.id AND h.user_id = auth.uid())
--
-- ⚠️ WHY THAT IS SAFE FOR SIGNED-OUT VISITORS. All five readers are SECURITY
-- DEFINER with SET search_path = public, and auth.uid() is NULL for an
-- anonymous caller, so `h.user_id = auth.uid()` matches no row and NOT EXISTS
-- is true for every post: the line filters nothing. A signed-out visitor's
-- hides live in their browser (localStorage) and are filtered client-side.
--
-- ⚠️ EVERY READER BELOW IS CARRIED FORWARD VERBATIM from the migration prod
-- runs it from, with that one line (and its two-line comment) added:
--   get_venue_feed_v3, get_following_feed_v3, get_venue_page_feed,
--   get_recent_post_pins   ← 20261006000003_feed_morning_reset.sql
--   get_member_posts       ← 20260903000002_member_profiles.sql
-- The one other change: get_venue_page_feed is CREATE OR REPLACE here, not
-- CREATE (20261006000003 dropped it first to add is_flyer; nothing about its
-- signature or columns changes now).
--
-- ⚠️ GRANTS. CREATE OR REPLACE keeps every existing grant. There is NO grant
-- footer on get_venue_feed_v3, get_venue_page_feed, get_recent_post_pins or
-- get_member_posts: signed-out browsing depends on their default EXECUTE TO
-- PUBLIC, and a footer would empty them for every signed-out visitor,
-- silently (200, zero rows). get_following_feed_v3 re-issues its real
-- three-line footer. Section 5 asserts both directions at install.
--
-- Rollback
-- --------
-- Re-run the five function blocks from their source migrations (named above;
-- get_venue_page_feed as CREATE OR REPLACE), then DROP FUNCTION
-- hide_social_post(UUID), unhide_social_post(UUID); DROP TABLE
-- social_hidden_posts.


-- ===== 1. social_hidden_posts =====

CREATE TABLE IF NOT EXISTS social_hidden_posts (
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- A deleted post takes its hides with it; there is nothing left to hide.
    media_id   UUID NOT NULL REFERENCES venue_media(id) ON DELETE CASCADE,
    app_id     UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, media_id)
);

-- The primary key serves the readers' (media_id, user_id) equality lookup.
-- This one serves the ON DELETE CASCADE from venue_media.
CREATE INDEX IF NOT EXISTS idx_social_hidden_posts_media
    ON social_hidden_posts(media_id);

ALTER TABLE social_hidden_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read their own hidden posts" ON social_hidden_posts;
CREATE POLICY "Members read their own hidden posts"
ON social_hidden_posts FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- ⚠️ REVOKE FROM PUBLIC does NOT reach anon or authenticated in Supabase —
-- they hold their own default grants. Named explicitly, then SELECT only.
REVOKE ALL ON TABLE social_hidden_posts FROM PUBLIC;
REVOKE ALL ON TABLE social_hidden_posts FROM anon;
REVOKE ALL ON TABLE social_hidden_posts FROM authenticated;
GRANT SELECT ON TABLE social_hidden_posts TO authenticated;


-- ===== 2. hide_social_post / unhide_social_post =====
--
-- Signed-in only. A missing post is a success: there is nothing to hide, and a
-- double tap must not surface an error. Hiding your own post is refused — the
-- client never offers it, and it would make your own post vanish from your
-- feed with no way to see why.

CREATE OR REPLACE FUNCTION hide_social_post(p_media_id UUID)
RETURNS TABLE (success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_media RECORD;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false, 'You must be signed in'::TEXT;
        RETURN;
    END IF;

    SELECT vm.id, vm.app_id, vm.uploaded_by_user_id
    INTO v_media
    FROM venue_media vm
    WHERE vm.id = p_media_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT true, NULL::TEXT;
        RETURN;
    END IF;

    IF v_media.uploaded_by_user_id = v_user_id THEN
        RETURN QUERY SELECT false, 'You cannot hide your own post'::TEXT;
        RETURN;
    END IF;

    INSERT INTO social_hidden_posts (user_id, media_id, app_id)
    VALUES (v_user_id, p_media_id, v_media.app_id)
    ON CONFLICT (user_id, media_id) DO NOTHING;

    RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION hide_social_post(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION hide_social_post(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION hide_social_post(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION unhide_social_post(p_media_id UUID)
RETURNS TABLE (success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false, 'You must be signed in'::TEXT;
        RETURN;
    END IF;

    DELETE FROM social_hidden_posts
    WHERE user_id = v_user_id
      AND media_id = p_media_id;

    RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION unhide_social_post(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION unhide_social_post(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION unhide_social_post(UUID) TO authenticated;


-- ===== 3. The home feed and the Following feed =====
--
-- Verbatim from 20261006000003 §1 and §2, + the hidden line after the cutoff.
-- The two stay byte-identical in their shared predicate.

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
      -- Hidden by this viewer (20261014000001). auth.uid() is NULL for a
      -- signed-out caller, so this matches nothing and filters nothing.
      AND NOT EXISTS (SELECT 1 FROM social_hidden_posts h WHERE h.media_id = vm.id AND h.user_id = auth.uid())
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


-- ⚠️ NO GRANT FOOTER HERE. See the header.


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
      -- Hidden by this viewer (20261014000001). auth.uid() is NULL for a
      -- signed-out caller, so this matches nothing and filters nothing.
      AND NOT EXISTS (SELECT 1 FROM social_hidden_posts h WHERE h.media_id = vm.id AND h.user_id = auth.uid())
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


-- ===== 4. Venue pages, map pins, member profiles =====
--
-- Verbatim from 20261006000003 §3 and §4 and 20260903000002 (get_member_posts),
-- + the hidden line.

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
      -- Hidden by this viewer (20261014000001). auth.uid() is NULL for a
      -- signed-out caller, so this matches nothing and filters nothing.
      AND NOT EXISTS (SELECT 1 FROM social_hidden_posts h WHERE h.media_id = vm.id AND h.user_id = auth.uid())
    -- Flyers pin to the top of the venue page, newest first among them.
    ORDER BY vm.is_flyer DESC, vm.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;


-- ⚠️ NO GRANT FOOTER HERE. See the header.


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
      -- Hidden by this viewer (20261014000001). auth.uid() is NULL for a
      -- signed-out caller, so this matches nothing and filters nothing.
      AND NOT EXISTS (SELECT 1 FROM social_hidden_posts h WHERE h.media_id = vm.id AND h.user_id = auth.uid())
    ORDER BY vm.created_at DESC
    LIMIT p_limit;
END;
$$;


-- ⚠️ NO GRANT FOOTER HERE. See the header.


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
      -- Hidden by this viewer (20261014000001). auth.uid() is NULL for a
      -- signed-out caller, so this matches nothing and filters nothing.
      AND NOT EXISTS (SELECT 1 FROM social_hidden_posts h WHERE h.media_id = vm.id AND h.user_id = auth.uid())
    ORDER BY vm.created_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 24), 0)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;


-- ⚠️ NO GRANT FOOTER HERE. See the header.


-- ===== 5. Post-install assertions, both directions =====

DO $$
DECLARE
    v_fn TEXT;
    v_src TEXT;
BEGIN
    -- 5a. The open readers stay open — the silent direction first.
    FOREACH v_fn IN ARRAY ARRAY[
        'public.get_venue_feed_v3(uuid, text, text, double precision, double precision, double precision, integer, integer)',
        'public.get_venue_page_feed(uuid, uuid, integer, integer)',
        'public.get_recent_post_pins(uuid, integer)',
        'public.get_member_posts(uuid, uuid, integer, integer)'
    ] LOOP
        IF NOT has_function_privilege('anon', v_fn, 'EXECUTE') THEN
            RAISE EXCEPTION '%: anon CANNOT execute it — signed-out visitors see nothing, with no error', v_fn;
        END IF;
    END LOOP;

    -- 5b. The closed ones stay closed to anon, open to members.
    FOREACH v_fn IN ARRAY ARRAY[
        'public.get_following_feed_v3(uuid, text, text, double precision, double precision, double precision, integer, integer)',
        'public.hide_social_post(uuid)',
        'public.unhide_social_post(uuid)'
    ] LOOP
        IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
            RAISE EXCEPTION '%: anon can EXECUTE it', v_fn;
        END IF;
        IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
            RAISE EXCEPTION '%: authenticated CANNOT execute it', v_fn;
        END IF;
    END LOOP;

    -- 5c. The table: no anon access, read-only for members.
    IF has_table_privilege('anon', 'public.social_hidden_posts', 'SELECT') THEN
        RAISE EXCEPTION 'social_hidden_posts: anon can SELECT it';
    END IF;
    IF has_table_privilege('authenticated', 'public.social_hidden_posts', 'INSERT')
       OR has_table_privilege('authenticated', 'public.social_hidden_posts', 'DELETE') THEN
        RAISE EXCEPTION 'social_hidden_posts: authenticated can write it directly';
    END IF;

    -- 5d. All five readers carry the hidden predicate, and every one is
    -- SECURITY DEFINER with search_path = public (what makes the auth.uid()
    -- no-op argument above true).
    FOREACH v_fn IN ARRAY ARRAY[
        'public.get_venue_feed_v3(uuid, text, text, double precision, double precision, double precision, integer, integer)',
        'public.get_following_feed_v3(uuid, text, text, double precision, double precision, double precision, integer, integer)',
        'public.get_venue_page_feed(uuid, uuid, integer, integer)',
        'public.get_recent_post_pins(uuid, integer)',
        'public.get_member_posts(uuid, uuid, integer, integer)'
    ] LOOP
        SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_fn::regprocedure;
        IF position('social_hidden_posts h WHERE h.media_id = vm.id AND h.user_id = auth.uid()' IN v_src) = 0 THEN
            RAISE EXCEPTION '%: lost the hidden-post predicate', v_fn;
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM pg_proc
            WHERE oid = v_fn::regprocedure
              AND prosecdef
              AND proconfig @> ARRAY['search_path=public']
        ) THEN
            RAISE EXCEPTION '%: not SECURITY DEFINER with search_path = public', v_fn;
        END IF;
    END LOOP;

    -- 5e. What 20261006000003 asserted still holds.
    SELECT prosrc INTO v_src FROM pg_proc
    WHERE oid = 'public.get_venue_page_feed(uuid, uuid, integer, integer)'::regprocedure;
    IF position('vm.is_permanent' IN v_src) = 0 OR position('vm.is_flyer DESC' IN v_src) = 0 THEN
        RAISE EXCEPTION 'get_venue_page_feed: lost its permanence rule or its flyer ordering';
    END IF;
    SELECT prosrc INTO v_src FROM pg_proc
    WHERE oid = 'public.get_recent_post_pins(uuid, integer)'::regprocedure;
    IF position('NOT vm.is_flyer' IN v_src) = 0 OR position('v_cutoff' IN v_src) = 0 THEN
        RAISE EXCEPTION 'get_recent_post_pins: lost its cutoff or its no-flyers rule';
    END IF;
END $$;
