-- Migration: Redemption Codes System
-- Handles AppSumo lifetime codes and tester promo codes
-- Created: 2026-02-10

-- ============================================================================
-- TABLES
-- ============================================================================

-- Redemption codes table
CREATE TABLE IF NOT EXISTS redemption_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    code_type VARCHAR(20) NOT NULL CHECK (code_type IN ('appsumo', 'tester', 'promo')),
    -- For AppSumo codes: which tier does this unlock?
    appsumo_tier INTEGER CHECK (appsumo_tier IS NULL OR appsumo_tier BETWEEN 1 AND 3),
    -- For tester/promo codes: Stripe coupon to apply
    stripe_coupon_id VARCHAR(100),
    discount_percent DECIMAL(5,2),
    -- Usage tracking
    max_uses INTEGER DEFAULT 1, -- -1 for unlimited
    current_uses INTEGER DEFAULT 0,
    -- Validity
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    notes TEXT,
    -- Constraints
    CONSTRAINT valid_appsumo_code CHECK (
        code_type != 'appsumo' OR appsumo_tier IS NOT NULL
    ),
    CONSTRAINT valid_promo_code CHECK (
        code_type NOT IN ('tester', 'promo') OR stripe_coupon_id IS NOT NULL
    )
);

-- Index for fast code lookups
CREATE INDEX IF NOT EXISTS idx_redemption_codes_code ON redemption_codes(code);
CREATE INDEX IF NOT EXISTS idx_redemption_codes_active ON redemption_codes(is_active) WHERE is_active = true;

-- Track who redeemed what code
CREATE TABLE IF NOT EXISTS code_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code_id UUID NOT NULL REFERENCES redemption_codes(id),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    redeemed_by UUID NOT NULL REFERENCES auth.users(id),
    redeemed_at TIMESTAMPTZ DEFAULT NOW(),
    -- Audit: what changed
    previous_plan_type VARCHAR(50),
    new_plan_type VARCHAR(50),
    previous_tier INTEGER,
    new_tier INTEGER,
    -- Unique: one org can only redeem each code once
    UNIQUE(code_id, organization_id)
);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_code_redemptions_org ON code_redemptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_code_redemptions_code ON code_redemptions(code_id);

-- ============================================================================
-- RPC FUNCTIONS
-- ============================================================================

