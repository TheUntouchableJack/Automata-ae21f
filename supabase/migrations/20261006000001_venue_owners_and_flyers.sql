-- Venue owners, and flyers on the venue page.
--
-- Why
-- ---
-- Until now "owner" meant ORG-WIDE: any organization_members row managed every
-- venue in the org (20260922000002's header). Jay's 2026-10-06 round adds the
-- first per-venue role: an org member assigns a ViibeView account as the owner
-- of ONE venue from the Royalty dashboard's Venues page. An owner can
--
--   * delete any post at their venue      (20261006000002, delete_social_post)
--   * add a flyer image to their venue    (add_venue_flyer, below)
--
-- and nothing else. There is no self-serve venue creation and no self-serve
-- ownership claim; only an org member can add or remove an owner.
--
-- Shape
-- -----
--   venue_owners (venue_id, user_id) — one row per owner per venue.
--     app_id is copied from the venue row by add_venue_owner, never taken from
--     the caller. created_by is the org member who added the row.
--
--   venue_media.is_flyer — a flyer is an IMAGE row that is permanent, approved
--     and has uploaded_by_user_id NULL. The NULL author is deliberate: every
--     surface that names or counts a poster ("here tonight", crowd mix,
--     "Been to", the uploader's own profile grid) reads uploaded_by_user_id,
--     so a NULL keeps a flyer out of all of them without touching any of them.
--
-- ⚠️ THREE THINGS THAT WILL BREAK THIS FILE IF IGNORED
--
-- 1. ⚠️ venue_owners is read by the client directly (PostgREST) to decide
--    whether to show "Add flyer" and Delete. Its ONLY policy is select-own.
--    No INSERT/UPDATE/DELETE grant exists for anyone but the definer RPCs; a
--    table-level INSERT grant would let any member make themselves an owner.
--
-- 2. ⚠️ add_venue_flyer VALIDATES THE PATH, not just the caller. Without the
--    storage.objects lookup, an owner could point a flyer row at any object in
--    the public bucket — another member's clip, another org's upload — and the
--    delete path (which removes storage for flyers under members/) would then
--    delete someone else's file. The object must exist, be owned by the caller
--    and sit under the caller's own prefix.
--
-- 3. ⚠️ Every new RPC here carries the 3-line footer (FROM PUBLIC, FROM anon,
--    TO authenticated). None of them is part of anonymous browsing. Asserted
--    in section 6, both directions.
--
-- Rollback
-- --------
--   DROP FUNCTION IF EXISTS add_venue_flyer(UUID, TEXT, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS remove_venue_owner(UUID, UUID);
--   DROP FUNCTION IF EXISTS add_venue_owner(UUID, TEXT);
--   DROP FUNCTION IF EXISTS list_venue_owners(UUID);
--   ALTER TABLE venue_media DROP COLUMN is_flyer;      -- only after 20261006000003 is rolled back
--   DROP TABLE venue_owners;                            -- only after 20261006000002 is rolled back


-- ===== 1. venue_owners =====

CREATE TABLE IF NOT EXISTS venue_owners (
    venue_id   UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    app_id     UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,
    -- SET NULL, not CASCADE: the org member who added an owner leaving must not
    -- remove the owner they added.
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (venue_id, user_id)
);

-- The client asks "which venues do I own?" — user_id first.
CREATE INDEX IF NOT EXISTS idx_venue_owners_user ON venue_owners(user_id);

ALTER TABLE venue_owners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can see their own venue_owners rows" ON venue_owners;
CREATE POLICY "Owners can see their own venue_owners rows"
ON venue_owners FOR SELECT
TO authenticated
USING (user_id = auth.uid());

REVOKE ALL ON TABLE venue_owners FROM anon;
REVOKE ALL ON TABLE venue_owners FROM authenticated;
GRANT SELECT ON TABLE venue_owners TO authenticated;


-- ===== 2. venue_media.is_flyer =====
--
-- NOT NULL DEFAULT false: every existing row, and every row create_social_post
-- writes, is not a flyer. Only add_venue_flyer and the dashboard's image upload
-- set it.

ALTER TABLE venue_media
    ADD COLUMN IF NOT EXISTS is_flyer BOOLEAN NOT NULL DEFAULT false;


-- ===== 3. The owner RPCs — org members of the venue's org only =====
--
-- All three RAISE rather than returning a status row. A SECURITY DEFINER
-- function that returns success:false does not set PostgREST's `error` field
-- (20260828000002's header), and the dashboard shows error.message as-is.

CREATE OR REPLACE FUNCTION list_venue_owners(p_venue_id UUID)
RETURNS TABLE (
    user_id UUID,
    email TEXT,
    display_name TEXT,
    first_name TEXT,
    last_name TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller UUID := auth.uid();
    v_venue RECORD;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'You must be signed in' USING ERRCODE = '42501';
    END IF;

    SELECT v.id, v.organization_id, v.app_id INTO v_venue
    FROM venues v
    WHERE v.id = p_venue_id
      AND v.deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Venue not found';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = v_venue.organization_id
          AND om.user_id = v_caller
    ) THEN
        RAISE EXCEPTION 'Only your team can manage venue owners' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        vo.user_id,
        u.email::TEXT,
        am.display_name,
        p.first_name,
        p.last_name,
        vo.created_at
    FROM venue_owners vo
    JOIN auth.users u ON u.id = vo.user_id
    LEFT JOIN profiles p ON p.id = vo.user_id
    LEFT JOIN app_members am
           ON am.user_id = vo.user_id
          AND am.app_id  = vo.app_id
          AND am.deleted_at IS NULL
    WHERE vo.venue_id = p_venue_id
    ORDER BY vo.created_at;
END;
$$;

REVOKE ALL ON FUNCTION list_venue_owners(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION list_venue_owners(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION list_venue_owners(UUID) TO authenticated;


CREATE OR REPLACE FUNCTION add_venue_owner(p_venue_id UUID, p_email TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller UUID := auth.uid();
    v_venue RECORD;
    v_email TEXT := lower(btrim(COALESCE(p_email, '')));
    v_user_id UUID;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'You must be signed in' USING ERRCODE = '42501';
    END IF;

    SELECT v.id, v.organization_id, v.app_id INTO v_venue
    FROM venues v
    WHERE v.id = p_venue_id
      AND v.deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Venue not found';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = v_venue.organization_id
          AND om.user_id = v_caller
    ) THEN
        RAISE EXCEPTION 'Only your team can manage venue owners' USING ERRCODE = '42501';
    END IF;

    IF v_email = '' THEN
        RAISE EXCEPTION 'Enter an email address';
    END IF;

    SELECT u.id INTO v_user_id
    FROM auth.users u
    WHERE lower(btrim(u.email)) = v_email
    ORDER BY u.created_at
    LIMIT 1;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'No ViibeView account for that email. Ask them to sign up first.';
    END IF;

    -- app_id from the venue row, never from the caller.
    INSERT INTO venue_owners (venue_id, user_id, app_id, created_by)
    VALUES (v_venue.id, v_user_id, v_venue.app_id, v_caller)
    ON CONFLICT (venue_id, user_id) DO NOTHING;

    RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION add_venue_owner(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION add_venue_owner(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION add_venue_owner(UUID, TEXT) TO authenticated;


CREATE OR REPLACE FUNCTION remove_venue_owner(p_venue_id UUID, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller UUID := auth.uid();
    v_org_id UUID;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'You must be signed in' USING ERRCODE = '42501';
    END IF;

    SELECT v.organization_id INTO v_org_id
    FROM venues v
    WHERE v.id = p_venue_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Venue not found';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = v_org_id
          AND om.user_id = v_caller
    ) THEN
        RAISE EXCEPTION 'Only your team can manage venue owners' USING ERRCODE = '42501';
    END IF;

    DELETE FROM venue_owners
    WHERE venue_id = p_venue_id
      AND user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION remove_venue_owner(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION remove_venue_owner(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION remove_venue_owner(UUID, UUID) TO authenticated;


-- ===== 4. add_venue_flyer — an org member, or an owner of THAT venue =====
--
-- The client uploads the image first (to members/{uid}/flyer-{ts}.jpg — the
-- member prefix 20260828000002 opened), then calls this. Every argument is
-- checked here; none is trusted:
--
--   * the caller is an org member of the venue's org, or a venue_owners row
--     for this venue;
--   * the path sits under members/{caller}/ — or, for an org member only,
--     under {org_id}/, the dashboard's prefix;
--   * the object EXISTS in the bucket and its owner_id is the caller — a row
--     cannot point at someone else's upload, or at nothing;
--   * the URL ends in exactly that path in this bucket;
--   * the extension is an image;
--   * no other venue_media row already uses the path (one file, one row — the
--     delete path relies on it).

CREATE OR REPLACE FUNCTION add_venue_flyer(
    p_venue_id UUID,
    p_storage_path TEXT,
    p_url TEXT,
    p_caption TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller UUID := auth.uid();
    v_venue RECORD;
    v_is_org_member BOOLEAN;
    v_is_owner BOOLEAN;
    v_path TEXT := btrim(COALESCE(p_storage_path, ''));
    v_url TEXT := btrim(COALESCE(p_url, ''));
    v_marker TEXT := '/storage/v1/object/public/venue-media/';
    v_path_ok BOOLEAN;
    v_media_id UUID;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'You must be signed in' USING ERRCODE = '42501';
    END IF;

    SELECT v.id, v.organization_id, v.app_id INTO v_venue
    FROM venues v
    WHERE v.id = p_venue_id
      AND v.deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Venue not found';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = v_venue.organization_id
          AND om.user_id = v_caller
    ) INTO v_is_org_member;

    SELECT EXISTS (
        SELECT 1 FROM venue_owners vo
        WHERE vo.venue_id = v_venue.id
          AND vo.user_id = v_caller
    ) INTO v_is_owner;

    IF NOT (v_is_org_member OR v_is_owner) THEN
        RAISE EXCEPTION 'Only this venue''s owners can add a flyer' USING ERRCODE = '42501';
    END IF;

    -- The path: the caller's own member prefix, or (org members only) the org's.
    -- `..` is refused outright; storage normalises nothing for us here.
    v_path_ok := v_path <> ''
        AND position('..' IN v_path) = 0
        AND (
              v_path LIKE 'members/' || v_caller::TEXT || '/%'
           OR (v_is_org_member AND v_path LIKE v_venue.organization_id::TEXT || '/%')
        );

    IF NOT v_path_ok THEN
        RAISE EXCEPTION 'That upload is not yours to use';
    END IF;

    IF lower(v_path) !~ '\.(jpe?g|png|webp)$' THEN
        RAISE EXCEPTION 'A flyer must be an image';
    END IF;

    -- The URL must be the public URL of exactly this object.
    IF v_url NOT LIKE 'https://%'
       OR right(v_url, length(v_marker || v_path)) <> v_marker || v_path THEN
        RAISE EXCEPTION 'The flyer URL does not match its upload';
    END IF;

    -- The object exists, in this bucket, and the caller uploaded it.
    IF NOT EXISTS (
        SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'venue-media'
          AND o.name = v_path
          AND o.owner_id = v_caller::TEXT
    ) THEN
        RAISE EXCEPTION 'Upload did not complete';
    END IF;

    -- One file, one row.
    IF EXISTS (SELECT 1 FROM venue_media vm WHERE vm.storage_path = v_path) THEN
        RAISE EXCEPTION 'That upload is already in use';
    END IF;

    INSERT INTO venue_media (
        venue_id, app_id, uploaded_by_user_id,
        media_type, storage_path, url, thumbnail_url,
        caption, status, is_permanent, is_flyer
    ) VALUES (
        v_venue.id, v_venue.app_id, NULL,
        'image', v_path, v_url, NULL,
        NULLIF(left(btrim(COALESCE(p_caption, '')), 500), ''),
        'approved', true, true
    )
    RETURNING id INTO v_media_id;

    RETURN v_media_id;
END;
$$;

REVOKE ALL ON FUNCTION add_venue_flyer(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION add_venue_flyer(UUID, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION add_venue_flyer(UUID, TEXT, TEXT, TEXT) TO authenticated;


-- ===== 5. No seed from venues.created_by_user_id =====
--
-- 20260922000002 anticipated seeding owners from that column. It is not done
-- here: only org members can create a venue today, and an org member already
-- has every right an owner row would give them. Seeding would add rows that
-- change nothing and that the dashboard would then list as "owners".


-- ===== 6. Post-install assertions, both directions =====

DO $$
DECLARE
    v_fn TEXT;
BEGIN
    -- 6a. RLS is on, and the one policy is select-own.
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.venue_owners'::regclass) THEN
        RAISE EXCEPTION 'venue_owners: row level security is OFF';
    END IF;

    IF has_table_privilege('anon', 'public.venue_owners', 'SELECT') THEN
        RAISE EXCEPTION 'venue_owners: anon can SELECT it';
    END IF;
    IF NOT has_table_privilege('authenticated', 'public.venue_owners', 'SELECT') THEN
        RAISE EXCEPTION 'venue_owners: authenticated CANNOT select it — the client cannot learn which venues it owns';
    END IF;
    IF has_table_privilege('authenticated', 'public.venue_owners', 'INSERT')
       OR has_table_privilege('authenticated', 'public.venue_owners', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.venue_owners', 'DELETE') THEN
        RAISE EXCEPTION 'venue_owners: authenticated can WRITE it — a member could make themselves an owner';
    END IF;

    -- 6b. The four RPCs: anon denied, authenticated allowed.
    FOREACH v_fn IN ARRAY ARRAY[
        'public.list_venue_owners(uuid)',
        'public.add_venue_owner(uuid, text)',
        'public.remove_venue_owner(uuid, uuid)',
        'public.add_venue_flyer(uuid, text, text, text)'
    ] LOOP
        IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
            RAISE EXCEPTION '%: anon can EXECUTE it', v_fn;
        END IF;
        IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
            RAISE EXCEPTION '%: authenticated CANNOT execute it', v_fn;
        END IF;
    END LOOP;

    -- 6c. add_venue_flyer reads storage.objects.owner_id at RUNTIME, where a
    -- missing column or a revoked SELECT would surface as "Upload did not
    -- complete" on every flyer. Prove both here, as the role that owns the
    -- function.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'storage' AND table_name = 'objects' AND column_name = 'owner_id'
    ) THEN
        RAISE EXCEPTION 'storage.objects has no owner_id column — add_venue_flyer cannot verify uploads';
    END IF;
    PERFORM 1 FROM storage.objects WHERE bucket_id = 'venue-media' LIMIT 1;

    -- 6d. The column landed with its default.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'venue_media'
          AND column_name = 'is_flyer' AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'venue_media.is_flyer is missing or nullable';
    END IF;
END $$;
