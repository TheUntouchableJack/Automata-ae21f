-- Fix: Remove Authorization header from notify trigger
-- The edge function was deployed with --no-verify-jwt, so auth is not needed
-- The previous version tried to read app.settings.service_role_key which is empty

CREATE OR REPLACE FUNCTION notify_proposal_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Call edge function without auth (deployed with --no-verify-jwt)
  PERFORM net.http_post(
    url := 'https://vhpmmfhfwnpmavytoomd.supabase.co/functions/v1/proposal-comment-notify',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'proposal_id', NEW.proposal_id,
      'question', NEW.question,
      'created_at', NEW.created_at
    )
  );
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Failed to send notification: %', SQLERRM;
    RETURN NEW;
END;
$$;
