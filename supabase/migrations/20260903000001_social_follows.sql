-- ViibeView Phase 2, part 1: the follow graph.
--
-- Why one polymorphic table
-- -------------------------
-- Two things get followed: other members, and venues. social.html:259 has
-- promised "follow venues" since the auth overlay shipped, and nothing behind
-- it was ever built. Two tables would mean two RLS policies, two write RPCs and
-- a UNION in every list query; one table with two nullable FKs and a
-- num_nonnulls CHECK costs one extra column and keeps the Following feed a
-- single scan.
--
-- Why the follower keys on auth.users, not app_members
-- ----------------------------------------------------
--   * The hot query needs no join. venue_media.uploaded_by_user_id is already an
--     auth user id, so the Following feed is a plain IN (SELECT ...).
--   * The client already holds the id — get_venue_feed returns
--     uploaded_by_user_id today, so linking an author to a profile costs nothing.
--   * Deletion is correct for free. delete-social-account deletes the auth.users
--     row and both FKs cascade in one statement. app_members is only ever
--     SOFT-deleted, so keying there would leave ghost edges needing a sweep in
--     two places, one of them a separate Deno deploy.
--   * auth.uid() is authoritative everywhere else here, so a write cannot name a
--     follower other than the caller.
--   * The venue branch cannot key on app_members anyway, so it is two nullable
--     FKs either way.
--
-- The one real cost: no FK can enforce "the follower is a member of app_id".
-- idx_app_members_app_user is PARTIAL and Postgres will not accept a partial
-- index as an FK target. follow_target() validates membership in the body
-- instead — the same posture create_social_post already takes (20260828000002).
--
-- ⚠️ No counter columns anywhere. venues.media_count is the local precedent for
-- how that goes wrong (it needed the whole of 20260822000001 to reconcile), and
-- more decisively: a follower LIST must exclude soft-deleted members, so the
-- COUNT has to use the identical predicate or the profile reads "12 followers"
-- over a list of 9. A stored integer cannot express that. See
-- social_follower_count() below — one definition, used by the count and by the
-- list, so they cannot drift.
--
-- Touches: creates social_follows (+ 5 indexes, RLS, 1 policy), creates
-- social_follower_count / follow_target / unfollow_target, and REPLACES
-- delete_social_member_data to clear the caller's edges. No existing table is
-- altered.
--
-- Rollback
-- --------
--   -- restore delete_social_member_data from 20260821000002 (lines 224-275) first,
--   -- or the DROP below fails on the dependency.
--   DROP FUNCTION IF EXISTS unfollow_target(UUID, TEXT, UUID);
--   DROP FUNCTION IF EXISTS follow_target(UUID, TEXT, UUID);
--   DROP FUNCTION IF EXISTS social_follower_count(UUID, TEXT, UUID);
--   DROP TABLE IF EXISTS social_follows;   -- takes its indexes and policy with it


-- ===== 1. The table =====

CREATE TABLE IF NOT EXISTS social_follows (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id            UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,
    follower_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    followee_user_id  UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    followee_venue_id UUID REFERENCES venues(id)     ON DELETE CASCADE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Exactly one target. Both null is a row that means nothing; both set is a
    -- row two different queries would each claim.
    CONSTRAINT social_follows_one_target
        CHECK (num_nonnulls(followee_user_id, followee_venue_id) = 1),

    -- Following yourself would put your own posts in your Following feed and
    -- add one to your own follower count.
    CONSTRAINT social_follows_no_self
        CHECK (followee_user_id IS NULL OR followee_user_id <> follower_user_id)
);

COMMENT ON TABLE social_follows IS
    'ViibeView follow edges. Exactly one of followee_user_id / followee_venue_id is set. Written only through follow_target()/unfollow_target(); there is deliberately no client INSERT or DELETE policy.';


-- ===== 2. Indexes =====
--
-- Two partial uniques (one per target kind — a single unique over both columns
-- would not dedupe, because NULL <> NULL), then the three access paths:
-- "who follows X", "who follows this venue", "what does X follow".

CREATE UNIQUE INDEX IF NOT EXISTS social_follows_user_once
    ON social_follows(app_id, follower_user_id, followee_user_id)
    WHERE followee_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS social_follows_venue_once
    ON social_follows(app_id, follower_user_id, followee_venue_id)
    WHERE followee_venue_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_social_follows_followee_user
    ON social_follows(app_id, followee_user_id, created_at DESC)
    WHERE followee_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_social_follows_followee_venue
    ON social_follows(app_id, followee_venue_id)
    WHERE followee_venue_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_social_follows_follower
    ON social_follows(app_id, follower_user_id, created_at DESC);


