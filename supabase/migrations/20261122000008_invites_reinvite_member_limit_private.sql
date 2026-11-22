-- ============================================================================
-- Re-inviting works; the member-limit functions are server-only
-- (plan twinkling-coalescing-sutherland, items 2 and 3)
-- ============================================================================
--
-- 2. organization_invitations was made with UNIQUE(organization_id, email)
--    (database/settings-migration.sql, hand-applied). Cancel only sets status = 'cancelled', so
--    that row blocked every later invite to the address, including re-inviting someone who left.
--    Now: at most one PENDING invite per address per org (case-insensitive), and any number of
--    cancelled / accepted / expired rows. Settings shows the 23505 as "already has a pending
--    invitation. Use Resend." get_org_invitation and accept_org_invitation key on the token, so
--    they are unaffected; an old cancelled token still answers 'cancelled'.
--    The constraint is found in pg_constraint by its columns, not by an assumed name.
--
-- 3. get_org_member_limit, count_org_members and check_member_limit were EXECUTE to anon and
--    authenticated (20260315000007, database/member-limits-enforcement.sql): anyone with an org id
--    could read that org's customer count and cap. Their SQL callers (join_app; customer_app_signup,
--    already revoked by B1b) are SECURITY DEFINER and run as the owner, so the revoke does not touch
--    them. The pre-flight refuses to run if prod holds a caller that would break: a non-definer
--    function, a view or an RLS policy that names one of the three. service_role keeps EXECUTE.
--    The dashboard's cap warning calls the new org_member_usage, which answers the org's own
--    members only (NULL for anyone else) with the same {allowed, current, limit}.
-- ============================================================================

-- Pre-flight: everything this needs exists, and nothing would break.
DO $preflight$
DECLARE
    v_dups TEXT;
    v_callers TEXT;
    v_views TEXT;
    v_policies TEXT;
BEGIN
    IF to_regclass('public.organization_invitations') IS NULL THEN
        RAISE EXCEPTION 'pre-flight: organization_invitations is missing.';
    END IF;
    IF to_regclass('public.organization_members') IS NULL THEN
        RAISE EXCEPTION 'pre-flight: organization_members is missing.';
    END IF;
    IF to_regprocedure('public.get_org_member_limit(uuid)') IS NULL
       OR to_regprocedure('public.count_org_members(uuid)') IS NULL
       OR to_regprocedure('public.check_member_limit(uuid)') IS NULL THEN
        RAISE EXCEPTION 'pre-flight: a member-limit function (uuid) is missing.';
    END IF;

    -- The new index would fail on these anyway; say which orgs (no addresses printed).
    SELECT string_agg(format('org %s: %s pending to one address', organization_id, n), '; ')
    INTO v_dups
    FROM (
        SELECT organization_id, lower(email) AS e, count(*) AS n
        FROM public.organization_invitations
        WHERE status = 'pending'
        GROUP BY 1, 2
        HAVING count(*) > 1
    ) d;
    IF v_dups IS NOT NULL THEN
        RAISE EXCEPTION 'pre-flight: duplicate pending invitations: %', v_dups;
    END IF;

    -- A caller that runs as the client role would start failing with 42501.
    SELECT string_agg(p.oid::regprocedure::TEXT, '; ')
    INTO v_callers
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT p.prosecdef
      AND p.proname NOT IN ('get_org_member_limit', 'count_org_members', 'check_member_limit')
      AND p.prosrc ~ '(get_org_member_limit|count_org_members|check_member_limit)';
    IF v_callers IS NOT NULL THEN
        RAISE EXCEPTION 'pre-flight: non-definer function(s) call a member-limit function: %', v_callers;
    END IF;

    SELECT string_agg(format('%I.%I', schemaname, viewname), '; ')
    INTO v_views
    FROM pg_views
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      AND definition ~ '(get_org_member_limit|count_org_members|check_member_limit)';
    IF v_views IS NOT NULL THEN
        RAISE EXCEPTION 'pre-flight: view(s) call a member-limit function: %', v_views;
    END IF;

    SELECT string_agg(format('%s on %s', pol.polname, pol.polrelid::regclass), '; ')
    INTO v_policies
    FROM pg_policy pol
    WHERE coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
          coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
          ~ '(get_org_member_limit|count_org_members|check_member_limit)';
    IF v_policies IS NOT NULL THEN
        RAISE EXCEPTION 'pre-flight: RLS policy(ies) call a member-limit function: %', v_policies;
    END IF;

    RAISE NOTICE 'pre-flight OK: no duplicate pending invitations, no client-role callers.';
