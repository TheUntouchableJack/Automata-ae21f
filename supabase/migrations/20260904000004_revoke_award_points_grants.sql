-- ============================================================================
-- Phase 0: close award_points() as a public points-minting endpoint
-- ============================================================================
--
-- THE HOLE
-- public.award_points(p_app_id, p_member_id, p_points, p_type, p_description,
-- p_metadata) is SECURITY DEFINER, contains ZERO occurrences of auth.uid(),
-- and takes an arbitrary caller-supplied p_points INTEGER. It reads the member
-- id straight from its argument, locks that row, adds p_points to
-- points_balance, recomputes the tier and writes a points_transactions row.
-- There is no ownership check, no cap, and no tenant check beyond the app_id
-- the caller also supplies.
--
-- VERIFIED IN PRODUCTION 2026-09-04, not inferred from the repo. Calling it
-- over PostgREST against a non-existent member (so the call could only ever
-- abort) returned, for BOTH the published anon key and a real ViibeView
-- member session:
--
--   SQLSTATE 23502: null value in column "balance_after" ...
--
-- 23502 is a *body* error. The permission check had already passed. A revoked
-- function returns 42501 before the body ever runs -- which is exactly what
-- record_member_visit returns today, in the same probe, from the same key.
--
-- ⚠️ WORSE THAN THE PLAN THAT COMMISSIONED THIS FILE ASSUMED. That plan read
-- the repo, found `GRANT EXECUTE ... TO authenticated` at
-- 20260902000001_fix_award_points_tier_shape.sql:157, and concluded the
-- exposure required a ViibeView signup. It does not. `anon` holds EXECUTE too,
-- and anon is the key published in customer-app/social.js:8. No signup, no
-- session, no account: the key in the page source is enough to mint unlimited
-- points onto any member of any tenant.
--
-- The anon grant is not in any migration. It is Supabase's default privilege
-- on public -- the same trap documented at 20260903000000:11-30 -- which is
-- why all three REVOKE lines below are required and `REVOKE ... FROM PUBLIC`
-- alone would be a silent no-op.
--
-- ZERO CALLERS (verified before writing this):
--   * No `.rpc('award_points'` anywhere in customer-app/ or app/.
--   * royal-ai-autonomous/index.ts:508 calls batch_award_points() -- a
--     different function (20260208000005), untouched here.
--   * automation-engine/index.ts:353 dispatches to its own executeAwardPoints()
--     which writes app_members and app_events directly. It never calls this RPC.
--   * redeem_reward() does `PERFORM award_points(...)` internally
--     (supabase-security-views-functions.sql:999). That keeps working: it is
--     SECURITY DEFINER, so the inner call runs with the owner's privileges, and
--     ownership is not affected by REVOKE.
--
-- SCOPE. Grants only. The function body is not touched, no table is altered,
-- no client ships with this. service_role keeps its default grant, so every
-- server-side path stays open. Re-keying award_points onto auth.uid() -- so it
-- can be granted back to real sessions -- belongs to S2 of the loyalty-session
-- plan; this file only takes away what should never have been public.
--
-- NOT INCLUDED: redeem_reward(). The same probe showed it is ALSO anon-
-- executable (it answered `Reward not found or inactive` -- a body response --
-- rather than 42501), which is likewise worse than assumed. It is left alone
-- here because it has a live call site at customer-app/app.html:4563 and is
-- scheduled to be re-keyed onto auth.uid() rather than merely switched off.
-- Flagged for a separate decision; it burns a victim's points rather than
-- minting attacker-controlled ones.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Pre-flight: record the before-state in the push output.
--
-- REVOKE has no IF EXISTS and raises 42883 on a missing function, so the
-- to_regprocedure() guard has to come first. Argument types only -- names and
-- DEFAULTs are not part of a function's identity.
-- ----------------------------------------------------------------------------
DO $preflight$
DECLARE
    v_fn CONSTANT TEXT := 'public.award_points(uuid,uuid,integer,text,text,jsonb)';
    v_oid oid := to_regprocedure(v_fn);
    v_holders TEXT;
BEGIN
    IF v_oid IS NULL THEN
        RAISE EXCEPTION
            'award_points(uuid,uuid,integer,text,text,jsonb) does not exist. '
            'REVOKE would fail with 42883. Check whether the signature changed '
            'before assuming this migration is a no-op.';
    END IF;

    SELECT string_agg(r.rolname || '=' ||
                      CASE WHEN has_function_privilege(r.rolname, v_oid, 'EXECUTE')
                           THEN 'EXECUTE' ELSE '-' END, ', ' ORDER BY r.rolname)
    INTO v_holders
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'), ('public')) AS r(rolname);

    RAISE NOTICE 'pre-flight: award_points EXECUTE before revoke -> %', v_holders;
END
$preflight$;


-- ----------------------------------------------------------------------------
-- The revoke.
--
-- ⚠️ All three lines are load-bearing. `REVOKE ... FROM PUBLIC` alone leaves
-- Supabase's direct default grants to anon and authenticated in place -- the
-- PUBLIC pseudo-role and a direct role grant are separate ACL entries, and
-- revoking one does not touch the other. This is the same footgun that
-- 20260903000000:11-30 documents, and the reason the probe above found anon
-- still executing despite no migration ever granting it.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.award_points(UUID, UUID, INTEGER, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.award_points(UUID, UUID, INTEGER, TEXT, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.award_points(UUID, UUID, INTEGER, TEXT, TEXT, JSONB) FROM authenticated;


-- ----------------------------------------------------------------------------
-- Post-flight: assert the revoke actually took, and that service_role survived.
--
-- Separate block from the COMMENT below on purpose. On 20260903000005 a
-- docstring failure would have rolled back the revoke it was documenting; the
-- lesson is that nothing cosmetic shares a transaction boundary with a
-- security change it can undo.
-- ----------------------------------------------------------------------------
DO $postflight$
DECLARE
    v_oid CONSTANT oid := to_regprocedure('public.award_points(uuid,uuid,integer,text,text,jsonb)');
BEGIN
    IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'post-flight: anon STILL holds EXECUTE on award_points. The hole is open.';
    END IF;

    IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'post-flight: authenticated STILL holds EXECUTE on award_points. The hole is open.';
    END IF;

    IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION
            'post-flight: service_role LOST EXECUTE on award_points. The revoke was '
            'over-broad -- server-side award paths would break. Grant it back.';
    END IF;

    RAISE NOTICE 'post-flight OK: anon and authenticated revoked, service_role intact.';
END
$postflight$;


-- ----------------------------------------------------------------------------
-- Documentation, isolated so a failure here cannot undo the revoke above.
-- ----------------------------------------------------------------------------
DO $doc$
BEGIN
    EXECUTE $c$
        COMMENT ON FUNCTION public.award_points(UUID, UUID, INTEGER, TEXT, TEXT, JSONB) IS
        'SECURITY DEFINER, service_role only. Takes the member id and the point '
        'amount from its caller and performs NO auth.uid() check, so any client '
        'role holding EXECUTE can mint unlimited points onto any member of any '
        'tenant. anon and authenticated were revoked on 2026-09-04 '
        '(20260904000004) after production probes showed both could reach the '
        'function body using only the anon key published in customer-app. '
        'DO NOT GRANT THIS TO anon OR authenticated. To let a real session award '
        'its own points, re-key the body onto auth.uid() first -- see the '
        'loyalty-session plan, stage S2.';
    $c$;
END
$doc$;

NOTIFY pgrst, 'reload schema';
