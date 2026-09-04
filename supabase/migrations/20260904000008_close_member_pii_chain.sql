-- ============================================================================
-- Close the member PII harvest chain. NO REVOKE, NO 42501, NO GRANT CHANGE.
--
-- The chain, verified live against production on 2026-09-04 with nothing but
-- the anon key published in customer-app/social.js:8:
--
--   1. get_app_leaderboard(p_app_id => <viibeview>)  -> app_members.id per member
--   2. get_member_profile(p_member_id => <that id>)  -> first_name, last_name,
--                                                       email, phone
--
-- Two unauthenticated requests returned every ViibeView member's full name,
-- email address and phone number. Three real rows came back, one of them a
-- third-party user.
--
-- The sting: BOTH functions are loyalty-only. customer-app/social.js never
-- calls either one. The product with zero reachable users was leaking the PII
-- of the product that has real ones.
--
-- Why this file changes SHAPES and not GRANTS
-- -------------------------------------------
-- 20260904000005 closed the 6 member RPCs that no working client called, and
-- deliberately left 7 open because customer-app/app.html calls them and a
-- revoke would have switched off live product surface. These two are in that
-- left-open set. Revoking them now would still break the loyalty leaderboard
-- and profile screen, so instead of removing ACCESS we remove the DATA:
--
--   §1  the leaderboard stops handing out member ids  -> step 1 yields nothing
--                                                        to dereference
--   §2  the profile RPC stops returning contact details -> step 2 yields no PII
--
-- Every current call site keeps working. app.html is updated in the same commit
-- because the two halves are not independently correct (see the § notes).
--
-- The structural fix — a token-verifying gateway that derives the member id
-- from a verified session instead of the request body, and restores loyalty
-- login (broken since 20260315000007) — remains the follow-on. This file makes
-- the harvest chain dead in the meantime; it does not make these functions safe.
--
-- Why DROP + CREATE and not CREATE OR REPLACE
-- -------------------------------------------
-- Both functions change their RETURN TYPE. Postgres answers CREATE OR REPLACE
-- with "cannot change return type of existing function" (42P13). Each needs an
-- explicit DROP first. That fails loudly rather than silently, but the DROP has
-- two consequences that do NOT fail loudly, and both are handled below:
--   - a DROP takes the function's GRANTS with it  -> every recreate re-GRANTs
--   - a DROP of the wrong overload is silent      -> §2's 🔴 warning
--
-- Still deliberately open, unchanged by this file: get_member_activity,
-- redeem_reward, submit_reward_suggestion, get_my_tickets,
-- get_customer_unread_count, customer_reply_to_ticket. get_member_activity in
-- particular still returns any member's points history to anyone holding a
-- member id — its severity drops sharply once §1 stops publishing ids, and it
-- carries no name, email or phone. All are re-keyed by the gateway.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Pre-flight: record the before-state and prove this file is not a no-op.
--
-- ⚠️ A green post-flight proves nothing if the shapes were already correct when
-- the file ran. These NOTICEs are the evidence the migration did work, so read
-- them on the push rather than trusting the absence of an error.
-- ----------------------------------------------------------------------------
DO $preflight$
DECLARE
    v_lb_old      oid := to_regprocedure('public.get_app_leaderboard(uuid,integer)');
    v_prof_1arg   oid := to_regprocedure('public.get_member_profile(uuid)');
    v_prof_2arg   oid := to_regprocedure('public.get_member_profile(uuid,uuid)');
    v_missing     TEXT[] := '{}';
    v_leaks       INTEGER := 0;
