-- Migration: Cron for auto-sending outreach emails past their veto window
-- Runs every 30 minutes — picks up:
--   1. Items with status='approved' (Jay approved manually but send-approved-outreach wasn't called)
--   2. Items with status='draft' AND veto_window_ends < now() (2-hour window expired, Jay didn't reject)
--
-- The actual sending is done by the send-approved-outreach edge function.
-- Nothing sends until self_growth_config.status = 'running' (checked inside the function via outreach_queue state).

-- pg_cron and pg_net are already enabled

SELECT cron.schedule(
  'send-approved-outreach',
  '*/30 * * * *',     -- Every 30 minutes
  $$
  SELECT net.http_post(
    url := 'https://vhpmmfhfwnpmavytoomd.supabase.co/functions/v1/send-approved-outreach',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
