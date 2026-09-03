-- ViibeView Phase 2, part 3: follower lists and member discovery.
--
-- One row template, three lists
-- -----------------------------
-- get_member_followers, get_member_following and discover_members all return the
-- SAME shape:
--
--     target_type ('user' | 'venue'), target_id, name, avatar_url,
--     subtitle, followed_at
--
-- so the client has one renderPeopleList() and one people sheet with three
-- modes, instead of three renderers that drift. "Following" is the only one that
-- is genuinely polymorphic — you follow both members and venues — and forcing
-- the other two into the same shape costs a constant literal each.
--
-- ⚠️ THE VISIBILITY RULE IS ASYMMETRIC, ON PURPOSE
-- ------------------------------------------------
--   LISTS      filter on deleted_at IS NULL ONLY.
--   DISCOVERY  additionally filters profile_public = true.
--
-- Why lists do not filter on profile_public: the follower COUNT on a profile is
-- social_follower_count(), whose only predicate is deleted_at IS NULL
-- (20260903000001 §4). If the list filtered on profile_public as well, a profile
-- would say "12 followers" above a list of 9, with no explanation available to
-- the person reading it. A private member still appears as a name + avatar row —
-- which is exactly what get_member_profile already returns for them — and tapping
-- through lands on the "this profile is private" state. Private means "my posts,
-- bio and counts are mine", not "I am invisible".
--
-- Discovery is different: it is an unsolicited directory of strangers. Being
-- listed there IS the thing profile_public opts into.
--
-- ⚠️ NO GRANT FOOTER ANYWHERE IN THIS FILE. All three are anon-readable by
-- design — a signed-out visitor can open a profile, so they can open its
-- followers. Adding `REVOKE ... FROM PUBLIC; GRANT ... TO authenticated` empties
-- these lists for anonymous visitors SILENTLY (20260828000003:21-28). And
-- because they are anon-callable they are public API: explicit column lists,
-- never m.*, and never email, phone, points_balance, tier, pin_hash, auth_token
-- or last_name. Name is COALESCE(display_name, first_name, 'Member') — first
-- name only, matching get_app_leaderboard (customer-apps-migration.sql:649).
--
-- Touches: creates three functions. No table, column or existing function is
-- changed.
--
-- Rollback
-- --------
--   DROP FUNCTION IF EXISTS discover_members(UUID, TEXT, INTEGER, INTEGER);
--   DROP FUNCTION IF EXISTS get_member_following(UUID, UUID, INTEGER, INTEGER);
--   DROP FUNCTION IF EXISTS get_member_followers(UUID, UUID, INTEGER, INTEGER);


-- ===== 1. get_member_followers =====
--
-- Who follows this member. Always 'user' rows — a venue cannot follow anybody.
-- The JOIN to app_members is what makes the list length equal the count: same
-- table, same deleted_at predicate as social_follower_count().

CREATE OR REPLACE FUNCTION get_member_followers(
    p_app_id UUID,
    p_user_id UUID,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    target_type TEXT,
    target_id UUID,
    name TEXT,
    avatar_url TEXT,
    subtitle TEXT,
    followed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_app_id IS NULL OR p_user_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        'user'::TEXT,
        f.follower_user_id,
        COALESCE(am.display_name, am.first_name, 'Member')::TEXT,
        am.avatar_url::TEXT,
        NULL::TEXT AS subtitle,
        f.created_at
    FROM social_follows f
    JOIN app_members am
      ON am.user_id = f.follower_user_id
     AND am.app_id  = f.app_id
     AND am.deleted_at IS NULL
    WHERE f.app_id = p_app_id
      AND f.followee_user_id = p_user_id
    ORDER BY f.created_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 50), 0)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;


-- ===== 2. get_member_following =====
--
-- What this member follows: other members AND venues, in one ordered list.
--
-- The UNION ALL is over two branches that produce the identical column list, so
-- the client renders both from one template. Venue rows carry the venue's
-- category/city as the subtitle, which is the only place the two branches differ
-- in what they can say about themselves.
--
-- A venue that was deactivated or soft-deleted drops out of the list, matching
-- every other venue surface in the app (get_venues_for_map, get_venue_feed).

CREATE OR REPLACE FUNCTION get_member_following(
    p_app_id UUID,
    p_user_id UUID,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    target_type TEXT,
    target_id UUID,
    name TEXT,
    avatar_url TEXT,
    subtitle TEXT,
    followed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_app_id IS NULL OR p_user_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT * FROM (
        SELECT
            'user'::TEXT AS target_type,
            f.followee_user_id AS target_id,
            COALESCE(am.display_name, am.first_name, 'Member')::TEXT AS name,
            am.avatar_url::TEXT AS avatar_url,
            NULL::TEXT AS subtitle,
            f.created_at AS followed_at
        FROM social_follows f
        JOIN app_members am
          ON am.user_id = f.followee_user_id
         AND am.app_id  = f.app_id
         AND am.deleted_at IS NULL
        WHERE f.app_id = p_app_id
          AND f.follower_user_id = p_user_id
          AND f.followee_user_id IS NOT NULL

        UNION ALL

        SELECT
            'venue'::TEXT AS target_type,
            v.id AS target_id,
            v.name::TEXT AS name,
            v.profile_image_url::TEXT AS avatar_url,
            NULLIF(concat_ws(' · ', v.category, v.city), '')::TEXT AS subtitle,
            f.created_at AS followed_at
        FROM social_follows f
        JOIN venues v
          ON v.id = f.followee_venue_id
         AND v.app_id = f.app_id
         AND v.is_active = true
         AND v.deleted_at IS NULL
        WHERE f.app_id = p_app_id
          AND f.follower_user_id = p_user_id
          AND f.followee_venue_id IS NOT NULL
    ) edges
    ORDER BY edges.followed_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 50), 0)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;


-- ===== 3. discover_members =====
--
-- The "find people" mode of the people sheet. profile_public = true ONLY — see
-- the header for why this list is stricter than the other two.
--
-- Search matches display_name or first_name, case-insensitively, as a substring.
-- No trigram index and no full-text setup: this is a per-tenant member list, and
-- ViibeView's is small enough that the honest answer is a sequential scan rather
-- than an index that has to be maintained for a query nobody runs at volume yet.
-- If that changes, the seam is here and it is one CREATE INDEX.
--
-- An empty/absent query is a valid call and returns the newest members — the
-- sheet opens on something rather than on a blank box.

CREATE OR REPLACE FUNCTION discover_members(
    p_app_id UUID,
    p_query TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    target_type TEXT,
    target_id UUID,
    name TEXT,
    avatar_url TEXT,
    subtitle TEXT,
    followed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_query TEXT;
BEGIN
    IF p_app_id IS NULL THEN
        RETURN;
    END IF;

    v_query := NULLIF(btrim(COALESCE(p_query, '')), '');

    RETURN QUERY
    SELECT
        'user'::TEXT,
        am.user_id,
        COALESCE(am.display_name, am.first_name, 'Member')::TEXT,
        am.avatar_url::TEXT,
        NULL::TEXT AS subtitle,
        -- Not a follow timestamp here; the column is reused as "when this row
        -- became relevant" so one client template can sort every mode.
        am.joined_at
    FROM app_members am
    WHERE am.app_id = p_app_id
      AND am.user_id IS NOT NULL
      AND am.deleted_at IS NULL
      AND COALESCE(am.profile_public, false) = true
      AND (
            v_query IS NULL
         OR am.display_name ILIKE '%' || v_query || '%'
         OR am.first_name   ILIKE '%' || v_query || '%'
          )
    ORDER BY am.joined_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 50), 0)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;
