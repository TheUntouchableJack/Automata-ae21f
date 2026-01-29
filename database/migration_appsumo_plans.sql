-- AppSumo Lifetime Deal Migration
-- Run this in Supabase SQL Editor after schema.sql

-- =====================================================
-- 1. ADD PLAN COLUMNS TO ORGANIZATIONS
-- =====================================================

-- Plan type: 'free', 'subscription', 'appsumo_lifetime'
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT 'free';

-- AppSumo tier (1, 2, or 3) - only set for appsumo_lifetime plans
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS appsumo_tier INTEGER;

-- Array of redeemed AppSumo codes for this org
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS appsumo_codes TEXT[] DEFAULT '{}';

-- Subscription tier for regular subscribers: 'growth', 'business', 'enterprise'
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_tier TEXT;

-- Stripe customer ID for subscription billing
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Plan limits override (allows custom limits per org if needed)
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_limits_override JSONB;

-- When the plan was last changed
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_changed_at TIMESTAMPTZ;

-- Index for plan lookups
CREATE INDEX IF NOT EXISTS idx_organizations_plan_type ON organizations(plan_type);

-- =====================================================
-- 2. APPSUMO CODES TABLE (for code verification)
-- =====================================================

CREATE TABLE IF NOT EXISTS appsumo_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    tier INTEGER NOT NULL CHECK (tier IN (1, 2, 3)),
    is_redeemed BOOLEAN DEFAULT FALSE,
    redeemed_by_org_id UUID REFERENCES organizations(id),
    redeemed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT -- for admin notes
);

-- Enable RLS
ALTER TABLE appsumo_codes ENABLE ROW LEVEL SECURITY;

-- Index for code lookups
CREATE INDEX IF NOT EXISTS idx_appsumo_codes_code ON appsumo_codes(code);
CREATE INDEX IF NOT EXISTS idx_appsumo_codes_redeemed ON appsumo_codes(is_redeemed);

-- Only allow authenticated users to check codes (but not see all codes)
CREATE POLICY "Users can verify their own codes" ON appsumo_codes
    FOR SELECT USING (
        redeemed_by_org_id IN (
            SELECT organization_id FROM organization_members
            WHERE user_id = auth.uid()
        )
    );

-- =====================================================
-- 3. USAGE TRACKING TABLE (monthly usage metrics)
-- =====================================================

CREATE TABLE IF NOT EXISTS usage_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    period_start DATE NOT NULL, -- First day of the month
    period_end DATE NOT NULL,   -- Last day of the month

    -- Usage counters
    emails_sent INTEGER DEFAULT 0,
    sms_sent INTEGER DEFAULT 0,
    ai_analyses_used INTEGER DEFAULT 0,

    -- Snapshot counts (updated periodically)
    projects_count INTEGER DEFAULT 0,
    automations_count INTEGER DEFAULT 0,
    customers_count INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(organization_id, period_start)
);

-- Enable RLS
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_usage_tracking_org_id ON usage_tracking(organization_id);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_period ON usage_tracking(period_start);

-- Auto-update updated_at
CREATE TRIGGER update_usage_tracking_updated_at
    BEFORE UPDATE ON usage_tracking
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Usage tracking policies
CREATE POLICY "Users can view org usage" ON usage_tracking
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = usage_tracking.organization_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update org usage" ON usage_tracking
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = usage_tracking.organization_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert org usage" ON usage_tracking
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = usage_tracking.organization_id
            AND organization_members.user_id = auth.uid()
        )
    );

-- =====================================================
-- 4. FUNCTION: Get or create current usage period
-- =====================================================

CREATE OR REPLACE FUNCTION get_current_usage(org_id UUID)
RETURNS usage_tracking AS $$
DECLARE
    current_period_start DATE;
    current_period_end DATE;
    usage_record usage_tracking;
BEGIN
    -- Calculate current month boundaries
    current_period_start := DATE_TRUNC('month', CURRENT_DATE)::DATE;
    current_period_end := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

    -- Try to get existing record
    SELECT * INTO usage_record
    FROM usage_tracking
    WHERE organization_id = org_id
    AND period_start = current_period_start;

    -- Create if doesn't exist
    IF NOT FOUND THEN
        INSERT INTO usage_tracking (organization_id, period_start, period_end)
        VALUES (org_id, current_period_start, current_period_end)
        RETURNING * INTO usage_record;
    END IF;

    RETURN usage_record;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 5. FUNCTION: Increment usage counter
-- =====================================================

CREATE OR REPLACE FUNCTION increment_usage(
    org_id UUID,
    usage_type TEXT,
    amount INTEGER DEFAULT 1
)
RETURNS BOOLEAN AS $$
DECLARE
    current_period_start DATE;
