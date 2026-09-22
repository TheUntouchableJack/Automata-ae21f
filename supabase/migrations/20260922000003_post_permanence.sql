-- venue_media.is_permanent — "this post never expires", stamped at WRITE time.
--
-- Why
-- ---
-- Post lifetime today is backwards from the intent. Posts expire from the HOME
-- FEED only, via a setting that defaults to never, and live on venue pages and
-- the map forever. What Jay asked for is the reverse:
--
--   - posts from the venue's own team are permanent EVERYWHERE
--   - member posts age out of every public surface
--   - everyone keeps their own posts on their own profile, forever
--
-- This migration ships only the column, the backfill and the writer. NOTHING
-- READS IT YET — the four read functions change in 20260922000004. Split so
-- that if the predicate turns out to be wrong, the rollback is one file and
-- not a column with a half-finished backfill behind it.
--
-- ⚠️ WHY A BOOLEAN AND NOT expires_at OR author_role
--
-- `expires_at` would freeze each post's TTL at the moment it was written, so
-- changing the setting from 24h to 48h would not reach a single existing post.
-- The setting is meant to be configurable, and configurable means retroactive.
--
-- `author_role` invites the thing this column exists to prevent: answering
-- "is this an owner post?" by joining organization_members at READ time. Do
-- that and the day someone leaves the org, every post they ever made starts
-- expiring — retroactively, silently, across every surface.
--
-- `is_permanent` names the POLICY, not the actor. That is the abstraction that
-- survives per-venue owners: create_social_post widens the condition that sets
-- it, and rows already written keep their correct historical answer.
--
-- ⚠️ TWO BACKFILLS, BOTH REQUIRED. Either one alone is wrong.
--
-- Rollback
-- --------
-- Re-run create_social_post from 20260828000002:46-160 (it is CREATE OR
-- REPLACE, signature unchanged, so no DROP is needed), then
-- ALTER TABLE venue_media DROP COLUMN is_permanent;
-- and DROP INDEX idx_venue_media_venue_created.
-- Do this only if 20260922000004 has already been rolled back — the readers
-- reference the column.


-- ===== 1. The column =====
--
-- NOT NULL DEFAULT false: every existing row gets `false` written into its
-- missing-value slot, which is retroactively true of nothing — hence the two
-- backfills immediately below, which are what actually make the historical
-- answer correct. Adding it with a default and then fixing it is the only
-- order available; DEFAULT true would make every member post permanent for
-- however long the backfill takes.

ALTER TABLE venue_media
    ADD COLUMN IF NOT EXISTS is_permanent BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN venue_media.is_permanent IS
    'true = this post never expires from any public surface. Stamped by '
    'create_social_post at write time from the author''s org membership, and '
    'never recomputed — a person leaving the org must not retroactively expire '
    'their past posts. Read by the four feed RPCs; see 20260922000004.';


-- ===== 2. Backfill A — posts by someone who is TODAY an org member =====
--
-- "Today" is the only answer available: there is no history of who was in the
-- org when. Anyone currently in the org that owns the app is treated as having
-- posted as the team. That is the same rule create_social_post applies going
-- forward, so the column is consistent across the boundary.

UPDATE venue_media vm
SET is_permanent = true
FROM customer_apps ca
JOIN organization_members om ON om.organization_id = ca.organization_id
WHERE vm.app_id = ca.id
  AND vm.uploaded_by_user_id IS NOT NULL
  AND om.user_id = vm.uploaded_by_user_id
  AND vm.is_permanent = false;


-- ===== 3. Backfill B — every row with a NULL author =====
--
-- ⚠️ WITHOUT THIS, DEPLOY DAY EXPIRES EVERY SEEDED ROW IN THE TENANT.
--
-- Every row predating 20260828000001 has uploaded_by_user_id = NULL: the column
-- had never been written, and that migration states at :81-84 that no backfill
-- is possible because nobody can prove authorship of them. Backfill A cannot
-- reach them — it joins on the author id. So they would keep is_permanent =
-- false, and the moment 20260922000004 lands with a 24h TTL they vanish from
-- the feed, the venue page and the map at once.
--
-- Treating an unattributable post as permanent is the recoverable direction:
-- the failure mode is "an old seeded clip stays up", not "the app is empty".