-- ===== 3. RLS =====
--
-- SELECT own rows only, and NO write policies at all — the content_reports
-- posture (20260828000004:52-71). The writers are the two SECURITY DEFINER
-- functions below, which bypass RLS; a client INSERT policy would let anyone
-- forge edges at scale and would also make the unique index an existence oracle
-- for user ids (a duplicate returns a distinguishable 23505).
--
-- Keeping the own-rows SELECT is deliberate and load-bearing: the client reads
-- its OWN follow state with a plain .select(), which is why get_venue_detail
-- needs no is_following column and is not touched by this release.

ALTER TABLE social_follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read their own follows" ON social_follows;
CREATE POLICY "Members can read their own follows"
ON social_follows FOR SELECT
TO authenticated
USING (follower_user_id = auth.uid());


-- ===== 4. social_follower_count =====
--
-- ⚠️ ONE definition of "who counts as a follower", shared by the count and by
-- get_member_followers (20260903000003). The predicate is
-- `app_members.deleted_at IS NULL`, so a member who deleted their account stops
-- being counted at the same instant they stop being listed. Split these two and
-- the profile shows a number that does not match the list under it.
--
-- Consequence, stated rather than hidden: an org owner who follows a member but
-- has no app_members row of their own is not counted and not listed. They are
-- not a member of the community the number describes.
--
-- STABLE, not VOLATILE: read-only, so it can be inlined in a SELECT list.
--
-- NO grant footer, deliberately. It returns an integer and nothing else, the
-- profile that displays it is anon-readable (20260903000002), and the follow
-- buttons need the number before the visitor has an account. Adding a footer
-- would blank the counts for signed-out visitors, silently.

