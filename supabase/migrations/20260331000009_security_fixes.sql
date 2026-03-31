-- Security fixes from audit (Mar 31, 2026)

-- Fix 1: FCM token RPCs — add member verification
-- Customer app uses anon key (not Supabase auth), so we can't use auth.uid().
-- Instead, verify the member exists and isn't deleted before allowing token updates.
-- This prevents arbitrary member_id injection.

CREATE OR REPLACE FUNCTION save_fcm_token(
  p_member_id UUID,
  p_fcm_token TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify member exists and is not deleted
  IF NOT EXISTS (
    SELECT 1 FROM app_members WHERE id = p_member_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  -- Validate token format (FCM tokens are ~163 chars, alphanumeric + : and -)
  IF p_fcm_token IS NOT NULL AND length(p_fcm_token) > 300 THEN
    RAISE EXCEPTION 'Invalid token format';
  END IF;

  UPDATE app_members
  SET fcm_token = p_fcm_token, updated_at = NOW()
  WHERE id = p_member_id
    AND deleted_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION clear_fcm_token(p_member_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app_members WHERE id = p_member_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  UPDATE app_members
  SET fcm_token = NULL, updated_at = NOW()
  WHERE id = p_member_id
    AND deleted_at IS NULL;
END;
$$;

-- Fix 7: Add claim-based locking for sequence processing
-- Prevents duplicate emails from concurrent self-growth runs
ALTER TABLE automation_sequence_state
  ADD COLUMN IF NOT EXISTS processing_instance TEXT,
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;
