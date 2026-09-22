-- Follow button, Phase 1: the SELECT grant social_follows never got, and a
-- follower_count on get_venue_detail.
--
-- Why
-- ---
-- Two things behind the same broken button.
--
--   1. 20260903000001 created social_follows with RLS and an own-rows SELECT
--      policy, but never issued `GRANT SELECT ON social_follows TO
--      authenticated`. Every other table in this repo grants explicitly; this
--      one relies on the project's default privileges. It almost certainly
--      works — the buttons have been reading state in prod since 09-03 — but
--      "almost certainly" is not a thing a silent failure mode should rest on.
--      If the grant were missing, loadFollowingState() would get a permission
--      error it logs to console, every button would read "Follow" forever, and
--      follow_target would keep writing rows nobody could see. GRANT is
--      idempotent, so issuing it costs nothing if it was already there.
--
--   2. Both follow_target and unfollow_target already return follower_count
--      (20260903000001:190, :286), and the client has always thrown the venue
--      arm away because get_venue_detail had nowhere to put it. The venue page
--      renders no count at all. Adding the OUT column is what makes the number
--      exist before the visitor's first tap.
--
-- ⚠️ THREE TRAPS IN THIS FILE
--
-- 1. ⚠️ NO GRANT FOOTER ON get_venue_detail. Adding one is the single most
--    damaging thing this file could do. get_venue_detail, get_venue_feed_v3,
--    get_venue_page_feed, get_venues_for_map and get_recent_post_pins all rely
--    on Postgres's default EXECUTE TO PUBLIC, and that default is the only
--    reason a signed-out visitor can browse ViibeView at all. The full
--    reasoning is at 20260901000001:32-41 and 20260828000003:21-28.
--
--    A DROP does take a function's grants with it — but this function has no
--    grants to re-issue. It is PUBLIC by default before the DROP and PUBLIC by
--    default after the CREATE. Section 3 asserts that, in the must-stay-OPEN
--    direction, so a future edit that "restores the footer" fails here instead
--    of emptying the venue page for every anonymous visitor.
--
-- 2. ⚠️ CREATE OR REPLACE cannot add an OUT column (42P13). get_venue_detail
--    must DROP first — which means the DROP window is a live outage: between
--    this migration and the Netlify deploy, openVenuePage() gets a function
--    that no longer matches the shape it is calling. Ship this migration and
--    the client in the SAME push. Same constraint 20260901000001:43-46 states.
--
-- 3. ⚠️ social_follower_count takes p_app_id, which get_venue_detail does not
--    receive. It is read off the venue row (v.app_id) inside the query, not
--    passed in — the signature stays get_venue_detail(UUID) so no client call
--    site changes and no second overload is created.
--
-- Rollback
-- --------
-- DROP FUNCTION get_venue_detail(UUID) and re-run the definition from
-- 20260901000001:258-311 verbatim. The GRANT in section 1 can stay; revoking
-- it would break the follow buttons, which is the state this file exists to
-- rule out.


-- ===== 1. The SELECT grant social_follows never got =====
--
-- RLS is what restricts this to own rows (20260903000001:120-126); the grant
-- is what lets `authenticated` reach the table at all. Both are required —
-- a policy on a table with no grant denies everyone.

GRANT SELECT ON TABLE social_follows TO authenticated;

-- anon is NOT granted. A signed-out visitor has no follows to read, the
-- own-rows policy would return zero rows anyway, and the client's
-- loadFollowingState() returns early when currentUserId is null.


-- ===== 2. get_venue_detail — + follower_count =====

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
    here_now INTEGER,
    follower_count INTEGER
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
        -- Same expression, same NULL trap, as get_venues_for_map.
        (SELECT COUNT(DISTINCT vm2.uploaded_by_user_id)
           FROM venue_media vm2
          WHERE vm2.venue_id = v.id
            AND vm2.status = 'approved'
            AND vm2.uploaded_by_user_id IS NOT NULL
            AND vm2.created_at > NOW() - INTERVAL '4 hours')::INTEGER AS here_now,
        -- ONE definition of "who counts as a follower", shared with
        -- follow_target, unfollow_target and get_member_followers. Split it and
        -- the venue page's number stops matching the number the button writes
        -- back after a tap.
        social_follower_count(v.app_id, 'venue', v.id) AS follower_count
    FROM venues v
    WHERE v.id = p_venue_id
      AND v.is_active = true
      AND v.deleted_at IS NULL;
END;
$$;


-- ===== 3. Post-install assertions =====
--
-- Both directions, because both failure modes are silent:
--   - a missing SELECT grant reads as "nobody follows anything"
--   - a grant footer on get_venue_detail reads as "this venue does not exist"

DO $$
BEGIN
    IF NOT has_table_privilege('authenticated', 'public.social_follows', 'SELECT') THEN
        RAISE EXCEPTION
            'social_follows is not SELECTable by authenticated — every follow button will read "Follow" forever';
    END IF;

    -- The must-stay-OPEN direction. anon browsing the venue page depends on it.
    IF NOT has_function_privilege('anon', 'public.get_venue_detail(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION
            'get_venue_detail is not EXECUTEable by anon — the venue page is empty for every signed-out visitor';
    END IF;

    IF NOT has_function_privilege('authenticated', 'public.get_venue_detail(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'get_venue_detail is not EXECUTEable by authenticated';
    END IF;
END $$;
