-- Reporting: a review queue for the app team (Jay's board, 2026-10-14).
--
-- What was there
-- --------------
-- Report → the reasons sheet → report-content (service role) → a row in
-- content_reports and an email to Pahkie. Nothing ever closed a report, and
-- there was nowhere to look at them except the email.
--
-- What changes
-- ------------
--   content_reports                + status ('open' | 'dismissed' | 'removed'),
--                                    reviewed_by, reviewed_at. Every existing
--                                    report becomes 'open'.
--   list_content_reports           NEW. The team's queue, ONE ROW PER POST:
--     (app_id, status)               reasons with counts, first and last
--                                    reported, the post's media, caption,
--                                    author and venue. 'open' or 'resolved'.
--   review_content_report          NEW. 'remove' | 'dismiss' | 'restore'.
--     (media_id, action)
--
-- ⚠️ "REMOVE" IS NOT A DELETE. It sets venue_media.status = 'removed'. Every
-- reader filters status = 'approved', so the post disappears from every
-- surface at once — and the row, its files and its reports stay, as evidence,
-- and so that 'restore' can put it back. content_reports.media_id is ON DELETE
-- SET NULL precisely so a report outlives its post; a real delete would orphan
-- the queue.
--
-- Who
-- ---
-- Org members of the app that owns the post (organization_members via
-- customer_apps) — the same people content_reports' SELECT policy already lets
-- read the table. Both RPCs carry the three-line footer: anon cannot call them.
--
-- Rollback
-- --------
-- DROP FUNCTION list_content_reports(UUID, TEXT), review_content_report(UUID,
-- TEXT); ALTER TABLE content_reports DROP COLUMN status, DROP COLUMN
-- reviewed_by, DROP COLUMN reviewed_at. Any post set 'removed' stays removed
-- until set back to 'approved' by hand — list them first:
--   SELECT id FROM venue_media WHERE status = 'removed';


-- ===== 1. content_reports gains a lifecycle =====

ALTER TABLE content_reports
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'dismissed', 'removed')),
    ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- The queue reads open reports per app, newest first.
CREATE INDEX IF NOT EXISTS idx_content_reports_app_status
    ON content_reports(app_id, status, created_at DESC);


-- ===== 2. list_content_reports =====
--
-- One row per reported post. p_status 'open' = reports nobody has acted on;
-- 'resolved' = dismissed or removed (the latest decision wins). A report whose
-- post was deleted outright has media_id NULL and nothing left to act on, so
-- it is not listed.
--
-- #variable_conflict use_column: the OUT columns (status, media_id, …) share
-- names with table columns, and every reference below is meant as a column.

