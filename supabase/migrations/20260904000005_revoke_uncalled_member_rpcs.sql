-- Revoke anon+authenticated on 6 member RPCs that NO WORKING CLIENT CALLS.
-- ZERO functionality change on royaltyapp.ai. Nothing a live page does today
-- behaves differently after this file.
--
-- Why the scope is 6 and not 13
-- -----------------------------
-- The plan that commissioned this file revoked all 13 anon-reachable loyalty
-- member RPCs. Nine of those are called by customer-app/app.html — the live
-- loyalty app — so that scope would have switched off real product surface
-- (profile, activity, redemptions, reward suggestions, support tickets) to fix
-- an access-control bug. That trade was rejected: we are not paying for
-- security with functionality when a better path exists.
--
-- This file takes only what is genuinely free. Full caller inventory taken
-- across the repo on 2026-09-04, excluding customer-app/app.js (dead — no HTML
-- loads it; grep for "app.js" finds only customer-app/sw.js:56, its precache
-- entry, and it is deleted in this same change):
--
--   REVOKED HERE — no working caller anywhere
--     update_member_setting        only app.js (dead)
--     save_fcm_token               only app.js (dead)
--     clear_fcm_token              only app.js (dead)
--     create_ticket_from_ai_chat   no caller at all, in any file
--     get_ticket_messages_for_customer  app.html — but see "never worked" below
--     get_ticket_ai_history             app.html — but see "never worked" below
--
--   DELIBERATELY LEFT OPEN — app.html calls these and they work
--     get_member_profile(uuid)   get_member_activity   redeem_reward
--     submit_reward_suggestion   get_my_tickets        get_customer_unread_count
--     customer_reply_to_ticket
--
-- The seven left open are still holes: SECURITY DEFINER, member id taken from
-- the caller, no auth.uid(). They are closed in the next stage, which routes
-- them through a token-verifying edge-function gateway that derives the member
-- id from a verified session instead of the request body. That stage removes
-- the exposure AND fixes loyalty login (broken since 20260315000007), so the
-- app comes out ahead rather than diminished. Closing them here would just
-- break them.
--
-- The two ticket RPCs, and why they count as free
-- -----------------------------------------------
-- get_ticket_messages_for_customer and get_ticket_ai_history ARE called by
-- app.html, so they are not "uncalled" in the strict sense. They are free
-- because they have never worked for anybody: both raise
--
--   42702  column reference "id" is ambiguous
--          It could refer to either a PL/pgSQL variable or a table column.
--
-- on every call, verified against production 2026-09-04. They abort before
-- returning a row, so they leak nothing and deliver nothing. Revoking changes
-- the error a broken feature returns from 42702 to 42501; it removes no working
-- behaviour.
-- ⚠️ CONSEQUENCE: whoever fixes the 42702 must ALSO route these through the
-- gateway or re-grant them. Fixing the SQL alone will leave the support-ticket
-- UI failing with a permission error instead of an ambiguity error. Both
-- COMMENTs below say so.
--
-- What this file does buy
-- -----------------------
-- update_member_setting, save_fcm_token and clear_fcm_token are SECURITY
-- DEFINER WRITES that take a member id from the caller with no auth.uid(), and
-- were reachable with the anon key published in customer-app/social.js:8.
-- Probed as anon on 2026-09-04 they returned P0001 "Member not found" — a BODY
-- error, meaning the permission check had already passed. Against a real member
-- id they would have changed that member's settings, or repointed their push
-- notifications at an attacker's device.
--
-- 42501 before the body runs is what a revoked function returns. award_points
-- and record_member_visit answered exactly that in the same probe run, from the
-- same key — they are the negative control proving the probe distinguishes the
-- two.
--
-- Scope: grants only. No body is touched, no table is altered. service_role
-- keeps EXECUTE, so every server-side path — including the deployed
-- generate-member-token edge function, which runs as service_role — is
-- unaffected.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Pre-flight: prove the signatures exist and record the before-state.
--
-- REVOKE has no IF EXISTS and raises 42883 on a missing function, which aborts
-- the whole push. Collect EVERY missing signature and name them at once.
-- Argument types only — names and DEFAULTs are not part of function identity.
-- ----------------------------------------------------------------------------
DO $preflight$
DECLARE
    v_fns CONSTANT TEXT[] := ARRAY[
        'public.update_member_setting(uuid,text,text)',
        'public.save_fcm_token(uuid,text)',
        'public.clear_fcm_token(uuid)',
        'public.create_ticket_from_ai_chat(uuid,uuid,uuid,text,text,text)',
        'public.get_ticket_messages_for_customer(uuid,uuid)',
        'public.get_ticket_ai_history(uuid,uuid)'
    ];
    v_fn TEXT;
    v_oid oid;
    v_missing TEXT[] := '{}';
    v_open INTEGER := 0;
