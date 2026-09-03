-- ViibeView Phase 2, part 4: author identity on feed cards, and a Following feed.
--
-- ⚠️ THIS IS THE ONLY OUTAGE WINDOW IN PHASE 2, WHICH IS WHY IT SHIPS LAST.
-- Postgres refuses a CREATE OR REPLACE that changes a function's OUT columns, so
-- get_venue_feed must be DROPped and recreated. Between the DROP and the client
-- deploy the live feed returns an error for everybody. Ship the migration and
-- the client together, and run the anon curl on get_venue_feed IMMEDIATELY after
-- the push — an empty 200 means anon lost EXECUTE and the feed is blank for every
-- signed-out visitor.
--
-- ⚠️ NO GRANT FOOTER on get_venue_feed. Restated because a DROP + CREATE is
-- exactly the moment someone "tidies up" by adding one: 20260225000001 issues no
-- grants at all, and Postgres's default EXECUTE TO PUBLIC — plus Supabase's
-- ALTER DEFAULT PRIVILEGES grant to anon — is what lets a signed-out visitor
-- browse. A footer here empties the feed for them and fails silently, because
-- the client logs the permission error to console and renders "No posts yet".
-- DROP + CREATE without a footer is safe: get_venue_feed has survived it twice
-- (20260828000003, 20260901000001) with anon browsing intact, because the
-- default privileges re-grant anon on the new function.
--
-- What is new on get_venue_feed
-- -----------------------------
--   author_display_name, author_avatar_url
--
-- The existing author join is against `profiles`, which has first_name/last_name
-- and NO avatar for a ViibeView member — avatars live on app_members. So a
-- second LEFT JOIN, scoped to the same app and excluding soft-deleted members,
-- supplies both. author_first_name / author_last_name stay: postIdentity() still
-- falls back to them for a member whose app_members row has no display_name.
--
-- Why get_following_feed is a SEPARATE function, not a p_following argument
-- ------------------------------------------------------------------------
--   * Adding an argument forces another DROP + CREATE of get_venue_feed — a
--     second live outage — every time the Following feed changes.
--   * A merged function could not have an honest grant footer. Browsing must be
--     anon-executable; a Following feed is meaningless without auth.uid(). One
--     function cannot be both, so anon callers would silently get an empty feed
--     from the branch they are not allowed to use.
--
-- The cost, stated plainly: the two RETURNS TABLE lists must stay identical, or
-- the client's one renderFeedCard() starts reading undefined on one of them and
-- shows nothing without erroring. Two guards: they ship in this one file, and
-- tests/viibeview-follows.test.js asserts the two blocks are textually identical.
-- Edit them together or the test fails.
--
-- Touches: get_venue_feed (DROP + CREATE), get_following_feed (new).
--
-- Rollback
-- --------
--   DROP FUNCTION IF EXISTS get_following_feed(UUID, TEXT, TEXT, INTEGER, INTEGER);
--   -- then re-run get_venue_feed from 20260901000001 (lines 91-179) after
--   -- DROPping the version below. Do NOT add a grant footer when you do.


-- ===== 1. get_venue_feed — + author_display_name, + author_avatar_url =====

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
    author_display_name TEXT,
    author_avatar_url TEXT,
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
        am.display_name AS author_display_name,
        am.avatar_url   AS author_avatar_url,
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
    -- The member row, for the display name and the avatar. `profiles` has
    -- neither of those for a ViibeView member. Scoped to the same app so an
    -- author who is a member of two tenants shows this tenant's identity.
    LEFT JOIN app_members am
           ON am.user_id = vm.uploaded_by_user_id
          AND am.app_id  = vm.app_id
          AND am.deleted_at IS NULL
    WHERE vm.app_id = p_app_id
      AND vm.status = 'approved'
      -- A post that names a venue still requires that venue to be live. Only a
      -- post with no venue at all is allowed through unattached; otherwise
      -- deleting a venue would resurrect its posts as anonymous ones.
      AND (vm.venue_id IS NULL OR v.id IS NOT NULL)
      -- Category and genre both follow the same rule for venue-less posts:
      -- they have neither, so `v.category = p_category` and the containment
      -- test are both NULL → false, and an unattached Viibe appears under
      -- "All / All" only.
      AND (p_category IS NULL OR v.category = p_category)
      AND (p_genre    IS NULL OR v.music_genres @> ARRAY[p_genre]::TEXT[])
    ORDER BY vm.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;


-- ===== 2. get_following_feed — NEW, authenticated only =====
--
-- Posts by members you follow, plus posts at venues you follow. Own posts are
-- EXCLUDED: a Following tab that shows your own Viibes back to you is not a
-- Following tab, and you cannot follow yourself (social_follows_no_self), so
-- including them would be inventing an edge that does not exist.
--
-- The category/genre pills still apply here. They are one row shared by both
-- feeds, and a filter that silently stopped working when you switched to
-- Following would read as the filter being broken.
--
-- ⚠️ The RETURNS TABLE block below is byte-identical to get_venue_feed's above,
-- and tests/viibeview-follows.test.js fails if it stops being. One
-- renderFeedCard() reads both.
--
-- Grant footer is the REAL one here, all three lines: anon has nobody to follow,
-- and the function reads auth.uid().

CREATE OR REPLACE FUNCTION get_following_feed(
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
BEGIN
    -- No session, nothing followed. Returning zero rows rather than raising
    -- keeps the client's empty state ("follow someone to fill this") the single
    -- place that explains an empty Following feed.
    IF v_user_id IS NULL THEN
        RETURN;
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
      -- Not mine.
      AND (vm.uploaded_by_user_id IS NULL OR vm.uploaded_by_user_id <> v_user_id)
      AND (
            -- by someone I follow
            EXISTS (
                SELECT 1 FROM social_follows f
                WHERE f.app_id = p_app_id
                  AND f.follower_user_id = v_user_id
                  AND f.followee_user_id = vm.uploaded_by_user_id
            )
            -- or at a venue I follow
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

REVOKE ALL ON FUNCTION get_following_feed(UUID, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_following_feed(UUID, TEXT, TEXT, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION get_following_feed(UUID, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