CREATE OR REPLACE FUNCTION list_content_reports(
    p_app_id UUID,
    p_status TEXT DEFAULT 'open'
)
RETURNS TABLE (
    media_id UUID,
    report_count INTEGER,
    reasons JSONB,
    first_reported_at TIMESTAMPTZ,
    last_reported_at TIMESTAMPTZ,
    status TEXT,
    reviewed_at TIMESTAMPTZ,
    media_status TEXT,
    media_type TEXT,
    url TEXT,
    thumbnail_url TEXT,
    caption TEXT,
    created_at TIMESTAMPTZ,
    author_user_id UUID,
    author_name TEXT,
    venue_id UUID,
    venue_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
    v_user_id UUID := auth.uid();
    v_open BOOLEAN := COALESCE(p_status, 'open') = 'open';
BEGIN
    IF v_user_id IS NULL OR p_app_id IS NULL THEN
        RETURN;
    END IF;

    -- The app team only. A member of some other org gets nothing.
    IF NOT EXISTS (
        SELECT 1
        FROM customer_apps ca
        JOIN organization_members om ON om.organization_id = ca.organization_id
        WHERE ca.id = p_app_id
          AND om.user_id = v_user_id
    ) THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH scoped AS (
        SELECT cr.media_id, COALESCE(cr.reason, 'other') AS reason, cr.status,
               cr.created_at, cr.reviewed_at
        FROM content_reports cr
        WHERE cr.app_id = p_app_id
          AND cr.media_id IS NOT NULL
          AND (CASE WHEN v_open THEN cr.status = 'open' ELSE cr.status <> 'open' END)
    ),
    by_reason AS (
        SELECT s.media_id, s.reason, COUNT(*)::INTEGER AS n
        FROM scoped s
        GROUP BY s.media_id, s.reason
    ),
    by_post AS (
        SELECT s.media_id,
               COUNT(*)::INTEGER AS report_count,
               MIN(s.created_at) AS first_reported_at,
               MAX(s.created_at) AS last_reported_at,
               (array_agg(s.status ORDER BY s.reviewed_at DESC NULLS LAST, s.created_at DESC))[1] AS status,
               MAX(s.reviewed_at) AS reviewed_at
        FROM scoped s
        GROUP BY s.media_id
    )
    SELECT
        bp.media_id,
        bp.report_count,
        (SELECT jsonb_object_agg(br.reason, br.n) FROM by_reason br WHERE br.media_id = bp.media_id),
        bp.first_reported_at,
        bp.last_reported_at,
        bp.status,
        bp.reviewed_at,
        vm.status,
        vm.media_type,
        vm.url,
        vm.thumbnail_url,
        vm.caption,
        vm.created_at,
        vm.uploaded_by_user_id,
        COALESCE(NULLIF(am.display_name, ''),
                 NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), '')),
        vm.venue_id,
        v.name
    FROM by_post bp
    JOIN venue_media vm ON vm.id = bp.media_id AND vm.app_id = p_app_id
    LEFT JOIN venues v ON v.id = vm.venue_id
    LEFT JOIN profiles p ON p.id = vm.uploaded_by_user_id
    LEFT JOIN app_members am
           ON am.user_id = vm.uploaded_by_user_id
          AND am.app_id  = vm.app_id
          AND am.deleted_at IS NULL
    ORDER BY bp.last_reported_at DESC
    LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION list_content_reports(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION list_content_reports(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION list_content_reports(UUID, TEXT) TO authenticated;


-- ===== 3. review_content_report =====
--
--   remove   the post leaves every surface (status 'removed'); its open
--            reports close as 'removed'.
--   dismiss  the post stays; its open reports close as 'dismissed'.
--   restore  a removed post comes back (status 'approved'); the reports that
--            removed it close as 'dismissed' — the decision was reversed.

CREATE OR REPLACE FUNCTION review_content_report(
    p_media_id UUID,
    p_action TEXT
)
RETURNS TABLE (success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_app_id UUID;
    v_now TIMESTAMPTZ := now();
BEGIN
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false, 'You must be signed in'::TEXT;
        RETURN;
    END IF;

    IF p_action IS NULL OR p_action NOT IN ('remove', 'dismiss', 'restore') THEN
        RETURN QUERY SELECT false, 'Unknown action'::TEXT;
        RETURN;
    END IF;

    SELECT vm.app_id INTO v_app_id
    FROM venue_media vm
    WHERE vm.id = p_media_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 'That post no longer exists'::TEXT;
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM customer_apps ca
        JOIN organization_members om ON om.organization_id = ca.organization_id
        WHERE ca.id = v_app_id
          AND om.user_id = v_user_id
    ) THEN
        RETURN QUERY SELECT false, 'Only the app team can review reports'::TEXT;
        RETURN;
    END IF;

    IF p_action = 'remove' THEN
        UPDATE venue_media SET status = 'removed'
        WHERE id = p_media_id AND status = 'approved';

        UPDATE content_reports
        SET status = 'removed', reviewed_by = v_user_id, reviewed_at = v_now
        WHERE media_id = p_media_id AND status = 'open';

    ELSIF p_action = 'dismiss' THEN
        UPDATE content_reports
        SET status = 'dismissed', reviewed_by = v_user_id, reviewed_at = v_now
        WHERE media_id = p_media_id AND status = 'open';

    ELSE
        UPDATE venue_media SET status = 'approved'
        WHERE id = p_media_id AND status = 'removed';

        UPDATE content_reports
        SET status = 'dismissed', reviewed_by = v_user_id, reviewed_at = v_now
        WHERE media_id = p_media_id AND status = 'removed';
    END IF;

    RETURN QUERY SELECT true, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION review_content_report(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION review_content_report(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION review_content_report(UUID, TEXT) TO authenticated;


-- ===== 4. Post-install assertions =====

DO $$
DECLARE
    v_fn TEXT;
    v_bad INTEGER;
BEGIN
    FOREACH v_fn IN ARRAY ARRAY[
        'public.list_content_reports(uuid, text)',
        'public.review_content_report(uuid, text)'
    ] LOOP
        IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
            RAISE EXCEPTION '%: anon can EXECUTE it', v_fn;
        END IF;
        IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
            RAISE EXCEPTION '%: authenticated CANNOT execute it — the Reports tab is dead', v_fn;
        END IF;
    END LOOP;

    -- Every existing report landed as 'open'.
    SELECT COUNT(*) INTO v_bad FROM content_reports
    WHERE status IS NULL OR status NOT IN ('open', 'dismissed', 'removed');
    IF v_bad > 0 THEN
        RAISE EXCEPTION 'content_reports: % row(s) without a valid status', v_bad;
    END IF;

    -- ⚠️ Not a has_table_privilege check: Supabase's default grants give anon
    -- and authenticated table privileges, and RLS is what stops them. The
    -- table has a SELECT policy for org members and NO write policy, so RLS
    -- being on is the property that matters.
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.content_reports'::regclass) THEN
        RAISE EXCEPTION 'content_reports: row level security is OFF';
    END IF;
END $$;
