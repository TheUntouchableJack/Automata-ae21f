-- Staff invitations work end to end (2026-11-22)
--
-- Plan cool-anything-here-wiggly-valiant, item 4. Settings → Team only INSERTed into
-- organization_invitations and said "Invitation sent": no email went out, nothing could accept
-- the invite, and handle_new_user() would have made the invitee the owner of a new org of
-- their own. Only the owner could use Counter.
--
-- Now:
--   1. handle_new_user(): user_type 'staff' gets a profile and nothing else (like 'app_member').
--      🔴 Replaced ONLY if the live body is byte-identical to 20260821000004 (md5 below). Two
--      older copies live in database/*.sql (applied by hand); if prod drifted to one of them,
--      this aborts and prints the live body instead of rolling it back.
--   2. get_org_invitation(token): what /app/accept-invite.html shows (anon + authenticated).
--      The token is a random uuid only the invitee's email carries.
--   3. accept_org_invitation(token): signed in, email confirmed, the invited address, invite
--      pending and unexpired → organization_members row. Never 'owner'. An account that already
--      belongs to an org is refused: AppUtils.loadOrganization reads ONE membership (limit 1, no
--      order), so a second org would pick one at random.
--   4. org_invite_claim_send(invitation, caller): the org-invite-send edge function's gate
--      (service_role only). Caller must be the org's owner/admin. ≥60 s between sends of one
--      invite, ≤5 sends per invite, ≤30 invites sent per org per day. A send restarts the 7 days.
--   The token model is 20260822000002's: no table read by token for anyone; only these
--   SECURITY DEFINER functions take a token.

-- ===== pre-flight =====
DO $$
DECLARE
    v_missing TEXT[];
    v_live TEXT;
BEGIN
    IF to_regclass('public.organization_invitations') IS NULL THEN
        RAISE EXCEPTION 'pre-flight: organization_invitations is missing.';
    END IF;
    SELECT array_agg(c) INTO v_missing
    FROM unnest(ARRAY['id','organization_id','email','role','invited_by','token','status','expires_at','created_at']) c
    WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'organization_invitations' AND column_name = c);
    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'pre-flight: organization_invitations lacks column(s): %', array_to_string(v_missing, ', ');
    END IF;
    IF to_regclass('public.organization_members') IS NULL THEN
        RAISE EXCEPTION 'pre-flight: organization_members is missing.';
    END IF;

    SELECT p.prosrc INTO v_live FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'handle_new_user' AND p.pronargs = 0;
    IF v_live IS NULL THEN
        RAISE EXCEPTION 'pre-flight: public.handle_new_user() is missing.';
    END IF;
    -- 20260821000004's body, or this file's (already applied: a re-run changes nothing).
    IF md5(v_live) NOT IN ('f301aaf6d2f31fb0b7de6cdaefafa855', 'b4545b04fc91102b6871a5ac93c84e10') THEN
        RAISE EXCEPTION 'pre-flight: live handle_new_user() is not 20260821000004 (md5 %, % chars). Not replacing it. Live body follows:%', md5(v_live), length(v_live), v_live;
    END IF;

    RAISE NOTICE 'pre-flight OK. Pending invitations: %, of which expired: %.',
        (SELECT count(*) FROM organization_invitations WHERE status = 'pending'),
        (SELECT count(*) FROM organization_invitations WHERE status = 'pending' AND expires_at < NOW());
END $$;


-- ===== 1. handle_new_user: the staff branch =====
-- Body = 20260821000004's, with 'staff' added to the app-member condition (and its comment).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    new_org_id UUID;
    user_first_name TEXT;
    user_last_name TEXT;
    org_name TEXT;
    org_slug TEXT;
BEGIN
    user_first_name := NEW.raw_user_meta_data->>'first_name';
    user_last_name := NEW.raw_user_meta_data->>'last_name';

    -- App members are customers of a white-label app, NOT Royalty customers.
    -- No organization, no ownership, no SMB onboarding, no admin notification.
    -- The profiles row is still required: venue_media.uploaded_by_user_id
    -- references it, so member-posted content needs one to be attributable.
    -- Staff (20261122000006) sign up from an invitation (/app/accept-invite.html)
    -- and join the INVITING org through accept_org_invitation(): same treatment,
    -- no org of their own.
    IF COALESCE(NEW.raw_user_meta_data->>'user_type', 'owner') IN ('app_member', 'staff') THEN
        INSERT INTO public.profiles (id, email, first_name, last_name)
        VALUES (NEW.id, NEW.email, user_first_name, user_last_name)
        ON CONFLICT (id) DO NOTHING;

        RETURN NEW;
    END IF;

    -- ===== Business owner path (unchanged) =====

    -- Create profile
    INSERT INTO public.profiles (id, email, first_name, last_name)
    VALUES (NEW.id, NEW.email, user_first_name, user_last_name)
    ON CONFLICT (id) DO NOTHING;

    -- Create default organization
    org_name := COALESCE(user_first_name || '''s Organization', 'My Organization');
    org_slug := LOWER(REPLACE(NEW.email, '@', '-at-') || '-' || SUBSTRING(NEW.id::TEXT, 1, 8));

    INSERT INTO public.organizations (id, name, slug)
    VALUES (gen_random_uuid(), org_name, org_slug)
    RETURNING id INTO new_org_id;

    -- Add user as owner
    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (new_org_id, NEW.id, 'owner');

    -- Enroll in onboarding sequence (step 1 = welcome, webhook below)
    INSERT INTO public.smb_email_sequence_state (organization_id, sequence_key, current_step, last_sent_at)
    VALUES (new_org_id, 'onboarding', 1, NOW())
    ON CONFLICT (organization_id, sequence_key) DO NOTHING;

    -- Fire welcome email BEST-EFFORT
    BEGIN
        PERFORM net.http_post(
            url := current_setting('supabase.url', true) || '/functions/v1/smb-lifecycle-email',
            headers := jsonb_build_object(
                'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true),
                'Content-Type', 'application/json'
            ),
            body := jsonb_build_object(
                'type', 'welcome',
                'email', NEW.email,
                'first_name', COALESCE(user_first_name, ''),
                'org_name', org_name,
                'user_id', NEW.id::text
            )
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE LOG 'handle_new_user welcome webhook failed (non-fatal): %', SQLERRM;
    END;

    -- Admin signup notification BEST-EFFORT
    BEGIN
        PERFORM net.http_post(
            url := current_setting('supabase.url', true) || '/functions/v1/signup-notify',
            headers := jsonb_build_object(
                'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true),
                'Content-Type', 'application/json'
            ),
            body := jsonb_build_object(
                'email', NEW.email,
                'first_name', COALESCE(user_first_name, ''),
                'last_name', COALESCE(user_last_name, ''),
                'org_name', org_name,
                'org_slug', org_slug,
                'user_id', NEW.id::text,
                'raw_meta', COALESCE(NEW.raw_user_meta_data, '{}'::jsonb)
            )
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE LOG 'handle_new_user signup-notify webhook failed (non-fatal): %', SQLERRM;
    END;

    RETURN NEW;
END;
$$;


-- ===== bookkeeping columns (additive) =====
ALTER TABLE public.organization_invitations
    ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS accepted_by UUID,
    ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS send_count INTEGER NOT NULL DEFAULT 0;

-- ===== who may write which column =====
-- The hand-applied policies let an org's owner/admin INSERT and UPDATE whole rows, and the table
-- carried Supabase's default table-level grants. With a mailer behind it that would let any owner
-- (anyone can sign up) reset send_count / last_sent_at, or rewrite email / token / accepted_by, and
-- send unthrottled mail to any address. The browser (app/settings.js) only ever inserts these four
-- columns and only ever sets status (cancel). Everything else is written by the functions below.
REVOKE INSERT, UPDATE ON public.organization_invitations FROM anon, authenticated;
GRANT INSERT (organization_id, email, role, invited_by) ON public.organization_invitations TO authenticated;
GRANT UPDATE (status) ON public.organization_invitations TO authenticated;


-- ===== 2. What the accept page shows =====
CREATE OR REPLACE FUNCTION public.get_org_invitation(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_inv RECORD;
    v_org_name TEXT;
    v_inviter TEXT;
BEGIN
    IF p_token IS NULL OR length(p_token) < 20 OR length(p_token) > 100 THEN
        RETURN jsonb_build_object('status', 'invalid');
    END IF;

    SELECT i.* INTO v_inv FROM organization_invitations i WHERE i.token = p_token;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'invalid');
    END IF;

    SELECT o.name INTO v_org_name FROM organizations o WHERE o.id = v_inv.organization_id;
    -- invited_by is written by the browser: name it only if it is an owner/admin of this org.
    SELECT NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), '') INTO v_inviter
    FROM profiles p
    JOIN organization_members m ON m.user_id = p.id
     AND m.organization_id = v_inv.organization_id AND m.role IN ('owner', 'admin')
    WHERE p.id = v_inv.invited_by;

    RETURN jsonb_build_object(
        'status', CASE
            WHEN v_inv.status = 'pending' AND v_inv.expires_at IS NOT NULL AND v_inv.expires_at < NOW() THEN 'expired'
            WHEN v_inv.status IN ('pending', 'accepted', 'cancelled', 'expired') THEN v_inv.status
            ELSE 'invalid' END,
        'org_name', v_org_name,
        'role', CASE WHEN v_inv.role = 'admin' THEN 'admin' ELSE 'member' END,
        'email', v_inv.email,
        'inviter_name', v_inviter
    );
END;
$$;


-- ===== 3. Accept =====
CREATE OR REPLACE FUNCTION public.accept_org_invitation(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_user RECORD;
    v_inv RECORD;
    v_role TEXT;
    v_org_name TEXT;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'not_signed_in');
    END IF;
    IF p_token IS NULL OR length(p_token) < 20 OR length(p_token) > 100 THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid');
    END IF;

    SELECT u.email, u.email_confirmed_at INTO v_user FROM auth.users u WHERE u.id = v_uid;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'not_signed_in');
    END IF;

    SELECT i.* INTO v_inv FROM organization_invitations i WHERE i.token = p_token FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid');
    END IF;
    SELECT o.name INTO v_org_name FROM organizations o WHERE o.id = v_inv.organization_id;
    v_role := CASE WHEN v_inv.role = 'admin' THEN 'admin' ELSE 'member' END;

    -- Accepted already: by this account it is a success (a double click, a second tab).
    IF v_inv.status = 'accepted' THEN
        IF v_inv.accepted_by = v_uid AND EXISTS (
            SELECT 1 FROM organization_members m WHERE m.organization_id = v_inv.organization_id AND m.user_id = v_uid
        ) THEN
            RETURN jsonb_build_object('success', true, 'code', 'already_member', 'org_name', v_org_name, 'role', v_role);
        END IF;
        RETURN jsonb_build_object('success', false, 'code', 'used');
    END IF;
    IF v_inv.status = 'cancelled' THEN
        RETURN jsonb_build_object('success', false, 'code', 'cancelled', 'org_name', v_org_name);
    END IF;
    IF v_inv.status <> 'pending' OR (v_inv.expires_at IS NOT NULL AND v_inv.expires_at < NOW()) THEN
        RETURN jsonb_build_object('success', false, 'code', 'expired', 'org_name', v_org_name);
    END IF;

    IF lower(trim(v_user.email)) IS DISTINCT FROM lower(trim(v_inv.email)) THEN
        RETURN jsonb_build_object('success', false, 'code', 'wrong_account', 'invited_email', v_inv.email);
    END IF;
    IF v_user.email_confirmed_at IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'email_unconfirmed');
    END IF;

    IF EXISTS (SELECT 1 FROM organization_members m WHERE m.user_id = v_uid AND m.organization_id = v_inv.organization_id) THEN
        UPDATE organization_invitations SET status = 'accepted', accepted_at = NOW(), accepted_by = v_uid WHERE id = v_inv.id;
        RETURN jsonb_build_object('success', true, 'code', 'already_member', 'org_name', v_org_name, 'role', v_role);
    END IF;
    IF EXISTS (SELECT 1 FROM organization_members m WHERE m.user_id = v_uid) THEN
        RETURN jsonb_build_object('success', false, 'code', 'has_org', 'invited_email', v_inv.email);
    END IF;

    INSERT INTO organization_members (organization_id, user_id, role)
    VALUES (v_inv.organization_id, v_uid, v_role);
    UPDATE organization_invitations SET status = 'accepted', accepted_at = NOW(), accepted_by = v_uid WHERE id = v_inv.id;

    RETURN jsonb_build_object('success', true, 'code', 'joined', 'org_name', v_org_name, 'role', v_role);
END;
$$;


-- ===== 4. The send gate (org-invite-send edge function) =====
CREATE OR REPLACE FUNCTION public.org_invite_claim_send(p_invitation_id UUID, p_caller UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_inv RECORD;
    v_org_name TEXT;
    v_inviter TEXT;
    v_inviter_email TEXT;
    v_sent_today INTEGER;
BEGIN
    SELECT i.* INTO v_inv FROM organization_invitations i WHERE i.id = p_invitation_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('result', 'not_found');
    END IF;
    IF p_caller IS NULL OR NOT EXISTS (
        SELECT 1 FROM organization_members m
        WHERE m.organization_id = v_inv.organization_id AND m.user_id = p_caller AND m.role IN ('owner', 'admin')
    ) THEN
        RETURN jsonb_build_object('result', 'forbidden');
    END IF;
    IF v_inv.status <> 'pending' THEN
        RETURN jsonb_build_object('result', 'not_pending', 'status', v_inv.status);
    END IF;
    IF v_inv.last_sent_at IS NOT NULL AND v_inv.last_sent_at > NOW() - INTERVAL '60 seconds' THEN
        RETURN jsonb_build_object('result', 'too_soon');
    END IF;
    IF v_inv.send_count >= 5 THEN
        RETURN jsonb_build_object('result', 'too_many');
    END IF;
    SELECT count(*) INTO v_sent_today FROM organization_invitations i
    WHERE i.organization_id = v_inv.organization_id AND i.last_sent_at > NOW() - INTERVAL '24 hours';
    IF v_sent_today >= 30 THEN
        RETURN jsonb_build_object('result', 'org_limit');
    END IF;

    UPDATE organization_invitations
       SET last_sent_at = NOW(), send_count = send_count + 1, expires_at = NOW() + INTERVAL '7 days'
     WHERE id = v_inv.id;

    SELECT o.name INTO v_org_name FROM organizations o WHERE o.id = v_inv.organization_id;
    SELECT NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email INTO v_inviter, v_inviter_email
    FROM profiles p WHERE p.id = p_caller;

    RETURN jsonb_build_object(
        'result', 'ok',
        'email', v_inv.email,
        'token', v_inv.token,
        'role', CASE WHEN v_inv.role = 'admin' THEN 'admin' ELSE 'member' END,
        'org_name', v_org_name,
        'inviter_name', v_inviter,
        'inviter_email', v_inviter_email
    );
END;
$$;


-- ===== grants =====
REVOKE ALL ON FUNCTION public.get_org_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_invitation(TEXT) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.accept_org_invitation(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_org_invitation(TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.org_invite_claim_send(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_invite_claim_send(UUID, UUID) TO service_role;

DO $$
BEGIN
    IF has_function_privilege('anon', 'public.accept_org_invitation(text)', 'execute')
       OR has_function_privilege('anon', 'public.org_invite_claim_send(uuid,uuid)', 'execute')
       OR has_function_privilege('authenticated', 'public.org_invite_claim_send(uuid,uuid)', 'execute') THEN
        RAISE EXCEPTION 'post-flight: a grant is wider than intended.';
    END IF;
    IF has_column_privilege('authenticated', 'public.organization_invitations', 'send_count', 'UPDATE')
       OR has_column_privilege('authenticated', 'public.organization_invitations', 'email', 'UPDATE')
       OR has_column_privilege('authenticated', 'public.organization_invitations', 'last_sent_at', 'INSERT')
       OR has_table_privilege('anon', 'public.organization_invitations', 'INSERT')
       OR NOT has_column_privilege('authenticated', 'public.organization_invitations', 'status', 'UPDATE')
       OR NOT has_column_privilege('authenticated', 'public.organization_invitations', 'email', 'INSERT') THEN
        RAISE EXCEPTION 'post-flight: organization_invitations column grants are not as intended.';
    END IF;
    RAISE NOTICE 'post-flight OK: get_org_invitation anon+authenticated, accept authenticated, claim service_role; invitations: insert 4 columns, update status only.';
END $$;
