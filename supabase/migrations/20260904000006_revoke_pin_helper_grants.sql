-- Revoke anon+authenticated on the 5 PIN-auth helpers, incl. an ACCOUNT
-- TAKEOVER primitive. Loyalty SIGNUP AND LOGIN BOTH KEEP WORKING.
--
-- ⚠️ customer_app_signup IS DELIBERATELY NOT IN THIS FILE. Read "What is NOT
-- revoked" before adding it.
--
-- 🔴 The headline
-- ---------------
-- upgrade_pin_to_bcrypt(p_member_id, p_pin) is granted to anon, and the anon
-- key is published in customer-app/social.js:8. Its entire body
-- (20260207000010:100-113) is:
--
--     UPDATE app_members SET pin_hash = hash_pin_bcrypt(p_pin),
--                            pin_hash_version = 'bcrypt'
--     WHERE id = p_member_id;
--
-- No ownership check, no app check, no rate limit. Anyone holding a member UUID
-- could set that member's PIN to a value of their choosing and then log in as
-- them. It is not a leak; it is an account-takeover primitive, and it has been
-- publicly callable since 2026-02-07. Probed as anon against production
-- 2026-09-04: HTTP 204 — it reached the body and completed.
--
-- The other four are the same mechanism's oracles:
--   hash_pin_bcrypt(p_pin)             -> 200, returned a live bcrypt hash to
--                                         an unauthenticated caller. Also the
--                                         write half of the takeover above.
--   verify_pin_bcrypt(p_pin,p_hash)    -> 22023 "invalid salt" (a BODY error)
--   verify_pin_legacy_sha256(p,h)      -> 200 false
--   verify_app_member_login(...)       -> 200 "App not found or inactive"
--
-- An unrate-limited PIN-checking oracle against a 4-digit PIN space is a
-- brute-force endpoint. 42501 before the body runs is what a revoked function
-- returns; award_points and record_member_visit answered exactly that in the
-- same probe run, from the same key, as the negative control.
--
-- What is NOT revoked, and why
-- ----------------------------
-- ⚠️ customer_app_signup STAYS GRANTED TO anon. The plan that commissioned this
-- file revoked it too, on the reasoning that the loyalty client is broken so
-- closing it is free. "Cheap" is not "necessary", and that reasoning was
-- rejected: it would have switched off /a/:slug member signup for every
-- royaltyapp.ai customer — jack-rewards, yoga-royalty-app and royalty-marketing
-- are all published and active — to fix a bug that function does not have.
--
-- customer_app_signup is the only one of the six with a LEGITIMATE anon grant.
-- A public join page must be callable by anonymous visitors. It does not take a
-- member id from the caller and mutate that member; it creates a new row, and
-- it checks the target app is published and active first. The post-flight below
-- asserts it survived.
--
-- Its real problems — it writes the PIN to app_members.pin_hash in PLAINTEXT
-- (20260315000007 reverted 20260207000010's bcrypt work), and the account it
-- creates cannot log in (see below) — are storage and session problems, fixed
-- by the gateway stage, not by taking signup away from paying customers.
--
-- Why revoking verify_app_member_login costs nothing
-- --------------------------------------------------
-- This is the non-obvious part, and it is what makes login survive:
--
--   1. The direct client call is ALREADY dead. The live function takes p_pin;
--      customer-app/index.html:2562 sends p_pin_hash. PostgREST resolves
--      overloads by argument NAME, so that call returns PGRST202 — verified
--      against production 2026-09-04, hint included: "Perhaps you meant to call
--      the function public.verify_app_member_login(p_app_id, p_email, p_phone,
--      p_pin)". Loyalty login has been broken since 20260315000007. Revoking
--      takes away nothing that works.
--
--   2. The path that DOES work is unaffected. The generate-member-token edge
--      function (deployed, ACTIVE, version 18) calls this RPC at index.ts:114
--      with the correct p_pin, using SUPABASE_SERVICE_ROLE_KEY. service_role
--      keeps EXECUTE here, so that call keeps working. It also rate-limits to
--      5 attempts / 15 minutes (index.ts:62-77) — which is exactly the control
--      the raw anon grant lacks.
--
-- So this file does not remove loyalty login. It removes the UNRATE-LIMITED,
-- UNAUTHENTICATED way to reach it, and leaves the rate-limited server-side way
-- intact. Pointing index.html at that edge function is the gateway stage, and
-- it makes login work again for the first time since March.
--
-- The SECURITY DEFINER chain survives the revoke
-- ----------------------------------------------
-- verify_app_member_login calls verify_pin_bcrypt (20260207000010:386, :397),
-- verify_pin_legacy_sha256 (:389, :400) and upgrade_pin_to_bcrypt (:393, :404).
-- customer_app_signup calls hash_pin_bcrypt (:179). upgrade_pin_to_bcrypt calls
-- hash_pin_bcrypt (:108). Every one of those is an internal call inside a
-- SECURITY DEFINER function, so it runs as the function OWNER, not the client
-- role. Revoking anon and authenticated does not break the chain — signup still
-- hashes, and the edge function's login still verifies and still upgrades a
-- legacy hash.
--
-- Scope: grants only. No body is touched, no PIN is rehashed, no row changes.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Pre-flight. Signatures, before-state, and the two guards.
-- ----------------------------------------------------------------------------
DO $preflight$
DECLARE
    v_viibeview CONSTANT UUID := '6119865e-83f8-4731-b320-8ea705a2ac18';
    v_fns CONSTANT TEXT[] := ARRAY[
        'public.upgrade_pin_to_bcrypt(uuid,text)',
        'public.hash_pin_bcrypt(text)',
        'public.verify_pin_bcrypt(text,text)',
        'public.verify_pin_legacy_sha256(text,text)',
        'public.verify_app_member_login(uuid,text,text,text)'
    ];
    v_fn TEXT;
    v_oid oid;
    v_missing TEXT[] := '{}';
    v_open INTEGER := 0;
    v_count INTEGER;
BEGIN
    -- ===== G5: no live member is relying on a stored PIN =====
    --
    -- The only way this file could strand somebody is if a live member has a
    -- PIN that the revoked verifiers were checking. They are not: every
    -- verification path that still matters runs through the edge function as
    -- service_role. This is belt-and-braces, and it is cheap.
    --
    -- Kept even though the revoke is safe without it, because if this ever
    -- fires it means someone re-enabled PIN storage without re-reading this
    -- file, and that is exactly when you want to stop.
    SELECT COUNT(*) INTO v_count
    FROM public.app_members
    WHERE deleted_at IS NULL AND pin_hash IS NOT NULL;

    IF v_count > 0 THEN
        RAISE NOTICE
            'pre-flight G5: % live member(s) have a non-NULL pin_hash. That is fine '
            '— the edge function verifies them as service_role, which this file does '
            'not touch. Noted so the number is visible, not hidden.', v_count;
    ELSE
        RAISE NOTICE 'pre-flight G5: zero live members hold a PIN.';
    END IF;

    -- ===== G4: how many members exist outside ViibeView =====
    --
    -- Informational, NOT a blocker — unlike the original plan, this file does
    -- not switch signup off, so a live loyalty member is not stranded by it.
    -- IS DISTINCT FROM, not <>, so a NULL app_id cannot slip past as unknown.
    -- ViibeView is pinned by ID, never by app_type (20260903000002:26).
    SELECT COUNT(*) INTO v_count
    FROM public.app_members
    WHERE deleted_at IS NULL AND app_id IS DISTINCT FROM v_viibeview;

    RAISE NOTICE 'pre-flight G4: % live non-ViibeView member(s). Signup stays ON for '
                 'them either way.', v_count;

    -- ===== Signatures =====
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
            'pre-flight: % signature(s) do not exist: %. REVOKE would abort the push '
            'with 42883.', array_length(v_missing, 1), array_to_string(v_missing, ', ');
    END IF;

    IF v_open = 0 THEN
        RAISE WARNING
            'pre-flight: anon already holds EXECUTE on ZERO of the 5 PIN helpers. '
            'This file is a no-op and the post-flight will pass vacuously.';
    ELSE
        RAISE NOTICE 'pre-flight: anon can EXECUTE % of 5 PIN-auth helpers today.', v_open;
    END IF;

    RAISE NOTICE 'pre-flight: customer_app_signup anon EXECUTE = % (MUST stay true — '
                 'it is the /a/:slug join page)',
        has_function_privilege('anon',
            to_regprocedure('public.customer_app_signup(uuid,text,text,text,text,text)'),
            'EXECUTE');
END
$preflight$;


-- ----------------------------------------------------------------------------
-- The revokes. Three lines each — REVOKE ... FROM PUBLIC alone is a silent
-- no-op against Supabase's direct default grants (20260903000000:11-30).
-- ----------------------------------------------------------------------------

-- 🔴 The account-takeover primitive. Sets ANY member's PIN, no auth check.
REVOKE ALL ON FUNCTION public.upgrade_pin_to_bcrypt(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upgrade_pin_to_bcrypt(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.upgrade_pin_to_bcrypt(UUID, TEXT) FROM authenticated;

REVOKE ALL ON FUNCTION public.hash_pin_bcrypt(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hash_pin_bcrypt(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.hash_pin_bcrypt(TEXT) FROM authenticated;

REVOKE ALL ON FUNCTION public.verify_pin_bcrypt(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_pin_bcrypt(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.verify_pin_bcrypt(TEXT, TEXT) FROM authenticated;

REVOKE ALL ON FUNCTION public.verify_pin_legacy_sha256(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_pin_legacy_sha256(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.verify_pin_legacy_sha256(TEXT, TEXT) FROM authenticated;

-- Unreachable from the client (PGRST202) is not the same as revoked: any caller
-- that guesses the p_pin argument name gets an unrate-limited login oracle. The
-- edge function's service_role path at generate-member-token/index.ts:114 is
-- unaffected and keeps rate-limiting at 5 per 15 minutes.
REVOKE ALL ON FUNCTION public.verify_app_member_login(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_app_member_login(UUID, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.verify_app_member_login(UUID, TEXT, TEXT, TEXT) FROM authenticated;


-- ----------------------------------------------------------------------------
-- Post-flight: collect every failure before raising.
-- ----------------------------------------------------------------------------
DO $postflight$
DECLARE
    v_fns CONSTANT TEXT[] := ARRAY[
        'public.upgrade_pin_to_bcrypt(uuid,text)',
        'public.hash_pin_bcrypt(text)',
        'public.verify_pin_bcrypt(text,text)',
        'public.verify_pin_legacy_sha256(text,text)',
        'public.verify_app_member_login(uuid,text,text,text)'
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
        -- 🔴 service_role losing EXECUTE here would break the edge function's
        -- login path, which is the ONLY working loyalty login there is.
        IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
            v_fail := v_fail || (v_fn || ' [service_role LOST EXECUTE — this breaks generate-member-token]');
        END IF;
    END LOOP;

    IF array_length(v_fail, 1) > 0 THEN
        RAISE EXCEPTION 'post-flight FAILED on % check(s):%',
            array_length(v_fail, 1), E'\n  ' || array_to_string(v_fail, E'\n  ');
    END IF;

    RAISE NOTICE 'post-flight OK: all 5 PIN helpers closed to anon and authenticated, '
                 'service_role intact so the edge-function login path still works.';
END
$postflight$;


-- ----------------------------------------------------------------------------
-- 🔴 FUNCTIONALITY GUARD. This file must not have cost royaltyapp.ai anything.
-- ----------------------------------------------------------------------------
DO $functionality$
DECLARE
    v_signup CONSTANT oid := to_regprocedure('public.customer_app_signup(uuid,text,text,text,text,text)');
    v_social CONSTANT oid := to_regprocedure('public.social_member_signup(uuid,text,text,text)');
BEGIN
    IF v_signup IS NULL THEN
        RAISE EXCEPTION
            'post-flight: customer_app_signup does not exist. The /a/:slug join page '
            'for jack-rewards, yoga-royalty-app and royalty-marketing is dead.';
    END IF;

    IF NOT has_function_privilege('anon', v_signup, 'EXECUTE') THEN
        RAISE EXCEPTION
            'post-flight FUNCTIONALITY GUARD: anon LOST EXECUTE on customer_app_signup. '
            'This file was explicitly NOT supposed to touch it — /a/:slug member '
            'signup is now off for every royaltyapp.ai customer. Something revoked it '
            'by bare name or with ON ALL FUNCTIONS IN SCHEMA. '
            'Fix: GRANT EXECUTE ON FUNCTION public.customer_app_signup(UUID, TEXT, '
            'TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;';
    END IF;

    -- ViibeView signup is a different function entirely, but assert it rather
    -- than assume it. A missing signature is a failure, not a soft skip — a
    -- silently-skipped assertion is the exact failure mode this work is about.
    IF v_social IS NULL THEN
        RAISE EXCEPTION
            'post-flight: social_member_signup(uuid,text,text,text) does not exist '
            '(20260821000002:69-74). Either ViibeView signup is broken or the '
            'signature drifted and this assertion has stopped checking anything.';
    END IF;

    IF NOT has_function_privilege('authenticated', v_social, 'EXECUTE') THEN
        RAISE EXCEPTION
            'post-flight: authenticated LOST EXECUTE on social_member_signup — '
            'ViibeView signup is broken. Nothing in this file should have touched it.';
    END IF;

    RAISE NOTICE 'post-flight OK: customer_app_signup still open to anon (loyalty + '
                 'newsletter join pages work), ViibeView social_member_signup untouched.';
END
$functionality$;


-- ----------------------------------------------------------------------------
-- Documentation, each in its own DO block so a docstring failure cannot roll
-- back the revoke it documents.
-- ----------------------------------------------------------------------------
DO $doc$
BEGIN
    EXECUTE $c$
        COMMENT ON FUNCTION public.upgrade_pin_to_bcrypt(UUID, TEXT) IS
        '🔴 ACCOUNT TAKEOVER PRIMITIVE. service_role only. Its entire body is '
        'UPDATE app_members SET pin_hash = hash_pin_bcrypt(p_pin) WHERE id = '
        'p_member_id — no auth.uid(), no app check, no rate limit. It was granted '
        'to anon from 2026-02-07 until 2026-09-04, so anyone holding a member UUID '
        'could set that member''s PIN and then log in as them. Verified reachable '
        'in production (HTTP 204) before the revoke (20260904000006). '
        'DO NOT GRANT THIS BACK TO ANY CLIENT ROLE. There is no safe grant for it '
        'as written: either re-key the body onto a verified session so a member can '
        'only rotate their own PIN, or delete it. Re-granting is not an option. '
        'Still called internally by verify_app_member_login, which is SECURITY '
        'DEFINER, so the legacy-hash upgrade path is unaffected by this revoke.';
    $c$;
END
$doc$;

DO $doc$
BEGIN
    EXECUTE $c$
        COMMENT ON FUNCTION public.hash_pin_bcrypt(TEXT) IS
        'service_role only. Revoked 2026-09-04 (20260904000006) — as a client-role '
        'grant it was a free bcrypt oracle (it returned a live hash to an '
        'unauthenticated caller) and it is the write half of the '
        'upgrade_pin_to_bcrypt takeover. Still called internally by '
        'customer_app_signup:179 and upgrade_pin_to_bcrypt:108; both are SECURITY '
        'DEFINER, so those internal calls run as the owner and signup still hashes.';
    $c$;
END
$doc$;

DO $doc$
BEGIN
    EXECUTE $c$
        COMMENT ON FUNCTION public.verify_pin_bcrypt(TEXT, TEXT) IS
        'service_role only. Revoked 2026-09-04 (20260904000006): an unrate-limited '
        'PIN-checking oracle against a 4-digit space is a brute-force endpoint. '
        'Called internally by verify_app_member_login (SECURITY DEFINER), so the '
        'real login path is unaffected.';
    $c$;
END
$doc$;

DO $doc$
BEGIN
    EXECUTE $c$
        COMMENT ON FUNCTION public.verify_pin_legacy_sha256(TEXT, TEXT) IS
        'service_role only. Revoked 2026-09-04 (20260904000006), same reasoning as '
        'verify_pin_bcrypt. Called internally by verify_app_member_login (SECURITY '
        'DEFINER), so the real login path is unaffected.';
    $c$;
END
$doc$;

DO $doc$
BEGIN
    EXECUTE $c$
        COMMENT ON FUNCTION public.verify_app_member_login(UUID, TEXT, TEXT, TEXT) IS
        'service_role only as of 2026-09-04 (20260904000006). This did NOT turn '
        'loyalty login off — it was already off. The shipped client sends '
        'p_pin_hash (customer-app/index.html:2562) while this takes p_pin, and '
        'PostgREST resolves overloads by argument NAME, so that call has returned '
        'PGRST202 since 20260315000007. What the revoke removes is the '
        'unrate-limited, unauthenticated way to reach a PIN-verification oracle. '
        'THE WORKING PATH IS UNAFFECTED: generate-member-token/index.ts:114 calls '
        'this with the correct p_pin as service_role and rate-limits to 5 attempts '
        'per 15 minutes. Point the client at that edge function to restore login. '
        'Do not re-grant this to anon — you would be re-adding the oracle.';
    $c$;
END
$doc$;

DO $doc$
BEGIN
    EXECUTE $c$
        COMMENT ON FUNCTION public.customer_app_signup(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) IS
        'anon + authenticated + service_role — DELIBERATELY STILL OPEN TO anon. '
        'This is the /a/:slug join page for loyalty and newsletter apps and a public '
        'join page must be callable by anonymous visitors. It was proposed for '
        'revoke on 2026-09-04 and that was rejected: unlike the PIN helpers revoked '
        'alongside it (20260904000006), it does not take a member id from the caller '
        'and mutate that member — it creates a new row and checks the target app is '
        'published and active first. '
        '⚠️ KNOWN ISSUES, both fixed by the gateway stage rather than by revoking: '
        '(1) it writes the PIN to app_members.pin_hash in PLAINTEXT, because '
        '20260315000007 reverted 20260207000010''s bcrypt work and restored the '
        'p_pin_hash parameter; (2) the account it creates cannot log in, because '
        'verify_app_member_login is reachable only via generate-member-token. '
        'NOTE for that stage: generate-member-token/index.ts:87 calls this with '
        'p_pin, but the live signature takes p_pin_hash — that call fails today and '
        'must be corrected when the client is pointed at the edge function.';
    $c$;
END
$doc$;

NOTIFY pgrst, 'reload schema';
