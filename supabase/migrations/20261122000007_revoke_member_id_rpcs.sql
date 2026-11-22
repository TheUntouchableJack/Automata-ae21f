-- ============================================================================
-- B1b — revoke the member-id RPCs (plan royalty-in-store-loop; step 7 of cool-anything-here-wiggly-valiant)
-- ============================================================================
--
-- The gate was a real test of B1a's sign-in: done 2026-11-22 on production (join with an emailed
-- code, then log out and back in: same points, one welcome bonus; check-in works since
-- 20261122000004). e2e/security/phase-a-anon-grants.spec.js moves these from MUST_STAY_OPEN to
-- CLOSED in the same commit.
--
-- Since 20261122000002 the customer app calls only the session-keyed versions (join_app,
-- check_in, member_*). These old ones take a member id FROM THE CALLER, so anyone holding the
-- published anon key and a member id could spend that member's points (redeem_reward), read
-- their history, post as them on tickets, or create PIN accounts (customer_app_signup).
-- Revoked from PUBLIC, anon AND authenticated: any signed-in user is just as able to pass
-- someone else's id. service_role keeps EXECUTE (server paths, if any, keep working).
--
-- 🔴 get_member_profile has TWO overloads. Only the 1-arg loyalty form (uuid) goes. The 2-arg
--    (p_app_id, p_user_id) form is ViibeView's and must stay open (phase-a spec checks it).
-- Signatures are taken from pg_proc, not assumed: several of these were hand-applied from
-- database/*.sql and the repo holds two parameter orders for some.
-- ============================================================================

DO $revoke$
DECLARE
    v_names CONSTANT TEXT[] := ARRAY[
        'redeem_reward', 'get_member_activity', 'submit_reward_suggestion', 'get_my_tickets',
        'get_customer_unread_count', 'customer_reply_to_ticket', 'customer_app_signup',
        'update_member_profile', 'get_ticket_messages_for_customer', 'get_ticket_ai_history'
    ];
    r RECORD;
    v_done TEXT[] := '{}';
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND (p.proname = ANY (v_names)
               OR (p.proname = 'get_member_profile' AND p.pronargs = 1))
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
        v_done := v_done || r.sig::TEXT;
    END LOOP;
    RAISE NOTICE 'B1b revoked % function(s): %', coalesce(array_length(v_done, 1), 0), array_to_string(v_done, '; ');
END
$revoke$;

-- Post-flight: none of them is callable by a client role, and ViibeView's overload still is.
DO $postflight$
DECLARE
    r RECORD;
    v_bad TEXT[] := '{}';
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND (p.proname IN ('redeem_reward', 'get_member_activity', 'submit_reward_suggestion',
                             'get_my_tickets', 'get_customer_unread_count', 'customer_reply_to_ticket',
                             'customer_app_signup', 'update_member_profile',
                             'get_ticket_messages_for_customer', 'get_ticket_ai_history')
               OR (p.proname = 'get_member_profile' AND p.pronargs = 1))
    LOOP
        IF has_function_privilege('anon', r.sig, 'EXECUTE') OR has_function_privilege('authenticated', r.sig, 'EXECUTE') THEN
            v_bad := v_bad || r.sig::TEXT;
        END IF;
    END LOOP;
    IF array_length(v_bad, 1) > 0 THEN
        RAISE EXCEPTION 'post-flight: still client-callable: %', array_to_string(v_bad, '; ');
    END IF;
    IF to_regprocedure('public.get_member_profile(uuid,uuid)') IS NOT NULL
       AND NOT has_function_privilege('anon', 'public.get_member_profile(uuid,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'post-flight: ViibeView''s get_member_profile(uuid,uuid) lost anon EXECUTE.';
    END IF;
    RAISE NOTICE 'B1b post-flight OK.';
END
$postflight$;

NOTIFY pgrst, 'reload schema';
