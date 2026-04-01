-- Helper RPCs to eliminate duplicate queries across edge functions
-- Replaces 4 identical org owner lookups and 5 identical member count queries

-- ============================================================
-- get_org_owner_contact: returns owner email, name, user_id for an org
-- Used by: royalty-self-growth (sequences, milestones, outreach), smb-lifecycle-email
-- ============================================================
CREATE OR REPLACE FUNCTION get_org_owner_contact(p_org_id UUID)
RETURNS TABLE(user_id UUID, email TEXT, first_name TEXT, last_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT om.user_id, p.email, p.first_name, p.last_name
  FROM organization_members om
  JOIN profiles p ON p.id = om.user_id
  WHERE om.organization_id = p_org_id
    AND om.role = 'owner'
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION get_org_owner_contact(UUID) TO service_role;

-- ============================================================
-- get_org_customer_metrics: returns app_id + member/redemption counts
-- Used by: milestone checker, churn scorer, read_automations
-- ============================================================
CREATE OR REPLACE FUNCTION get_org_customer_metrics(p_org_id UUID)
RETURNS TABLE(app_id UUID, member_count BIGINT, redemption_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ca.id AS app_id,
    (SELECT COUNT(*) FROM app_members am WHERE am.app_id = ca.id AND am.deleted_at IS NULL) AS member_count,
    (SELECT COUNT(*) FROM reward_redemptions rr WHERE rr.app_id = ca.id) AS redemption_count
  FROM customer_apps ca
  WHERE ca.organization_id = p_org_id
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION get_org_customer_metrics(UUID) TO service_role;
