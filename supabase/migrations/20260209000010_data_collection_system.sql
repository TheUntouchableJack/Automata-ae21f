-- Data Collection Learning System
-- Phase 1: Core schema for tracking data collection campaigns, attempts, and learnings

-- ============================================================================
-- 1. DATA COLLECTION CAMPAIGNS
-- Tracks active collection efforts with A/B testing support
-- ============================================================================
CREATE TABLE data_collection_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- What we're collecting
  target_field TEXT NOT NULL CHECK (target_field IN ('phone', 'email', 'birthday', 'preferences')),

  -- Strategy used
  strategy_type TEXT NOT NULL, -- 'receipt_sms', 'points_incentive', 'vip_access', 'order_ready', etc.
  strategy_name TEXT NOT NULL, -- Human-readable name
  value_proposition TEXT, -- "Get your receipt via text"
  incentive_points INTEGER DEFAULT 0,

  -- Automation link (optional - campaign may be manual)
  automation_id UUID REFERENCES automations(id) ON DELETE SET NULL,

  -- Performance counters
  attempts INTEGER DEFAULT 0,
  successes INTEGER DEFAULT 0,
  declines INTEGER DEFAULT 0,

  -- A/B testing
  variant TEXT DEFAULT 'control', -- 'control', 'A', 'B', 'C'
  parent_campaign_id UUID REFERENCES data_collection_campaigns(id) ON DELETE SET NULL,

  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'learning')),

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_collection_campaigns_org ON data_collection_campaigns(organization_id);
CREATE INDEX idx_collection_campaigns_field ON data_collection_campaigns(target_field);
CREATE INDEX idx_collection_campaigns_status ON data_collection_campaigns(status);
CREATE INDEX idx_collection_campaigns_parent ON data_collection_campaigns(parent_campaign_id);

-- RLS
ALTER TABLE data_collection_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their org's campaigns"
  ON data_collection_campaigns FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can manage their org's campaigns"
  ON data_collection_campaigns FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

-- ============================================================================
-- 2. DATA COLLECTION ATTEMPTS
-- Individual attempt tracking per member
-- ============================================================================
CREATE TABLE data_collection_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES data_collection_campaigns(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES app_members(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Context
  touchpoint TEXT NOT NULL, -- 'checkout', 'post_visit', 'loyalty_signup', 'redemption', 'tier_upgrade'
  channel TEXT NOT NULL, -- 'in_person', 'email', 'sms', 'push', 'in_app'

  -- Outcome
  outcome TEXT NOT NULL CHECK (outcome IN ('collected', 'declined', 'ignored', 'invalid', 'pending')),
  collected_value TEXT, -- The actual data collected (will be cleared after member update for PII)

  -- Timing
  attempted_at TIMESTAMPTZ DEFAULT now(),
  responded_at TIMESTAMPTZ,
  response_time_seconds INTEGER GENERATED ALWAYS AS (
    CASE WHEN responded_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (responded_at - attempted_at))::INTEGER
      ELSE NULL
    END
  ) STORED
);

-- Indexes
CREATE INDEX idx_collection_attempts_campaign ON data_collection_attempts(campaign_id);
CREATE INDEX idx_collection_attempts_member ON data_collection_attempts(member_id);
CREATE INDEX idx_collection_attempts_org ON data_collection_attempts(organization_id);
CREATE INDEX idx_collection_attempts_outcome ON data_collection_attempts(outcome);
CREATE INDEX idx_collection_attempts_date ON data_collection_attempts(attempted_at);

-- RLS
ALTER TABLE data_collection_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their org's attempts"
  ON data_collection_attempts FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Service role can manage attempts"
  ON data_collection_attempts FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 3. CUSTOMER DATA GAPS
-- Tracks what data is missing per customer for targeting
-- ============================================================================
CREATE TABLE customer_data_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES app_members(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Gap details
  missing_field TEXT NOT NULL CHECK (missing_field IN ('phone', 'email', 'birthday', 'preferences')),
  priority_score INTEGER DEFAULT 50 CHECK (priority_score >= 0 AND priority_score <= 100),

  -- Collection history
  last_ask_at TIMESTAMPTZ,
  ask_count INTEGER DEFAULT 0,
  max_asks INTEGER DEFAULT 3, -- Never ask more than this
  last_decline_reason TEXT, -- 'explicit_no', 'ignored', 'invalid_data'

  -- Cooling off (exponential backoff)
  next_ask_eligible_at TIMESTAMPTZ DEFAULT now(),

  -- Respect boundaries
  do_not_ask BOOLEAN DEFAULT false, -- Explicit opt-out for this field

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(member_id, missing_field)
);

-- Indexes
CREATE INDEX idx_data_gaps_org ON customer_data_gaps(organization_id);
CREATE INDEX idx_data_gaps_field ON customer_data_gaps(missing_field);
CREATE INDEX idx_data_gaps_eligible ON customer_data_gaps(next_ask_eligible_at);
CREATE INDEX idx_data_gaps_member ON customer_data_gaps(member_id);

-- RLS
ALTER TABLE customer_data_gaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their org's gaps"
  ON customer_data_gaps FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

