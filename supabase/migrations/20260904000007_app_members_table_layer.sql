-- ⚠️ TOUCHES THE OWNER DASHBOARD AND VIIBEVIEW. Closes direct table access to
-- app_members for anon and narrows it for authenticated.
--
-- Read this whole header before pushing. Unlike the two files before it, this
-- one can break live surfaces that work today, and the two things it must NOT
-- break are named explicitly below with file:line.
--
-- Why this file exists at all
-- ---------------------------
-- 20260904000005 and 20260904000006 revoked 11 SECURITY DEFINER member RPCs.
-- Every one of those revokes is COSMETIC if a client role can just PATCH the
-- table directly, and on 2026-09-04 it could. Two production probes:
--
--   1. Signed in as a real ViibeView member (jay+tester1@24hour.design, a
--      genuine session — proven first by get_social_member returning that
--      member's row), PATCH /rest/v1/app_members?id=eq.<nil uuid> returned
--      HTTP 204 for EVERY column tried: points_balance, tier, pin_hash, email,
--      app_id, auth_token, display_name, deleted_at. 204, not 42501, means the
--      column privilege check passed; only the RLS row filter kept it to zero
--      rows. The RLS UPDATE policy is `user_id = auth.uid()` with NO column
--      restriction (20260821000002:58-63), so on their OWN row every one of
--      those writes would have landed. A member could set their own
--      points_balance and tier directly and never touch an RPC.
--
--   2. As plain anon, INSERT into app_members with the REAL published ViibeView
--      app_id and a deliberate FK violation on referred_by returned 23503
--      "violates foreign key constraint app_members_referred_by_fkey" — a
--      CONSTRAINT error, which means RLS had already passed. Without the
--      deliberate violation the row would have been created. anon can mint
--      arbitrary memberships in any published app.
--
--      (The same INSERT with a nil app_id returns 42501 instead. That is not
--      the policy denying anon — it is the policy's own `is_published` check
--      finding no such app. Probing with a nil app_id here proves the OPPOSITE
--      of what it looks like it proves, which is why the real app_id was used.)
--
-- app_members has no table-level GRANT anywhere in the repo. Everything above
-- comes from Supabase's default privileges on public.
--
-- What cannot be done, so nobody re-proposes it
-- ---------------------------------------------
-- Tightening the RLS UPDATE policy so members can update themselves but not
-- their points IS NOT EXPRESSIBLE. A policy has no OLD reference, so
--
--     WITH CHECK (points_balance = OLD.points_balance)
--
-- cannot be written. Column-level GRANTs are the only mechanism, and they are
-- role-wide: the ViibeView member and the org owner are BOTH `authenticated`,
-- so any column an owner needs is a column a member gets. That is why §3 drops
-- the member UPDATE policy entirely rather than trying to narrow it — with no
-- matching policy a member's PATCH matches zero rows no matter what the column
-- grants say, and the owner keeps working through "Org can manage app members".
--
-- The premise §3 rests on, verified: customer-app/ contains ZERO occurrences of
-- .from('app_members'). The member client never writes this table directly. It
-- goes through social_member_signup / update_social_profile, which are SECURITY
-- DEFINER and bypass RLS.
--
-- 🔴 The two things this must not break
-- -------------------------------------
--   app/venues.html:1709-1712  — removeMember() does
--       .from('app_members').update({ deleted_at, user_id: null }).eq('id', …)
--     as the signed-in ORG OWNER. It is the only direct client UPDATE on this
--     table in the entire repo. §4 grants exactly those two columns back.
--
--   app/dashboard.js:872-873  — select('*', { count:'exact', head:true }).
--     ⚠️ NEVER column-restrict SELECT on this table. select('*') needs SELECT on
--     every column, and a column grant that omits one turns the member count
--     into a 42501. SELECT is not touched anywhere in this file.
--
-- Accepted residual
-- -----------------
-- A member can still SELECT their own row, including pin_hash and auth_token,
-- via "Members can read own membership". Not fixable with column grants without
-- breaking dashboard.js's select('*'). Recorded in COMMENT ON TABLE below. It
-- leaks only to the row's own owner, and G5 (20260904000006) established that
-- no live row has a pin_hash at all.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Pre-flight: record the before-state, and refuse to run blind.
-- ----------------------------------------------------------------------------
DO $preflight$
DECLARE
    v_rel CONSTANT regclass := to_regclass('public.app_members');
    v_cols CONSTANT TEXT[] := ARRAY[
        'points_balance','total_points_earned','total_points_redeemed','tier',
        'pin_hash','pin_hash_version','auth_token','email','phone','app_id',
        'customer_id','referral_code','profile_public','display_name','avatar_url'
    ];
    v_col TEXT;
    v_open TEXT[] := '{}';
    v_missing TEXT[] := '{}';
    v_rls BOOLEAN;
BEGIN
    IF v_rel IS NULL THEN
        RAISE EXCEPTION 'pre-flight: public.app_members does not exist.';
    END IF;

    SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid = v_rel;
    RAISE NOTICE 'pre-flight: app_members RLS enabled = %', v_rls;

    RAISE NOTICE 'pre-flight: anon table privs   -> SELECT=% INSERT=% UPDATE=% DELETE=%',
        has_table_privilege('anon', v_rel, 'SELECT'),
        has_table_privilege('anon', v_rel, 'INSERT'),
        has_table_privilege('anon', v_rel, 'UPDATE'),
        has_table_privilege('anon', v_rel, 'DELETE');
    RAISE NOTICE 'pre-flight: authenticated privs -> SELECT=% INSERT=% UPDATE=% DELETE=%',
        has_table_privilege('authenticated', v_rel, 'SELECT'),
        has_table_privilege('authenticated', v_rel, 'INSERT'),
        has_table_privilege('authenticated', v_rel, 'UPDATE'),
        has_table_privilege('authenticated', v_rel, 'DELETE');

    -- Which sensitive columns can a client role write today? This is the number
    -- the post-flight has to drive to zero, and printing it here is what stops
    -- an all-denied post-flight from passing vacuously.
    FOREACH v_col IN ARRAY v_cols LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema='public' AND table_name='app_members'
                         AND column_name=v_col) THEN
            v_missing := v_missing || v_col;
        ELSIF has_column_privilege('authenticated', v_rel, v_col, 'UPDATE')
           OR has_column_privilege('anon', v_rel, v_col, 'UPDATE') THEN
            v_open := v_open || v_col;
        END IF;
    END LOOP;

    -- ⚠️ A column named in the post-flight but absent from the table would make
    -- that assertion pass for the wrong reason. Fail loudly instead.
    IF array_length(v_missing, 1) > 0 THEN
        RAISE EXCEPTION
            'pre-flight: column(s) named in this migration do not exist on '
            'app_members: %. The post-flight assertions on them would pass '
            'vacuously. Fix the column list.', array_to_string(v_missing, ', ');
    END IF;

    IF array_length(v_open, 1) IS NULL THEN
        RAISE WARNING
            'pre-flight: no client role can UPDATE any sensitive column already. '
            'This file is a no-op on §4 and its post-flight will pass vacuously.';
    ELSE
        RAISE NOTICE 'pre-flight: % sensitive column(s) writable by a client role today: %',
            array_length(v_open, 1), array_to_string(v_open, ', ');
    END IF;

    -- The two policies that must survive.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                     AND tablename='app_members' AND policyname='Org can manage app members') THEN
        RAISE EXCEPTION
            'pre-flight: "Org can manage app members" is ALREADY MISSING. That is '
            'the owner''s only path to this table (FOR ALL). Do not proceed — '
            'restore it from database/customer-apps-migration.sql:449-453 first.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                     AND tablename='app_members' AND policyname='Members can read own membership') THEN
        RAISE EXCEPTION
            'pre-flight: "Members can read own membership" is ALREADY MISSING. '
            'ViibeView members cannot read their own row. Restore it from '
            '20260821000002:53-56 first.';
    END IF;

    RAISE NOTICE 'pre-flight OK: both keeper policies present.';