BEGIN
    -- Both targets must exist. DROP FUNCTION without IF EXISTS raises 42883 and
    -- aborts the push; with IF EXISTS it would silently no-op and the CREATE
    -- would then fail on the return type. Name every absentee at once.
    IF v_lb_old IS NULL THEN
        v_missing := v_missing || 'public.get_app_leaderboard(uuid,integer)';
    END IF;
    IF v_prof_1arg IS NULL THEN
        v_missing := v_missing || 'public.get_member_profile(uuid)';
    END IF;

    IF array_length(v_missing, 1) > 0 THEN
        RAISE EXCEPTION
            'pre-flight: % target signature(s) do not exist: %. The signature '
            'drifted since 2026-09-04 — find the live one with '
            '\df public.get_app_leaderboard before assuming this file still applies.',
            array_length(v_missing, 1), array_to_string(v_missing, ', ');
    END IF;

    -- 🔴 The one that must SURVIVE. If it is already gone, something else broke
    -- ViibeView's profile overlay and this file is not the culprit — but do not
    -- let the post-flight below report that pre-existing breakage as ours.
    IF v_prof_2arg IS NULL THEN
        RAISE EXCEPTION
            'pre-flight: public.get_member_profile(uuid,uuid) — ViibeView''s '
            'profile overlay — DOES NOT EXIST before this file runs. Restore it '
            'from 20260903000002 first. Do not run this migration against a '
            'database that is already missing it.';
    END IF;

    -- The before-state of the leak itself, printed so the diff is on the record.
    IF pg_get_function_result(v_lb_old) ~ '\mid\M' THEN
        v_leaks := v_leaks + 1;
        RAISE NOTICE 'pre-flight: get_app_leaderboard(uuid,integer) RETURNS a member id today -> %',
            pg_get_function_result(v_lb_old);
    END IF;

    IF pg_get_function_result(v_prof_1arg) ~ '\memail\M'
       OR pg_get_function_result(v_prof_1arg) ~ '\mphone\M' THEN
        v_leaks := v_leaks + 1;
        RAISE NOTICE 'pre-flight: get_member_profile(uuid) RETURNS email/phone today -> %',
            pg_get_function_result(v_prof_1arg);
    END IF;

    IF v_leaks = 0 THEN
        RAISE WARNING
            'pre-flight: NEITHER function leaks today. This file is a no-op and '
            'the post-flight will pass vacuously. Find out what already reshaped '
            'them before reading the green as a fix.';
    ELSE
        RAISE NOTICE 'pre-flight: % of 2 legs of the PII chain are live right now.', v_leaks;
    END IF;

    RAISE NOTICE 'pre-flight: anon EXECUTE before — leaderboard=%, profile(1)=%, profile(2)=% '
                 '(all three must still be true at the end; a DROP takes grants with it).',
        has_function_privilege('anon', v_lb_old, 'EXECUTE'),
        has_function_privilege('anon', v_prof_1arg, 'EXECUTE'),
        has_function_privilege('anon', v_prof_2arg, 'EXECUTE');
END
$preflight$;


-- ----------------------------------------------------------------------------
-- §1 — get_app_leaderboard: stop returning app_members.id.
--
-- The id was added by 20260217000005 purely so the client could highlight
-- "this is you" (member.id === currentMember.id). That comparison is now made
-- SERVER-side and only the boolean comes back, so the leaderboard publishes
-- nothing dereferenceable while the highlight survives.
--
-- p_member_id is the caller's OWN id, which app.html already holds in
-- localStorage. Passing someone else's id reveals nothing: is_me would come
-- back true on a row whose id you already had to know to ask the question.
-- Nothing is enumerable either way.
--
-- ⚠️ THE DROP IS MANDATORY, NOT TIDINESS. Leaving the 2-arg form in place
-- alongside the new 3-arg one creates an overload whose extra arguments are all
-- DEFAULTable, so `get_app_leaderboard(app, 10)` matches BOTH. Postgres reports
-- that as 42725 "function is not unique" at RUN time, not at deploy time — the
-- push goes green and the leaderboard breaks for real users later. Same trap
-- recorded for update_social_profile in 20260903000002.
--
-- The filter is unchanged: profile_public = true AND deleted_at IS NULL.
-- ----------------------------------------------------------------------------

DROP FUNCTION public.get_app_leaderboard(UUID, INTEGER);

