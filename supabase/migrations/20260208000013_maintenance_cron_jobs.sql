-- Phase 5: Maintenance Cron Jobs
-- Adds scheduled jobs for outcome measurement and data maintenance

-- ============================================================================
-- 1. OUTCOME MEASUREMENT - Every 6 hours
-- ============================================================================
-- Measures automation success by checking if members visited after receiving messages

SELECT cron.schedule(
  'measure-automation-outcomes',
  '0 */6 * * *',  -- Every 6 hours (at minute 0 of hours 0, 6, 12, 18)
  $$
  SELECT measure_automation_outcomes(100);  -- Process 100 executions per run
  $$
);

-- ============================================================================
-- 2. CLEANUP OLD COMMUNICATION LOGS - Daily at 4 AM UTC
-- ============================================================================
-- Keep 90 days of communication log for fatigue calculations

SELECT cron.schedule(
  'cleanup-communication-logs',
  '0 4 * * *',  -- Daily at 4 AM UTC
  $$
  DELETE FROM member_communication_log
  WHERE sent_at < NOW() - INTERVAL '90 days';
  $$
);

-- ============================================================================
-- 3. CLEANUP OLD MESSAGE EVENTS - Weekly on Sundays at 5 AM UTC
-- ============================================================================
-- Keep 180 days of webhook event data

SELECT cron.schedule(
  'cleanup-message-events',
  '0 5 * * 0',  -- Weekly on Sundays at 5 AM UTC
  $$
  DELETE FROM message_events
  WHERE occurred_at < NOW() - INTERVAL '180 days';
  $$
);

-- ============================================================================
-- 4. COMMENTS
-- ============================================================================

COMMENT ON VIEW cron_job_status IS 'View of all scheduled cron jobs for automation intelligence maintenance';
