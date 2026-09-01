-- Music genres on venues, and "who is here tonight" on the three feed RPCs.
--
-- Why
-- ---
-- ViibeView is a nightlife app whose only filter is a venue category. What
-- people actually choose a room by is what is playing in it, and what makes a
-- room worth walking to is whether anyone is in it. Both of those are one
-- column and one scalar subquery away.
--
-- Two things ship here:
--
--   1. venues.music_genres TEXT[]  — a controlled vocabulary, CHECK-constrained
--      to the same 19 slugs as /js/music-genres.js, GIN-indexed for the @>
--      containment filter. Deliberately NOT venues.tags: tags are freeform
--      owner text with no constraint behind them, so a filter over them would
--      match whatever anyone happened to type.
--
--   2. here_now INTEGER — the count of DISTINCT people who have posted an
--      approved Viibe at a venue in the last 4 hours. Per the product decision,
--      there is no check-in button: selecting a venue when you post IS the
--      check-in, so this is derived rather than stored, and there is no new
--      table, no new write path and nothing to keep in sync.
--
-- ⚠️ THREE TRAPS IN THIS FILE
--
-- 1. CREATE OR REPLACE cannot change a function's return type or add a
--    parameter. All three functions below therefore DROP first. Adding a
--    parameter without dropping would create a SECOND OVERLOAD, and PostgREST
--    resolution against two candidates is ambiguous — the client gets a 300,
--    not the new function.
--
-- 2. ⚠️ NO GRANT FOOTER. get_venue_feed, get_venues_for_map, get_venue_detail
--    and get_recent_post_pins all rely on Postgres's default EXECUTE TO PUBLIC,
--    and that default is the only reason a signed-out visitor can browse
--    ViibeView at all. Copying the `REVOKE ALL … FROM PUBLIC; GRANT … TO
--    authenticated` footer that 20260821000002 uses would empty the feed for
--    every anonymous visitor, and it would fail SILENTLY: the RPC returns a
--    permission error the client logs to console while rendering "No posts
--    yet". The same warning is spelled out at 20260828000003:21-28. Do not add
--    one. Verify with has_function_privilege('anon', …, 'EXECUTE') after
--    applying.
--
-- 3. ⚠️ The DROP window is a live outage. Between DROP FUNCTION and the client
--    deploy that reads the new columns, the feed errors. Ship this migration
--    and the client in the same push.
--
-- While here: all four feed RPCs get `SET search_path = public`. They are the
-- only SECURITY DEFINER functions in the repo still missing it — three earlier
-- migrations (20260218000003, 20260218000010, 20260218000011) exist purely to
-- fix this class of bug, and all three predate the venues tables.
--
-- Rollback
-- --------
-- Re-run get_venue_feed and get_venues_for_map from 20260828000003,
-- get_recent_post_pins from 20260828000006, and get_venue_detail from
-- 20260225000001:343-386, after DROPping the versions below. The column and
-- index can stay; nothing reads them once the functions are reverted.


-- ===== 1. venues.music_genres =====
--
-- Mirrors how `category` is constrained in 20260821000001_social_repair.sql:39-43.
-- `<@` is "is contained by", so an empty array passes and NULL never occurs
-- (the DEFAULT is '{}', and the column is left nullable so the CHECK is not
-- evaluated against pre-existing NULLs on a table this migration does not
-- rewrite).

ALTER TABLE venues ADD COLUMN IF NOT EXISTS music_genres TEXT[] DEFAULT '{}';

ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_music_genres_valid;
ALTER TABLE venues ADD CONSTRAINT venues_music_genres_valid
  CHECK (music_genres IS NULL OR music_genres <@ ARRAY[
    'house','techno','hip_hop','rnb','afrobeats','latin','reggaeton',
    'dancehall','amapiano','disco','funk_soul','rock','pop','jazz',
    'live_band','open_format','edm','trance','dj_set'
  ]::TEXT[]);

-- GIN, because the only query shape is `music_genres @> ARRAY[$1]`.
CREATE INDEX IF NOT EXISTS idx_venues_genres ON venues USING GIN (music_genres);

-- Supports the here_now subquery below, which is evaluated once per venue row
-- in get_venues_for_map and would otherwise be a sequential scan of
-- venue_media per venue.
CREATE INDEX IF NOT EXISTS idx_venue_media_presence
    ON venue_media (venue_id, created_at DESC)
    WHERE status = 'approved' AND uploaded_by_user_id IS NOT NULL;


-- ===== 2. get_venue_feed — + p_genre, + venue_music_genres =====

