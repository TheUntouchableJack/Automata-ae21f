-- The feed contract, v2: venue-less posts, author attribution, post geo.
--
-- Why
-- ---
-- 20260828000001 made venue_media.venue_id nullable so a member can post a
-- Viibe that belongs to them rather than to an invented venue. get_venue_feed
-- still `JOIN venues`, so every one of those posts would be silently dropped
-- from the feed the moment it was created — the exact class of bug this app
-- keeps producing: no error, just nothing.
--
-- Three functions change here, and they change together because the client
-- deploy that reads them is a single file:
--
--   get_venue_feed     LEFT JOIN + author/geo/storage_path columns
--   get_venues_for_map + city, + state  (see §2 — they were never returned,
--                                        so the swim-lane address line has
--                                        always been blank and searching by
--                                        city has never matched anything)
--   get_recent_post_pins  NEW — drives the map's post pins and default centre
--
-- ⚠️ NO GRANT FOOTER IN THIS FILE. 20260225000001 issues no grants at all:
-- get_venue_feed, get_venues_for_map and get_venue_detail all rely on
-- Postgres's default EXECUTE TO PUBLIC, and that default is what lets a
-- signed-out visitor browse. Copying the
-- `REVOKE ALL … FROM PUBLIC; GRANT … TO authenticated` footer that
-- 20260821000002 uses would empty the feed for every anonymous visitor, and it
-- would fail SILENTLY — the RPC returns a permission error the client logs to
-- console while rendering the "No posts yet" empty state. Do not add one.
--
-- Rollback
-- --------
-- Re-run the three definitions from 20260225000001 (lines 239-330) after
-- DROPping the versions below. get_recent_post_pins is simply dropped.
--
-- ⚠️ DROP FUNCTION is required, not optional: Postgres refuses a
-- CREATE OR REPLACE that changes a function's OUT columns. Between the drop
-- and the client deploy the live feed returns an error, so ship the migration
-- and the client together.


-- ===== 1. get_venue_feed =====

DROP FUNCTION IF EXISTS get_venue_feed(UUID, TEXT, INTEGER, INTEGER);

CREATE FUNCTION get_venue_feed(
    p_app_id UUID,
    p_category TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 20,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    venue_id UUID,
    venue_name TEXT,
    venue_handle TEXT,
    venue_category TEXT,
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
    post_latitude DECIMAL,
    post_longitude DECIMAL
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        vm.id, vm.venue_id,
        v.name AS venue_name,
        v.handle AS venue_handle,
        v.category AS venue_category,
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
        vm.latitude  AS post_latitude,
        vm.longitude AS post_longitude
    FROM venue_media vm
    -- LEFT, and the venue's own predicates live in the join condition, so a
    -- venue-less post survives instead of being filtered out by a WHERE clause
    -- evaluated against a row that does not exist.
    LEFT JOIN venues v
           ON v.id = vm.venue_id
          AND v.is_active = true
          AND v.deleted_at IS NULL
    LEFT JOIN profiles p ON p.id = vm.uploaded_by_user_id
    WHERE vm.app_id = p_app_id
      AND vm.status = 'approved'
      -- A post that names a venue still requires that venue to be live. Only a
      -- post with no venue at all is allowed through unattached; otherwise
      -- deleting a venue would resurrect its posts as anonymous ones.
      AND (vm.venue_id IS NULL OR v.id IS NOT NULL)
      -- Category rule for venue-less posts: they have no category, so
      -- `v.category = p_category` is NULL → false and they appear under "All"
      -- only. That is the honest behaviour — an unattached Viibe is not a
      -- "Rooftop" post.
      AND (p_category IS NULL OR v.category = p_category)
    ORDER BY vm.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;


-- ===== 2. get_venues_for_map — city and state =====
--
-- The original return table (20260225000001:240-254) has neither column, yet
-- social.js:1247 matches on v.city in search and social.js:1154 renders
-- [venue.city, venue.state] as the swim-card address line. Both have been
-- reading undefined since the day they shipped: the address line is blank on
-- every card and typing a city name finds nothing.
--
-- This is a prerequisite for the browse list (§3.7 of the plan), which reuses
-- the same card template — it would otherwise ship with an empty second line
-- on every row. openVenuePage is unaffected: it reads get_venue_detail, which
-- does return them.

DROP FUNCTION IF EXISTS get_venues_for_map(UUID);

CREATE FUNCTION get_venues_for_map(p_app_id UUID)
RETURNS TABLE (
    id UUID,
    name TEXT,
    slug TEXT,
    handle TEXT,
    category TEXT,
    latitude DECIMAL,
    longitude DECIMAL,
    city TEXT,
    state TEXT,
    cover_image_url TEXT,
    profile_image_url TEXT,
    is_featured BOOLEAN,
    average_rating DECIMAL,
    review_count INTEGER,
    media_count BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        v.id, v.name, v.slug, v.handle, v.category,
        v.latitude, v.longitude,
        v.city, v.state,
        v.cover_image_url, v.profile_image_url,
        v.is_featured,
        v.average_rating, v.review_count,
        COALESCE(mc.cnt, 0) AS media_count
    FROM venues v
    LEFT JOIN (
        SELECT vm.venue_id, COUNT(*) AS cnt
        FROM venue_media vm
        WHERE vm.status = 'approved'
        GROUP BY vm.venue_id
    ) mc ON mc.venue_id = v.id
    WHERE v.app_id = p_app_id
      AND v.is_active = true
      AND v.deleted_at IS NULL
      AND v.latitude IS NOT NULL
      AND v.longitude IS NOT NULL
    ORDER BY v.is_featured DESC, v.name;
END;
$$;


-- ===== 3. get_recent_post_pins — NEW =====
--
-- Drives two things on the map: the post pins themselves, and the default
-- centre (most recent post wins over the user's location, so opening the map
-- shows you what was just posted rather than your own street).
--
-- Coordinates COALESCE post over venue: a Viibe recorded on the sidewalk
-- outside is pinned where it was shot, and a venue post falls back to the
-- venue. Rows that resolve to no coordinate at all are excluded — a pin at
-- (null, null) is not a pin.
--
-- venue_name and the author names are returned so the preview modal can render
-- without a second round trip; a pin is often for a post that is not in the
-- current feed page.

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
    url TEXT,
    thumbnail_url TEXT,
    caption TEXT,
    author_first_name TEXT,
    author_last_name TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        vm.id, vm.venue_id,
        v.name AS venue_name,
        COALESCE(vm.latitude,  v.latitude)  AS latitude,
        COALESCE(vm.longitude, v.longitude) AS longitude,
        vm.url, vm.thumbnail_url, vm.caption,
        p.first_name AS author_first_name,
        p.last_name  AS author_last_name,
        vm.created_at
    FROM venue_media vm
    LEFT JOIN venues v
           ON v.id = vm.venue_id
          AND v.is_active = true
          AND v.deleted_at IS NULL
    LEFT JOIN profiles p ON p.id = vm.uploaded_by_user_id
    WHERE vm.app_id = p_app_id
      AND vm.status = 'approved'
      AND (vm.venue_id IS NULL OR v.id IS NOT NULL)
      AND COALESCE(vm.latitude,  v.latitude)  IS NOT NULL
      AND COALESCE(vm.longitude, v.longitude) IS NOT NULL
    ORDER BY vm.created_at DESC
    LIMIT p_limit;
END;
$$;
