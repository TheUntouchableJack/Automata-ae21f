-- Retire the member-avatars bucket AND revoke the two legacy member grants.
--
-- The filename names both changes on purpose. §5 is a check-in kill switch, and
-- a kill switch hidden under "retire an avatar bucket" is how outages ship.
--
-- Why
-- ---
-- 20260903000002 puts ViibeView member avatars in `venue-media` under
-- `members/{auth.uid()}/` specifically to route around this bucket, whose four
-- policies (database/profile-visits-migration.sql:83-98) carry NO path
-- predicate at all — every one of them is just `bucket_id = 'member-avatars'`.
-- Any anon caller can write or delete any object in it.
--
-- Investigating that turned up the larger problem. The same hand-applied file
-- also ships two SECURITY DEFINER functions that take a member id FROM THE
-- CALLER, never check auth.uid(), and are granted to `anon` — and the anon key
-- is published in customer-app/social.js:8. Today, against production:
--
--   update_member_profile(p_member_id, ...)  -> rewrite ANY member's
--                                               name / email / phone / avatar
--   record_member_visit(p_member_id, ...)    -> mint loyalty points onto ANY
--                                               member id, with streak and
--                                               milestone bonuses
--
-- Both return HTTP 200 to an unauthenticated caller right now. The bucket is
-- one symptom; those grants are the disease.
--
-- Why retire the bucket rather than secure it
-- -------------------------------------------
-- Loyalty members authenticate by PIN. customer-app/app.html:2790-2792 builds
-- its Supabase client with the anon key and never calls signIn; the whole
-- session is localStorage.getItem('app_member_id') (:2837). So a loyalty member
-- has NO auth.uid(), and a path predicate like
--
--     (storage.foldername(name))[2] = auth.uid()::text
--
-- would not secure this bucket — it would break it outright. Securing it
-- properly means giving loyalty members a real session, which is a rebuild, not
-- a patch (see "Out of scope" below). With zero loyalty members and zero live
-- avatars, retiring is the honest move, and the replacement already shipped.
--
-- ⚠️ THE CONSEQUENCE, STATED PLAINLY
-- ----------------------------------
-- Revoking `anon` on record_member_visit TURNS OFF QR CHECK-IN for loyalty
-- members — the core loyalty loop: points, streaks, milestones, visit
-- attribution, and every automation keyed off a visit. Revoking it on
-- update_member_profile turns off loyalty profile editing.
--
-- Both are INERT TODAY because zero loyalty members exist (G4 below asserts
-- exactly that and aborts this whole file if it has stopped being true). They
-- are revoked anyway, now, because the grants are not merely unused — they are
-- exploitable, and deferring means knowingly leaving a points-forgery endpoint
-- open on the public internet.
--
-- ⚠️ RE-GRANTING `anon` IS NOT THE FIX for a future check-in bug. It reopens
-- the forgery. The fix is a real member session. See the COMMENT ON FUNCTION
-- in §5, which says the same thing to anyone reading the catalog.
--
-- ⚠️ PREREQUISITE — the bucket must be dropped via the STORAGE API first.
-- This project blocks direct DML on storage tables project-wide (42501,
-- "Direct deletion from storage tables is not allowed"), at STATEMENT level, so
-- a migration cannot do it and cannot even try without aborting. §1-2 asserts
-- the bucket is gone and tells you the exact curl commands if it is not.
--
-- Scope: asserts one storage bucket is gone, drops its four policies, and
-- revokes EXECUTE on two functions. No function BODY is touched, no table is
-- altered, no return type changes. Needs a client deploy (app.html + sw.js)
-- because the avatar upload UI it backed is being removed in the same commit.
--
-- Rollback
-- --------
--   -- 1. bucket + policies (the bytes are NOT recoverable — see §1)
--   INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
--   VALUES ('member-avatars', 'member-avatars', true, 2097152,
--           ARRAY['image/jpeg','image/png','image/webp','image/gif'])
--   ON CONFLICT (id) DO NOTHING;
--   CREATE POLICY "Public avatar access"          ON storage.objects FOR SELECT USING (bucket_id = 'member-avatars');
--   CREATE POLICY "Members can upload own avatar" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'member-avatars');
--   CREATE POLICY "Members can update own avatar" ON storage.objects FOR UPDATE USING (bucket_id = 'member-avatars');
--   CREATE POLICY "Members can delete own avatar" ON storage.objects FOR DELETE USING (bucket_id = 'member-avatars');
--   -- 2. grants (⚠️ this restores the forgery surface — read §5 first)
--   GRANT EXECUTE ON FUNCTION update_member_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION record_member_visit(UUID, UUID, UUID) TO anon, authenticated;
--
-- Verify (anon key from customer-app/social.js:8)
-- -----------------------------------------------
--   GET  $SB/storage/v1/bucket/member-avatars                    -> 404
--   POST $SB/storage/v1/object/member-avatars/probe.txt (anon)   -> 400 "Bucket not found"
--        ^ a 200 here means this migration did NOT take. Delete the probe at once.
--   POST $SB/rest/v1/rpc/record_member_visit    (anon)           -> 42501, not 200
--   POST $SB/rest/v1/rpc/update_member_profile  (anon)           -> 42501, not 200
--   GET  $SB/storage/v1/bucket/venue-media                       -> 200 (ViibeView unaffected)
--   POST $SB/rest/v1/rpc/get_venue_feed         (anon)           -> still returns rows
--
-- Out of scope: giving loyalty members a real Supabase session so
-- record_member_visit can key on auth.uid() and QR check-in can come back. That
-- is the correct long-term fix, it is a rebuild of the PIN auth model, and it
-- needs its own plan — before loyalty onboards its first member.


