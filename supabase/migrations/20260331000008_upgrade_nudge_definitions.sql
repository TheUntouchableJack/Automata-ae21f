-- Add upgrade nudge automations to automation_definitions
-- These fire when SMBs hit 80% of their plan limits

DO $$
DECLARE
  v_admin_user_id UUID := 'b7ac81ba-56c9-4aa2-968a-391d080048f0';
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM organization_members
  WHERE user_id = v_admin_user_id AND role = 'owner'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE NOTICE 'Admin org not found — skipping';
    RETURN;
  END IF;

  -- Upgrade nudge: member limit at 80%
  INSERT INTO automation_definitions (
    organization_id, name, description, category,
    template_key, trigger_type, action_type, action_config,
    max_frequency_days, target_type, target_filter, is_enabled
  ) VALUES (
    v_org_id, 'Upgrade Nudge: Member Limit', 'Notify SMBs when they hit 80% of their member limit',
    'proactive', 'upgrade_nudge_members', 'condition', 'send_message',
    '{"channel": "email", "template_key": "upgrade_nudge_members"}'::jsonb,
    30, 'organizations', '{"condition": "member_limit_80pct"}'::jsonb, true
  ) ON CONFLICT DO NOTHING;

  -- Upgrade nudge: email limit at 80%
  INSERT INTO automation_definitions (
    organization_id, name, description, category,
    template_key, trigger_type, action_type, action_config,
    max_frequency_days, target_type, target_filter, is_enabled
  ) VALUES (
    v_org_id, 'Upgrade Nudge: Email Limit', 'Notify SMBs when they hit 80% of their monthly email limit',
    'proactive', 'upgrade_nudge_emails', 'condition', 'send_message',
    '{"channel": "email", "template_key": "upgrade_nudge_emails"}'::jsonb,
    30, 'organizations', '{"condition": "email_limit_80pct"}'::jsonb, true
  ) ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Added upgrade nudge definitions for org %', v_org_id;
END $$;
