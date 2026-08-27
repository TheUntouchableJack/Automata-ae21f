-- The member write path for ViibeView posts.
--
-- Why an RPC and not RLS
-- ----------------------
-- A ViibeView member has a `profiles` row and no organization
-- (20260821000004). Letting them INSERT into venue_media under RLS would mean
-- either granting members org-shaped rights on venue_media, or making `venues`
-- writable by them so the old getOrCreateDefaultVenue() path keeps working.
-- Both widen the blast radius far past "post a 15-second clip". One narrow
-- SECURITY DEFINER function that validates every field itself is the smaller
-- surface: the client cannot choose the author, the status, or the app.
--
-- Rules enforced here, none of them trustable from the client:
--   * auth.uid() must be non-null.
--   * The app must be published, active and not soft-deleted.
--   * The caller must be an app_members row for that app, OR an
--     organization_members row for the app's organization (owners keep
--     posting through the same path).
--   * p_venue_id, when given, must belong to p_app_id — otherwise a member of
--     one app could post into another app's venue.
--   * uploaded_by_user_id comes from auth.uid(), never from an argument.
--   * status is hardcoded 'approved' (Jay's decision: live instantly,
--     reporting is the safety valve, not pre-moderation).
--   * Rate limited to 10 posts/hour per user. Members posting 50 MB videos is
--     a real cost surface that the owner-only gate was hiding; this call is
--     the only thing standing in front of it.
--
-- Both functions return a status ROW rather than raising. A SECURITY DEFINER
-- function that returns success:false does NOT set PostgREST's `error` field —
-- callers must check data[0].success or they will show "Posted!" over a
-- rejected post.
--
-- Touches: creates create_social_post + delete_social_post, and adds two
-- member-scoped storage policies. No table is altered here.
--
-- Rollback
-- --------
--   DROP POLICY "Members can delete their own venue media" ON storage.objects;
--   DROP POLICY "Members can upload their own venue media" ON storage.objects;
--   DROP FUNCTION IF EXISTS delete_social_post(UUID);
--   DROP FUNCTION IF EXISTS create_social_post(UUID, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER, BIGINT, DECIMAL, DECIMAL);


-- ===== 1. Create a post =====

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

    -- Member of this app, or a member of the org that owns it.
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
        latitude, longitude, status
    )
    VALUES (
        p_venue_id, p_app_id, v_user_id,
        'video', p_storage_path, p_url, p_thumbnail_url,
        NULLIF(left(btrim(COALESCE(p_caption, '')), 500), ''),
        p_duration_seconds, p_file_size_bytes,
        p_latitude, p_longitude, 'approved'
    )
    RETURNING id INTO v_media_id;

    RETURN QUERY SELECT true, v_media_id, NULL::TEXT;
END;
$$;


-- ===== 2. Delete a post =====
--
-- The storage object goes in the same transaction as the row. Doing the two
-- halves as separate client round trips can half-fail and orphan a 50 MB file
-- that nothing in the UI will ever show again.

CREATE OR REPLACE FUNCTION delete_social_post(p_media_id UUID)
RETURNS TABLE (success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_media RECORD;
    v_authorized BOOLEAN;
    v_thumb_path TEXT;
    v_marker TEXT := '/storage/v1/object/public/venue-media/';
BEGIN
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false, 'You must be signed in'::TEXT;
        RETURN;
    END IF;

    SELECT vm.id, vm.app_id, vm.storage_path, vm.thumbnail_url, vm.uploaded_by_user_id
    INTO v_media
    FROM venue_media vm
    WHERE vm.id = p_media_id;

    IF NOT FOUND THEN
        -- Already gone. Report success so a double-tap does not surface an
        -- error over a post that is genuinely deleted.
        RETURN QUERY SELECT true, NULL::TEXT;
        RETURN;
    END IF;

    -- The author, or an org member of the app that owns the post.
    v_authorized := (v_media.uploaded_by_user_id = v_user_id) OR EXISTS (
        SELECT 1
        FROM customer_apps ca
        JOIN organization_members om ON om.organization_id = ca.organization_id
        WHERE ca.id = v_media.app_id
          AND om.user_id = v_user_id
    );

    IF NOT v_authorized THEN
        RETURN QUERY SELECT false, 'You can only delete your own posts'::TEXT;
        RETURN;
    END IF;

    DELETE FROM venue_media WHERE id = p_media_id;

    -- The clip itself.
    IF v_media.storage_path IS NOT NULL AND v_media.storage_path <> '' THEN
        DELETE FROM storage.objects
        WHERE bucket_id = 'venue-media'
          AND name = v_media.storage_path;
    END IF;

    -- The generated poster frame. Its path is not stored in a column, so it is
    -- recovered from the public URL. Only ever deletes inside this bucket.
    IF v_media.thumbnail_url IS NOT NULL AND position(v_marker IN v_media.thumbnail_url) > 0 THEN
        v_thumb_path := split_part(v_media.thumbnail_url, v_marker, 2);
        IF v_thumb_path <> '' THEN
            DELETE FROM storage.objects
            WHERE bucket_id = 'venue-media'
              AND name = v_thumb_path;
        END IF;
    END IF;

    RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;


-- ===== 3. Grants =====
--
-- Matches social_member_signup's footer (20260821000002:176-177). Both of
-- these require a signed-in caller, so PUBLIC has no business executing them.
REVOKE ALL ON FUNCTION create_social_post(UUID, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER, BIGINT, DECIMAL, DECIMAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_social_post(UUID, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER, BIGINT, DECIMAL, DECIMAL) TO authenticated;

REVOKE ALL ON FUNCTION delete_social_post(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_social_post(UUID) TO authenticated;


-- ===== 4. Storage: a member-scoped prefix =====
--
-- Members still cannot use the owner path: "Users can upload venue media for
-- their org" (20260225000001) requires an organization id in folder 1, and a
-- member belongs to no organization. Give them their own prefix instead of
-- loosening the owner policy.
--
--   owners:  {orgId}/{venueId}/{ts}-{file}     — unchanged, untouched
--   members: members/{uid}/{ts}-{file}
--
-- The bucket's mime allowlist already includes image/jpeg, so the generated
-- thumbnails need no bucket change.

DROP POLICY IF EXISTS "Members can upload their own venue media" ON storage.objects;
CREATE POLICY "Members can upload their own venue media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'venue-media'
    AND (storage.foldername(name))[1] = 'members'
    AND (storage.foldername(name))[2] = auth.uid()::text
);

-- delete_social_post owns the normal delete path, but it should not depend on
-- the definer role happening to bypass RLS on storage.objects. This policy is
-- scoped to the caller's own prefix, so it can never reach another member's
-- upload or an owner's {orgId}/ path.
DROP POLICY IF EXISTS "Members can delete their own venue media" ON storage.objects;
CREATE POLICY "Members can delete their own venue media"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'venue-media'
    AND (storage.foldername(name))[1] = 'members'
    AND (storage.foldername(name))[2] = auth.uid()::text
);