UPDATE venue_media
SET is_permanent = true
WHERE uploaded_by_user_id IS NULL
  AND is_permanent = false;


-- ===== 4. The index both the grid and the new predicate want =====
--
-- (venue_id, created_at DESC) WHERE status = 'approved' is exactly the access
-- pattern of get_venue_page_feed — one venue, newest first, approved only —
-- and the schema has never had it. The venue reels grid in Phase 4 makes that
-- query hotter, and the TTL predicate adds a created_at comparison on top of
-- an ordering that is already by created_at.
--
-- Partial on status: 'approved' is the only status any read path asks for, so
-- the index stays smaller than the table and does not carry rows nothing reads.

CREATE INDEX IF NOT EXISTS idx_venue_media_venue_created
    ON venue_media (venue_id, created_at DESC)
    WHERE status = 'approved';


-- ===== 5. create_social_post — write the column =====
--
-- The function already computes the owner/member distinction; it just collapses
-- both arms into one v_is_member boolean and throws the distinction away. Split
-- into v_is_app_member and v_is_org_member, keep v_is_member as their OR so the
-- authorization check is byte-for-byte the decision it was, and use the org arm
-- for is_permanent.
--
-- ⚠️ DO NOT derive this from the storage-path prefix (social.js builds
-- `members/…` vs a venue path). It degrades silently: an org member posting
-- with no venue selected falls to the members/ path and would lose permanence.
--
-- Signature unchanged, so CREATE OR REPLACE preserves the grants. The footer in
-- section 6 is re-issued anyway, per this repo's convention — it costs one
-- idempotent statement and removes the need to remember which way it went.

CREATE OR REPLACE FUNCTION create_social_post(
    p_app_id UUID,
    p_storage_path TEXT,
    p_url TEXT,
    p_venue_id UUID DEFAULT NULL,
    p_caption TEXT DEFAULT NULL,
    p_thumbnail_url TEXT DEFAULT NULL,
    p_duration_seconds INTEGER DEFAULT NULL,
    p_file_size_bytes BIGINT DEFAULT NULL,
    p_latitude DECIMAL DEFAULT NULL,
    p_longitude DECIMAL DEFAULT NULL
)
RETURNS TABLE (success BOOLEAN, media_id UUID, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_org_id UUID;
    v_is_app_member BOOLEAN;
    v_is_org_member BOOLEAN;
    v_is_member BOOLEAN;
    v_media_id UUID;
    v_allowed BOOLEAN;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false, NULL::UUID, 'You must be signed in to post'::TEXT;
        RETURN;
    END IF;

    IF p_storage_path IS NULL OR btrim(p_storage_path) = ''
       OR p_url IS NULL OR btrim(p_url) = '' THEN
        RETURN QUERY SELECT false, NULL::UUID, 'Upload did not complete'::TEXT;
        RETURN;
    END IF;

    -- App must be live. The public read policies require is_published, so a
    -- post into an unpublished app would be invisible the moment it landed.
    SELECT organization_id INTO v_org_id
    FROM customer_apps
    WHERE id = p_app_id
      AND is_published = true
      AND is_active = true
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, 'App not found or not published'::TEXT;
        RETURN;
    END IF;

    -- Member of this app.
    SELECT EXISTS (
        SELECT 1 FROM app_members am
        WHERE am.app_id = p_app_id
          AND am.user_id = v_user_id
          AND am.deleted_at IS NULL
    ) INTO v_is_app_member;

    -- ...or a member of the org that owns it. Split out from the OR above
    -- because this arm is now load-bearing twice: it authorizes the post AND it
    -- decides permanence.
    --
    -- ⚠️ "Owner" here is ORG-WIDE, not per-venue. Ownership is not modelled per
    -- venue anywhere in this schema — any organization_members row makes you an
    -- owner of every venue in the org. So a bartender, a contractor or a former
    -- intern with a row here gets permanent posts at every venue. That is the
    -- deliberate trade against retroactive expiry, and it is why this is
    -- stamped once rather than recomputed.
    SELECT EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = v_org_id
          AND om.user_id = v_user_id
    ) INTO v_is_org_member;

    v_is_member := v_is_app_member OR v_is_org_member;

    IF NOT v_is_member THEN
        RETURN QUERY SELECT false, NULL::UUID, 'Join this app to post'::TEXT;
        RETURN;
    END IF;

    -- A venue, when named, must be one of THIS app's. Without this check a
    -- member could attach their clip to any venue in any tenant.
    IF p_venue_id IS NOT NULL THEN
        PERFORM 1 FROM venues v
        WHERE v.id = p_venue_id
          AND v.app_id = p_app_id
          AND v.deleted_at IS NULL;

        IF NOT FOUND THEN
            RETURN QUERY SELECT false, NULL::UUID, 'That venue is not part of this app'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- 10 posts/hour/user. Same helper contact-inquiry uses.
    BEGIN
        SELECT check_and_record_rate_limit(
            'social_post_' || v_user_id::TEXT, 'social_post', 10, 60
        ) INTO v_allowed;
    EXCEPTION WHEN OTHERS THEN
        -- The limiter is anti-abuse, not authorization. If it is unavailable,
        -- log and let the post through rather than blocking every member.
        RAISE WARNING 'Rate limit check failed for social_post: %', SQLERRM;
        v_allowed := true;
    END;

    IF v_allowed = false THEN
        RETURN QUERY SELECT false, NULL::UUID,
            'You have posted a lot in the last hour. Try again shortly.'::TEXT;
        RETURN;
    END IF;

    INSERT INTO venue_media (
        venue_id, app_id, uploaded_by_user_id,
        media_type, storage_path, url, thumbnail_url,
        caption, duration_seconds, file_size_bytes,
        latitude, longitude, status,
        is_permanent
    )
    VALUES (
        p_venue_id, p_app_id, v_user_id,
        'video', p_storage_path, p_url, p_thumbnail_url,
        NULLIF(left(btrim(COALESCE(p_caption, '')), 500), ''),
        p_duration_seconds, p_file_size_bytes,
        p_latitude, p_longitude, 'approved',
        v_is_org_member
    )
    RETURNING id INTO v_media_id;

    RETURN QUERY SELECT true, v_media_id, NULL::TEXT;
