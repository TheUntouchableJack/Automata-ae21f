-- Migration: Automation Event Triggers
-- Connects database events to the automation-engine via pg_net
-- This enables event-based automations (member_joined, visit, etc.) to fire automatically

-- Ensure pg_net extension is available
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================================
-- 1. TRIGGER: New Member Joined
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_automation_member_joined()
RETURNS TRIGGER AS $$
DECLARE
  v_supabase_url TEXT;
  v_service_key TEXT;
  v_org_id UUID;
BEGIN
  -- Get Supabase URL and service key from settings
  v_supabase_url := current_setting('app.settings.supabase_url', true);
  v_service_key := current_setting('app.settings.service_role_key', true);

  -- Get organization_id from the app
  SELECT organization_id INTO v_org_id
  FROM customer_apps
  WHERE id = NEW.app_id;

  -- Call automation-engine with member_joined event
  PERFORM net.http_post(
    url := COALESCE(v_supabase_url, 'https://vhpmmfhfwnpmavytoomd.supabase.co') || '/functions/v1/automation-engine',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || COALESCE(v_service_key, current_setting('supabase.service_role_key', true)),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'type', 'event',
      'event_name', 'member_joined',
      'organization_id', v_org_id,
      'app_id', NEW.app_id,
      'member_id', NEW.id,
      'event_data', jsonb_build_object(
        'tier', NEW.tier,
        'email', NEW.email,
        'first_name', NEW.first_name
      )
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on app_members insert
DROP TRIGGER IF EXISTS automation_member_joined ON app_members;
CREATE TRIGGER automation_member_joined
  AFTER INSERT ON app_members
  FOR EACH ROW
  EXECUTE FUNCTION trigger_automation_member_joined();

-- ============================================================================
-- 2. TRIGGER: Member Visit
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_automation_visit()
RETURNS TRIGGER AS $$
DECLARE
  v_supabase_url TEXT;
  v_service_key TEXT;
  v_org_id UUID;
  v_member RECORD;
BEGIN
  -- Get Supabase URL and service key from settings
  v_supabase_url := current_setting('app.settings.supabase_url', true);
  v_service_key := current_setting('app.settings.service_role_key', true);

  -- Get organization_id and member details
  SELECT ca.organization_id, am.tier, am.visit_count, am.current_streak
  INTO v_org_id, v_member.tier, v_member.visit_count, v_member.current_streak
  FROM customer_apps ca
  JOIN app_members am ON am.app_id = ca.id AND am.id = NEW.member_id
  WHERE ca.id = NEW.app_id;

  -- Call automation-engine with visit event
  PERFORM net.http_post(
    url := COALESCE(v_supabase_url, 'https://vhpmmfhfwnpmavytoomd.supabase.co') || '/functions/v1/automation-engine',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || COALESCE(v_service_key, current_setting('supabase.service_role_key', true)),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'type', 'event',
      'event_name', 'visit',
      'organization_id', v_org_id,
      'app_id', NEW.app_id,
      'member_id', NEW.member_id,
      'event_data', jsonb_build_object(
        'visit_count', COALESCE(v_member.visit_count, 0) + 1,
        'streak', v_member.current_streak,
        'tier', v_member.tier,
        'points_awarded', NEW.points_awarded,
        'streak_bonus', NEW.streak_bonus,
        'milestone_bonus', NEW.milestone_bonus
      )
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on member_visits insert
DROP TRIGGER IF EXISTS automation_visit ON member_visits;
CREATE TRIGGER automation_visit
  AFTER INSERT ON member_visits
  FOR EACH ROW
  EXECUTE FUNCTION trigger_automation_visit();

-- ============================================================================
-- 3. TRIGGER: Points Redeemed
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_automation_points_redeemed()
RETURNS TRIGGER AS $$
DECLARE
  v_supabase_url TEXT;
  v_service_key TEXT;
  v_org_id UUID;
BEGIN
  -- Only fire for redemption transactions
  IF NEW.type != 'redemption' THEN
    RETURN NEW;
  END IF;

  -- Get Supabase URL and service key
  v_supabase_url := current_setting('app.settings.supabase_url', true);
  v_service_key := current_setting('app.settings.service_role_key', true);

  -- Get organization_id
  SELECT organization_id INTO v_org_id
  FROM customer_apps
  WHERE id = NEW.app_id;

  -- Call automation-engine
  PERFORM net.http_post(
    url := COALESCE(v_supabase_url, 'https://vhpmmfhfwnpmavytoomd.supabase.co') || '/functions/v1/automation-engine',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || COALESCE(v_service_key, current_setting('supabase.service_role_key', true)),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'type', 'event',
      'event_name', 'points_redeemed',
      'organization_id', v_org_id,
      'app_id', NEW.app_id,
      'member_id', NEW.member_id,
      'event_data', jsonb_build_object(
        'points_redeemed', ABS(NEW.points_change),
        'reward_name', NEW.description
      )
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on points_transactions insert
DROP TRIGGER IF EXISTS automation_points_redeemed ON points_transactions;
CREATE TRIGGER automation_points_redeemed
  AFTER INSERT ON points_transactions
  FOR EACH ROW
  EXECUTE FUNCTION trigger_automation_points_redeemed();

-- ============================================================================
-- 4. TRIGGER: Tier Upgrade
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_automation_tier_upgrade()
RETURNS TRIGGER AS $$
DECLARE
  v_supabase_url TEXT;
  v_service_key TEXT;
  v_org_id UUID;
  v_tier_order TEXT[] := ARRAY['bronze', 'silver', 'gold', 'platinum'];
  v_old_idx INTEGER;
  v_new_idx INTEGER;
BEGIN
  -- Only fire if tier changed and is an upgrade
  IF OLD.tier IS NOT DISTINCT FROM NEW.tier THEN
    RETURN NEW;
  END IF;

  -- Find tier positions
  v_old_idx := array_position(v_tier_order, LOWER(COALESCE(OLD.tier, 'bronze')));
  v_new_idx := array_position(v_tier_order, LOWER(COALESCE(NEW.tier, 'bronze')));

  -- Only proceed if this is an upgrade
  IF v_new_idx IS NULL OR v_old_idx IS NULL OR v_new_idx <= v_old_idx THEN
    RETURN NEW;
  END IF;

  -- Get Supabase URL and service key
  v_supabase_url := current_setting('app.settings.supabase_url', true);
  v_service_key := current_setting('app.settings.service_role_key', true);

  -- Get organization_id
  SELECT organization_id INTO v_org_id
  FROM customer_apps
  WHERE id = NEW.app_id;

  -- Call automation-engine
  PERFORM net.http_post(
    url := COALESCE(v_supabase_url, 'https://vhpmmfhfwnpmavytoomd.supabase.co') || '/functions/v1/automation-engine',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || COALESCE(v_service_key, current_setting('supabase.service_role_key', true)),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'type', 'event',
      'event_name', 'tier_upgrade',
      'organization_id', v_org_id,
      'app_id', NEW.app_id,
      'member_id', NEW.id,
      'event_data', jsonb_build_object(
        'old_tier', OLD.tier,
        'new_tier', NEW.tier
      )
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on app_members update
DROP TRIGGER IF EXISTS automation_tier_upgrade ON app_members;
CREATE TRIGGER automation_tier_upgrade
  AFTER UPDATE ON app_members
  FOR EACH ROW
  WHEN (OLD.tier IS DISTINCT FROM NEW.tier)
  EXECUTE FUNCTION trigger_automation_tier_upgrade();

-- ============================================================================
-- 5. CRON: Schedule-based Automations (birthday, anniversary)
-- ============================================================================

-- Run at 9 AM UTC daily to process birthday and anniversary automations
SELECT cron.schedule(
  'process-scheduled-automations',
  '0 9 * * *',  -- 9 AM UTC daily
  $$
  SELECT net.http_post(
    url := 'https://vhpmmfhfwnpmavytoomd.supabase.co/functions/v1/automation-engine',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{"type": "cron"}'::jsonb
  ) AS request_id;
  $$
);

-- ============================================================================
-- 6. HELPER: Grant permissions for automation triggers
-- ============================================================================

-- Allow the service role to execute these trigger functions
GRANT EXECUTE ON FUNCTION trigger_automation_member_joined() TO service_role;
GRANT EXECUTE ON FUNCTION trigger_automation_visit() TO service_role;
GRANT EXECUTE ON FUNCTION trigger_automation_points_redeemed() TO service_role;
GRANT EXECUTE ON FUNCTION trigger_automation_tier_upgrade() TO service_role;

-- ============================================================================
-- 7. COMMENTS
-- ============================================================================

COMMENT ON FUNCTION trigger_automation_member_joined() IS 'Fires automation-engine when a new member joins';
COMMENT ON FUNCTION trigger_automation_visit() IS 'Fires automation-engine when a member records a visit';
COMMENT ON FUNCTION trigger_automation_points_redeemed() IS 'Fires automation-engine when points are redeemed';
COMMENT ON FUNCTION trigger_automation_tier_upgrade() IS 'Fires automation-engine when member tier upgrades';
