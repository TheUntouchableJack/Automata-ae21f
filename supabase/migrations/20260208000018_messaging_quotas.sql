-- Migration: Messaging Quotas for New Pricing Model
-- Adds tracking for email/SMS usage and purchased bundles

-- ============================================================================
-- USAGE TRACKING TABLE
-- ============================================================================

-- Track monthly messaging usage per organization
CREATE TABLE IF NOT EXISTS usage_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    -- Period tracking (monthly reset)
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    -- Messaging usage (incremented per send)
    emails_sent INTEGER NOT NULL DEFAULT 0,
    sms_sent INTEGER NOT NULL DEFAULT 0,
    -- Purchased bundles (added when bundle purchased)
    email_credits_purchased INTEGER NOT NULL DEFAULT 0,
    sms_credits_purchased INTEGER NOT NULL DEFAULT 0,
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Unique constraint: one record per org per period
    UNIQUE(organization_id, period_start)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_usage_tracking_org_period
    ON usage_tracking(organization_id, period_start DESC);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Drop existing functions to handle parameter name changes
DROP FUNCTION IF EXISTS get_current_usage(UUID);
DROP FUNCTION IF EXISTS increment_email_usage(UUID, INTEGER);
DROP FUNCTION IF EXISTS increment_sms_usage(UUID, INTEGER);
DROP FUNCTION IF EXISTS add_messaging_credits(UUID, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS get_messaging_usage(UUID);

-- Get or create usage record for current month
CREATE OR REPLACE FUNCTION get_current_usage(p_organization_id UUID)
RETURNS usage_tracking
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_period_start DATE;
    v_period_end DATE;
    v_usage usage_tracking;
BEGIN
    -- Calculate current month period
    v_period_start := DATE_TRUNC('month', CURRENT_DATE)::DATE;
    v_period_end := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

    -- Try to get existing record
    SELECT * INTO v_usage
    FROM usage_tracking
    WHERE organization_id = p_organization_id
    AND period_start = v_period_start;

    -- Create if doesn't exist
    IF v_usage IS NULL THEN
        INSERT INTO usage_tracking (organization_id, period_start, period_end)
        VALUES (p_organization_id, v_period_start, v_period_end)
        RETURNING * INTO v_usage;
    END IF;

    RETURN v_usage;
END;
$$;

-- Increment email usage
CREATE OR REPLACE FUNCTION increment_email_usage(
    p_organization_id UUID,
    p_count INTEGER DEFAULT 1
)
RETURNS TABLE(
    new_count INTEGER,
    limit_reached BOOLEAN,
    monthly_limit INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_usage usage_tracking;
    v_org RECORD;
    v_limit INTEGER;
    v_effective_limit INTEGER;
BEGIN
    -- Get current usage record
    v_usage := get_current_usage(p_organization_id);

    -- Get org plan info
    SELECT plan_type, subscription_tier, appsumo_tier, has_royalty_pro
    INTO v_org
    FROM organizations
    WHERE id = p_organization_id;

    -- Calculate effective limit based on plan
    -- (This mirrors the plan-limits.js logic)
    CASE
        WHEN v_org.plan_type = 'subscription' THEN
            v_limit := CASE v_org.subscription_tier
                WHEN 'starter' THEN 2000
                WHEN 'growth' THEN 10000
                WHEN 'scale' THEN 50000
                ELSE 0
            END;
        WHEN v_org.plan_type = 'appsumo_lifetime' THEN
            v_limit := CASE v_org.appsumo_tier
                WHEN 1 THEN 500
                WHEN 2 THEN 2000
                WHEN 3 THEN 5000
                ELSE 500
            END;
            -- Add Royalty Pro bonus
            IF v_org.has_royalty_pro THEN
                v_limit := v_limit + 10000;
            END IF;
        ELSE
            v_limit := 0;
    END CASE;

    -- Add purchased credits
    v_effective_limit := v_limit + v_usage.email_credits_purchased;

    -- Increment usage
    UPDATE usage_tracking
    SET emails_sent = emails_sent + p_count,
        updated_at = NOW()
    WHERE id = v_usage.id
    RETURNING emails_sent INTO new_count;

    monthly_limit := v_effective_limit;
    limit_reached := new_count >= v_effective_limit;

    RETURN NEXT;
END;
$$;

-- Increment SMS usage
CREATE OR REPLACE FUNCTION increment_sms_usage(
    p_organization_id UUID,
    p_count INTEGER DEFAULT 1
)
RETURNS TABLE(
    new_count INTEGER,
    limit_reached BOOLEAN,
    monthly_limit INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_usage usage_tracking;
    v_org RECORD;
    v_limit INTEGER;
    v_effective_limit INTEGER;
BEGIN
    -- Get current usage record
    v_usage := get_current_usage(p_organization_id);

    -- Get org plan info
    SELECT plan_type, subscription_tier, appsumo_tier, has_royalty_pro
    INTO v_org
    FROM organizations
    WHERE id = p_organization_id;

    -- Calculate effective limit based on plan
    CASE
        WHEN v_org.plan_type = 'subscription' THEN
            v_limit := CASE v_org.subscription_tier
                WHEN 'starter' THEN 100
                WHEN 'growth' THEN 500
                WHEN 'scale' THEN 2000
                ELSE 0
            END;
        WHEN v_org.plan_type = 'appsumo_lifetime' THEN
            -- LTD tiers have no SMS by default
            v_limit := 0;
            -- Royalty Pro adds 500 SMS
            IF v_org.has_royalty_pro THEN
                v_limit := 500;
            END IF;
        ELSE
            v_limit := 0;
    END CASE;

    -- Add purchased credits
    v_effective_limit := v_limit + v_usage.sms_credits_purchased;

    -- Increment usage
    UPDATE usage_tracking
    SET sms_sent = sms_sent + p_count,
        updated_at = NOW()
    WHERE id = v_usage.id
    RETURNING sms_sent INTO new_count;

    monthly_limit := v_effective_limit;
    limit_reached := new_count >= v_effective_limit;

    RETURN NEXT;
END;
$$;

-- Add credits from bundle purchase
CREATE OR REPLACE FUNCTION add_messaging_credits(
    p_organization_id UUID,
    p_email_credits INTEGER DEFAULT 0,
    p_sms_credits INTEGER DEFAULT 0
)
RETURNS usage_tracking
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_usage usage_tracking;
BEGIN
    -- Get or create current month's usage record
    v_usage := get_current_usage(p_organization_id);

    -- Add credits
    UPDATE usage_tracking
    SET email_credits_purchased = email_credits_purchased + p_email_credits,
        sms_credits_purchased = sms_credits_purchased + p_sms_credits,
        updated_at = NOW()
    WHERE id = v_usage.id
    RETURNING * INTO v_usage;

    RETURN v_usage;
END;
$$;

-- Get messaging usage summary for dashboard
CREATE OR REPLACE FUNCTION get_messaging_usage(p_organization_id UUID)
RETURNS TABLE(
    emails_sent INTEGER,
    emails_limit INTEGER,
    emails_remaining INTEGER,
    sms_sent INTEGER,
    sms_limit INTEGER,
    sms_remaining INTEGER,
    period_start DATE,
    period_end DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_usage usage_tracking;
    v_org RECORD;
    v_email_limit INTEGER;
    v_sms_limit INTEGER;
BEGIN
    -- Get current usage
    v_usage := get_current_usage(p_organization_id);

    -- Get org plan info
    SELECT plan_type, subscription_tier, appsumo_tier, has_royalty_pro
    INTO v_org
    FROM organizations
    WHERE id = p_organization_id;

    -- Calculate email limit
    CASE
        WHEN v_org.plan_type = 'subscription' THEN
            v_email_limit := CASE v_org.subscription_tier
                WHEN 'starter' THEN 2000
                WHEN 'growth' THEN 10000
                WHEN 'scale' THEN 50000
                ELSE 0
            END;
        WHEN v_org.plan_type = 'appsumo_lifetime' THEN
            v_email_limit := CASE v_org.appsumo_tier
                WHEN 1 THEN 500
                WHEN 2 THEN 2000
                WHEN 3 THEN 5000
                ELSE 500
            END;
            IF v_org.has_royalty_pro THEN
                v_email_limit := v_email_limit + 10000;
            END IF;
        ELSE
            v_email_limit := 0;
    END CASE;

    -- Calculate SMS limit
    CASE
        WHEN v_org.plan_type = 'subscription' THEN
            v_sms_limit := CASE v_org.subscription_tier
                WHEN 'starter' THEN 100
                WHEN 'growth' THEN 500
                WHEN 'scale' THEN 2000
                ELSE 0
            END;
        WHEN v_org.plan_type = 'appsumo_lifetime' THEN
            v_sms_limit := CASE WHEN v_org.has_royalty_pro THEN 500 ELSE 0 END;
        ELSE
            v_sms_limit := 0;
    END CASE;

    -- Add purchased credits to limits
    v_email_limit := v_email_limit + v_usage.email_credits_purchased;
    v_sms_limit := v_sms_limit + v_usage.sms_credits_purchased;

    -- Return summary
    emails_sent := v_usage.emails_sent;
    emails_limit := v_email_limit;
    emails_remaining := GREATEST(0, v_email_limit - v_usage.emails_sent);
    sms_sent := v_usage.sms_sent;
    sms_limit := v_sms_limit;
    sms_remaining := GREATEST(0, v_sms_limit - v_usage.sms_sent);
    period_start := v_usage.period_start;
    period_end := v_usage.period_end;

    RETURN NEXT;
END;
$$;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;

-- Organizations can view their own usage
CREATE POLICY "Organizations can view own usage"
    ON usage_tracking FOR SELECT
    USING (
        organization_id IN (
            SELECT organization_id FROM profiles
            WHERE id = auth.uid()
        )
    );

-- Only system can insert/update (via functions)
CREATE POLICY "System can manage usage"
    ON usage_tracking FOR ALL
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- GRANTS
-- ============================================================================

GRANT EXECUTE ON FUNCTION get_current_usage(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_email_usage(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_sms_usage(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION add_messaging_credits(UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_messaging_usage(UUID) TO authenticated;
GRANT SELECT ON usage_tracking TO authenticated;
