-- ============================================================
-- Royalty Self-Growth Foundation
-- Dormant by default — nothing runs until Jay hits Start.
-- ============================================================

-- ============================================================
-- self_growth_config
-- Single-row table. status is the kill switch for all autonomy.
-- 'stopped' = cron disabled entirely
-- 'paused'  = cron fires, observes + reports, skips all actions
-- 'running' = full autonomy
-- ============================================================
CREATE TABLE IF NOT EXISTS self_growth_config (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status         text NOT NULL DEFAULT 'stopped' CHECK (status IN ('stopped', 'paused', 'running')),
  ai_provider    text NOT NULL DEFAULT 'anthropic' CHECK (ai_provider IN ('anthropic', 'openai', 'gemini')),
  financial_pause_usd integer NOT NULL DEFAULT 50,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text -- 'jay' | 'royal' | 'system'
);

-- Enforce single-row constraint
CREATE UNIQUE INDEX IF NOT EXISTS self_growth_config_singleton ON self_growth_config ((true));

-- Seed the one config row (dormant by default)
INSERT INTO self_growth_config (status, ai_provider, updated_by)
VALUES ('stopped', 'anthropic', 'system')
ON CONFLICT DO NOTHING;

-- Keep updated_at current on every update
CREATE OR REPLACE FUNCTION update_self_growth_config_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER self_growth_config_updated_at
  BEFORE UPDATE ON self_growth_config
  FOR EACH ROW EXECUTE FUNCTION update_self_growth_config_timestamp();

-- ============================================================
-- self_growth_log
-- Every action Royal takes for Royalty's own business is logged here.
-- Outcome attribution closes the loop — every action gets measured.
-- ============================================================
CREATE TABLE IF NOT EXISTS self_growth_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type           text NOT NULL,
  -- e.g. 'content_published', 'outreach_sent', 'blocker_identified',
  --      'blocker_resolved', 'revenue_snapshot', 'reflection', 'briefing_generated'
  description           text NOT NULL,
  -- Task approval flow for Paused mode:
  -- 'pending_approval' = Paused mode — Royal planned it, Jay must approve
  -- 'approved'         = Jay approved (manually or auto in Running mode)
  -- 'completed'        = executed and done
  -- 'skipped'          = Jay skipped this task today
  -- 'failed'           = execution failed
  status                text NOT NULL DEFAULT 'completed'
                          CHECK (status IN ('pending_approval', 'approved', 'completed', 'skipped', 'failed')),
  outcome               text,
  blocker_identified    text,
  blocker_removed       boolean DEFAULT false,
  revenue_delta_cents   integer, -- positive = gain, negative = loss
  metadata              jsonb DEFAULT '{}',
  -- outcome attribution
  attributed_result     text,    -- what actually happened after this action
  attributed_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS self_growth_log_action_type_idx ON self_growth_log (action_type);
CREATE INDEX IF NOT EXISTS self_growth_log_created_at_idx  ON self_growth_log (created_at DESC);
CREATE INDEX IF NOT EXISTS self_growth_log_blocker_idx     ON self_growth_log (blocker_removed) WHERE blocker_identified IS NOT NULL;
CREATE INDEX IF NOT EXISTS self_growth_log_pending_idx     ON self_growth_log (status, created_at DESC) WHERE status = 'pending_approval';

-- ============================================================
-- outreach_queue
-- Royal drafts outreach here. Jay has a veto window before delivery.
-- status flow: draft → approved → sent (or: draft → rejected)
-- ============================================================
CREATE TABLE IF NOT EXISTS outreach_queue (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_email     text NOT NULL,
  target_org_id    uuid REFERENCES organizations(id) ON DELETE SET NULL,
  target_name      text,
  channel          text NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms', 'x_reply', 'x_post')),
  subject          text,
  body_html        text NOT NULL,
  body_text        text,
  rationale        text, -- why Royal drafted this outreach
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'sent', 'rejected', 'bounced')),
  veto_window_ends timestamptz, -- Jay can reject before this timestamp
  approved_by      text,        -- 'jay' | null (auto-approved after veto window)
  sent_at          timestamptz,
  outcome          text,        -- reply received, activated, unsubscribed, etc.
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outreach_queue_status_idx     ON outreach_queue (status);
CREATE INDEX IF NOT EXISTS outreach_queue_org_idx        ON outreach_queue (target_org_id);
CREATE INDEX IF NOT EXISTS outreach_queue_veto_idx       ON outreach_queue (veto_window_ends) WHERE status = 'draft';
CREATE INDEX IF NOT EXISTS outreach_queue_created_at_idx ON outreach_queue (created_at DESC);

CREATE OR REPLACE FUNCTION update_outreach_queue_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER outreach_queue_updated_at
  BEFORE UPDATE ON outreach_queue
  FOR EACH ROW EXECUTE FUNCTION update_outreach_queue_timestamp();

-- ============================================================
-- RLS policies
-- Service role (edge functions) has full access.
-- Authenticated users (Jay via dashboard) can read + update status.
-- ============================================================

ALTER TABLE self_growth_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE self_growth_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_queue     ENABLE ROW LEVEL SECURITY;

-- self_growth_config: authenticated users can read; only service role writes
CREATE POLICY "authenticated can read config"
  ON self_growth_config FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "service role full access to config"
  ON self_growth_config FOR ALL
  TO service_role USING (true);

-- Jay needs to update status from CEO dashboard (authenticated)
CREATE POLICY "authenticated can update config status"
  ON self_growth_config FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (status IN ('stopped', 'paused', 'running'));

-- self_growth_log: authenticated can read + update status (approve/skip tasks)
CREATE POLICY "authenticated can read growth log"
  ON self_growth_log FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "authenticated can approve or skip tasks"
  ON self_growth_log FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (status IN ('approved', 'skipped'));

CREATE POLICY "service role full access to growth log"
  ON self_growth_log FOR ALL
  TO service_role USING (true);

-- outreach_queue: authenticated can read + update status (approve/reject)
CREATE POLICY "authenticated can read outreach queue"
  ON outreach_queue FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "authenticated can update outreach status"
  ON outreach_queue FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (status IN ('approved', 'rejected'));

CREATE POLICY "service role full access to outreach queue"
  ON outreach_queue FOR ALL
  TO service_role USING (true);