END
$preflight$;


-- ============================================================================
-- 1. anon loses every write verb on the table.
--
-- Deliberately NOT `REVOKE ALL`, and SELECT is deliberately UNTOUCHED. anon's
-- SELECT is already inert under RLS — no policy grants anon a readable row —
-- and revoking it risks breaking an unknown view, embed or PostgREST resource
-- embedding for no security gain. Take the writes, leave the read.
-- ============================================================================
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON public.app_members FROM anon;


-- ============================================================================
-- 2. Drop the roleless INSERT policy.
--
-- database/customer-apps-migration.sql:461-471 is:
--
--     CREATE POLICY "Public can join published apps" ON app_members
--         FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM customer_apps ca
--             WHERE ca.id = app_members.app_id AND ca.is_published = true ...));
--
-- No TO clause, so it defaults to PUBLIC — anon included. Its only condition is
-- that the target app be published. That is not an authorization check; it is a
-- check on the victim.
--
-- ⚠️ THIS DOES NOT BREAK SIGNUP, and signup deliberately stays ON — see
-- 20260904000006's header. Both signup paths are SECURITY DEFINER and bypass
-- RLS entirely, so neither needs an INSERT policy:
--     customer_app_signup   20260315000007:138, confirmed SECURITY DEFINER at
--                           the tail of its body. Loyalty + newsletter join.
--     social_member_signup  20260821000002:69. ViibeView.
-- The post-flight below asserts both are still callable. What this DROP removes
-- is the ability to bypass those functions and write the table raw.
--
-- ⚠️ database/supabase-performance-policies-indexes.sql:632 annotates this
-- policy "uses no auth.uid() -- SKIP". That is a PERFORMANCE-LINTER exemption:
-- the linter's rule is "wrap auth.uid() in a subselect", and a policy with no
-- auth.uid() has nothing to wrap, so it skips it. It is not, and was never, a
-- security review finding. The absence of auth.uid() is precisely the bug.
-- ============================================================================
DROP POLICY IF EXISTS "Public can join published apps" ON public.app_members;


