-- Phase 1: SMB Engagement — Welcome Email + Email Preferences
-- 1. smb_email_preferences table (unsubscribe tracking)
-- 2. Updated handle_new_user() trigger (fires welcome email via pg_net)

-- ============================================================
-- smb_email_preferences — tracks opt-out status for SMB owners
-- ============================================================
CREATE TABLE IF NOT EXISTS smb_email_preferences (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id  UUID REFERENCES organizations(id) ON DELETE CASCADE,
  unsubscribed_all BOOLEAN DEFAULT FALSE,
  unsubscribed_categories TEXT[] DEFAULT '{}',
  unsubscribed_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE smb_email_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own email preferences" ON smb_email_preferences
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can update own email preferences" ON smb_email_preferences
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "Service role full access to email preferences" ON smb_email_preferences
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- Updated handle_new_user() — adds pg_net call for welcome email
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    new_org_id UUID;
    user_first_name TEXT;
    user_last_name TEXT;
    org_name TEXT;
    org_slug TEXT;
BEGIN
    -- Get user names
    user_first_name := NEW.raw_user_meta_data->>'first_name';
    user_last_name := NEW.raw_user_meta_data->>'last_name';

    -- Create profile
    INSERT INTO public.profiles (id, email, first_name, last_name)
    VALUES (
        NEW.id,
        NEW.email,
        user_first_name,
        user_last_name
    )
    ON CONFLICT (id) DO NOTHING;

    -- Create default organization for user
    org_name := COALESCE(user_first_name || '''s Organization', 'My Organization');
    org_slug := LOWER(REPLACE(NEW.email, '@', '-at-') || '-' || SUBSTRING(NEW.id::TEXT, 1, 8));

    INSERT INTO public.organizations (id, name, slug)
    VALUES (gen_random_uuid(), org_name, org_slug)
    RETURNING id INTO new_org_id;

    -- Add user as owner of their organization
    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (new_org_id, NEW.id, 'owner');

    -- Fire welcome email via smb-lifecycle-email edge function
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

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Reinstall trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