-- ===== 0. Pre-flight — abort the whole file if the ground has moved =====
--
-- Everything below is only safe while the four measurements taken on
-- 2026-09-03 still hold. Asserting them here rather than in a runbook means the
-- trade-off in §5 cannot go quietly stale: if this app grows a loyalty member
-- between writing and applying, the push fails instead of silently killing
-- their check-in.

DO $preflight$
DECLARE
    v_viibeview CONSTANT UUID := '6119865e-83f8-4731-b320-8ea705a2ac18';
    v_count     INTEGER;
BEGIN
    -- G1 — no LIVE member's avatar_url points into this bucket.
    --
    -- ⚠️ Scoped with LIKE '%/member-avatars/%', NOT `avatar_url IS NOT NULL`.
    -- 20260903000002 made avatar_url a written column for ViibeView members,
    -- pointing at venue-media. An unscoped guard would start aborting this file
    -- the first time a ViibeView member sets a photo — i.e. it would break on
    -- correct behaviour.
    SELECT COUNT(*) INTO v_count
    FROM public.app_members
    WHERE deleted_at IS NULL
      AND avatar_url LIKE '%/member-avatars/%';

    IF v_count > 0 THEN
        RAISE EXCEPTION
            'pre-flight G1: % live member(s) still reference member-avatars in avatar_url. '
            'Migrate those images to venue-media before retiring the bucket.', v_count;
    END IF;

    -- G2/G3 only mean anything while the bucket exists. The optional Storage-API
    -- pre-step (which removes the BYTES, something SQL cannot do) may already
    -- have deleted it, in which case these are correctly vacuous.
    IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'member-avatars') THEN

        -- G2 — every object in the bucket is an orphan.
        --
        -- ⚠️ Compared as TEXT. `split_part(o.name,'/',1)::uuid` throws 22P02 on
        -- any object whose first path segment is not a UUID, which turns "one
        -- weird filename" into a migration that dies on a cast instead of
        -- reporting what it found.
        SELECT COUNT(*) INTO v_count
        FROM storage.objects o
        JOIN public.app_members m
          ON m.id::text = split_part(o.name, '/', 1)
        WHERE o.bucket_id = 'member-avatars'
          AND m.deleted_at IS NULL;

        IF v_count > 0 THEN
            RAISE EXCEPTION
                'pre-flight G2: % object(s) in member-avatars belong to a LIVE member. '
                'They were all orphans on 2026-09-03; someone has used the bucket since.', v_count;
        END IF;

        -- G3 — the bucket still holds at most the 2 known orphans. If that
        -- changed, the case for retiring is gone even though G2 passed: it would
        -- mean something is actively writing here.
        SELECT COUNT(*) INTO v_count
        FROM storage.objects WHERE bucket_id = 'member-avatars';

        IF v_count > 2 THEN
            RAISE EXCEPTION
                'pre-flight G3: member-avatars holds % objects, expected at most 2 orphans. '
                'Something is still writing to this bucket — find out what before dropping it.', v_count;
        END IF;
    END IF;

    -- G4 — zero live NON-ViibeView members.
    --
    -- ⚠️ THIS IS THE GUARD PROTECTING §5's CHECK-IN OUTAGE. A loyalty member
    -- existing here means revoking anon on record_member_visit breaks a real
    -- person's QR check-in.
    --
    -- IS DISTINCT FROM, not <>, so a NULL app_id cannot slip past as unknown.
    -- ViibeView is pinned by ID, never by app_type — same reasoning as
    -- 20260903000002:26.
    SELECT COUNT(*) INTO v_count
    FROM public.app_members
    WHERE deleted_at IS NULL
      AND app_id IS DISTINCT FROM v_viibeview;

    IF v_count > 0 THEN
        RAISE EXCEPTION
            'pre-flight G4: % live loyalty member(s) exist. Revoking anon on '
            'record_member_visit would turn OFF their QR check-in (points, streaks, '
            'milestones, visit attribution). Give loyalty members a real session '
            'first — see "Out of scope" in this file''s header.', v_count;
    END IF;

    RAISE NOTICE 'pre-flight OK: no live member references member-avatars, no live '
                 'non-ViibeView members, bucket holds only orphans.';
