-- Self-Tuning Cron Jobs
-- Schedules auto-pause checks, weekly digest generation, and recovery suggestions

-- ============================================================================
-- 1. AUTO-PAUSE CHECK - Every 6 hours (offset from outcome measurement)
-- ============================================================================
-- Checks for automations with bounce rate > 15% and pauses them

SELECT cron.schedule(
  'check-bouncy-automations',
  '30 */6 * * *',  -- Every 6 hours at minute 30 (offset from :00 outcome measurement)
  $$
  SELECT check_and_pause_bouncy_automations(15.0, 20, 30);
  $$
);

-- ============================================================================
-- 2. WEEKLY DIGEST GENERATION - Every Monday at 8 AM UTC
-- ============================================================================
-- Generates digest snapshots for all active organizations and queues email delivery

SELECT cron.schedule(
  'generate-weekly-digests',
  '0 8 * * 1',  -- Monday at 8 AM UTC
  $$
  -- Generate digests and queue email delivery for all organizations with automations
  WITH orgs_with_automations AS (
      SELECT DISTINCT ad.organization_id
      FROM automation_definitions ad
      WHERE ad.is_archived = FALSE
  ),
  generated_digests AS (
      SELECT
          oa.organization_id,
          generate_weekly_digest(oa.organization_id) as digest_data
      FROM orgs_with_automations oa
  )
  -- Queue digest email delivery via ai_action_queue
  INSERT INTO ai_action_queue (
      organization_id,
      action_type,
      action_payload,
      reasoning,
      confidence,
      status,
      scheduled_for,
      expires_at
  )
  SELECT
      gd.organization_id,
      'send_weekly_digest',
      jsonb_build_object(
          'week_start', gd.digest_data->>'week_start',
          'week_end', gd.digest_data->>'week_end',
          'digest_data', gd.digest_data
      ),
      'Weekly automation performance digest',
      0.95,
      'approved',  -- Auto-approve digest delivery
      NOW(),
      NOW() + INTERVAL '1 day'
  FROM generated_digests gd
  WHERE (gd.digest_data->>'total_automations')::INTEGER > 0;
  $$
);

-- ============================================================================
-- 3. RECOVERY SUGGESTIONS - Weekly on Wednesdays at 10 AM UTC
-- ============================================================================
-- Suggests recovery for automations paused 7+ days

SELECT cron.schedule(
  'suggest-automation-recovery',
  '0 10 * * 3',  -- Wednesday at 10 AM UTC
  $$
  SELECT suggest_automation_recovery(automation_id)
  FROM get_recovery_candidates(NULL, 7);
  $$
);

-- ============================================================================
-- 4. DIGEST SNAPSHOT CLEANUP - Monthly, keep 12 weeks
-- ============================================================================

SELECT cron.schedule(
  'cleanup-old-digest-snapshots',
  '0 6 1 * *',  -- First of each month at 6 AM UTC
  $$
  DELETE FROM weekly_digest_snapshots
  WHERE week_start < CURRENT_DATE - INTERVAL '12 weeks';
  $$
);

-- ============================================================================
-- 5. COMMENTS
-- ============================================================================

COMMENT ON VIEW cron_job_status IS 'View of all scheduled cron jobs including self-tuning jobs';
