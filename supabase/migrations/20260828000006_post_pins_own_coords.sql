-- get_recent_post_pins: say whether a pin's coordinates are the post's own.
--
-- Why
-- ---
-- 20260828000003 has get_recent_post_pins COALESCE the post's coordinates over
-- its venue's, which is right for the map's DEFAULT CENTRE ("where is the
-- action?") and wrong for the PINS. A post with no coordinates of its own
-- inherits its venue's exactly, so renderPostPins() drew an 18px post pin
-- precisely on top of the 14px venue pin — and being larger and added later, it
-- swallowed the venue pin's click. The venue became unreachable on the map.
--
-- Measured on prod before changing anything: ViibeView's one post has
-- latitude/longitude NULL, and its pin came back at 42.6633415, 2.9048665 —
-- character-for-character the General venue's own coordinates. e2e caught it as
-- "tapping a map pin opens the venue page" failing, which had passed for months.
--
-- It also scales badly in the obvious direction: a venue with fifty posts would
-- stack fifty identical pins on one point.
--
-- A post pinned at exactly its venue's location carries no information the
-- venue pin does not already carry, and the post is still one tap away through
-- the venue page. So the client draws a post pin only when the post has its own
-- fix, and this column is how it can tell. The COALESCE stays — the centring
-- question is a different question.
--
-- Touches get_recent_post_pins and nothing else.
--
-- ⚠️ DROP first: adding an OUT column changes the return type, and Postgres
-- refuses a CREATE OR REPLACE that does. Ship with the client that reads it.
--
-- ⚠️ No grant footer, for the same reason as 20260828000003: these feed RPCs
-- rely on the default EXECUTE TO PUBLIC so signed-out visitors can browse.
--
-- Rollback: re-run the definition from 20260828000003 after dropping this one.

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
