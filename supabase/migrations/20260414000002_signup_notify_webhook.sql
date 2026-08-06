-- Add admin signup notification webhook to handle_new_user()
-- Sends email to jay@24hour.design via signup-notify edge function
-- with full signup data (name, email, org, metadata, platform totals).

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
