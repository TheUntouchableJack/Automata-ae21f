-- Author identity on the two post surfaces that never had it.
--
-- Why
-- ---
-- 20260903000004 added the author columns to get_venue_feed so the main feed
-- card header could route to its author's profile. Two other surfaces show
-- posts and were left behind:
--
--   1. The VENUE PAGE's "Recent Posts" is a raw client-side
--      .from('venue_media').select(...) with no author name or avatar at all,
--      so its cards render a header holding nothing but the ⋮ button. There is
--      no way to see who posted, let alone open their profile.
--
--   2. The MAP post preview builds its byline from get_recent_post_pins, which
--      returns author_first_name / author_last_name but NOT the author's id —
--      so the byline is unavoidably inert text.
--
-- Both are fixed here, by giving them the same author columns and the same
-- app_members join that get_venue_feed already uses.
--
-- Fixing (2) also closes a latent bug that has nothing to do with profiles:
-- findPostById() returns a map pin whose uploaded_by_user_id is undefined, so
-- renderPostOptionsMain()'s canDelete check is always false. A post opened from
-- the map never offers Delete to its own author. Returning the column fixes
-- that as a side effect.
--
-- ⚠️ NO GRANT FOOTER, in either section. Signed-out visitors browse the feed,
-- the venue page and the map, so these must keep the default EXECUTE TO PUBLIC.
-- Adding `REVOKE ... FROM PUBLIC; GRANT ... TO authenticated` empties all three
-- surfaces for every anonymous visitor and fails SILENTLY — the same warning
-- 20260903000002 and 20260828000006 both carry.
--
-- Rollback: DROP get_venue_page_feed and re-run get_recent_post_pins from
-- 20260828000006.


-- ===== 1. get_venue_page_feed — NEW =====
--
-- The venue page's own feed, with the author columns. Deliberately a mirror of
-- get_venue_feed's author half rather than a new shape: one client function
-- (postHeaderMarkup) renders both, so the payloads must agree.
--
-- No category/genre parameters — the page is already one venue, and the pills
-- do not exist there. Paginated the same way the client already paginates:
-- p_limit/p_offset, newest first.

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
BEGIN
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
    ORDER BY vm.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;


-- ===== 2. get_recent_post_pins — + author id, display name, avatar =====
--
-- ⚠️ DROP first: adding an OUT column changes the return type, and Postgres
-- refuses a CREATE OR REPLACE that does. Ship with the client that reads it.
--
-- Everything else is carried forward verbatim from 20260828000006, including
-- has_own_coords and the reasoning behind it (a post with no fix of its own
-- inherits its venue's coordinates exactly, and drawing a second pin on that
-- point swallows the venue pin's click).

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
    ORDER BY vm.created_at DESC
    LIMIT p_limit;
END;
$$;
