-- Phase 4: Upgrade Nudges + Milestone Notifications
-- Tracks which milestones each org has been notified about (prevents duplicates)

CREATE TABLE IF NOT EXISTS smb_milestones (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  milestone_key    TEXT NOT NULL,
  notified_at      TIMESTAMPTZ DEFAULT NOW(),
  metadata         JSONB DEFAULT '{}',
  UNIQUE(organization_id, milestone_key)
);

CREATE INDEX IF NOT EXISTS idx_smb_milestones_org
  ON smb_milestones (organization_id);

ALTER TABLE smb_milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to milestones" ON smb_milestones
  FOR ALL USING (auth.role() = 'service_role');
