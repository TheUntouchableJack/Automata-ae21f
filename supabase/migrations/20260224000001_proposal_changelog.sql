-- Proposal changelog: tracks all significant actions (signings, ticket moves, approvals, etc.)
CREATE TABLE IF NOT EXISTS proposal_changelog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_group text NOT NULL,
  proposal text DEFAULT '',
  author text NOT NULL,
  section text NOT NULL,
  action text NOT NULL,
  summary text NOT NULL,
  details jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE proposal_changelog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert changelog" ON proposal_changelog
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can read changelog" ON proposal_changelog
  FOR SELECT USING (true);

CREATE INDEX idx_changelog_group ON proposal_changelog(client_group, created_at DESC);