DROP FUNCTION IF EXISTS get_venue_feed(UUID, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS get_venue_feed(UUID, TEXT, TEXT, INTEGER, INTEGER);

CREATE FUNCTION get_venue_feed(
    p_app_id UUID,
    p_category TEXT DEFAULT NULL,
    p_genre TEXT DEFAULT NULL,
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
    post_latitude DECIMAL,
    post_longitude DECIMAL
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
      -- Category and genre both follow the same rule for venue-less posts:
      -- they have neither, so `v.category = p_category` and the containment
      -- test are both NULL → false, and an unattached Viibe appears under
      -- "All / All" only. That is the honest behaviour — a street Viibe is not
      -- a "Rooftop" post and it is not a "techno" post either.
      AND (p_category IS NULL OR v.category = p_category)
      AND (p_genre    IS NULL OR v.music_genres @> ARRAY[p_genre]::TEXT[])
    ORDER BY vm.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;


-- ===== 3. get_venues_for_map — + music_genres, + here_now =====

DROP FUNCTION IF EXISTS get_venues_for_map(UUID);

CREATE FUNCTION get_venues_for_map(p_app_id UUID)
RETURNS TABLE (
    id UUID,
    name TEXT,
    slug TEXT,
    handle TEXT,
    category TEXT,
    music_genres TEXT[],
    latitude DECIMAL,
    longitude DECIMAL,
    city TEXT,
    state TEXT,
    cover_image_url TEXT,
    profile_image_url TEXT,
    is_featured BOOLEAN,
    average_rating DECIMAL,
    review_count INTEGER,
    media_count BIGINT,
    here_now INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        v.id, v.name, v.slug, v.handle, v.category,
        v.music_genres,
        v.latitude, v.longitude,
        v.city, v.state,
        v.cover_image_url, v.profile_image_url,
        v.is_featured,
        v.average_rating, v.review_count,
        COALESCE(mc.cnt, 0) AS media_count,
        -- "Here tonight": distinct people who posted here in the last 4 hours.
        --
        -- ⚠️ `uploaded_by_user_id IS NOT NULL` is load-bearing, not defensive.
        -- Every post predating 20260828000001 has that column NULL — it was
        -- never written before then and no backfill is possible, because the
        -- authorship was never recorded. COUNT(DISTINCT) over a set containing
        -- NULLs would collapse all of them into a single phantom person and
        -- report "1 here tonight" at a venue nobody has visited.
        (SELECT COUNT(DISTINCT vm2.uploaded_by_user_id)
           FROM venue_media vm2
          WHERE vm2.venue_id = v.id
            AND vm2.status = 'approved'
            AND vm2.uploaded_by_user_id IS NOT NULL
            AND vm2.created_at > NOW() - INTERVAL '4 hours')::INTEGER AS here_now
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


-- ===== 4. get_venue_detail — + music_genres, + here_now =====
--
-- 20260225000001 created this with CREATE OR REPLACE and no DROP. Adding OUT
-- columns means it needs a real DROP now; the IF EXISTS covers a database where
-- it somehow does not exist.

DROP FUNCTION IF EXISTS get_venue_detail(UUID);

CREATE FUNCTION get_venue_detail(p_venue_id UUID)
RETURNS TABLE (
    id UUID,
    name TEXT,
    slug TEXT,
    handle TEXT,
    description TEXT,
    category TEXT,
    music_genres TEXT[],
    address_line1 TEXT,
    city TEXT,
    state TEXT,
    postal_code TEXT,
    latitude DECIMAL,
    longitude DECIMAL,
    cover_image_url TEXT,
    profile_image_url TEXT,
    phone TEXT,
    website TEXT,
    instagram_handle TEXT,
    hours JSONB,
    tags TEXT[],
    average_rating DECIMAL,
    review_count INTEGER,
    is_featured BOOLEAN,
    here_now INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        v.id, v.name, v.slug, v.handle, v.description, v.category,
        v.music_genres,
        v.address_line1, v.city, v.state, v.postal_code,
        v.latitude, v.longitude,
        v.cover_image_url, v.profile_image_url,
        v.phone, v.website, v.instagram_handle,
        v.hours, v.tags,
        v.average_rating, v.review_count,
        v.is_featured,
        -- Same expression, same NULL trap, as get_venues_for_map above.
        (SELECT COUNT(DISTINCT vm2.uploaded_by_user_id)
           FROM venue_media vm2
          WHERE vm2.venue_id = v.id
            AND vm2.status = 'approved'
            AND vm2.uploaded_by_user_id IS NOT NULL
            AND vm2.created_at > NOW() - INTERVAL '4 hours')::INTEGER AS here_now
    FROM venues v
    WHERE v.id = p_venue_id
      AND v.is_active = true
      AND v.deleted_at IS NULL;
END;
$$;


-- ===== 5. get_recent_post_pins — search_path only =====
--
-- The body is byte-identical to 20260828000006. It is restated rather than
-- ALTERed so that this file is the complete current definition of all four feed
-- RPCs; a reader diffing them should not have to reconstruct one of them from
-- two files. DROP is not strictly required (no signature change) but keeps the
-- pattern uniform and avoids a CREATE OR REPLACE that silently no-ops on a
-- return-type mismatch introduced later.

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
    author_first_name TEXT,
    author_last_name TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        vm.id, vm.venue_id,
        v.name AS venue_name,
        COALESCE(vm.latitude,  v.latitude)  AS latitude,
        COALESCE(vm.longitude, v.longitude) AS longitude,
        (vm.latitude IS NOT NULL AND vm.longitude IS NOT NULL) AS has_own_coords,
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