END
$preflight$;

-- ── 2. One pending invite per address per org ────────────────────────────────
DO $reinvite$
DECLARE
    r RECORD;
    v_dropped TEXT[] := '{}';
BEGIN
    -- Unique constraints on exactly (organization_id, email), whatever they are called.
    FOR r IN
        SELECT c.conname
        FROM pg_constraint c
        WHERE c.conrelid = 'public.organization_invitations'::regclass
          AND c.contype = 'u'
          AND (SELECT array_agg(a.attname::TEXT ORDER BY a.attname::TEXT)
               FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k)
              = ARRAY['email', 'organization_id']
    LOOP
        EXECUTE format('ALTER TABLE public.organization_invitations DROP CONSTRAINT %I', r.conname);
        v_dropped := v_dropped || r.conname::TEXT;
    END LOOP;
    -- ...and a plain unique index on the same columns, if one was made by hand instead.
    FOR r IN
        SELECT ic.relname
        FROM pg_index i
        JOIN pg_class ic ON ic.oid = i.indexrelid
        WHERE i.indrelid = 'public.organization_invitations'::regclass
          AND i.indisunique AND NOT i.indisprimary
          AND i.indpred IS NULL AND i.indexprs IS NULL
          AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
          AND (SELECT array_agg(a.attname::TEXT ORDER BY a.attname::TEXT)
               FROM unnest(i.indkey::int2[]) k JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k)
              = ARRAY['email', 'organization_id']
    LOOP
        EXECUTE format('DROP INDEX public.%I', r.relname);
        v_dropped := v_dropped || r.relname::TEXT;
    END LOOP;
    RAISE NOTICE 'dropped % unique rule(s) on (organization_id, email): %',
        coalesce(array_length(v_dropped, 1), 0), array_to_string(v_dropped, ', ');
END
$reinvite$;

CREATE UNIQUE INDEX IF NOT EXISTS organization_invitations_one_pending
    ON public.organization_invitations (organization_id, lower(email))
    WHERE status = 'pending';

-- ── 3. The member-limit functions: server only ───────────────────────────────
REVOKE ALL ON FUNCTION public.get_org_member_limit(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.count_org_members(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_member_limit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_member_limit(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.count_org_members(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_member_limit(uuid) TO service_role;

-- The dashboard's 80% / full warning: the org's own members only.
CREATE OR REPLACE FUNCTION public.org_member_usage(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NULL OR p_org_id IS NULL THEN
        RETURN NULL;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.organization_members m
        WHERE m.organization_id = p_org_id AND m.user_id = v_uid
    ) THEN
        RETURN NULL;
    END IF;
    RETURN public.check_member_limit(p_org_id);
END;
$$;

REVOKE ALL ON FUNCTION public.org_member_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_member_usage(uuid) TO authenticated, service_role;

-- Post-flight.
DO $postflight$
DECLARE
    v_fn TEXT;
BEGIN
    FOREACH v_fn IN ARRAY ARRAY['public.get_org_member_limit(uuid)', 'public.count_org_members(uuid)', 'public.check_member_limit(uuid)'] LOOP
        IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
            RAISE EXCEPTION 'post-flight: % is still client-callable.', v_fn;
        END IF;
        IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
            RAISE EXCEPTION 'post-flight: service_role lost EXECUTE on %.', v_fn;
        END IF;
    END LOOP;
    IF has_function_privilege('anon', 'public.org_member_usage(uuid)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.org_member_usage(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'post-flight: org_member_usage must be authenticated-only.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = 'public.organization_invitations'::regclass AND c.contype = 'u'
          AND (SELECT array_agg(a.attname::TEXT ORDER BY a.attname::TEXT)
               FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k)
              = ARRAY['email', 'organization_id']
    ) THEN
        RAISE EXCEPTION 'post-flight: UNIQUE(organization_id, email) is still there.';
    END IF;
    IF to_regclass('public.organization_invitations_one_pending') IS NULL THEN
        RAISE EXCEPTION 'post-flight: organization_invitations_one_pending is missing.';
    END IF;
    RAISE NOTICE 'post-flight OK.';
END
$postflight$;

NOTIFY pgrst, 'reload schema';
