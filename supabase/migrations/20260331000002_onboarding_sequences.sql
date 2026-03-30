-- Phase 2: Onboarding Drip Sequence
-- Tables for multi-step email sequences + seed the onboarding sequence

-- ============================================================
-- smb_email_sequences — defines reusable email sequences
-- ============================================================
CREATE TABLE IF NOT EXISTS smb_email_sequences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_key  TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  steps         JSONB NOT NULL,
  -- steps: [{ step: 1, template_key: "onboarding_create_app", delay_hours: 24, skip_condition: "has_customer_app" }]
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- smb_email_sequence_state — tracks per-org progress
-- ============================================================
CREATE TABLE IF NOT EXISTS smb_email_sequence_state (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sequence_key     TEXT NOT NULL,
  current_step     INTEGER DEFAULT 0,
  started_at       TIMESTAMPTZ DEFAULT NOW(),
  last_sent_at     TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  skipped_steps    INTEGER[] DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, sequence_key)
);

CREATE INDEX IF NOT EXISTS idx_sequence_state_pending
  ON smb_email_sequence_state (sequence_key, current_step)
  WHERE completed_at IS NULL;

-- RLS
ALTER TABLE smb_email_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE smb_email_sequence_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to sequences" ON smb_email_sequences
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access to sequence state" ON smb_email_sequence_state
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- Seed: Onboarding sequence (5 steps over 14 days)
-- Step 1 (welcome) is handled by handle_new_user trigger (Phase 1)
-- Steps 2-5 are processed by the nightly self-growth loop
-- ============================================================
INSERT INTO smb_email_sequences (sequence_key, name, description, steps) VALUES (
  'onboarding',
  'New Owner Onboarding',
  '5-step email sequence guiding new SMB owners through setup',
  '[
    {
      "step": 1,
      "template_key": "welcome",
      "delay_hours": 0,
      "skip_condition": null,
      "note": "Handled by handle_new_user trigger — not processed by loop"
    },
    {
      "step": 2,
      "template_key": "onboarding_create_app",
      "delay_hours": 24,
      "skip_condition": "has_customer_app",
      "subject_hint": "Create your loyalty app"
    },
    {
      "step": 3,
      "template_key": "onboarding_meet_royal",
      "delay_hours": 72,
      "skip_condition": "has_used_ai",
      "subject_hint": "Meet Royal, your AI assistant"
    },
    {
      "step": 4,
      "template_key": "onboarding_add_customers",
      "delay_hours": 168,
      "skip_condition": "has_customers",
      "subject_hint": "Add your first customers"
    },
    {
      "step": 5,
      "template_key": "onboarding_checkin",
      "delay_hours": 336,
      "skip_condition": "has_ten_members",
      "subject_hint": "How is it going?"
    }
  ]'::jsonb
) ON CONFLICT (sequence_key) DO NOTHING;

-- ============================================================
-- Auto-enroll new orgs into onboarding sequence
-- Updated handle_new_user to also insert sequence state
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

    -- Enroll in onboarding sequence (step 1 = welcome, already sent below)
    INSERT INTO public.smb_email_sequence_state (organization_id, sequence_key, current_step, last_sent_at)
    VALUES (new_org_id, 'onboarding', 1, NOW())
    ON CONFLICT (organization_id, sequence_key) DO NOTHING;

    -- Fire welcome email
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