END
$preflight$;


-- ===== 1-2. The bucket and its objects — ASSERTED, not deleted here =====
--
-- ⚠️ THE BUCKET MUST ALREADY BE GONE BEFORE THIS FILE RUNS. This section only
-- checks; it deliberately deletes nothing.
--
-- The first draft did `DELETE FROM storage.objects` then `DELETE FROM
-- storage.buckets`. This project rejects both:
--
--     ERROR: Direct deletion from storage tables is not allowed.
--            Use the Storage API instead.  (SQLSTATE 42501)
--
-- and — the part worth writing down — it raised that error with ZERO matching
-- rows, on an already-emptied bucket. So the guard is STATEMENT-level, not
-- row-level: you cannot make it vacuous by deleting the rows out from under it,
-- and "the bucket is already empty" is not a way around it. Any DELETE against
-- storage.objects aborts the whole migration.
--
-- So the Storage API pre-step is REQUIRED, not optional as first drafted:
--
--   # ⚠️ NOT POST /bucket/member-avatars/empty — that endpoint is ASYNC
--   #   ("queued, may take up to an hour") and the bucket DELETE then fails
--   #   409 ResourceNotEmpty. Delete the objects explicitly; that is synchronous.
--   curl -X DELETE "$SB/storage/v1/object/member-avatars" \
--        -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
--        -H 'Content-Type: application/json' \
--        -d '{"prefixes":["<id>/avatar.jpg","<id>/avatar.jpeg"]}'
--   curl -X DELETE "$SB/storage/v1/bucket/member-avatars" \
--        -H "apikey: $SRK" -H "Authorization: Bearer $SRK"
--
-- Doing it through the API is also strictly better than the SQL would have
-- been: it reclaims the actual BYTES in S3, which a DELETE against
-- storage.objects never could.

DO $bucket_gone$
DECLARE v_objects INTEGER;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'member-avatars') THEN
        RAISE NOTICE 'member-avatars bucket already removed via the Storage API — as required.';
        RETURN;
    END IF;

    SELECT COUNT(*) INTO v_objects FROM storage.objects WHERE bucket_id = 'member-avatars';

    RAISE EXCEPTION
        'member-avatars still exists (% object(s)). This migration cannot drop it: '
        'direct DML on storage tables is blocked project-wide (42501), even for zero rows. '
        'Delete the objects and then the bucket via the Storage API with the service key '
        '(see the commands in this file, §1-2), then re-run this push.', v_objects;
END
$bucket_gone$;


-- ===== 3. Drop the four path-less policies =====
--
-- These are the actual hole: not one of them constrains WHICH object a caller
-- may touch (database/profile-visits-migration.sql:83-98).
--
-- ⚠️ storage.objects is owned by supabase_storage_admin. If the migration role
-- cannot drop policies on it, a 42501 here would roll back §§4-5 as well — and
-- four inert policies on a bucket that no longer exists are strictly less bad
-- than leaving the two anon grants live. So this warns instead of failing.
--
-- plpgsql exception blocks are subtransactions: the failure is all-or-nothing
-- across the block, which is why the warning names all four rather than
-- pretending to know how far it got.

DO $policies$
BEGIN
    DROP POLICY IF EXISTS "Public avatar access"          ON storage.objects;
    DROP POLICY IF EXISTS "Members can upload own avatar" ON storage.objects;
    DROP POLICY IF EXISTS "Members can update own avatar" ON storage.objects;
    DROP POLICY IF EXISTS "Members can delete own avatar" ON storage.objects;
EXCEPTION WHEN insufficient_privilege THEN
    RAISE WARNING
        'Could not drop the member-avatars storage policies (insufficient privilege on '
        'storage.objects, owned by supabase_storage_admin). ALL FOUR are still present: '
        '"Public avatar access", "Members can upload own avatar", "Members can update own '
        'avatar", "Members can delete own avatar". They are inert now that the bucket is '
        'gone, but drop them by hand in Dashboard -> Database -> Policies (filter '
        'storage.objects) so the next bucket named member-avatars is not born wide open.';
END
$policies$;


