-- =====================================================
-- STRIPE SUBSCRIPTION MIGRATION
-- Run this in Supabase SQL Editor
-- Adds columns for Stripe subscription tracking
-- =====================================================

-- Add subscription-related columns to organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status TEXT;

-- Create index for subscription lookups
CREATE INDEX IF NOT EXISTS idx_organizations_stripe_subscription
    ON organizations(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_subscription_status
    ON organizations(subscription_status) WHERE subscription_status IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN organizations.stripe_customer_id IS 'Stripe customer ID for billing';
COMMENT ON COLUMN organizations.stripe_subscription_id IS 'Active Stripe subscription ID';
COMMENT ON COLUMN organizations.subscription_status IS 'Stripe subscription status: active, past_due, canceled, trialing, etc.';
COMMENT ON COLUMN organizations.subscription_tier IS 'Subscription tier: pro, scale, enterprise';
COMMENT ON COLUMN organizations.plan_type IS 'Plan type: free, subscription, appsumo_lifetime';

-- =====================================================
-- RPC FUNCTION: Get organization billing info
-- =====================================================

CREATE OR REPLACE FUNCTION get_organization_billing(p_organization_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_org organizations%ROWTYPE;
    v_user_id UUID;
BEGIN
    v_user_id := auth.uid();

    -- Verify user has access to this organization
    IF NOT EXISTS (
        SELECT 1 FROM organization_members
        WHERE organization_id = p_organization_id
        AND user_id = v_user_id
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Access denied'
        );
    END IF;

    -- Get organization
    SELECT * INTO v_org
    FROM organizations
    WHERE id = p_organization_id;

    IF v_org.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Organization not found'
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'plan_type', COALESCE(v_org.plan_type, 'free'),
        'subscription_tier', v_org.subscription_tier,
        'subscription_status', v_org.subscription_status,
        'appsumo_tier', v_org.appsumo_tier,
        'has_stripe_customer', v_org.stripe_customer_id IS NOT NULL,
        'has_active_subscription', v_org.subscription_status = 'active' OR v_org.subscription_status = 'trialing'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION get_organization_billing TO authenticated;

-- =====================================================
-- DONE! Run this migration in Supabase SQL Editor
-- =====================================================