-- Check if a code is valid (called while typing)
CREATE OR REPLACE FUNCTION check_appsumo_code(code_to_check TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_code RECORD;
    v_user_id UUID;
    v_org_id UUID;
    v_already_redeemed BOOLEAN;
BEGIN
    -- Get current user
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Not authenticated');
    END IF;

    -- Get user's organization
    SELECT om.organization_id INTO v_org_id
    FROM organization_members om
    WHERE om.user_id = v_user_id
    LIMIT 1;

    IF v_org_id IS NULL THEN
        RETURN jsonb_build_object('valid', false, 'error', 'No organization found');
    END IF;

    -- Look up the code
    SELECT * INTO v_code
    FROM redemption_codes
    WHERE UPPER(code) = UPPER(code_to_check)
    AND is_active = true;

    IF v_code IS NULL THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Invalid or expired code');
    END IF;

    -- Check expiration
    IF v_code.expires_at IS NOT NULL AND v_code.expires_at < NOW() THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Code has expired');
    END IF;

    -- Check usage limit
    IF v_code.max_uses > 0 AND v_code.current_uses >= v_code.max_uses THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Code has reached maximum uses');
    END IF;

    -- Check if already redeemed by this org
    SELECT EXISTS(
        SELECT 1 FROM code_redemptions
        WHERE code_id = v_code.id AND organization_id = v_org_id
    ) INTO v_already_redeemed;

    IF v_already_redeemed THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Code already redeemed');
    END IF;

    -- Return success with code info
    RETURN jsonb_build_object(
        'valid', true,
        'code_type', v_code.code_type,
        'tier', v_code.appsumo_tier,
        'discount_percent', v_code.discount_percent,
        'stripe_coupon_id', v_code.stripe_coupon_id
    );
END;
$$;

-- Redeem a code (called on form submit)
CREATE OR REPLACE FUNCTION redeem_appsumo_code(org_id UUID, code_to_redeem TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_code RECORD;
    v_org RECORD;
    v_user_id UUID;
    v_new_tier INTEGER;
    v_already_redeemed BOOLEAN;
BEGIN
    -- Get current user
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
    END IF;

    -- Verify user has access to this org
    IF NOT EXISTS(
        SELECT 1 FROM organization_members
        WHERE user_id = v_user_id AND organization_id = org_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Access denied');
    END IF;

    -- Get current org state
    SELECT * INTO v_org FROM organizations WHERE id = org_id;
    IF v_org IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Organization not found');
    END IF;

    -- Look up and validate code
    SELECT * INTO v_code
    FROM redemption_codes
    WHERE UPPER(code) = UPPER(code_to_redeem)
    AND is_active = true;

    IF v_code IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired code');
    END IF;

    -- Check expiration
    IF v_code.expires_at IS NOT NULL AND v_code.expires_at < NOW() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Code has expired');
    END IF;

    -- Check usage limit
    IF v_code.max_uses > 0 AND v_code.current_uses >= v_code.max_uses THEN
        RETURN jsonb_build_object('success', false, 'error', 'Code has reached maximum uses');
    END IF;

    -- Check if already redeemed
    SELECT EXISTS(
        SELECT 1 FROM code_redemptions
        WHERE code_id = v_code.id AND organization_id = org_id
    ) INTO v_already_redeemed;

    IF v_already_redeemed THEN
        RETURN jsonb_build_object('success', false, 'error', 'Code already redeemed');
    END IF;

    -- Handle based on code type
    IF v_code.code_type = 'appsumo' THEN
        -- Calculate new tier (stacking: add tiers, max 3)
        IF v_org.plan_type = 'appsumo_lifetime' AND v_org.appsumo_tier IS NOT NULL THEN
            v_new_tier := LEAST(v_org.appsumo_tier + v_code.appsumo_tier, 3);
        ELSE
            v_new_tier := v_code.appsumo_tier;
        END IF;

        -- Update organization
        UPDATE organizations
        SET plan_type = 'appsumo_lifetime',
            appsumo_tier = v_new_tier,
            updated_at = NOW()
        WHERE id = org_id;

        -- Record redemption
        INSERT INTO code_redemptions (code_id, organization_id, redeemed_by, previous_plan_type, new_plan_type, previous_tier, new_tier)
        VALUES (v_code.id, org_id, v_user_id, v_org.plan_type, 'appsumo_lifetime', v_org.appsumo_tier, v_new_tier);

        -- Increment usage count
        UPDATE redemption_codes
        SET current_uses = current_uses + 1
        WHERE id = v_code.id;

        RETURN jsonb_build_object(
            'success', true,
            'message', format('Your account has been upgraded to Lifetime Tier %s!', v_new_tier),
            'new_tier', v_new_tier,
            'plan_type', 'appsumo_lifetime'
        );

    ELSIF v_code.code_type IN ('tester', 'promo') THEN
        -- For tester/promo codes, just record the redemption
        -- The actual discount is applied in the checkout flow via stripe_coupon_id
        INSERT INTO code_redemptions (code_id, organization_id, redeemed_by, previous_plan_type, new_plan_type)
        VALUES (v_code.id, org_id, v_user_id, v_org.plan_type, v_org.plan_type);

        -- Increment usage count
        UPDATE redemption_codes
        SET current_uses = current_uses + 1
        WHERE id = v_code.id;

        RETURN jsonb_build_object(
            'success', true,
            'message', format('Promo code applied! %s%% discount will be applied at checkout.', v_code.discount_percent),
            'stripe_coupon_id', v_code.stripe_coupon_id,
            'discount_percent', v_code.discount_percent
        );
    END IF;

    RETURN jsonb_build_object('success', false, 'error', 'Unknown code type');
END;
$$;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

ALTER TABLE redemption_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE code_redemptions ENABLE ROW LEVEL SECURITY;

-- Only admins can view/modify codes (via service role)
-- Regular users access via RPC functions only

-- Users can see their own redemptions
CREATE POLICY "Users can view own redemptions"
    ON code_redemptions FOR SELECT
    USING (redeemed_by = auth.uid());

-- ============================================================================
-- SEED DATA: Tester Codes
-- ============================================================================

-- SUPERTESTER: Internal testing, unlimited uses, 99.99% off
INSERT INTO redemption_codes (code, code_type, stripe_coupon_id, discount_percent, max_uses, notes)
VALUES ('SUPERTESTER', 'tester', 'coupon_supertester_9999', 99.99, -1, 'Internal testing - 99.99% off all plans')
ON CONFLICT (code) DO UPDATE SET
    stripe_coupon_id = EXCLUDED.stripe_coupon_id,
    discount_percent = EXCLUDED.discount_percent,
    is_active = true;

-- ALPHA2026: Alpha testers, limited uses, 99.99% off
INSERT INTO redemption_codes (code, code_type, stripe_coupon_id, discount_percent, max_uses, notes)
VALUES ('ALPHA2026', 'tester', 'coupon_supertester_9999', 99.99, 100, 'Alpha tester code - 99.99% off')
ON CONFLICT (code) DO UPDATE SET
    stripe_coupon_id = EXCLUDED.stripe_coupon_id,
    discount_percent = EXCLUDED.discount_percent,
    max_uses = 100,
    is_active = true;

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON redemption_codes TO authenticated;
GRANT SELECT, INSERT ON code_redemptions TO authenticated;
GRANT EXECUTE ON FUNCTION check_appsumo_code(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION redeem_appsumo_code(UUID, TEXT) TO authenticated;
