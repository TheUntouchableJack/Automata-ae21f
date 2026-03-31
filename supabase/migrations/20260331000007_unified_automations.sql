-- Unified Automations: Converge smb_email_sequences into automation_definitions
-- Every org uses the same automation system. Jay's org targets organizations (SMBs).
-- Regular SMB orgs target app_members (loyalty customers).

-- ============================================================
-- 1. Add target_type + sequence support to automation_definitions
-- ============================================================
ALTER TABLE automation_definitions
  ADD COLUMN IF NOT EXISTS target_type TEXT DEFAULT 'app_members'
    CHECK (target_type IN ('app_members', 'organizations'));

ALTER TABLE automation_definitions
  ADD COLUMN IF NOT EXISTS target_filter JSONB;

ALTER TABLE automation_definitions
  ADD COLUMN IF NOT EXISTS sequence_key TEXT;

ALTER TABLE automation_definitions
  ADD COLUMN IF NOT EXISTS sequence_step INTEGER;

CREATE INDEX IF NOT EXISTS idx_automation_defs_target_type
  ON automation_definitions (target_type);

CREATE INDEX IF NOT EXISTS idx_automation_defs_sequence
  ON automation_definitions (sequence_key, sequence_step)
  WHERE sequence_key IS NOT NULL;

-- ============================================================
-- 2. Rename smb tables to generic names (keep old names as views for compatibility)
-- ============================================================

-- Rename sequence state table
ALTER TABLE smb_email_sequence_state RENAME TO automation_sequence_state;

-- Rename sequence definitions table
ALTER TABLE smb_email_sequences RENAME TO automation_sequences;

-- Compatibility views so existing code doesn't break during transition
CREATE OR REPLACE VIEW smb_email_sequence_state AS SELECT * FROM automation_sequence_state;
CREATE OR REPLACE VIEW smb_email_sequences AS SELECT * FROM automation_sequences;

-- ============================================================
-- 3. Migrate onboarding sequence steps into automation_definitions
-- Assigned to Jay's admin org (looked up dynamically)
-- ============================================================
DO $$
DECLARE
  v_admin_user_id UUID := 'b7ac81ba-56c9-4aa2-968a-391d080048f0';
  v_org_id UUID;