CREATE FUNCTION public.get_app_leaderboard(
    p_app_id    UUID,
    p_limit     INTEGER DEFAULT 10,
    p_member_id UUID DEFAULT NULL
)
RETURNS TABLE (
    is_me BOOLEAN,
    rank BIGINT,
    display_name TEXT,
    avatar_url TEXT,
    points_balance INTEGER,
    tier TEXT,
    joined_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        (p_member_id IS NOT NULL AND am.id = p_member_id) AS is_me,
        ROW_NUMBER() OVER (ORDER BY am.points_balance DESC) AS rank,
        COALESCE(am.display_name, am.first_name, 'Anonymous') AS display_name,
        am.avatar_url,
        am.points_balance,
        am.tier,
        am.joined_at
    FROM app_members am
    WHERE am.app_id = p_app_id
      AND am.profile_public = true
      AND am.deleted_at IS NULL
    ORDER BY am.points_balance DESC
    LIMIT p_limit;
END;
$$;

-- ⚠️ NOT OPTIONAL. The DROP above took the old grants with it. Without this
-- line the leaderboard answers 42501 for every caller, signed in or not.
GRANT EXECUTE ON FUNCTION public.get_app_leaderboard(UUID, INTEGER, UUID) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- §2 — get_member_profile(UUID): stop returning email and phone.
--
-- Recreated identically minus those two columns. first_name and last_name stay
-- because app.html:2891 renders the member's own name from them; points, tier
-- and the two flags stay because app.html renders all of them and the
-- leaderboard already publishes points and tier for public profiles, so they
-- add no exposure this function did not already have.
--
-- This function has NO profile_public gate at all (20260217000004:30-37) — it
-- returns any live row by id, so the PRIVATE-profile case was worse than the
-- public one, which the leaderboard at least filtered. The gate is not added
-- here: it belongs with the gateway, which can tell a member from a stranger.
-- Dropping the PII is what makes the missing gate survivable in the meantime.
--
-- 🔴 THIS DROP IS THE ONE LINE IN THIS FILE THAT CAN BREAK VIIBEVIEW.
-- get_member_profile is legitimately OVERLOADED. The 2-arg (UUID, UUID) form is
-- ViibeView's profile overlay, is anon-readable BY DESIGN and ships with no
-- grant footer (20260903000002:350-363). A bare `DROP FUNCTION
-- get_member_profile` raises 42725 rather than guessing — but
-- `DROP FUNCTION get_member_profile(UUID, UUID)` would take the WRONG one and
-- succeed. Losing it empties every profile overlay SILENTLY: social.js:660
-- destructures { data } and never inspects error, so the client renders its
-- empty state over a permission failure it only logs.
-- Type-qualified to the 1-arg form, and the post-flight asserts the 2-arg
-- survived WITH its anon grant.
-- ----------------------------------------------------------------------------

DROP FUNCTION public.get_member_profile(UUID);

CREATE FUNCTION public.get_member_profile(p_member_id UUID)
RETURNS TABLE (
    id UUID,
    app_id UUID,
    first_name TEXT,
    last_name TEXT,
    display_name TEXT,
    points_balance INTEGER,
    total_points_earned INTEGER,
    tier TEXT,
    profile_public BOOLEAN,
    notifications_enabled BOOLEAN,
    joined_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        am.id, am.app_id, am.first_name, am.last_name, am.display_name,
        am.points_balance, am.total_points_earned,
        am.tier, am.profile_public, am.notifications_enabled, am.joined_at
    FROM app_members am
    WHERE am.id = p_member_id
      AND am.deleted_at IS NULL;
END;
$$;

-- ⚠️ NOT OPTIONAL — same reason as §1. Restores exactly what 20260217000004:40
-- granted; this is not a widening.
GRANT EXECUTE ON FUNCTION public.get_member_profile(UUID) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- Post-flight: assert the SHAPES, which is what this file actually changes,
-- plus the grants a DROP silently takes away. Collect every failure before
-- raising — a file that stops at the first hides the rest.
--
-- \m and \M are Postgres word boundaries. A plain LIKE '%id%' would match
-- avatar_url and a bare 'email' check would match nothing useful; the shape
-- string is the assertion target and it has to be read precisely.
-- ----------------------------------------------------------------------------
DO $postflight$
DECLARE
    v_lb_new    oid := to_regprocedure('public.get_app_leaderboard(uuid,integer,uuid)');
    v_lb_old    oid := to_regprocedure('public.get_app_leaderboard(uuid,integer)');
    v_prof_1arg oid := to_regprocedure('public.get_member_profile(uuid)');
    v_prof_2arg oid := to_regprocedure('public.get_member_profile(uuid,uuid)');
    v_fail      TEXT[] := '{}';
    v_shape     TEXT;
BEGIN
    -- --- §1 shape ---
    IF v_lb_new IS NULL THEN
        v_fail := v_fail || 'get_app_leaderboard(uuid,integer,uuid) was not created';
    ELSE
        v_shape := pg_get_function_result(v_lb_new);
        IF v_shape ~ '\mid\M' THEN
            v_fail := v_fail || format(
                'get_app_leaderboard STILL returns a bare id — the harvest chain is '
                'not closed. Shape: %s', v_shape);
        END IF;
        IF v_shape !~ '\mis_me\M' THEN
            v_fail := v_fail || format(
                'get_app_leaderboard does not return is_me — the "this is you" '
                'highlight will be dead. Shape: %s', v_shape);
        END IF;
        IF NOT has_function_privilege('anon', v_lb_new, 'EXECUTE') THEN
            v_fail := v_fail ||
                'anon LOST EXECUTE on get_app_leaderboard(uuid,integer,uuid) — the DROP '
                'took the grant and it was not restored. Fix: GRANT EXECUTE ON FUNCTION '
                'public.get_app_leaderboard(UUID, INTEGER, UUID) TO anon, authenticated;';
        END IF;
    END IF;

    -- 🔴 Proves the old overload is GONE, not merely shadowed by the new one.
    -- If both exist, get_app_leaderboard(app, 10) is ambiguous at RUN time.
    IF v_lb_old IS NOT NULL THEN
        v_fail := v_fail ||
            'the OLD get_app_leaderboard(uuid,integer) still exists. It is now an '
            'ambiguous overload with the 3-arg form and will raise 42725 "function is '
            'not unique" for real users while this push reports green. Fix: '
            'DROP FUNCTION public.get_app_leaderboard(UUID, INTEGER);';
    END IF;

    -- --- §2 shape ---
    IF v_prof_1arg IS NULL THEN
        v_fail := v_fail || 'get_member_profile(uuid) was not created — the loyalty '
                            'profile screen is now dead';
    ELSE
        v_shape := pg_get_function_result(v_prof_1arg);
        IF v_shape ~ '\memail\M' THEN
            v_fail := v_fail || format(
                'get_member_profile(uuid) STILL returns email. Shape: %s', v_shape);
        END IF;
        IF v_shape ~ '\mphone\M' THEN
            v_fail := v_fail || format(
                'get_member_profile(uuid) STILL returns phone. Shape: %s', v_shape);
        END IF;
        IF NOT has_function_privilege('anon', v_prof_1arg, 'EXECUTE') THEN
            v_fail := v_fail ||
                'anon LOST EXECUTE on get_member_profile(uuid). Fix: GRANT EXECUTE ON '
                'FUNCTION public.get_member_profile(UUID) TO anon, authenticated;';
        END IF;
    END IF;

    -- 🔴 THE ONE THAT MUST HAVE SURVIVED. Checked for existence AND grant,
    -- because losing either empties every ViibeView profile overlay silently.
    IF v_prof_2arg IS NULL THEN
        v_fail := v_fail ||
            '🔴 get_member_profile(uuid,uuid) IS GONE. The §2 DROP hit ViibeView''s '
            'profile overlay instead of the loyalty function. Every profile overlay '
            'is now empty and fails SILENTLY (social.js:660 ignores error). Restore '
            'it from 20260903000002 section 6 immediately.';
    ELSIF NOT has_function_privilege('anon', v_prof_2arg, 'EXECUTE') THEN
        v_fail := v_fail ||
            '🔴 anon LOST EXECUTE on get_member_profile(uuid,uuid). Signed-out '
            'visitors get an empty profile overlay with no error shown. Fix: '
            'GRANT EXECUTE ON FUNCTION public.get_member_profile(UUID, UUID) TO anon, '
            'authenticated;';
    END IF;

    IF array_length(v_fail, 1) > 0 THEN
        RAISE EXCEPTION 'post-flight: % failure(s): %',
            array_length(v_fail, 1), array_to_string(v_fail, ' || ');
    END IF;

    RAISE NOTICE 'post-flight OK: leaderboard publishes is_me and no id; '
                 'get_member_profile(uuid) returns neither email nor phone; the old '
                 '2-arg leaderboard overload is gone; ViibeView''s '
                 'get_member_profile(uuid,uuid) survived with its anon grant.';
END
$postflight$;


-- ----------------------------------------------------------------------------
-- 🔴 Functionality guard, separate from the security post-flight above.
--
-- The security assertions can all pass on a database where every loyalty caller
-- is broken. This block asserts the opposite direction: that the call sites
-- app.html and social.js depend on are still executable by anon. Phase A's
-- lesson — assert the must-stay-OPEN direction too, or a "successful" security
-- migration silently ships an outage.
-- ----------------------------------------------------------------------------
DO $functionality$
DECLARE
    v_sites CONSTANT TEXT[][] := ARRAY[
        ['public.get_app_leaderboard(uuid,integer,uuid)', 'app.html:3001 leaderboard'],
        ['public.get_member_profile(uuid)',               'app.html:2817 loyalty profile'],
        ['public.get_member_profile(uuid,uuid)',          'social.js:660 ViibeView profile overlay'],
        ['public.get_member_posts(uuid,uuid,integer,integer)', 'social.js member grid'],
        ['public.get_member_activity(uuid,integer)',      'app.html activity feed']
    ];
    v_i     INTEGER;
    v_oid   oid;
    v_dead  TEXT[] := '{}';
BEGIN
    FOR v_i IN 1 .. array_length(v_sites, 1) LOOP
        v_oid := to_regprocedure(v_sites[v_i][1]);
        IF v_oid IS NULL THEN
            v_dead := v_dead || format('%s (%s) DOES NOT EXIST', v_sites[v_i][1], v_sites[v_i][2]);
        ELSIF NOT has_function_privilege('anon', v_oid, 'EXECUTE') THEN
            v_dead := v_dead || format('%s (%s) NOT EXECUTABLE BY anon', v_sites[v_i][1], v_sites[v_i][2]);
        END IF;
    END LOOP;

    IF array_length(v_dead, 1) > 0 THEN
        RAISE EXCEPTION
            '🔴 functionality guard: % live call site(s) broken by this migration: %. '
            'This file is not allowed to cost functionality — it reshapes return '
            'types and changes no grants.',
            array_length(v_dead, 1), array_to_string(v_dead, ' || ');
    END IF;

    RAISE NOTICE 'functionality guard OK: all 5 live call sites still callable by anon — '
                 'loyalty leaderboard, loyalty profile, ViibeView overlay, member grid, activity.';
END
$functionality$;


-- ----------------------------------------------------------------------------
-- Documentation. Each COMMENT isolated in its own DO block so a docstring
-- failure can never roll back the DDL it documents — 20260903000005's lesson.
-- ----------------------------------------------------------------------------
DO $doc$
BEGIN
    EXECUTE $c$
        COMMENT ON FUNCTION public.get_app_leaderboard(UUID, INTEGER, UUID) IS
        'Public leaderboard for a customer app. anon + authenticated by design — '
        'customer-app/app.html:3001 calls it from an unauthenticated page. '
        '⚠️ RETURNS NO MEMBER ID, DELIBERATELY. The 2-arg form (20260217000005) '
        'returned app_members.id for every public member, which anyone holding '
        'the published anon key could feed straight into get_member_profile to '
        'read that member''s name, email and phone. Reshaped 2026-09-04 '
        '(20260904000008): the "this is you" comparison is made server-side and '
        'only is_me comes back. p_member_id is the caller''s own id and reveals '
        'nothing — is_me on an id you already had to know. '
        'DO NOT re-add an id column to satisfy a client; pass the id IN instead.';
    $c$;
END
$doc$;

DO $doc$
BEGIN
    EXECUTE $c$
        COMMENT ON FUNCTION public.get_member_profile(UUID) IS
        'LOYALTY app member profile, one arg. anon + authenticated — '
        'customer-app/app.html:2817 calls it from an unauthenticated page. '
        '⚠️ RETURNS NO email AND NO phone, DELIBERATELY. Removed 2026-09-04 '
        '(20260904000008): this function has NO profile_public gate and returns '
        'any live row by id, so it was the dereference half of a two-request PII '
        'harvest chain fed by get_app_leaderboard. '
        '⚠️ STILL UNSAFE BY DESIGN: SECURITY DEFINER, member id taken from the '
        'caller, no auth.uid(). It is not private, it merely no longer carries '
        'contact details. The gateway re-keys it to a verified session. '
        '🔴 DO NOT DROP BY BARE NAME — the 2-arg (UUID, UUID) overload is '
        'ViibeView''s profile overlay and losing it fails silently.';
    $c$;
END
$doc$;

-- The 2-arg form is not modified by this file. The COMMENT is refreshed only to
-- record, at the place someone will actually look, that a neighbouring
-- migration drops its sibling — so the next person to write a DROP here reads
-- the warning before writing it, not after.
DO $doc$
BEGIN
    EXECUTE $c$
        COMMENT ON FUNCTION public.get_member_profile(UUID, UUID) IS
        'VIIBEVIEW social profile overlay, two args (p_app_id, p_user_id). Keys on '
        'app_members.user_id, NOT app_members.id — feeding it a member id returns '
        'zero rows, which is correct behaviour and NOT evidence that it is broken. '
        'Anon-readable BY DESIGN and ships with no grant footer (20260903000002): '
        'signed-out visitors browse the feed and must be able to open the profile '
        'behind a post. '
        '🔴 NEVER REVOKE, NEVER DROP. social.js:660 destructures { data } and never '
        'inspects error, so both failures render the empty state instead of an '
        'error — silent. 20260904000008 drops and recreates the 1-ARG loyalty '
        'sibling; that file is type-qualified and asserts this one survived.';
    $c$;
END
$doc$;


-- PostgREST caches the schema. Both functions changed signature, so without this
-- the API answers PGRST202 "function not found" for the new 3-arg leaderboard —
-- which reads as a broken migration rather than a stale cache.
NOTIFY pgrst, 'reload schema';
