-- delete_social_post, without the storage deletes.
--
-- Why
-- ---
-- Deleting a post has been failing for everyone with a 403. The function
-- (20260828000002:170-245) deleted the venue_media row and then ran
--
--     DELETE FROM storage.objects WHERE bucket_id = 'venue-media' AND name = …
--
-- for the clip and the poster frame. Supabase now refuses a direct DELETE on
-- storage tables (42501, "Direct deletion from storage tables is not allowed.
-- Use the Storage API instead.") — at statement level, inside the definer
-- function. The exception rolls back the whole call, including the row
-- delete before it, so NOTHING has been deleted since that change.
--
-- After this file
-- ---------------
--   * This function deletes the ROW only. Applying this file alone fixes the
--     live bug; the files are simply left behind in the bucket.
--   * The edge function delete-social-post removes the files through the
--     Storage API with the service role, AFTER this function has authorized
--     and deleted the row with the caller's own JWT. Authorization stays here.
--   * Authorization widens by one arm: the owner of the post's venue
--     (venue_owners, 20261006000001) may delete any post at that venue.
--
--   * ⚠️ A latent hole closes: the old check was `IF NOT v_authorized`, and for
--     a post with a NULL author (seeded rows, flyers) a non-member's
--     `NULL = uid OR false` is NULL, `NOT NULL` is NULL, and the IF never
--     fired — any signed-in account could delete it. It only stayed
--     unexploited because the storage statement then rolled the call back.
--     COALESCE(v_authorized, false) makes NULL mean "no".
--
-- Same signature, same return type — CREATE OR REPLACE, no outage window.
--
-- ⚠️ The body must not mention the storage tables at all, not even in a
-- comment: the install check below reads the function's source and treats any
-- mention as the statement coming back.
--
-- Rollback
-- --------
-- Re-running 20260828000002's version restores the bug. Prefer leaving this.


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
BEGIN
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false, 'You must be signed in'::TEXT;
        RETURN;
    END IF;

    SELECT vm.id, vm.app_id, vm.venue_id, vm.uploaded_by_user_id
    INTO v_media
    FROM venue_media vm
    WHERE vm.id = p_media_id;

    IF NOT FOUND THEN
        -- Already gone. Report success so a double-tap does not surface an
        -- error over a post that is genuinely deleted.
        RETURN QUERY SELECT true, NULL::TEXT;
        RETURN;
    END IF;

    -- The author, an org member of the app that owns the post, or an owner of
    -- the post's venue.
    v_authorized := (v_media.uploaded_by_user_id = v_user_id)
        OR EXISTS (
            SELECT 1
            FROM customer_apps ca
            JOIN organization_members om ON om.organization_id = ca.organization_id
            WHERE ca.id = v_media.app_id
              AND om.user_id = v_user_id
        )
        OR (v_media.venue_id IS NOT NULL AND EXISTS (
            SELECT 1
            FROM venue_owners vo
            WHERE vo.venue_id = v_media.venue_id
              AND vo.user_id = v_user_id
        ));

    IF NOT COALESCE(v_authorized, false) THEN
        RETURN QUERY SELECT false, 'You can only delete your own posts'::TEXT;
        RETURN;
    END IF;

    DELETE FROM venue_media WHERE id = p_media_id;

    RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION delete_social_post(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION delete_social_post(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION delete_social_post(UUID) TO authenticated;


-- ===== Post-install assertions =====

DO $$
DECLARE
    v_src TEXT;
BEGIN
    SELECT prosrc INTO v_src
    FROM pg_proc
    WHERE oid = 'public.delete_social_post(uuid)'::regprocedure;

    IF position('storage.objects' IN v_src) > 0 THEN
        RAISE EXCEPTION 'delete_social_post still touches storage.objects — every delete will 403 and roll back';
    END IF;
    IF position('venue_owners' IN v_src) = 0 THEN
        RAISE EXCEPTION 'delete_social_post does not consult venue_owners — venue owners cannot delete posts at their venue';
    END IF;

    IF has_function_privilege('anon', 'public.delete_social_post(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'delete_social_post: anon can EXECUTE it';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.delete_social_post(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'delete_social_post: authenticated CANNOT execute it';
    END IF;
END $$;