BEGIN
  -- Look up Jay's org
  SELECT organization_id INTO v_org_id
  FROM organization_members
  WHERE user_id = v_admin_user_id AND role = 'owner'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE NOTICE 'Admin org not found — skipping sequence migration';
    RETURN;
  END IF;

  -- Onboarding Step 2: Create your loyalty app (24h after signup)
  INSERT INTO automation_definitions (
    organization_id, name, description, category,
    template_key, trigger_type, trigger_event, action_type, action_config,
    delay_minutes, max_frequency_days, cooldown_hours,
    target_type, sequence_key, sequence_step,
    target_filter, is_enabled
  ) VALUES (
    v_org_id, 'Onboarding: Create Your App', 'Nudge new SMBs to create their first loyalty app (Day 1)',
    'welcome', 'onboarding_create_app', 'schedule', 'daily', 'send_message',
    '{"channel": "email", "template_key": "onboarding_create_app"}'::jsonb,
    0, 14, 24, 'organizations', 'onboarding', 2,
    '{"skip_condition": "has_customer_app"}'::jsonb, true
  ) ON CONFLICT DO NOTHING;

  -- Onboarding Step 3: Meet Royal (Day 3)
  INSERT INTO automation_definitions (
    organization_id, name, description, category,
    template_key, trigger_type, trigger_event, action_type, action_config,
    delay_minutes, max_frequency_days, cooldown_hours,
    target_type, sequence_key, sequence_step,
    target_filter, is_enabled
  ) VALUES (
    v_org_id, 'Onboarding: Meet Royal', 'Introduce SMB owners to their AI assistant (Day 3)',
    'welcome', 'onboarding_meet_royal', 'schedule', 'daily', 'send_message',
    '{"channel": "email", "template_key": "onboarding_meet_royal"}'::jsonb,
    0, 14, 24, 'organizations', 'onboarding', 3,
    '{"skip_condition": "has_used_ai"}'::jsonb, true
  ) ON CONFLICT DO NOTHING;

  -- Onboarding Step 4: Add Customers (Day 7)
  INSERT INTO automation_definitions (
    organization_id, name, description, category,
    template_key, trigger_type, trigger_event, action_type, action_config,
    delay_minutes, max_frequency_days, cooldown_hours,
    target_type, sequence_key, sequence_step,
    target_filter, is_enabled
  ) VALUES (
    v_org_id, 'Onboarding: Add Customers', 'Guide SMBs to add their first customers (Day 7)',
    'engagement', 'onboarding_add_customers', 'schedule', 'daily', 'send_message',
    '{"channel": "email", "template_key": "onboarding_add_customers"}'::jsonb,
    0, 14, 24, 'organizations', 'onboarding', 4,
    '{"skip_condition": "has_customers"}'::jsonb, true
  ) ON CONFLICT DO NOTHING;

  -- Onboarding Step 5: Check-in (Day 14)
  INSERT INTO automation_definitions (
    organization_id, name, description, category,
    template_key, trigger_type, trigger_event, action_type, action_config,
    delay_minutes, max_frequency_days, cooldown_hours,
    target_type, sequence_key, sequence_step,
    target_filter, is_enabled
  ) VALUES (
    v_org_id, 'Onboarding: Check-in', 'Two-week check-in with SMB owner (Day 14)',
    'engagement', 'onboarding_checkin', 'schedule', 'daily', 'send_message',
    '{"channel": "email", "template_key": "onboarding_checkin"}'::jsonb,
    0, 30, 24, 'organizations', 'onboarding', 5,
    '{"skip_condition": "has_ten_members"}'::jsonb, true
  ) ON CONFLICT DO NOTHING;

  -- Win-back Step 1: Sorry to see you go (1 day after cancel)
  INSERT INTO automation_definitions (
    organization_id, name, description, category,
    template_key, trigger_type, trigger_event, action_type, action_config,
    delay_minutes, max_frequency_days, cooldown_hours,
    target_type, sequence_key, sequence_step,
    target_filter, is_enabled
  ) VALUES (
    v_org_id, 'Win-Back: Sorry to See You Go', 'Day 1 after subscription cancellation',
    'recovery', 'winback_sorry', 'schedule', 'daily', 'send_message',
    '{"channel": "email", "template_key": "winback_sorry"}'::jsonb,
    0, 90, 24, 'organizations', 'win_back', 1,
    '{"skip_condition": "has_resubscribed"}'::jsonb, true
  ) ON CONFLICT DO NOTHING;

  -- Win-back Step 2: Your customers miss you (Day 7)
  INSERT INTO automation_definitions (
    organization_id, name, description, category,
    template_key, trigger_type, trigger_event, action_type, action_config,
    delay_minutes, max_frequency_days, cooldown_hours,
    target_type, sequence_key, sequence_step,
    target_filter, is_enabled
  ) VALUES (
    v_org_id, 'Win-Back: Your Customers Miss You', 'Day 7 after cancellation with usage stats',
    'recovery', 'winback_miss_you', 'schedule', 'daily', 'send_message',
    '{"channel": "email", "template_key": "winback_miss_you"}'::jsonb,
    0, 90, 24, 'organizations', 'win_back', 2,
    '{"skip_condition": "has_resubscribed"}'::jsonb, true
  ) ON CONFLICT DO NOTHING;

  -- Win-back Step 3: Come back offer (Day 30)
  INSERT INTO automation_definitions (
    organization_id, name, description, category,
    template_key, trigger_type, trigger_event, action_type, action_config,
    delay_minutes, max_frequency_days, cooldown_hours,
    target_type, sequence_key, sequence_step,
    target_filter, is_enabled
  ) VALUES (
    v_org_id, 'Win-Back: Come Back Offer', 'Day 30 final outreach with special offer',
    'recovery', 'winback_offer', 'schedule', 'daily', 'send_message',
    '{"channel": "email", "template_key": "winback_offer"}'::jsonb,
    0, 180, 24, 'organizations', 'win_back', 3,
    '{"skip_condition": "has_resubscribed"}'::jsonb, true
  ) ON CONFLICT DO NOTHING;

  -- Milestone: First customer
  INSERT INTO automation_definitions (
    organization_id, name, description, category,
    template_key, trigger_type, action_type, action_config,
    max_frequency_days, target_type, target_filter, is_enabled
  ) VALUES (
    v_org_id, 'Milestone: First Customer', 'Celebrate when an SMB gets their first loyalty member',
    'behavioral', 'milestone_first_customer', 'condition', 'send_message',
    '{"channel": "email", "template_key": "milestone_first_customer"}'::jsonb,
    NULL, 'organizations', '{"condition": "first_customer"}'::jsonb, true
  ) ON CONFLICT DO NOTHING;

  -- Milestone: 10 Customers
  INSERT INTO automation_definitions (
    organization_id, name, description, category,
    template_key, trigger_type, action_type, action_config,
    max_frequency_days, target_type, target_filter, is_enabled
  ) VALUES (
    v_org_id, 'Milestone: 10 Customers', 'Celebrate when an SMB hits 10 loyalty members',
    'behavioral', 'milestone_10_customers', 'condition', 'send_message',
    '{"channel": "email", "template_key": "milestone_10_customers"}'::jsonb,
    NULL, 'organizations', '{"condition": "10_customers"}'::jsonb, true
  ) ON CONFLICT DO NOTHING;

  -- Milestone: 50 Customers
  INSERT INTO automation_definitions (
    organization_id, name, description, category,
    template_key, trigger_type, action_type, action_config,
    max_frequency_days, target_type, target_filter, is_enabled
  ) VALUES (
    v_org_id, 'Milestone: 50 Customers', 'Celebrate when an SMB hits 50 loyalty members',
    'behavioral', 'milestone_50_customers', 'condition', 'send_message',
    '{"channel": "email", "template_key": "milestone_50_customers"}'::jsonb,
    NULL, 'organizations', '{"condition": "50_customers"}'::jsonb, true
  ) ON CONFLICT DO NOTHING;

  -- Milestone: First Redemption
  INSERT INTO automation_definitions (
    organization_id, name, description, category,
    template_key, trigger_type, action_type, action_config,
    max_frequency_days, target_type, target_filter, is_enabled
  ) VALUES (
    v_org_id, 'Milestone: First Redemption', 'Celebrate when an SMB has their first reward redeemed',
    'behavioral', 'milestone_first_redemption', 'condition', 'send_message',
    '{"channel": "email", "template_key": "milestone_first_redemption"}'::jsonb,
    NULL, 'organizations', '{"condition": "first_redemption"}'::jsonb, true
  ) ON CONFLICT DO NOTHING;

  -- Milestone: 100 Customers (testimonial request)
  INSERT INTO automation_definitions (
    organization_id, name, description, category,
    template_key, trigger_type, action_type, action_config,
    max_frequency_days, target_type, target_filter, is_enabled
  ) VALUES (
    v_org_id, 'Milestone: Testimonial Request', 'Request a testimonial when SMB hits 100+ customers',
    'proactive', 'testimonial_request', 'condition', 'send_message',
    '{"channel": "email", "template_key": "testimonial_request"}'::jsonb,
    NULL, 'organizations', '{"condition": "testimonial_100"}'::jsonb, true
  ) ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Migrated SMB sequences into automation_definitions for org %', v_org_id;
END $$;
