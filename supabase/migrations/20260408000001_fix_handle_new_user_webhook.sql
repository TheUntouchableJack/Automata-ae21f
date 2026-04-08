-- Fix signup 500 "Database error saving new user"
-- ==================================================
-- Root cause: migration 20260331000002_onboarding_sequences.sql replaced
-- handle_new_user() with a version that calls net.http_post() to fire the
-- welcome-email webhook, but:
--   1. It dropped SET search_path = '' on the SECURITY DEFINER function
--      (earlier migrations 20260218000003/08/10/11 had standardized on this).
--   2. It did not wrap the net.http_post() call in an EXCEPTION block, so any
--      failure in the webhook (pg_net unavailable, NULL current_setting, etc.)
--      raises and rolls back the entire signup transaction, producing the
--      generic "Database error saving new user" 500 from Supabase Auth.
--
-- This migration restores SET search_path and wraps the webhook call in a
-- best-effort exception handler so signup always succeeds regardless of the
-- welcome-email path.

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
    -- Do not fail signup if pg_net or the webhook target has issues.
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

    RETURN NEW;
END;
$$;

-- Reinstall trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