-- ===== 4. update_member_profile — revoke =====
--
-- Takes p_member_id from the caller and never checks auth.uid()
-- (database/supabase-security-views-functions.sql:1232-1268), so with the
-- published anon key this rewrites any member's name, email, phone or avatar.
--
-- ⚠️ All three REVOKE lines, every time. `REVOKE ... FROM PUBLIC` alone does
-- NOTHING here: Supabase ships ALTER DEFAULT PRIVILEGES granting anon and
-- authenticated DIRECTLY, and revoking PUBLIC leaves those direct grants in
-- place. This is the lesson of 20260828000005 and 20260903000000:14-30.
--
-- `authenticated` goes too, not just `anon`: the function trusts a
-- caller-supplied member id, so a signed-in ViibeView member could write to any
-- loyalty tenant's row. There are zero authenticated callers.
--
-- REVOKE has no IF EXISTS and errors 42883 on a missing function, hence the
-- to_regprocedure guard. service_role keeps its default grant.

DO $ump$
BEGIN
    IF to_regprocedure('public.update_member_profile(uuid,text,text,text,text,text)') IS NULL THEN
        RAISE NOTICE 'update_member_profile(uuid,text,text,text,text,text) not present — nothing to revoke.';
        RETURN;
    END IF;

    REVOKE ALL ON FUNCTION public.update_member_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.update_member_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
    REVOKE ALL ON FUNCTION public.update_member_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
END
$ump$;

-- The COMMENT is deliberately a SEPARATE block from the REVOKEs above. A
-- plpgsql exception block is a subtransaction, so a COMMENT failure inside the
-- same block would roll the REVOKEs back with it — losing the security fix to
-- save a docstring.
DO $ump_doc$
BEGIN
    IF to_regprocedure('public.update_member_profile(uuid,text,text,text,text,text)') IS NULL THEN
        RETURN;
    END IF;

    COMMENT ON FUNCTION public.update_member_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) IS
        'RETIRED 2026-09-03 (20260903000005). SECURITY DEFINER, takes p_member_id from the '
        'caller, never checks auth.uid() — with the published anon key it rewrote any '
        'member''s name/email/phone/avatar. EXECUTE revoked from PUBLIC, anon and '
        'authenticated; service_role only. ViibeView members use update_social_profile '
        '(20260903000002), which keys on auth.uid(). Loyalty profile editing is OFF until '
        'loyalty members have a real session.';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Could not comment update_member_profile (%). The REVOKEs above still applied.', SQLERRM;
END
$ump_doc$;


-- ===== 5. record_member_visit — revoke =====
--
-- ⚠️ THIS IS THE CHECK-IN KILL SWITCH. Read the header before touching it.
--
-- Same defect, higher stakes: SECURITY DEFINER, member id from the caller, no
-- auth.uid() check (database/supabase-security-views-functions.sql:~1060-1127),
-- granted to anon. That is a points-forgery endpoint — anyone with the public
-- anon key can mint points, streak bonuses and milestone bonuses onto any
-- member id they can guess or read.
--
-- ⚠️ Targeted by TYPE, never by argument name. There are two definitions with
-- different parameter ORDER:
--     database/profile-visits-migration.sql:212   (p_app_id, p_member_id, p_location_id)
--     database/security-fixes-migration.sql:256   (p_member_id, p_app_id, p_location_id)
-- Both are (uuid,uuid,uuid), so only one can be live — and a name-based revoke
-- would target neither.

DO $rmv$
BEGIN
    IF to_regprocedure('public.record_member_visit(uuid,uuid,uuid)') IS NULL THEN
        RAISE NOTICE 'record_member_visit(uuid,uuid,uuid) not present — nothing to revoke.';
        RETURN;
    END IF;

    REVOKE ALL ON FUNCTION public.record_member_visit(UUID, UUID, UUID) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.record_member_visit(UUID, UUID, UUID) FROM anon;
    REVOKE ALL ON FUNCTION public.record_member_visit(UUID, UUID, UUID) FROM authenticated;
END
$rmv$;

-- Separate block, same reasoning as §4: a COMMENT failure must not roll back
-- the revoke that closes a points-forgery endpoint.
DO $rmv_doc$
BEGIN
    IF to_regprocedure('public.record_member_visit(uuid,uuid,uuid)') IS NULL THEN
        RETURN;
    END IF;

    COMMENT ON FUNCTION public.record_member_visit(UUID, UUID, UUID) IS
        'RETIRED 2026-09-03 (20260903000005). SECURITY DEFINER, takes p_member_id from the '
        'caller, never checks auth.uid() — with the published anon key this MINTED POINTS '
        'onto any member id. EXECUTE revoked from PUBLIC, anon and authenticated; '
        'service_role only. This turns OFF QR check-in for loyalty members; it was safe to '
        'do because zero loyalty members existed. '
        '⚠️ RE-GRANTING anon IS NOT THE FIX for a check-in bug — it reopens the forgery. '
        'The fix is giving loyalty members a real Supabase session so this can key on '
        'auth.uid() instead of trusting p_member_id.';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Could not comment record_member_visit (%). The REVOKEs above still applied.', SQLERRM;
END
$rmv_doc$;
