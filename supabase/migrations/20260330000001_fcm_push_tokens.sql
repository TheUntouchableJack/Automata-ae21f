-- FCM Push Notification Support
-- Adds token storage + RPCs for customer app push registration

-- Add FCM token column to app_members
ALTER TABLE app_members
ADD COLUMN IF NOT EXISTS fcm_token TEXT DEFAULT NULL;

-- Partial index: only index members who have tokens
CREATE INDEX IF NOT EXISTS idx_app_members_fcm_token
ON app_members (id) WHERE fcm_token IS NOT NULL;

-- Save FCM token (called from customer app via anon key)
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
  UPDATE app_members
  SET fcm_token = p_fcm_token, updated_at = NOW()
  WHERE id = p_member_id
    AND deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION save_fcm_token(UUID, TEXT) TO anon, authenticated;

-- Clear FCM token (called on logout or token invalidation)
CREATE OR REPLACE FUNCTION clear_fcm_token(p_member_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE app_members
  SET fcm_token = NULL, updated_at = NOW()
  WHERE id = p_member_id
    AND deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION clear_fcm_token(UUID) TO anon, authenticated;