-- ============================================================================
-- 3. Drop the member UPDATE policy.
--
-- 20260821000002:58-63, `USING (user_id = auth.uid())` with a matching
-- WITH CHECK and NO column restriction. It is the highest-leverage line in this
-- file: with no UPDATE policy in force for a member, their PATCH matches zero
-- rows regardless of what column grants exist, now or after any future grant.
--
-- Safe because customer-app/ contains ZERO .from('app_members') calls — the
-- member client has never written this table directly. Profile writes go
-- through update_social_profile (SECURITY DEFINER, 20260904000002), which is
-- unaffected by RLS.
--
-- The owner keeps writing through "Org can manage app members" (FOR ALL),
-- which is NOT dropped and is asserted present below.
-- ============================================================================
DROP POLICY IF EXISTS "Members can update own membership" ON public.app_members;


-- ============================================================================
-- 4. authenticated keeps UPDATE on exactly two columns.
--
-- Belt and braces on top of §3. §3 removes the member's row-level path; this
-- removes the column-level privilege, so a future policy added without this
-- file's context cannot silently re-open points_balance.
--
-- 🔴 deleted_at and user_id, EXACTLY. app/venues.html:1709-1712 writes
--    { deleted_at, user_id: null } and is the ONLY direct client UPDATE on this
--    table in the repo. Removing a member from the owner dashboard needs both.
--    An allow-list also means any column added to app_members later is denied
--    by default rather than inheriting a blanket grant.
--
-- Column-level GRANT UPDATE only applies where a policy already lets the row
-- through, so this does not hand members anything §3 took away.
-- ============================================================================
REVOKE UPDATE ON public.app_members FROM authenticated;
GRANT UPDATE (deleted_at, user_id) ON public.app_members TO authenticated;


-- ----------------------------------------------------------------------------
-- Post-flight. Collect every failure before raising; a file that stops at its
-- first problem hides the rest.
-- ----------------------------------------------------------------------------
DO $postflight$
DECLARE
    v_rel CONSTANT regclass := to_regclass('public.app_members');
    v_cols CONSTANT TEXT[] := ARRAY[
        'points_balance','total_points_earned','total_points_redeemed','tier',
        'pin_hash','pin_hash_version','auth_token','email','phone','app_id',
        'customer_id','referral_code','profile_public','display_name','avatar_url'
    ];
    v_col TEXT;
    v_role TEXT;
    v_fail TEXT[] := '{}';
    v_rls BOOLEAN;
    v_force BOOLEAN;