END;
$$;


-- ===== 6. Grants — re-issued, not changed =====
--
-- CREATE OR REPLACE on an unchanged signature keeps the existing grants, so
-- this is a no-op restatement of 20260828000002:244-245. Stated anyway: the
-- cost is nothing and it removes "did the replace keep them?" as a question.

REVOKE ALL ON FUNCTION create_social_post(UUID, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER, BIGINT, DECIMAL, DECIMAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_social_post(UUID, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER, BIGINT, DECIMAL, DECIMAL) TO authenticated;


-- ===== 7. Post-install assertions =====

DO $$
DECLARE
    v_orphans BIGINT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'venue_media'
          AND column_name = 'is_permanent'
    ) THEN
        RAISE EXCEPTION 'venue_media.is_permanent was not created';
    END IF;

    -- Backfill B, asserted directly. If a single NULL-author row is still
    -- non-permanent, 20260922000004 will expire a post nobody can attribute
    -- and nobody can restore.
    SELECT COUNT(*) INTO v_orphans
    FROM venue_media
    WHERE uploaded_by_user_id IS NULL
      AND is_permanent = false;

    IF v_orphans > 0 THEN
        RAISE EXCEPTION
            'Backfill B missed % pre-authorship row(s) — they would expire on the day 20260922000004 lands', v_orphans;
    END IF;

    -- create_social_post must still be callable by a signed-in member and by
    -- nobody else. Both directions, because both fail silently.
    IF NOT has_function_privilege('authenticated',
            'public.create_social_post(uuid,text,text,uuid,text,text,integer,bigint,numeric,numeric)', 'EXECUTE') THEN
        RAISE EXCEPTION 'create_social_post lost its authenticated grant in the REPLACE';
    END IF;

    IF has_function_privilege('anon',
            'public.create_social_post(uuid,text,text,uuid,text,text,integer,bigint,numeric,numeric)', 'EXECUTE') THEN
        RAISE EXCEPTION 'create_social_post is EXECUTEable by anon — it must not be';
    END IF;
END $$;
