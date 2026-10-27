-- =============================================================================
-- ViibeView admin tools (Jay's board, 2026-10-27: "Admin Panel" — suspend a
-- member, an activity log). Plan: videos-are-not-reflective-quokka, Phase 3.
--
--   1. app_members.suspended_at / suspended_reason.
--   2. suspend_app_member(p_member_id, p_reason): org members of the member's
--      app. Stamps the member, sets their approved posts in THAT app to
--      status 'removed', and writes an audit_logs row whose new_data lists
--      exactly those post ids.
--      unsuspend_app_member(p_member_id): clears the stamp and puts back
--      exactly the posts the latest suspend entry lists (not one a reviewer
--      removed through the Reports queue meanwhile), and logs it.
--   3. create_social_post: re-created VERBATIM from 20260922000003, plus a
--      suspended check (a clear "suspended" answer, not "Join this app to
--      post") and `AND am.suspended_at IS NULL` in its member check.
--   4. Grants: REVOKE FROM PUBLIC *and* FROM anon (REVOKE ... FROM PUBLIC does
--      NOT restrict anon here), GRANT TO authenticated, asserted after.
--
-- No reader is touched: status = 'removed' already hides a post everywhere
-- (the five feed readers, the venue page, member pages, pins, shared links).
--
-- ⚠️ Members cannot clear their own suspension: app_members has NO member
-- UPDATE policy and `authenticated` holds UPDATE on (deleted_at, user_id)
-- only (20260904000007), an allow-list the two new columns are not on.
--
-- The venue "Delete forever" is the purge-venue edge function, not SQL: files
-- in storage can only be removed through the Storage API.
--
-- Rollback (in this order):
--   create_social_post: re-run section 5 of 20260922000003.
--   DROP FUNCTION unsuspend_app_member(UUID);
--   DROP FUNCTION suspend_app_member(UUID, TEXT);
--   UPDATE venue_media SET status = 'approved' WHERE id IN (the ids in the
--     open 'suspend' audit entries)  -- only if members are still suspended
--   ALTER TABLE app_members DROP COLUMN suspended_reason, DROP COLUMN suspended_at;
-- =============================================================================


-- ===== 1. The columns =====
-- No DEFAULT: NULL ("not suspended") is the truth about every existing row.

ALTER TABLE app_members ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE app_members ADD COLUMN IF NOT EXISTS suspended_reason TEXT;


-- ===== 2. Suspend / unsuspend =====

CREATE OR REPLACE FUNCTION suspend_app_member(
    p_member_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS TABLE (success BOOLEAN, error_message TEXT, posts_removed INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_member app_members%ROWTYPE;
    v_org_id UUID;
    v_reason TEXT := NULLIF(left(btrim(COALESCE(p_reason, '')), 500), '');
    v_post_ids UUID[];
    v_actor_email TEXT;
    v_actor_name TEXT;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false, 'You must be signed in'::TEXT, 0;
        RETURN;
    END IF;

    SELECT * INTO v_member
    FROM app_members am
    WHERE am.id = p_member_id
      AND am.deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'That member no longer exists'::TEXT, 0;
        RETURN;
    END IF;

    -- The same check review_content_report makes: an org member of the app.
    SELECT ca.organization_id INTO v_org_id
    FROM customer_apps ca
    WHERE ca.id = v_member.app_id;

    IF NOT EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = v_org_id
          AND om.user_id = v_user_id
    ) THEN
        RETURN QUERY SELECT false, 'Only the app team can suspend a member'::TEXT, 0;
        RETURN;
    END IF;

    -- A loyalty member with no account has no posts and cannot post.
    IF v_member.user_id IS NULL THEN
        RETURN QUERY SELECT false, 'This member has no account to suspend'::TEXT, 0;
        RETURN;
    END IF;

    IF v_member.user_id = v_user_id THEN
        RETURN QUERY SELECT false, 'You cannot suspend yourself'::TEXT, 0;
        RETURN;
    END IF;

    -- A team member posts through create_social_post's ORG arm: suspending
    -- their membership row would hide their posts and stop nothing.
    IF EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = v_org_id
          AND om.user_id = v_member.user_id
    ) THEN
        RETURN QUERY SELECT false, 'This person is on the app team. Remove them from the team first.'::TEXT, 0;
        RETURN;
    END IF;

    IF v_member.suspended_at IS NOT NULL THEN
        RETURN QUERY SELECT false, 'This member is already suspended'::TEXT, 0;
        RETURN;
    END IF;

    UPDATE app_members
    SET suspended_at = now(),
        suspended_reason = v_reason
    WHERE id = p_member_id;

    -- Their approved posts in THIS app. Posts already removed (a report) stay
    -- out of the list, so unsuspending can never put one of those back.
    WITH hidden AS (
        UPDATE venue_media vm
        SET status = 'removed'
        WHERE vm.app_id = v_member.app_id
          AND vm.uploaded_by_user_id = v_member.user_id
          AND vm.status = 'approved'
        RETURNING vm.id
    )
    SELECT COALESCE(array_agg(hidden.id), '{}'::UUID[]) INTO v_post_ids FROM hidden;

    SELECT COALESCE(p.email, u.email, ''),
           NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '')
    INTO v_actor_email, v_actor_name
    FROM auth.users u
    LEFT JOIN profiles p ON p.id = u.id
    WHERE u.id = v_user_id;

    INSERT INTO audit_logs (
        organization_id, user_id, user_email, user_name,
        entity_type, entity_id, entity_name, action,
        previous_data, new_data
    )
    VALUES (
        v_org_id, v_user_id, COALESCE(v_actor_email, ''), v_actor_name,
        'app_member', p_member_id,
        COALESCE(
            NULLIF(btrim(v_member.display_name), ''),
            NULLIF(btrim(concat_ws(' ', v_member.first_name, v_member.last_name)), ''),
            v_member.email
        ),
        'suspend',
        NULL,
        jsonb_build_object(
            'app_id', v_member.app_id,
            'reason', v_reason,
            'removed_post_ids', to_jsonb(v_post_ids)
        )
    );

    RETURN QUERY SELECT true, NULL::TEXT, COALESCE(array_length(v_post_ids, 1), 0);
