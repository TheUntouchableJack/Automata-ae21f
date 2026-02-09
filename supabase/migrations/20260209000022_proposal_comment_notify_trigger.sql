-- Proposal Comment Email Notification Trigger
-- Sends email to jay@24hour.design when a new comment is submitted

-- Ensure pg_net extension is available (may already exist from cron migration)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ============================================================================
-- Trigger function to notify on new comment
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_proposal_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_supabase_url TEXT;
  v_service_key TEXT;
BEGIN
  -- Get Supabase URL from environment
  v_supabase_url := current_setting('app.settings.supabase_url', true);
  v_service_key := current_setting('app.settings.service_role_key', true);

  -- Fallback to hardcoded URL if setting not available
  IF v_supabase_url IS NULL OR v_supabase_url = '' THEN
    v_supabase_url := 'https://vhpmmfhfwnpmavytoomd.supabase.co';
  END IF;

  -- Call the edge function to send email notification
  -- pg_net runs async, so this won't block the insert
  PERFORM net.http_post(
    url := v_supabase_url || '/functions/v1/proposal-comment-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(v_service_key, '')
    ),
    body := jsonb_build_object(
      'proposal_id', NEW.proposal_id,
      'question', NEW.question,
      'created_at', NEW.created_at
    )
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail the insert
    RAISE WARNING 'Failed to send notification: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- ============================================================================
-- Attach trigger to proposal_comments table
-- ============================================================================

DROP TRIGGER IF EXISTS on_proposal_comment_insert ON proposal_comments;

CREATE TRIGGER on_proposal_comment_insert
AFTER INSERT ON proposal_comments
FOR EACH ROW
EXECUTE FUNCTION notify_proposal_comment();

-- ============================================================================
-- Grant necessary permissions
-- ============================================================================

-- Allow the trigger function to use pg_net
GRANT USAGE ON SCHEMA net TO postgres;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA net TO postgres;
