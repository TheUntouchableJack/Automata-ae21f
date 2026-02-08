-- Migration: Cron Scheduling for Autonomous Runner
-- Schedules the royal-ai-autonomous function to run every 5 minutes

-- Enable pg_cron and pg_net extensions if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule the autonomous runner to process the action queue every 5 minutes
-- This enables fully autonomous operation without manual triggers
SELECT cron.schedule(
  'process-ai-action-queue',           -- Job name
  '*/5 * * * *',                       -- Every 5 minutes
  $$
  SELECT net.http_post(
    url := 'https://vhpmmfhfwnpmavytoomd.supabase.co/functions/v1/royal-ai-autonomous',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Also schedule cleanup of old audit logs (once per day at 3 AM UTC)
SELECT cron.schedule(
  'cleanup-ai-audit-logs',
  '0 3 * * *',                         -- Daily at 3 AM UTC
  $$
  DELETE FROM ai_audit_log
  WHERE created_at < NOW() - INTERVAL '90 days';
  $$
);

-- Expire old pending actions that weren't approved (once per hour)
SELECT cron.schedule(
  'expire-pending-actions',
  '0 * * * *',                         -- Every hour
  $$
  UPDATE ai_action_queue
  SET status = 'expired',
      updated_at = NOW()
  WHERE status = 'pending'
  AND expires_at < NOW();
  $$
);

-- Add helpful comments
COMMENT ON EXTENSION pg_cron IS 'Scheduled job execution for autonomous AI operations';

-- Create view to see scheduled jobs (using actual pg_cron schema)
CREATE OR REPLACE VIEW cron_job_status AS
SELECT
  jobid,
  jobname,
  schedule,
  command,
  nodename,
  database,
  username,
  active
FROM cron.job;

-- Grant access to view job status
GRANT SELECT ON cron_job_status TO authenticated;