BEGIN
    FOREACH v_fn IN ARRAY v_fns LOOP
        v_oid := to_regprocedure(v_fn);
        IF v_oid IS NULL THEN
            v_missing := v_missing || v_fn;
        ELSIF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
            v_open := v_open + 1;
        END IF;
    END LOOP;

    IF array_length(v_missing, 1) > 0 THEN
        RAISE EXCEPTION
            'pre-flight: % of % signature(s) do not exist: %. REVOKE would abort '
            'the push with 42883. The signature drifted — find the live one before '
            'assuming this file is a no-op.',
            array_length(v_missing, 1), array_length(v_fns, 1),
            array_to_string(v_missing, ', ');
    END IF;

    -- ⚠️ An all-42501 post-flight proves nothing if the file was already a no-op.
    IF v_open = 0 THEN
        RAISE WARNING
            'pre-flight: anon already holds EXECUTE on ZERO of the 6. This file is '
            'a no-op and the post-flight below will pass vacuously. Find out what '
            'already revoked them before trusting the green.';
    ELSE
        RAISE NOTICE 'pre-flight: anon can EXECUTE % of 6 uncalled member RPCs today.', v_open;
    END IF;

    -- 🔴 The seven this file deliberately LEAVES OPEN. Printed every push so the
    -- remaining exposure stays visible and nobody reads a green push as "done".
    RAISE NOTICE 'pre-flight: STILL OPEN by design (live app.html callers, closed in the '
                 'gateway stage): get_member_profile(uuid)=%, get_member_activity=%, '
                 'redeem_reward=%, submit_reward_suggestion=%, get_my_tickets=%, '
                 'get_customer_unread_count=%, customer_reply_to_ticket=%',
        has_function_privilege('anon', to_regprocedure('public.get_member_profile(uuid)'), 'EXECUTE'),
        has_function_privilege('anon', to_regprocedure('public.get_member_activity(uuid,integer)'), 'EXECUTE'),
        has_function_privilege('anon', to_regprocedure('public.redeem_reward(uuid,uuid,uuid)'), 'EXECUTE'),
        has_function_privilege('anon', to_regprocedure('public.submit_reward_suggestion(uuid,uuid,text,text,integer,text)'), 'EXECUTE'),
        has_function_privilege('anon', to_regprocedure('public.get_my_tickets(uuid,uuid)'), 'EXECUTE'),
        has_function_privilege('anon', to_regprocedure('public.get_customer_unread_count(uuid,uuid)'), 'EXECUTE'),
        has_function_privilege('anon', to_regprocedure('public.customer_reply_to_ticket(uuid,uuid,text)'), 'EXECUTE');
END
$preflight$;


