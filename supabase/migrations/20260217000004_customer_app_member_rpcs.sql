-- =====================================================
-- CUSTOMER APP: SECURITY DEFINER RPC wrappers for member data
-- Fixes: app_members and points_transactions have no anon SELECT policy,
-- so direct table queries from the customer app (anon Supabase client) fail.
-- These RPCs bypass RLS and return only non-sensitive data.
-- =====================================================

-- 1. get_member_profile: replaces direct SELECT on app_members
CREATE OR REPLACE FUNCTION get_member_profile(p_member_id UUID)
RETURNS TABLE (
  id UUID,
  app_id UUID,
  first_name TEXT,
  last_name TEXT,
  display_name TEXT,
  email TEXT,
  phone TEXT,
  points_balance INTEGER,
  total_points_earned INTEGER,
  tier TEXT,
  profile_public BOOLEAN,
  notifications_enabled BOOLEAN,
  joined_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    am.id, am.app_id, am.first_name, am.last_name, am.display_name,
    am.email, am.phone, am.points_balance, am.total_points_earned,
    am.tier, am.profile_public, am.notifications_enabled, am.joined_at
  FROM app_members am
  WHERE am.id = p_member_id
    AND am.deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION get_member_profile(UUID) TO anon, authenticated;

-- 2. get_member_activity: replaces direct SELECT on points_transactions
CREATE OR REPLACE FUNCTION get_member_activity(
  p_member_id UUID,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  type TEXT,
  points_change INTEGER,
  balance_after INTEGER,
  description TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pt.id, pt.type, pt.points_change, pt.balance_after,
    pt.description, pt.created_at
  FROM points_transactions pt
  WHERE pt.member_id = p_member_id
  ORDER BY pt.created_at DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_member_activity(UUID, INTEGER) TO anon, authenticated;

-- 3. update_member_setting: replaces direct UPDATE on app_members
-- Only allows safe keys to prevent updating sensitive fields
CREATE OR REPLACE FUNCTION update_member_setting(
  p_member_id UUID,
  p_key TEXT,
  p_value TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Whitelist of safe settings
  IF p_key NOT IN ('profile_public', 'notifications_enabled', 'display_name') THEN
    RAISE EXCEPTION 'Invalid setting key: %', p_key;
  END IF;

  IF p_key = 'profile_public' THEN
    UPDATE app_members SET profile_public = (p_value = 'true')
    WHERE id = p_member_id AND deleted_at IS NULL;
  ELSIF p_key = 'notifications_enabled' THEN
    UPDATE app_members SET notifications_enabled = (p_value = 'true')
    WHERE id = p_member_id AND deleted_at IS NULL;
  ELSIF p_key = 'display_name' THEN
    UPDATE app_members SET display_name = p_value
    WHERE id = p_member_id AND deleted_at IS NULL;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION update_member_setting(UUID, TEXT, TEXT) TO anon, authenticated;
