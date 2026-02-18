-- 24 Hour Designs — Proposal System Tables
-- visitor_signatures + feature_approvals + RPCs + RLS

-- ============================================
-- VISITOR SIGNATURES
-- ============================================
CREATE TABLE IF NOT EXISTS visitor_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id UUID NOT NULL,
  proposal_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  title TEXT,
  signature_data_url TEXT NOT NULL,
  signed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(visitor_id, proposal_id)
);

ALTER TABLE visitor_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all inserts on visitor_signatures"
  ON visitor_signatures FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow all reads on visitor_signatures"
  ON visitor_signatures FOR SELECT USING (true);

-- Save / upsert a visitor signature
CREATE OR REPLACE FUNCTION save_visitor_signature(
  p_visitor_id UUID,
  p_proposal_id TEXT,
  p_name TEXT,
  p_email TEXT,
  p_title TEXT,
  p_signature_data_url TEXT
) RETURNS JSON AS $$
BEGIN
  INSERT INTO visitor_signatures (visitor_id, proposal_id, name, email, title, signature_data_url)
  VALUES (p_visitor_id, p_proposal_id, p_name, p_email, p_title, p_signature_data_url)
  ON CONFLICT (visitor_id, proposal_id) DO UPDATE
    SET signature_data_url = EXCLUDED.signature_data_url,
        name = EXCLUDED.name,
        title = EXCLUDED.title,
        signed_at = now();
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fetch a visitor's signature
CREATE OR REPLACE FUNCTION get_visitor_signature(
  p_visitor_id UUID,
  p_proposal_id TEXT
) RETURNS JSON AS $$
DECLARE
  sig visitor_signatures;
BEGIN
  SELECT * INTO sig FROM visitor_signatures
  WHERE visitor_id = p_visitor_id AND proposal_id = p_proposal_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false);
  END IF;
  RETURN json_build_object(
    'success', true,
    'signature_data_url', sig.signature_data_url,
    'name', sig.name,
    'email', sig.email,
    'title', sig.title,
    'signed_at', sig.signed_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- FEATURE APPROVALS
-- ============================================
CREATE TABLE IF NOT EXISTS feature_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  feature_title TEXT NOT NULL,
  sow_label TEXT,
  status TEXT DEFAULT 'pending',
  visitor_id UUID,
  signature_data_url TEXT,
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(proposal_id, feature_id)
);

ALTER TABLE feature_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all reads on feature_approvals"
  ON feature_approvals FOR SELECT USING (true);

CREATE POLICY "Allow all inserts on feature_approvals"
  ON feature_approvals FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow all updates on feature_approvals"
  ON feature_approvals FOR UPDATE USING (true);

-- Upsert a feature approval
CREATE OR REPLACE FUNCTION upsert_feature_approval(
  p_proposal_id TEXT,
  p_feature_id TEXT,
  p_feature_title TEXT,
  p_sow_label TEXT,
  p_status TEXT,
  p_visitor_id UUID,
  p_signature_data_url TEXT
) RETURNS JSON AS $$
BEGIN
  INSERT INTO feature_approvals (
    proposal_id, feature_id, feature_title, sow_label,
    status, visitor_id, signature_data_url, approved_at
  )
  VALUES (
    p_proposal_id, p_feature_id, p_feature_title, p_sow_label,
    p_status, p_visitor_id, p_signature_data_url,
    CASE WHEN p_status = 'approved' THEN now() ELSE NULL END
  )
  ON CONFLICT (proposal_id, feature_id) DO UPDATE
    SET status = EXCLUDED.status,
        signature_data_url = COALESCE(EXCLUDED.signature_data_url, feature_approvals.signature_data_url),
        approved_at = CASE
          WHEN EXCLUDED.status = 'approved' AND feature_approvals.approved_at IS NULL THEN now()
          ELSE feature_approvals.approved_at
        END,
        updated_at = now();
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get all feature approvals for a proposal
CREATE OR REPLACE FUNCTION get_feature_approvals(p_proposal_id TEXT)
RETURNS JSON AS $$
BEGIN
  RETURN (
    SELECT json_agg(row_to_json(fa))
    FROM feature_approvals fa
    WHERE fa.proposal_id = p_proposal_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
