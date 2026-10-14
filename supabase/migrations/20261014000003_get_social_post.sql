-- One Viibe by id, for a shared link (Jay's board, 2026-10-14: Share via SMS /
-- Email / General).
--
-- A shared link is {origin}/a/{slug}/social?post={id}. The app opens it in the
-- Viibe player, which needs the post in the same row shape the home feed uses
-- (renderFeedCard). Nothing could fetch ONE post by id before: every reader is
-- a list, and the home feed resets at 7am, so yesterday's link would find
-- nothing there.
--
--   get_social_post(app_id, post_id)   NEW. Zero or one row, the exact
--                                      RETURNS TABLE of get_venue_feed_v3.
--
-- When does a link still open?
-- ----------------------------
-- Exactly when the post would still show where it lives:
--   - a post AT A VENUE: when its venue page would still list it — approved,
--     the venue active, and inside the tenant's post lifetime (or permanent).
--     That is get_venue_page_feed's predicate, character for character.
--   - a post with NO venue: when its author's profile would — approved, and
--     the author's profile public (or the caller is the author). That is
--     get_member_posts' gate.
-- ...and never when the viewer has hidden it (20261014000001).
--
-- ⚠️ READABLE BY ANON, deliberately: a shared link is opened by people who are
-- not signed in. NO grant footer — the default EXECUTE TO PUBLIC is what makes
-- it work. It returns nothing a signed-out visitor could not already read from
-- the venue page or the profile. Asserted at install.
--
-- Rollback: DROP FUNCTION get_social_post(UUID, UUID).

CREATE OR REPLACE FUNCTION get_social_post(
    p_app_id UUID,
    p_post_id UUID
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
BEGIN
    IF p_app_id IS NULL OR p_post_id IS NULL THEN
        RETURN;
    END IF;

    v_ttl_hours := social_feed_ttl_hours(p_app_id);

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
    WHERE vm.id = p_post_id
      AND vm.app_id = p_app_id
      AND vm.status = 'approved'
      AND (
            -- At a venue: get_venue_page_feed's predicate, verbatim, plus an
            -- active venue (an inactive venue's page does not open).
            (vm.venue_id IS NOT NULL AND v.id IS NOT NULL
             AND (v_ttl_hours IS NULL
                  OR vm.is_permanent
                  OR vm.created_at > now() - make_interval(secs => (v_ttl_hours * 3600)::DOUBLE PRECISION)))
            -- No venue: get_member_posts' gate on the author's profile.
         OR (vm.venue_id IS NULL
             AND (am.profile_public IS TRUE
                  OR (auth.uid() IS NOT NULL AND auth.uid() = vm.uploaded_by_user_id)))
          )
      -- Hidden by this viewer. A no-op for a signed-out caller.
      AND NOT EXISTS (SELECT 1 FROM social_hidden_posts h WHERE h.media_id = vm.id AND h.user_id = auth.uid())
    LIMIT 1;
END;
$$;


-- ⚠️ NO GRANT FOOTER HERE. Shared links are opened signed out.


DO $$
BEGIN
    IF NOT has_function_privilege('anon', 'public.get_social_post(uuid, uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'get_social_post: anon CANNOT execute it — every shared link fails for a signed-out visitor';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = 'public.get_social_post(uuid, uuid)'::regprocedure
          AND prosecdef
          AND proconfig @> ARRAY['search_path=public']
    ) THEN
        RAISE EXCEPTION 'get_social_post: not SECURITY DEFINER with search_path = public';
    END IF;
END $$;