CREATE OR REPLACE FUNCTION social_follower_count(
    p_app_id UUID,
    p_target_type TEXT,
    p_target_id UUID
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COUNT(*)::INTEGER
    FROM social_follows f
    JOIN app_members am
      ON am.user_id = f.follower_user_id
     AND am.app_id  = f.app_id
     AND am.deleted_at IS NULL
    WHERE f.app_id = p_app_id
      AND (
            (p_target_type = 'user'  AND f.followee_user_id  = p_target_id)
         OR (p_target_type = 'venue' AND f.followee_venue_id = p_target_id)
          );
$$;


-- ===== 5. follow_target =====
--
-- Family A: returns a STATUS ROW and never RAISEs. A SECURITY DEFINER function
-- that returns success:false does NOT set PostgREST's `error` field
-- (20260828000002:29-32), so the client checks data[0].success. Raising instead
-- would surface as a 400 the client cannot tell apart from a network fault.
--
-- `following` is the resulting state, not what changed, so the button can be
-- painted straight from it — including on the double-tap path where the row
-- already existed and ON CONFLICT did nothing.

CREATE OR REPLACE FUNCTION follow_target(
    p_app_id UUID,
    p_target_type TEXT,
    p_target_id UUID
)
RETURNS TABLE (
    success BOOLEAN,
    following BOOLEAN,
    follower_count INTEGER,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_org_id UUID;
    v_is_member BOOLEAN;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false, false, 0, 'You must be signed in to follow'::TEXT;
        RETURN;
    END IF;

    -- COALESCE, not a bare NOT IN: `NULL NOT IN (...)` evaluates to NULL, which
    -- is not true, so a null target type would fall straight through this guard.
    IF COALESCE(p_target_type, '') NOT IN ('user', 'venue') OR p_target_id IS NULL THEN
        RETURN QUERY SELECT false, false, 0, 'Nothing to follow'::TEXT;
        RETURN;
    END IF;

    IF p_target_type = 'user' AND p_target_id = v_user_id THEN
        RETURN QUERY SELECT false, false, 0, 'You cannot follow yourself'::TEXT;
        RETURN;
    END IF;

    -- The app must be live, same gate create_social_post applies.
    SELECT organization_id INTO v_org_id
    FROM customer_apps
    WHERE id = p_app_id
      AND is_published = true
      AND is_active = true
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, false, 0, 'App not found or not published'::TEXT;
        RETURN;
    END IF;

    -- Membership of THIS app, or of the org that owns it. No FK can express
    -- this (see the header), so it is checked here.
    SELECT EXISTS (
        SELECT 1 FROM app_members am
        WHERE am.app_id = p_app_id
          AND am.user_id = v_user_id
          AND am.deleted_at IS NULL
    ) OR EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = v_org_id
          AND om.user_id = v_user_id
    ) INTO v_is_member;

    IF NOT v_is_member THEN
        RETURN QUERY SELECT false, false, 0, 'Join this app to follow'::TEXT;
        RETURN;
    END IF;

    -- The target is re-validated against p_app_id, so a member of one tenant
    -- cannot build a follow edge into another tenant's member or venue.
    IF p_target_type = 'user' THEN
        PERFORM 1 FROM app_members am
        WHERE am.app_id = p_app_id
          AND am.user_id = p_target_id
          AND am.deleted_at IS NULL;

        IF NOT FOUND THEN
            RETURN QUERY SELECT false, false, 0, 'That member is not part of this app'::TEXT;
            RETURN;
        END IF;

        INSERT INTO social_follows (app_id, follower_user_id, followee_user_id)
        VALUES (p_app_id, v_user_id, p_target_id)
        ON CONFLICT DO NOTHING;
    ELSE
        PERFORM 1 FROM venues v
        WHERE v.id = p_target_id
          AND v.app_id = p_app_id
          AND v.is_active = true
          AND v.deleted_at IS NULL;

        IF NOT FOUND THEN
            RETURN QUERY SELECT false, false, 0, 'That venue is not part of this app'::TEXT;
            RETURN;
        END IF;

        INSERT INTO social_follows (app_id, follower_user_id, followee_venue_id)
        VALUES (p_app_id, v_user_id, p_target_id)
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN QUERY SELECT
        true,
        true,
        social_follower_count(p_app_id, p_target_type, p_target_id),
        NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION follow_target(UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION follow_target(UUID, TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION follow_target(UUID, TEXT, UUID) TO authenticated;


-- ===== 6. unfollow_target =====
--
-- Deleting a row that is not there is a success: the caller asked to not be
-- following, and they are not. Reporting an error on a double-tap would leave
-- the button lit over a state that is already correct.

CREATE OR REPLACE FUNCTION unfollow_target(
    p_app_id UUID,
    p_target_type TEXT,
    p_target_id UUID
)
RETURNS TABLE (
    success BOOLEAN,
    following BOOLEAN,
    follower_count INTEGER,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false, false, 0, 'You must be signed in'::TEXT;
        RETURN;
    END IF;

    IF COALESCE(p_target_type, '') NOT IN ('user', 'venue') OR p_target_id IS NULL THEN
        RETURN QUERY SELECT false, false, 0, 'Nothing to unfollow'::TEXT;
        RETURN;
    END IF;

    DELETE FROM social_follows f
    WHERE f.app_id = p_app_id
      AND f.follower_user_id = v_user_id
      AND (
            (p_target_type = 'user'  AND f.followee_user_id  = p_target_id)
         OR (p_target_type = 'venue' AND f.followee_venue_id = p_target_id)
          );

    RETURN QUERY SELECT
        true,
        false,
        social_follower_count(p_app_id, p_target_type, p_target_id),
        NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION unfollow_target(UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION unfollow_target(UUID, TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION unfollow_target(UUID, TEXT, UUID) TO authenticated;


-- ===== 7. Account deletion clears the graph =====
--
-- ⚠️ The DELETE must come BEFORE `UPDATE app_members SET ... user_id = NULL`.
-- After that line the function has released its only handle on the auth user
-- and cannot find the edges any more.
--
-- The FKs would catch this eventually — delete-social-account deletes the
-- auth.users row next and both cascade. But the two halves are separate calls
-- across a network, and the RPC half succeeding while the edge function half
-- fails is a state this codebase has already shipped once (social-auth.js:395
-- exists precisely for it). Cleaning up here means a half-failed deletion leaves
-- no follow edges pointing at a member who no longer appears anywhere.
--
-- Signature is unchanged, so CREATE OR REPLACE preserves the grants
-- 20260903000000 just corrected. Body is otherwise byte-identical to
-- 20260821000002:224-272.

CREATE OR REPLACE FUNCTION delete_social_member_data(p_app_id UUID)
RETURNS TABLE (success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_member RECORD;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false, 'Not authenticated'::TEXT;
        RETURN;
    END IF;

    SELECT * INTO v_member
    FROM app_members
    WHERE app_id = p_app_id AND user_id = v_user_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        -- Nothing to remove is a success, not an error — keeps the edge
        -- function's delete flow idempotent on retry.
        RETURN QUERY SELECT true, NULL::TEXT;
        RETURN;
    END IF;

    -- Both directions, across every app: the account is going away entirely,
    -- not just its membership of this one.
    DELETE FROM social_follows
    WHERE follower_user_id = v_user_id
       OR followee_user_id = v_user_id;

    UPDATE app_members
    SET deleted_at = NOW(),
        user_id = NULL,      -- release the unique (app_id, user_id) slot
        email = NULL,
        phone = NULL,
        first_name = NULL,
        last_name = NULL,
        display_name = NULL,
        avatar_url = NULL,
        pin_hash = NULL,
        auth_token = NULL
    WHERE id = v_member.id;

    IF v_member.customer_id IS NOT NULL THEN
        UPDATE customers
        SET deleted_at = NOW()
        WHERE id = v_member.customer_id;
    END IF;

    RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;