-- ----------------------------------------------------------------------------
-- The revokes.
--
-- ⚠️ All three lines per function are load-bearing. `REVOKE ... FROM PUBLIC`
-- alone is a SILENT NO-OP: the PUBLIC pseudo-role and a direct role grant are
-- separate ACL entries, and revoking one does not touch the other. Supabase
-- ships direct default grants to anon and authenticated on public, which is why
-- probes find anon executing functions no migration ever granted it. Same
-- footgun as 20260903000000:11-30 and 20260904000004.
--
-- 🔴 ALWAYS TYPE-QUALIFIED. Never the bare name (42725 on an overloaded
-- function), never ON ALL FUNCTIONS IN SCHEMA.
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.update_member_setting(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_member_setting(UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.update_member_setting(UUID, TEXT, TEXT) FROM authenticated;

REVOKE ALL ON FUNCTION public.save_fcm_token(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_fcm_token(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.save_fcm_token(UUID, TEXT) FROM authenticated;

REVOKE ALL ON FUNCTION public.clear_fcm_token(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_fcm_token(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.clear_fcm_token(UUID) FROM authenticated;

-- DROP CANDIDATE: zero callers anywhere in the repo. Not dropped — there is no
-- read-only SQL runner on this machine (no Docker) to dump the live body first,
-- a DROP loses the COMMENT recording why it was closed, and this ledger has
-- already been repaired once (57f3a93).
REVOKE ALL ON FUNCTION public.create_ticket_from_ai_chat(UUID, UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_ticket_from_ai_chat(UUID, UUID, UUID, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.create_ticket_from_ai_chat(UUID, UUID, UUID, TEXT, TEXT, TEXT) FROM authenticated;

-- ⚠️ These two ARE called by app.html:3884 / :3878. Safe only because they
-- raise 42702 on every call and always have. See the header.
REVOKE ALL ON FUNCTION public.get_ticket_messages_for_customer(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_ticket_messages_for_customer(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.get_ticket_messages_for_customer(UUID, UUID) FROM authenticated;

REVOKE ALL ON FUNCTION public.get_ticket_ai_history(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_ticket_ai_history(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.get_ticket_ai_history(UUID, UUID) FROM authenticated;


-- ----------------------------------------------------------------------------
-- Post-flight: assert the revokes took and service_role survived. Collect every
-- failure before raising — a file that stops at the first hides the rest.
-- ----------------------------------------------------------------------------
DO $postflight$
DECLARE
    v_fns CONSTANT TEXT[] := ARRAY[
        'public.update_member_setting(uuid,text,text)',
        'public.save_fcm_token(uuid,text)',
        'public.clear_fcm_token(uuid)',
        'public.create_ticket_from_ai_chat(uuid,uuid,uuid,text,text,text)',
        'public.get_ticket_messages_for_customer(uuid,uuid)',
        'public.get_ticket_ai_history(uuid,uuid)'
    ];
    v_fn TEXT;
    v_oid oid;
    v_fail TEXT[] := '{}';
BEGIN
    FOREACH v_fn IN ARRAY v_fns LOOP
        v_oid := to_regprocedure(v_fn);
        IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
            v_fail := v_fail || (v_fn || ' [anon STILL holds EXECUTE]');
        END IF;
        IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
            v_fail := v_fail || (v_fn || ' [authenticated STILL holds EXECUTE]');
        END IF;
        IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
            v_fail := v_fail || (v_fn || ' [service_role LOST EXECUTE — over-broad]');
        END IF;
    END LOOP;

    IF array_length(v_fail, 1) > 0 THEN
        RAISE EXCEPTION 'post-flight FAILED on % check(s):%',
            array_length(v_fail, 1), E'\n  ' || array_to_string(v_fail, E'\n  ');
    END IF;

    RAISE NOTICE 'post-flight OK: all 6 closed to anon and authenticated, service_role intact.';
END
$postflight$;


-- ----------------------------------------------------------------------------
-- 🔴 FUNCTIONALITY GUARD. This file must not have cost royaltyapp.ai anything.
--
-- Every RPC a live page calls is asserted STILL GRANTED. If any of these fires,
-- the revoke above was over-broad and a real product surface just went dark.
-- Separate block so its message is the only thing you read if it raises.
-- ----------------------------------------------------------------------------
DO $functionality$
DECLARE
    v_keep CONSTANT TEXT[] := ARRAY[
        -- loyalty app.html
        'public.get_member_profile(uuid)',
        'public.get_member_activity(uuid,integer)',
        'public.redeem_reward(uuid,uuid,uuid)',
        'public.submit_reward_suggestion(uuid,uuid,text,text,integer,text)',
        'public.get_my_tickets(uuid,uuid)',
        'public.get_customer_unread_count(uuid,uuid)',
        'public.customer_reply_to_ticket(uuid,uuid,text)',
        -- loyalty / newsletter join page, index.html:2519
        'public.customer_app_signup(uuid,text,text,text,text,text)',
        -- ViibeView. get_member_profile is OVERLOADED — the 2-arg form is the
        -- social profile overlay and revoking it empties every overlay SILENTLY,
        -- because social.js:660 destructures { data } and never inspects error.
        'public.get_member_profile(uuid,uuid)'
    ];
    v_fn TEXT;
    v_oid oid;
    v_fail TEXT[] := '{}';
BEGIN
    FOREACH v_fn IN ARRAY v_keep LOOP
        v_oid := to_regprocedure(v_fn);
        IF v_oid IS NULL THEN
            v_fail := v_fail || (v_fn || ' [DOES NOT EXIST — a live page calls it]');
        ELSIF NOT has_function_privilege('anon', v_oid, 'EXECUTE') THEN
            v_fail := v_fail || (v_fn || ' [anon LOST EXECUTE — a live page calls this with the anon key]');
        END IF;
    END LOOP;

    IF array_length(v_fail, 1) > 0 THEN
        RAISE EXCEPTION
            'post-flight FUNCTIONALITY GUARD FAILED on % check(s). This migration was '
            'supposed to cost royaltyapp.ai nothing and it has broken a live call '
            'site:%s%sFix: GRANT EXECUTE ON FUNCTION <signature> TO anon, authenticated;',
            array_length(v_fail, 1),
            E'\n  ' || array_to_string(v_fail, E'\n  '), E'\n';
    END IF;

    RAISE NOTICE 'post-flight OK: all 9 live call sites still granted — loyalty app, '
                 'join page and ViibeView profile overlay unchanged.';
END
$functionality$;


-- ----------------------------------------------------------------------------
-- Documentation. Each COMMENT in its own DO block so a docstring failure can
-- never roll back the revoke it documents — 20260903000005's lesson.
-- ----------------------------------------------------------------------------
DO $doc$
BEGIN
    EXECUTE $c$
        COMMENT ON FUNCTION public.update_member_setting(UUID, TEXT, TEXT) IS
        'service_role only. SECURITY DEFINER WRITE, member id from the caller, no '
        'auth.uid() — any holder of the published anon key could change any '
        'member''s settings. Its allow-list of safe keys limits WHICH columns, '
        'never WHOSE. anon and authenticated revoked 2026-09-04 (20260904000005). '
        'Free to revoke: its only caller was customer-app/app.js, which no HTML '
        'loads and which was deleted in the same change.';
    $c$;
END
$doc$;

DO $doc$
BEGIN
    EXECUTE $c$
        COMMENT ON FUNCTION public.save_fcm_token(UUID, TEXT) IS
        'service_role only. SECURITY DEFINER WRITE, member id from the caller, no '
        'auth.uid() — let any caller repoint a victim''s push notifications at '
        'their own device. anon and authenticated revoked 2026-09-04 '
        '(20260904000005). Free to revoke: only caller was the dead app.js.';
    $c$;
END
$doc$;

DO $doc$
BEGIN
    EXECUTE $c$
        COMMENT ON FUNCTION public.clear_fcm_token(UUID) IS
        'service_role only. SECURITY DEFINER WRITE, member id from the caller, no '
        'auth.uid() — let any caller silence any member''s push notifications. '
        'anon and authenticated revoked 2026-09-04 (20260904000005). Free to '
        'revoke: only caller was the dead app.js.';
    $c$;
END
$doc$;

DO $doc$
BEGIN
    EXECUTE $c$
        COMMENT ON FUNCTION public.create_ticket_from_ai_chat(UUID, UUID, UUID, TEXT, TEXT, TEXT) IS
        'service_role only. SECURITY DEFINER WRITE, ids from the caller, no '
        'auth.uid(). anon and authenticated revoked 2026-09-04 (20260904000005). '
        'DROP CANDIDATE: zero call sites anywhere in the repo. Kept rather than '
        'dropped because there is no read-only SQL runner on the dev machine to '
        'dump the live body first. Drop it once one exists.';
    $c$;
END
$doc$;

DO $doc$
BEGIN
    EXECUTE $c$
        COMMENT ON FUNCTION public.get_ticket_messages_for_customer(UUID, UUID) IS
        'service_role only. SECURITY DEFINER, ids from the caller, no auth.uid(). '
        'anon and authenticated revoked 2026-09-04 (20260904000005). '
        '⚠️ ALSO BROKEN, AND THAT IS WHY THE REVOKE WAS FREE: it raises 42702 '
        '"column reference id is ambiguous" on every call and always has, so it '
        'has never returned a row to anyone. customer-app/app.html DOES call it. '
        '⚠️ IF YOU FIX THE 42702, the support-ticket UI will then fail with 42501 '
        'instead. Fixing the SQL is not enough — route this through the member '
        'gateway (which derives the member id from a verified token) or re-grant '
        'it deliberately. Do not re-grant to anon as-is.';
    $c$;
END
$doc$;

DO $doc$
BEGIN
    EXECUTE $c$
        COMMENT ON FUNCTION public.get_ticket_ai_history(UUID, UUID) IS
        'service_role only. SECURITY DEFINER, ids from the caller, no auth.uid(). '
        'anon and authenticated revoked 2026-09-04 (20260904000005). '
        '⚠️ ALSO BROKEN: 42702 "column reference id is ambiguous" on every call, '
        'same as get_ticket_messages_for_customer, and called from the same '
        'app.html screen. The same warning applies — fixing the 42702 alone '
        'converts the failure to 42501. Route it through the member gateway.';
    $c$;
END
$doc$;

NOTIFY pgrst, 'reload schema';