END;
$$;


CREATE OR REPLACE FUNCTION unsuspend_app_member(
    p_member_id UUID
)
RETURNS TABLE (success BOOLEAN, error_message TEXT, posts_restored INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_member app_members%ROWTYPE;
    v_org_id UUID;
    v_listed JSONB;
    v_ids UUID[];
    v_restored UUID[];
    v_actor_email TEXT;
    v_actor_name TEXT;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false, 'You must be signed in'::TEXT, 0;
        RETURN;
    END IF;

    SELECT * INTO v_member
    FROM app_members am
    WHERE am.id = p_member_id
      AND am.deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'That member no longer exists'::TEXT, 0;
        RETURN;
    END IF;

    SELECT ca.organization_id INTO v_org_id
    FROM customer_apps ca
    WHERE ca.id = v_member.app_id;

    IF NOT EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = v_org_id
          AND om.user_id = v_user_id
    ) THEN
        RETURN QUERY SELECT false, 'Only the app team can unsuspend a member'::TEXT, 0;
        RETURN;
    END IF;

    IF v_member.suspended_at IS NULL THEN
        RETURN QUERY SELECT false, 'This member is not suspended'::TEXT, 0;
        RETURN;
    END IF;

    -- Exactly the posts the LATEST suspend entry removed.
    SELECT al.new_data -> 'removed_post_ids' INTO v_listed
    FROM audit_logs al
    WHERE al.organization_id = v_org_id
      AND al.entity_type = 'app_member'
      AND al.entity_id = p_member_id
      AND al.action = 'suspend'
    ORDER BY al.created_at DESC
    LIMIT 1;

    v_ids := ARRAY(
        SELECT jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(v_listed) = 'array' THEN v_listed ELSE '[]'::JSONB END
        )::UUID
    );

    UPDATE app_members
    SET suspended_at = NULL,
        suspended_reason = NULL
    WHERE id = p_member_id;

    -- Still theirs, still in this app, still removed — and not removed by a
    -- reviewer through the Reports queue while they were suspended.
    WITH back AS (
        UPDATE venue_media vm
        SET status = 'approved'
        WHERE vm.id = ANY (v_ids)
          AND vm.app_id = v_member.app_id
          AND vm.uploaded_by_user_id = v_member.user_id
          AND vm.status = 'removed'
          AND NOT EXISTS (
              SELECT 1 FROM content_reports cr
              WHERE cr.media_id = vm.id
                AND cr.status = 'removed'
          )
        RETURNING vm.id
    )
    SELECT COALESCE(array_agg(back.id), '{}'::UUID[]) INTO v_restored FROM back;

    SELECT COALESCE(p.email, u.email, ''),
           NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '')
    INTO v_actor_email, v_actor_name
    FROM auth.users u
    LEFT JOIN profiles p ON p.id = u.id
    WHERE u.id = v_user_id;

    INSERT INTO audit_logs (
        organization_id, user_id, user_email, user_name,
        entity_type, entity_id, entity_name, action,
        previous_data, new_data
    )
    VALUES (
        v_org_id, v_user_id, COALESCE(v_actor_email, ''), v_actor_name,
        'app_member', p_member_id,
        COALESCE(
            NULLIF(btrim(v_member.display_name), ''),
            NULLIF(btrim(concat_ws(' ', v_member.first_name, v_member.last_name)), ''),
            v_member.email
        ),
        'unsuspend',
        jsonb_build_object('suspended_at', v_member.suspended_at, 'reason', v_member.suspended_reason),
        jsonb_build_object('app_id', v_member.app_id, 'restored_post_ids', to_jsonb(v_restored))
    );

    RETURN QUERY SELECT true, NULL::TEXT, COALESCE(array_length(v_restored, 1), 0);