BEGIN
    SELECT relrowsecurity, relforcerowsecurity INTO v_rls, v_force
    FROM pg_class WHERE oid = v_rel;

    IF NOT v_rls THEN
        v_fail := v_fail || 'RLS is DISABLED on app_members — every policy above is decorative';
    END IF;

    -- ⚠️ FORCE would subject the TABLE OWNER to RLS, which breaks every
    -- SECURITY DEFINER RPC that touches this table — ViibeView's signup,
    -- profile and feed included. Nothing here sets it; assert it anyway.
    IF v_force THEN
        v_fail := v_fail || 'FORCE ROW LEVEL SECURITY is ON — this breaks every SECURITY DEFINER RPC on app_members, ViibeView included. ALTER TABLE public.app_members NO FORCE ROW LEVEL SECURITY;';
    END IF;

    -- No client role may write any sensitive column.
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
        FOREACH v_col IN ARRAY v_cols LOOP
            IF has_column_privilege(v_role, v_rel, v_col, 'UPDATE') THEN
                v_fail := v_fail || format('%s can still UPDATE %I', v_role, v_col);
            END IF;
        END LOOP;
    END LOOP;

    -- anon writes are gone.
    IF has_table_privilege('anon', v_rel, 'INSERT') THEN
        v_fail := v_fail || 'anon still holds INSERT on app_members';
    END IF;
    IF has_table_privilege('anon', v_rel, 'UPDATE') THEN
        v_fail := v_fail || 'anon still holds UPDATE on app_members';
    END IF;
    IF has_table_privilege('anon', v_rel, 'DELETE') THEN
        v_fail := v_fail || 'anon still holds DELETE on app_members';
    END IF;

    -- 🔴 The owner dashboard must keep working.
    IF NOT has_column_privilege('authenticated', v_rel, 'deleted_at', 'UPDATE') THEN
        v_fail := v_fail || 'authenticated LOST UPDATE(deleted_at) — app/venues.html:1710 removeMember() is bricked';
    END IF;
    IF NOT has_column_privilege('authenticated', v_rel, 'user_id', 'UPDATE') THEN
        v_fail := v_fail || 'authenticated LOST UPDATE(user_id) — app/venues.html:1711 removeMember() is bricked';
    END IF;

    -- 🔴 dashboard.js:873 does select('*') and needs SELECT on every column.
    IF NOT has_table_privilege('authenticated', v_rel, 'SELECT') THEN
        v_fail := v_fail || 'authenticated LOST SELECT — app/dashboard.js:872-873 select(''*'') 42501s';
    END IF;
    FOREACH v_col IN ARRAY v_cols LOOP
        IF NOT has_column_privilege('authenticated', v_rel, v_col, 'SELECT') THEN
            v_fail := v_fail || format('authenticated LOST SELECT on %I — select(''*'') needs every column', v_col);
        END IF;
    END LOOP;

    -- service_role is how every server path and SECURITY DEFINER owner reaches this.
    IF NOT has_table_privilege('service_role', v_rel, 'UPDATE') THEN
        v_fail := v_fail || 'service_role LOST UPDATE — the revoke was over-broad';
    END IF;
    IF NOT has_table_privilege('service_role', v_rel, 'INSERT') THEN
        v_fail := v_fail || 'service_role LOST INSERT — the revoke was over-broad';
    END IF;

    -- Both keeper policies survived.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                     AND tablename='app_members' AND policyname='Org can manage app members') THEN
        v_fail := v_fail || '"Org can manage app members" is GONE — the owner has no path to this table at all';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                     AND tablename='app_members' AND policyname='Members can read own membership') THEN
        v_fail := v_fail || '"Members can read own membership" is GONE — ViibeView members cannot read their own row';
    END IF;

    -- And the two that should not.
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='app_members' AND policyname='Public can join published apps') THEN
        v_fail := v_fail || '"Public can join published apps" SURVIVED — anon can still INSERT memberships';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='app_members' AND policyname='Members can update own membership') THEN
        v_fail := v_fail || '"Members can update own membership" SURVIVED — members can still self-write';
    END IF;

    IF array_length(v_fail, 1) > 0 THEN
        RAISE EXCEPTION 'post-flight FAILED on % check(s):%s',
            array_length(v_fail, 1), E'\n  ' || array_to_string(v_fail, E'\n  ');
    END IF;

    RAISE NOTICE 'post-flight OK: anon has no writes, no client role can UPDATE any '
                 'sensitive column, authenticated keeps UPDATE(deleted_at,user_id) and '
                 'full SELECT, service_role intact, both keeper policies present.';
END
$postflight$;


