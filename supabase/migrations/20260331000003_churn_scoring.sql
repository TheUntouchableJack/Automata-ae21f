-- Phase 3: Activity Tracking + Churn Scoring
-- Adds last_active_at tracking and nightly churn risk scoring

-- ============================================================
-- Activity tracking columns
-- ============================================================
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS churn_risk_score INTEGER DEFAULT 0;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS churn_risk_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_organizations_churn_risk
  ON organizations (churn_risk_score DESC)
  WHERE churn_risk_score >= 40;

-- ============================================================
-- RPC: update_org_activity — called from dashboard + edge functions
-- ============================================================
CREATE OR REPLACE FUNCTION update_org_activity(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE organizations
  SET last_active_at = NOW()
  WHERE id = p_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_org_activity(UUID) TO authenticated;