END;
$$;


-- ===== 3. create_social_post — verbatim from 20260922000003, plus the suspended check =====

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

    -- Suspended in this app (20261027000001): a clear answer, not the
    -- "Join this app to post" the member check below would give.
    IF EXISTS (
        SELECT 1 FROM app_members am
        WHERE am.app_id = p_app_id
          AND am.user_id = v_user_id
          AND am.deleted_at IS NULL
          AND am.suspended_at IS NOT NULL
    ) THEN
        RETURN QUERY SELECT false, NULL::UUID, 'Your account is suspended in this app'::TEXT;
        RETURN;
    END IF;

    -- Member of this app.
    SELECT EXISTS (
        SELECT 1 FROM app_members am
        WHERE am.app_id = p_app_id
          AND am.user_id = v_user_id
          AND am.deleted_at IS NULL
          AND am.suspended_at IS NULL
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


-- ===== 4. Grants =====
-- ⚠️ REVOKE ... FROM PUBLIC does NOT restrict anon in this project (Supabase
-- grants anon directly), hence the explicit FROM anon on every function.

REVOKE ALL ON FUNCTION suspend_app_member(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION suspend_app_member(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION suspend_app_member(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION unsuspend_app_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION unsuspend_app_member(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION unsuspend_app_member(UUID) TO authenticated;

REVOKE ALL ON FUNCTION create_social_post(UUID, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER, BIGINT, DECIMAL, DECIMAL) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_social_post(UUID, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER, BIGINT, DECIMAL, DECIMAL) FROM anon;
GRANT EXECUTE ON FUNCTION create_social_post(UUID, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER, BIGINT, DECIMAL, DECIMAL) TO authenticated;


-- ===== 5. Post-install assertions =====

DO $$
DECLARE
    v_fn TEXT;
    v_src TEXT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'app_members' AND column_name = 'suspended_at'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'app_members' AND column_name = 'suspended_reason'
    ) THEN
        RAISE EXCEPTION 'app_members.suspended_at / suspended_reason were not created';
    END IF;

    -- ⚠️ A non-owner's REVOKE only WARNS; check what actually holds.
    FOREACH v_fn IN ARRAY ARRAY[
        'public.suspend_app_member(uuid, text)',
        'public.unsuspend_app_member(uuid)',
        'public.create_social_post(uuid, text, text, uuid, text, text, integer, bigint, numeric, numeric)'
    ] LOOP
        IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
            RAISE EXCEPTION '%: anon can EXECUTE it', v_fn;
        END IF;
        IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
            RAISE EXCEPTION '%: authenticated CANNOT execute it', v_fn;
        END IF;
    END LOOP;

    -- The live create_social_post is the one with the suspended check.
    SELECT p.prosrc INTO v_src
    FROM pg_proc p
    WHERE p.oid = 'public.create_social_post(uuid, text, text, uuid, text, text, integer, bigint, numeric, numeric)'::regprocedure;
    IF position('am.suspended_at IS NOT NULL' IN v_src) = 0
       OR position('am.suspended_at IS NULL' IN v_src) = 0 THEN
        RAISE EXCEPTION 'create_social_post: the suspended checks are missing from the live body';
    END IF;

    -- Members still may not write the new columns themselves.
    IF has_column_privilege('authenticated', 'public.app_members', 'suspended_at', 'UPDATE')
       OR has_column_privilege('authenticated', 'public.app_members', 'suspended_reason', 'UPDATE') THEN
        RAISE EXCEPTION 'app_members: authenticated can UPDATE the suspension columns directly';
    END IF;

    -- audit_logs takes free-text entity_type / action ('app_member', 'suspend').
    -- A CHECK constraint added outside the migrations could refuse them, and
    -- that would only surface when someone presses Suspend. Stop here instead.
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.audit_logs'::regclass AND contype = 'c'
    ) THEN
        RAISE EXCEPTION 'audit_logs has CHECK constraints: confirm app_member / suspend pass them before applying';
    END IF;
END $$;