-- ============================================================================
-- 4. COLLECTION STRATEGY PERFORMANCE
-- Aggregated learnings across businesses for Royal AI recommendations
-- ============================================================================
CREATE TABLE collection_strategy_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Segmentation for learning
  industry TEXT, -- 'restaurant', 'salon', 'retail', 'fitness', etc.
  business_size TEXT CHECK (business_size IN ('small', 'medium', 'large')),
  target_field TEXT NOT NULL CHECK (target_field IN ('phone', 'email', 'birthday', 'preferences')),
  strategy_type TEXT NOT NULL,
  touchpoint TEXT,

  -- Aggregated performance
  total_attempts INTEGER DEFAULT 0,
  total_successes INTEGER DEFAULT 0,
  total_declines INTEGER DEFAULT 0,
  avg_conversion_rate DECIMAL(5,4),

  -- Confidence (based on sample size)
  sample_size INTEGER DEFAULT 0, -- Number of distinct organizations
  confidence_score DECIMAL(3,2), -- 0.00 to 1.00

  -- Best practices learned
  best_value_proposition TEXT,
  optimal_incentive_points INTEGER,
  best_time_of_day TEXT, -- 'morning', 'afternoon', 'evening'
  best_day_of_week INTEGER, -- 0-6

  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint for aggregation
CREATE UNIQUE INDEX idx_strategy_perf_unique
  ON collection_strategy_performance(
    COALESCE(industry, ''),
    COALESCE(business_size, ''),
    target_field,
    strategy_type,
    COALESCE(touchpoint, '')
  );

-- Index for lookups
CREATE INDEX idx_strategy_perf_lookup
  ON collection_strategy_performance(industry, target_field, strategy_type);

-- RLS (read-only for authenticated users - aggregated anonymized data)
ALTER TABLE collection_strategy_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read strategy performance"
  ON collection_strategy_performance FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================================
-- 5. PROFILE COMPLETION REWARDS
-- Gamification configuration per organization
-- ============================================================================
CREATE TABLE profile_completion_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,

  -- Points for each field
  phone_added_points INTEGER DEFAULT 25,
  email_added_points INTEGER DEFAULT 25,
  birthday_added_points INTEGER DEFAULT 50,
  preferences_added_points INTEGER DEFAULT 25,
  complete_profile_bonus INTEGER DEFAULT 100, -- All fields filled

  -- Gamification options
  show_progress_bar BOOLEAN DEFAULT true,
  celebration_animation BOOLEAN DEFAULT true,
  show_achievements BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE profile_completion_rewards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their org's rewards config"
  ON profile_completion_rewards FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can manage their org's rewards config"
  ON profile_completion_rewards FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

-- ============================================================================
-- 6. CUSTOMER PREFERENCES
-- Communication and data collection preferences per member
-- ============================================================================
CREATE TABLE customer_preferences (
  member_id UUID PRIMARY KEY REFERENCES app_members(id) ON DELETE CASCADE,

  -- Communication preferences
  sms_opt_in BOOLEAN DEFAULT false,
  email_opt_in BOOLEAN DEFAULT false,
  push_opt_in BOOLEAN DEFAULT true,

  -- Frequency preferences
  max_messages_per_week INTEGER DEFAULT 3,
  preferred_contact_time TEXT, -- 'morning', 'afternoon', 'evening', 'any'

  -- Data collection preferences
  allow_birthday_ask BOOLEAN DEFAULT true,
  allow_preference_questions BOOLEAN DEFAULT true,

  -- Global controls
  do_not_contact BOOLEAN DEFAULT false,
  do_not_ask_for_data BOOLEAN DEFAULT false,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  opted_out_at TIMESTAMPTZ
);

-- RLS
ALTER TABLE customer_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage preferences"
  ON customer_preferences FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 7. ADD PENDING COLLECTION FIELDS TO APP_MEMBERS
-- Track when we're waiting for a reply from a customer
-- ============================================================================
ALTER TABLE app_members ADD COLUMN IF NOT EXISTS
  pending_collection_type TEXT; -- 'birthday', 'email', 'preference'

ALTER TABLE app_members ADD COLUMN IF NOT EXISTS
  pending_collection_campaign_id UUID REFERENCES data_collection_campaigns(id) ON DELETE SET NULL;

ALTER TABLE app_members ADD COLUMN IF NOT EXISTS
  pending_collection_sent_at TIMESTAMPTZ;

-- Index for finding members with pending collections
CREATE INDEX IF NOT EXISTS idx_members_pending_collection
  ON app_members(pending_collection_type)
  WHERE pending_collection_type IS NOT NULL;

-- ============================================================================
-- 8. TRIGGERS FOR UPDATED_AT
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_data_collection_campaigns_updated_at
  BEFORE UPDATE ON data_collection_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customer_data_gaps_updated_at
  BEFORE UPDATE ON customer_data_gaps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profile_completion_rewards_updated_at
  BEFORE UPDATE ON profile_completion_rewards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customer_preferences_updated_at
  BEFORE UPDATE ON customer_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 9. COMMENTS FOR DOCUMENTATION
-- ============================================================================
COMMENT ON TABLE data_collection_campaigns IS 'Tracks data collection campaigns with A/B testing support';
COMMENT ON TABLE data_collection_attempts IS 'Individual collection attempt tracking per member';
COMMENT ON TABLE customer_data_gaps IS 'Tracks missing data per customer with cooling off periods';
COMMENT ON TABLE collection_strategy_performance IS 'Aggregated learnings across businesses for AI recommendations';
COMMENT ON TABLE profile_completion_rewards IS 'Gamification configuration per organization';
COMMENT ON TABLE customer_preferences IS 'Customer communication and data collection preferences';
