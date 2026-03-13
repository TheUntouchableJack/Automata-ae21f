-- Migration: Nightly Cron for royalty-self-growth
-- Schedules the royalty-self-growth function to run at 11 PM UTC daily.
-- This is Royal's nightly autonomous business loop.
-- Nothing runs until Jay flips self_growth_config.status to 'running' or 'paused'.

-- pg_cron and pg_net are already enabled (from 20260208000006)

-- Nightly self-growth loop: 11 PM UTC
SELECT cron.schedule(
  'royalty-self-growth-nightly',
  '0 23 * * *',
  $$
  SELECT net.http_post(
    url := 'https://vhpmmfhfwnpmavytoomd.supabase.co/functions/v1/royalty-self-growth',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{"trigger":"cron","schedule":"nightly"}'::jsonb
  ) AS request_id;
  $$
);

-- Clean up old self_growth_log entries (keep 90 days)
SELECT cron.schedule(
  'cleanup-self-growth-log',
  '0 4 * * *',
  $$
  DELETE FROM self_growth_log
  WHERE created_at < NOW() - INTERVAL '90 days'
    AND status IN ('completed', 'skipped');
  $$
);

-- Clean up old sent/rejected outreach entries (keep 180 days)
SELECT cron.schedule(
  'cleanup-outreach-queue',
  '0 4 * * 0',   -- Weekly on Sunday
  $$
  DELETE FROM outreach_queue
  WHERE created_at < NOW() - INTERVAL '180 days'
    AND status IN ('sent', 'rejected', 'bounced');
  $$
);
