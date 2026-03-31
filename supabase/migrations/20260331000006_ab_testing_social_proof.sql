-- Phase 6: A/B Testing + Social Proof
-- Adds variant tracking on outreach + testimonial collection

-- ============================================================
-- A/B variant support on outreach_queue
-- ============================================================
ALTER TABLE outreach_queue ADD COLUMN IF NOT EXISTS variant TEXT DEFAULT 'A';
ALTER TABLE outreach_queue ADD COLUMN IF NOT EXISTS experiment_id UUID;

CREATE INDEX IF NOT EXISTS idx_outreach_experiment
  ON outreach_queue (experiment_id) WHERE experiment_id IS NOT NULL;

-- ============================================================
-- smb_testimonials — collect and manage customer stories
-- ============================================================
CREATE TABLE IF NOT EXISTS smb_testimonials (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID REFERENCES organizations(id) ON DELETE CASCADE,
  contact_name     TEXT,
  business_name    TEXT,
  quote            TEXT,
  metrics          JSONB DEFAULT '{}',
  status           TEXT DEFAULT 'requested'
                     CHECK (status IN ('requested', 'received', 'approved', 'published')),
  requested_at     TIMESTAMPTZ DEFAULT NOW(),
  received_at      TIMESTAMPTZ,
  approved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_testimonials_status
  ON smb_testimonials (status);

ALTER TABLE smb_testimonials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to testimonials" ON smb_testimonials
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Admin can read testimonials" ON smb_testimonials
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );
