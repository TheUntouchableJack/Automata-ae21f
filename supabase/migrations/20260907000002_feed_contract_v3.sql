-- ViibeView feed contract v3: distance (#5), 24h auto-hide (#6), video-only (#12).
--
-- SIBLING FUNCTIONS, NOT AN IN-PLACE REPLACEMENT
-- ----------------------------------------------
-- get_venue_feed and get_following_feed are left EXACTLY as 20260903000004 left
-- them. This file adds `_v3` siblings alongside them.
--
-- Why: changing a function's OUT columns or arity requires DROP + CREATE
-- (CREATE OR REPLACE raises 42P13), and between the migration landing and the
-- Netlify deploy going live the feed errors for every visitor —
-- 20260903000004:3-9 calls that out as "the only outage window in Phase 2".
-- A sibling removes the coupled-deploy window entirely: the migration can ship
-- first and change nothing, and the old function stays as an instant rollback
-- (point social.js back at it, one line).
--
-- The v2 pair is dead code the moment the client deploys. It is deliberately
-- NOT dropped here — see the cleanup note at the bottom.
--
-- ⚠️ GRANT ASYMMETRY. This is the single most breakable thing in the file:
--
--   get_venue_feed_v3      NO GRANT FOOTER. Anon browsing is a supported mode
--                          and it depends on Postgres's default EXECUTE TO
--                          PUBLIC plus Supabase's ALTER DEFAULT PRIVILEGES
--                          grant to anon. Adding `REVOKE … FROM PUBLIC` here
--                          empties the feed for every signed-out visitor and
--                          fails SILENTLY: the client logs the permission error
--                          to console and renders "No posts yet".
--
--   get_following_feed_v3  KEEPS the real three-line footer from
--                          20260903000004:286-288. It reads auth.uid(); anon
--                          has nobody to follow.
--
-- The post-install assertion at the bottom checks BOTH directions, because the
-- must-stay-OPEN direction is the one that fails silently.
--
-- ⚠️ The two RETURNS TABLE blocks are byte-identical to each other and to the
-- v2 pair. One renderFeedCard() reads all of them, and
-- tests/viibeview-follows.test.js asserts the identity textually. Edit them
-- together or the test fails.
--
--
-- THE THREE NEW PREDICATES
-- ------------------------
-- 1. TTL (#6) — read SERVER-SIDE from customer_apps.settings->>'post_ttl_hours'.
--    Not a client parameter: a client-supplied TTL is spoofable (anyone with the
--    anon key can ask for the un-expired feed), and a server-side read means the
--    owner's toggle takes effect with no client deploy. Absent / non-numeric /
--    <= 0 all mean NO EXPIRY, which is the current behaviour and therefore the
--    safe default for every other tenant on this database.
--
--    Uses the existing idx_venue_media_feed (app_id, status, created_at DESC)
--    as a range scan. No new index.
--
-- 2. Distance (#5) — p_lat / p_lng / p_radius_miles, filtered on
--    COALESCE(vm.latitude, v.latitude), the same coalesce get_recent_post_pins
--    already uses. Bounding-box prefilter, then haversine. No PostGIS.
--
--    ⚠️ A NULL radius means "Any", and skips the predicate entirely. So does a
--    radius with no coordinates. getCurrentCoords() (social.js) resolves to null
--    on permission-denied AND on timeout, and A DENIED LOCATION PERMISSION MUST
--    NEVER PRODUCE AN EMPTY FEED. The client is written to send NULL, and this
--    function refuses to filter without coordinates as well — two guards,
--    because there is no error state for "your feed is empty for a reason you
--    cannot see".
--
-- 3. Video-only — the home feed is a full-screen video surface (#3/#12), and a
--    photo in a 100dvh snap panel is a still image you cannot skip past at the
--    same speed. Photos stay on venue pages, profile grids and the map, all of
--    which read DIFFERENT functions (get_venue_page_feed, get_member_posts,
--    get_recent_post_pins) that this file does not touch.
--
--
-- WHY ALL THREE APPLY TO get_following_feed_v3 TOO
-- -----------------------------------------------
-- The plan scoped TTL to "the home feed". Following is not a separate surface —
-- it is a third state of the SAME pill row on the SAME tab, rendered by the
-- SAME renderFeedCard(). 20260903000004:164-166 already made this call for the
-- category/genre pills: "a filter that silently stopped working when you
-- switched to Following would read as the filter being broken." A distance chip
-- or a full-screen video feed that quietly changed meaning between two chips in
-- one row is the same defect. "Home feed only" still holds against what it was
-- written about: venue pages, profile grids and map pins are untouched.
--
--
-- Touches: creates get_venue_feed_v3, get_following_feed_v3,
-- update_social_app_settings. Modifies NO existing function, NO table, NO
-- policy, NO index.
--
-- Rollback
-- --------
--   DROP FUNCTION IF EXISTS get_venue_feed_v3(UUID, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER);
--   DROP FUNCTION IF EXISTS get_following_feed_v3(UUID, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER);
--   DROP FUNCTION IF EXISTS update_social_app_settings(UUID, JSONB);
--   -- and point social.js's loadFeed() back at get_venue_feed / get_following_feed.
--   -- Nothing else has to move: the v2 pair was never altered.


-- ===== 0. Two shared helpers =====
--
-- Both feed functions need the identical TTL lookup and the identical haversine
-- expression. Inlining them twice is how the v2 pair's two RETURNS TABLE blocks
-- came to need a TEXTUAL EQUALITY TEST to stop them drifting — one copy each is
-- the cheaper guarantee.
--
-- No grant footer on either, and that is deliberate rather than an oversight:
--
--   * Both are called from INSIDE SECURITY DEFINER functions, where EXECUTE is
--     checked against the definer, so a footer would not protect anything.
--   * social_haversine_miles is pure arithmetic on caller-supplied numbers.
--   * social_feed_ttl_hours reads ONE key of customer_apps.settings — a column
--     the anon key already reads in full at app boot (social.js init() does
--     .from('customer_apps').select('*') for any published app). It exposes
--     nothing new.

CREATE OR REPLACE FUNCTION social_haversine_miles(
    p_lat1 DOUBLE PRECISION,
    p_lng1 DOUBLE PRECISION,
    p_lat2 DOUBLE PRECISION,
    p_lng2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    -- 3958.7613 = mean Earth radius in statute miles. asin(sqrt(a)) rather than
    -- atan2 because it is the form that stays numerically stable for the short
    -- distances this app actually filters on.
    SELECT 3958.7613 * 2 * asin(LEAST(1.0, sqrt(
        power(sin(radians(p_lat2 - p_lat1) / 2), 2)
      + cos(radians(p_lat1)) * cos(radians(p_lat2))
      * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
    )));
$$;

COMMENT ON FUNCTION social_haversine_miles(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) IS
    'Great-circle distance in statute miles. Used by the ViibeView feed distance filter; no PostGIS dependency.';

-- Returns hours, or NULL for "no expiry".
--
-- ⚠️ Every unparseable shape returns NULL, i.e. NO EXPIRY. That is the safe
-- direction: the failure mode of guessing wrong here is either "posts stop
-- disappearing" (visible, harmless) or "the feed empties for every tenant on
-- this database" (silent, catastrophic). A bare `(settings->>'x')::NUMERIC`
-- would take the second one — it raises 22P02 on any non-numeric string, which
-- inside the feed function is a hard error on every page load.
CREATE OR REPLACE FUNCTION social_feed_ttl_hours(p_app_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_raw JSONB;
    v_hours NUMERIC;
BEGIN
    SELECT ca.settings->'post_ttl_hours' INTO v_raw
    FROM customer_apps ca
    WHERE ca.id = p_app_id;

    IF v_raw IS NULL OR jsonb_typeof(v_raw) = 'null' THEN
        RETURN NULL;
    END IF;

    IF jsonb_typeof(v_raw) = 'number' THEN
        v_hours := (v_raw #>> '{}')::NUMERIC;
    ELSIF jsonb_typeof(v_raw) = 'string' AND (v_raw #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$' THEN
        v_hours := (v_raw #>> '{}')::NUMERIC;
    ELSE
        RETURN NULL;
    END IF;

    -- 0 or negative means "no expiry", not "hide everything". A setting whose
    -- lowest value blanks the app is a footgun; update_social_app_settings
    -- refuses to write one, and this is the second guard for rows written any
    -- other way.
    IF v_hours <= 0 THEN
        RETURN NULL;
    END IF;

    RETURN v_hours;
END;
$$;

COMMENT ON FUNCTION social_feed_ttl_hours(UUID) IS
    'customer_apps.settings->>post_ttl_hours as a NUMBER of hours, or NULL for no expiry. Every unparseable value returns NULL — see the function body for why that direction is the safe one.';


-- ===== 1. get_venue_feed_v3 =====
--
-- ⚠️ NO GRANT FOOTER. Read the header. This is not an oversight.

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
      -- (#6) Server-side TTL. NULL = no expiry, which is what every tenant
      -- without the setting gets, i.e. today's behaviour unchanged.
      AND (v_ttl_hours IS NULL
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


-- ===== 2. get_following_feed_v3 — authenticated only =====
--
-- ⚠️ The RETURNS TABLE block below is byte-identical to §1's. One
-- renderFeedCard() reads both, and tests/viibeview-follows.test.js fails if
-- they stop matching.
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


-- ===== 3. update_social_app_settings =====
--
-- The owner's TTL and default-radius controls, written from the ViibeView app
-- on a phone rather than from the Royalty admin. ViibeView already carries
-- org-member-only admin in-app (add-a-venue, venue genres), so this is the
-- lower-blast-radius home for it: nothing in the Royalty owner dashboard
-- changes, and a bug here cannot reach a Royalty screen.
--
-- 🔴 NEVER grant table-level UPDATE on customer_apps to reach this. That table
-- holds EVERY Royalty tenant's row — branding, features, plan, autonomy mode.
-- This function is SECURITY DEFINER precisely so that grant never has to exist.
--
-- Two things keep it narrow:
--   * org membership is verified against organization_members for THIS app's
--     organization, exactly as the venues RLS policy does;
--   * only an ALLOW-LIST of keys is merged. `settings ||` on a caller-supplied
--     object would let an org member of any tenant rewrite video_max_duration,
--     moderation_required, or whatever ships into that column next.

CREATE OR REPLACE FUNCTION update_social_app_settings(
    p_app_id UUID,
    p_settings JSONB
)
RETURNS TABLE (success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_org_id UUID;
    v_patch JSONB := '{}'::JSONB;
    v_ttl NUMERIC;
    v_radius NUMERIC;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false, 'You must be signed in'::TEXT;
        RETURN;
    END IF;

    SELECT ca.organization_id INTO v_org_id
    FROM customer_apps ca
    WHERE ca.id = p_app_id
      AND ca.app_type = 'social'
      AND ca.deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'App not found'::TEXT;
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = v_org_id
          AND om.user_id = v_user_id
    ) THEN
        RETURN QUERY SELECT false, 'Not authorized'::TEXT;
        RETURN;
    END IF;

    -- ===== Allow-list =====
    --
    -- post_ttl_hours: how long a Viibe stays in the home feed. JSON null is the
    -- explicit "no expiry" value and is preserved as SQL NULL inside the JSONB,
    -- which is what the feed functions read as "no expiry". 0 is rejected
    -- rather than treated as "hide everything instantly" — a control whose
    -- lowest setting empties the app is a footgun, not a feature.
    IF p_settings ? 'post_ttl_hours' THEN
        IF jsonb_typeof(p_settings->'post_ttl_hours') = 'null' THEN
            v_patch := v_patch || jsonb_build_object('post_ttl_hours', NULL);
        ELSIF jsonb_typeof(p_settings->'post_ttl_hours') = 'number' THEN
            v_ttl := (p_settings->>'post_ttl_hours')::NUMERIC;
            IF v_ttl < 1 OR v_ttl > 8760 THEN
                RETURN QUERY SELECT false, 'Post lifetime must be between 1 and 8760 hours'::TEXT;
                RETURN;
            END IF;
            v_patch := v_patch || jsonb_build_object('post_ttl_hours', v_ttl);
        ELSE
            RETURN QUERY SELECT false, 'Post lifetime must be a number'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- feed_radius_default: the radius chip's opening value, in miles. Purely a
    -- default — the member overrides it and the override is remembered on their
    -- device. JSON null means "Any".
    IF p_settings ? 'feed_radius_default' THEN
        IF jsonb_typeof(p_settings->'feed_radius_default') = 'null' THEN
            v_patch := v_patch || jsonb_build_object('feed_radius_default', NULL);
        ELSIF jsonb_typeof(p_settings->'feed_radius_default') = 'number' THEN
            v_radius := (p_settings->>'feed_radius_default')::NUMERIC;
            IF v_radius < 1 OR v_radius > 500 THEN
                RETURN QUERY SELECT false, 'Feed radius must be between 1 and 500 miles'::TEXT;
                RETURN;
            END IF;
            v_patch := v_patch || jsonb_build_object('feed_radius_default', v_radius);
        ELSE
            RETURN QUERY SELECT false, 'Feed radius must be a number'::TEXT;
            RETURN;
        END IF;
    END IF;

    IF v_patch = '{}'::JSONB THEN
        RETURN QUERY SELECT false, 'Nothing to update'::TEXT;
        RETURN;
    END IF;

    -- COALESCE: settings is nullable on customer_apps, and NULL || anything is
    -- NULL — which would silently discard the write.
    UPDATE customer_apps
    SET settings = COALESCE(settings, '{}'::JSONB) || v_patch
    WHERE id = p_app_id;

    RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION update_social_app_settings(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION update_social_app_settings(UUID, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION update_social_app_settings(UUID, JSONB) TO authenticated;


-- ===== Post-install assertions =====
--
-- Both directions. The must-stay-OPEN one is asserted first because it is the
-- one that fails silently: a REVOKE that "tidies up" get_venue_feed_v3 gives
-- every signed-out visitor a 200 with zero rows and an empty state that reads
-- as "no posts tonight".

DO $$
DECLARE
    v_anon BOOLEAN;
    v_auth BOOLEAN;
BEGIN
    SELECT has_function_privilege('anon', 'public.get_venue_feed_v3(uuid, text, text, double precision, double precision, double precision, integer, integer)', 'EXECUTE')
    INTO v_anon;
    IF NOT v_anon THEN
        RAISE EXCEPTION
            'get_venue_feed_v3: anon CANNOT execute it — a grant footer was added, and the feed is now empty for every signed-out visitor with no error on screen';
    END IF;

    SELECT has_function_privilege('anon', 'public.get_following_feed_v3(uuid, text, text, double precision, double precision, double precision, integer, integer)', 'EXECUTE'),
           has_function_privilege('authenticated', 'public.get_following_feed_v3(uuid, text, text, double precision, double precision, double precision, integer, integer)', 'EXECUTE')
    INTO v_anon, v_auth;
    IF v_anon THEN
        RAISE EXCEPTION 'get_following_feed_v3: anon can EXECUTE it — the REVOKE ... FROM anon line did not take';
    END IF;
    IF NOT v_auth THEN
        RAISE EXCEPTION 'get_following_feed_v3: authenticated CANNOT execute it — the Following chip is dead';
    END IF;

    SELECT has_function_privilege('anon', 'public.update_social_app_settings(uuid, jsonb)', 'EXECUTE'),
           has_function_privilege('authenticated', 'public.update_social_app_settings(uuid, jsonb)', 'EXECUTE')
    INTO v_anon, v_auth;
    IF v_anon THEN
        RAISE EXCEPTION 'update_social_app_settings: anon can EXECUTE it — an anon-reachable writer on customer_apps';
    END IF;
    IF NOT v_auth THEN
        RAISE EXCEPTION 'update_social_app_settings: authenticated CANNOT execute it — the owner settings sheet cannot save';
    END IF;
END;
$$;

-- The v2 pair MUST still be intact and still anon-executable. It is the
-- rollback target, and until the client deploys it is also the LIVE feed.
DO $$
BEGIN
    IF NOT has_function_privilege('anon', 'public.get_venue_feed(uuid, text, text, integer, integer)', 'EXECUTE') THEN
        RAISE EXCEPTION
            'get_venue_feed (v2): anon lost EXECUTE — this migration was supposed to touch nothing, and the LIVE feed is now empty for signed-out visitors';
    END IF;
END;
$$;


-- ===== Cleanup, deliberately deferred =====
--
-- get_venue_feed and get_following_feed become dead code once social.js ships
-- pointing at the _v3 pair. They are NOT dropped here on purpose: for the
-- window between this migration and the Netlify deploy they ARE the live feed,
-- and after it they are a one-line rollback. Drop them in a later migration,
-- once the _v3 pair has served real traffic — and re-read
-- 20260903000004's header first, because dropping get_venue_feed has its own
-- grant story.