-- ----------------------------------------------------------------------------
-- 🔴 FUNCTIONALITY GUARD. Both signup paths must still be callable.
--
-- §2 drops the only INSERT policy on this table. That is safe ONLY because both
-- signup RPCs are SECURITY DEFINER and bypass RLS. If either ever stops being
-- SECURITY DEFINER, dropping that policy turns signup off — so assert the
-- property this file depends on rather than trusting the comment above.
-- ----------------------------------------------------------------------------
DO $functionality$
DECLARE
    v_fn TEXT;
    v_oid oid;
    v_fail TEXT[] := '{}';
    v_secdef BOOLEAN;
BEGIN
    FOREACH v_fn IN ARRAY ARRAY[
        'public.customer_app_signup(uuid,text,text,text,text,text)',
        'public.social_member_signup(uuid,text,text,text)'
    ] LOOP
        v_oid := to_regprocedure(v_fn);
        IF v_oid IS NULL THEN
            v_fail := v_fail || (v_fn || ' [DOES NOT EXIST]');
            CONTINUE;
        END IF;

        SELECT prosecdef INTO v_secdef FROM pg_proc WHERE oid = v_oid;
        IF NOT v_secdef THEN
            v_fail := v_fail || (v_fn ||
                ' [NOT SECURITY DEFINER — it needs an INSERT policy on app_members, '
                'and §2 just dropped the only one. Signup is OFF.]');
        END IF;
    END LOOP;

    -- The join page calls signup with the published anon key.
    IF NOT has_function_privilege('anon',
             to_regprocedure('public.customer_app_signup(uuid,text,text,text,text,text)'),
             'EXECUTE') THEN
        v_fail := v_fail || 'customer_app_signup [anon LOST EXECUTE — /a/:slug join page is off]';
    END IF;

    IF array_length(v_fail, 1) > 0 THEN
        RAISE EXCEPTION
            'post-flight FUNCTIONALITY GUARD FAILED on % check(s). Member signup is '
            'broken and this file is why:%',
            array_length(v_fail, 1), E'\n  ' || array_to_string(v_fail, E'\n  ');
    END IF;

    RAISE NOTICE 'post-flight OK: both signup RPCs exist, are SECURITY DEFINER (so they '
                 'bypass the dropped INSERT policy) and customer_app_signup is still '
                 'anon-callable. Loyalty, newsletter and ViibeView signup all unaffected.';
END
$functionality$;


-- ----------------------------------------------------------------------------
-- Documentation, isolated so a failure here cannot roll back the changes above.
-- ----------------------------------------------------------------------------
DO $doc$
BEGIN
    EXECUTE $c$
        COMMENT ON TABLE public.app_members IS
        'Membership rows for customer apps. Table-layer access was closed on '
        '2026-09-04 (20260904000007) after production probes showed the 19 RPC '
        'revokes of 20260904000005/6 were bypassable: a signed-in member could '
        'PATCH points_balance and tier on their own row (the RLS UPDATE policy '
        'had no column restriction), and plain anon could INSERT memberships into '
        'any published app (the INSERT policy had no role predicate). '
        'NOW: anon has SELECT only, and it is inert — no policy grants anon a '
        'readable row. authenticated has SELECT plus UPDATE on exactly '
        '(deleted_at, user_id), for the owner dashboard''s remove-member action '
        '(app/venues.html:1709-1712). Writes otherwise go through SECURITY '
        'DEFINER RPCs. '
        '⚠️ DO NOT column-restrict SELECT — app/dashboard.js:872-873 does '
        'select(''*'', {count:''exact''}) and needs every column. '
        '⚠️ DO NOT enable FORCE ROW LEVEL SECURITY — it subjects the owner to RLS '
        'and breaks every SECURITY DEFINER RPC on this table. '
        '⚠️ A column-immutability policy IS NOT EXPRESSIBLE here: policies have no '
        'OLD reference, so WITH CHECK (points_balance = OLD.points_balance) cannot '
        'be written. Column GRANTs are the only mechanism and they are role-wide. '
        'ACCEPTED RESIDUAL: a member can SELECT their own row including pin_hash '
        'and auth_token via "Members can read own membership". Not fixable by '
        'column grant without breaking select(''*''). No live row has a pin_hash.';
    $c$;
END
$doc$;

NOTIFY pgrst, 'reload schema';
