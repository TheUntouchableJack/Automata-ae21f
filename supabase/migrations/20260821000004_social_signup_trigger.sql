-- Social app type (ViibeView) — Phase 1: signup trigger branch
--
-- SPLIT OUT OF 20260821000002_social_member_auth.sql ON PURPOSE.
--
-- This is the one migration in the ViibeView series that is not additive.
-- CREATE OR REPLACE on public.handle_new_user() rewrites the AFTER INSERT
-- trigger behind EVERY Royalty signup. If it is wrong, nobody can create a
-- Royalty account. Keeping it alone in its own file means the additive half
-- (app_members.user_id, its indexes, the two RLS policies, the three RPCs)
-- can be applied and verified independently, and this half can be rolled back
-- on its own by re-applying the previous body.
--
-- WHAT CHANGES
-- ------------
-- handle_new_user() fires on every auth.users INSERT and currently, for EVERY
-- new user, creates an organization and makes them its owner, enrols them in
-- the SMB onboarding email sequence, sends them a "Let's set up your loyalty
-- program" welcome email, and notifies jay@24hour.design of a new signup.
--
-- That is correct for a business owner signing up to Royalty. It is completely
-- wrong for someone creating an account in a nightlife app: every ViibeView
-- member would silently become a Royalty business owner with their own org,
-- and would start receiving SMB marketing.
--
-- Signup now passes user_type='app_member' in the auth metadata, and the
-- trigger branches on it at the top: app members get a profiles row (needed
-- for venue_media.uploaded_by_user_id in Phase 3) and nothing else. The owner
-- path below is unchanged.
--
-- BEFORE APPLYING — read the runbook. Two things must be true:
--
--   1. The live body in prod matches 20260414000002_signup_notify_webhook.sql.
--      Seven definitions of this function exist in the repo, and two of them
--      live under database/*.sql, which are applied BY HAND in the SQL Editor
--      and are older in content than this one. If prod was last updated from
--      one of those, CREATE OR REPLACE silently rolls it back. Dump prosrc and
--      diff it first; if it differs, rebase this file onto the live body
--      instead of pushing the repo's assumption.
--
--   2. public.smb_email_sequence_state exists AND has its
--      UNIQUE(organization_id, sequence_key) constraint. The INSERT into it
--      below is the ONE statement in this function that is not wrapped in
--      BEGIN … EXCEPTION — both webhook calls are, so pg_net being absent or
--      an edge function being unreachable cannot break a signup, but a missing
--      table or missing ON CONFLICT target aborts the trigger and therefore
--      the whole signup transaction. That table comes from
--      20260331000002_onboarding_sequences.sql:22-33.
--
-- Rollback: re-apply the pre-change prosrc as a single CREATE OR REPLACE. The
-- trigger binding (on_auth_user_created) is untouched here, so replacing the
-- function body is a complete revert.
--
-- Isolated migration: touches handle_new_user() and nothing else.

-- Body reproduced from 20260414000002_signup_notify_webhook.sql with the
-- app-member branch added at the top. Keep this in sync if that one changes.

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
    IF COALESCE(NEW.raw_user_meta_data->>'user_type', 'owner') = 'app_member' THEN
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