BEGIN
    current_period_start := DATE_TRUNC('month', CURRENT_DATE)::DATE;

    -- Ensure usage record exists
    PERFORM get_current_usage(org_id);

    -- Increment the appropriate counter
    IF usage_type = 'emails' THEN
        UPDATE usage_tracking
        SET emails_sent = emails_sent + amount, updated_at = NOW()
        WHERE organization_id = org_id AND period_start = current_period_start;
    ELSIF usage_type = 'sms' THEN
        UPDATE usage_tracking
        SET sms_sent = sms_sent + amount, updated_at = NOW()
        WHERE organization_id = org_id AND period_start = current_period_start;
    ELSIF usage_type = 'ai_analyses' THEN
        UPDATE usage_tracking
        SET ai_analyses_used = ai_analyses_used + amount, updated_at = NOW()
        WHERE organization_id = org_id AND period_start = current_period_start;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 6. FUNCTION: Update snapshot counts
-- =====================================================

CREATE OR REPLACE FUNCTION update_usage_snapshots(org_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    current_period_start DATE;
    proj_count INTEGER;
    auto_count INTEGER;
    cust_count INTEGER;
BEGIN
    current_period_start := DATE_TRUNC('month', CURRENT_DATE)::DATE;

    -- Ensure usage record exists
    PERFORM get_current_usage(org_id);

    -- Count projects
    SELECT COUNT(*) INTO proj_count
    FROM projects WHERE organization_id = org_id;

    -- Count automations (via projects)
    SELECT COUNT(*) INTO auto_count
    FROM automations a
    JOIN projects p ON a.project_id = p.id
    WHERE p.organization_id = org_id;

    -- Count customers
    SELECT COUNT(*) INTO cust_count
    FROM customers WHERE organization_id = org_id;

    -- Update snapshot
    UPDATE usage_tracking
    SET
        projects_count = proj_count,
        automations_count = auto_count,
        customers_count = cust_count,
        updated_at = NOW()
    WHERE organization_id = org_id AND period_start = current_period_start;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 7. FUNCTION: Redeem AppSumo code
-- =====================================================

CREATE OR REPLACE FUNCTION redeem_appsumo_code(
    org_id UUID,
    code_to_redeem TEXT
)
RETURNS JSONB AS $$
DECLARE
    code_record appsumo_codes;
    current_tier INTEGER;
    new_tier INTEGER;
    current_codes TEXT[];
BEGIN
    -- Find the code
    SELECT * INTO code_record
    FROM appsumo_codes
    WHERE code = code_to_redeem;

    -- Check if code exists
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid code');
    END IF;

    -- Check if already redeemed
    IF code_record.is_redeemed THEN
        RETURN jsonb_build_object('success', false, 'error', 'Code already redeemed');
    END IF;

    -- Get current org state
    SELECT appsumo_tier, appsumo_codes INTO current_tier, current_codes
    FROM organizations
    WHERE id = org_id;

    -- Calculate new tier (stacking: tier = sum of code tiers, max 3)
    IF current_tier IS NULL THEN
        new_tier := code_record.tier;
    ELSE
        new_tier := LEAST(current_tier + code_record.tier, 3);
    END IF;

    -- Mark code as redeemed
    UPDATE appsumo_codes
    SET is_redeemed = TRUE, redeemed_by_org_id = org_id, redeemed_at = NOW()
    WHERE id = code_record.id;

    -- Update organization
    UPDATE organizations
    SET
        plan_type = 'appsumo_lifetime',
        appsumo_tier = new_tier,
        appsumo_codes = array_append(COALESCE(current_codes, '{}'), code_to_redeem),
        plan_changed_at = NOW()
    WHERE id = org_id;

    RETURN jsonb_build_object(
        'success', true,
        'tier', new_tier,
        'message', 'Code redeemed successfully! Your plan has been upgraded to Tier ' || new_tier
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 8. SAMPLE APPSUMO CODES (for testing)
-- =====================================================

-- Insert some test codes (remove in production or replace with real codes)
INSERT INTO appsumo_codes (code, tier, notes) VALUES
    ('AUTOMATA-TEST-T1-001', 1, 'Test Tier 1 code'),
    ('AUTOMATA-TEST-T1-002', 1, 'Test Tier 1 code'),
    ('AUTOMATA-TEST-T2-001', 2, 'Test Tier 2 code'),
    ('AUTOMATA-TEST-T2-002', 2, 'Test Tier 2 code'),
    ('AUTOMATA-TEST-T3-001', 3, 'Test Tier 3 code'),
    ('AUTOMATA-TEST-T3-002', 3, 'Test Tier 3 code')
ON CONFLICT (code) DO NOTHING;

-- =====================================================
-- 9. RPC FUNCTION: Check code validity (public check)
-- =====================================================

CREATE OR REPLACE FUNCTION check_appsumo_code(code_to_check TEXT)
RETURNS JSONB AS $$
DECLARE
    code_record appsumo_codes;
BEGIN
    SELECT * INTO code_record
    FROM appsumo_codes
    WHERE code = code_to_check;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Code not found');
    END IF;

    IF code_record.is_redeemed THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Code already redeemed');
    END IF;

    RETURN jsonb_build_object('valid', true, 'tier', code_record.tier);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
