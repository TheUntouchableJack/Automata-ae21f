-- =====================================================
-- CUSTOMER APPS MIGRATION
-- Run this in Supabase SQL Editor
-- Adds customer-facing apps (loyalty, rewards, etc.)
-- =====================================================

-- =====================================================
-- 1. CUSTOMER_APPS TABLE
-- Main app container (org-level, can be linked from multiple automations)
-- =====================================================

CREATE TABLE IF NOT EXISTS customer_apps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,

    -- App Identity
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    app_type TEXT NOT NULL DEFAULT 'loyalty',  -- 'loyalty', 'rewards', 'membership', 'custom'

    -- Branding
    branding JSONB DEFAULT '{
        "primary_color": "#7c3aed",
        "secondary_color": "#1e293b",
        "logo_url": null,
        "favicon_url": null,
        "cover_image_url": null,
        "custom_css": null
    }',

    -- Features (toggle on/off)
    features JSONB DEFAULT '{
        "points_enabled": true,
        "leaderboard_enabled": true,
        "rewards_enabled": true,
        "menu_enabled": false,
        "announcements_enabled": true,
        "profile_public": false,
        "referrals_enabled": false
    }',

    -- QR Code
    qr_code_id TEXT UNIQUE,
    qr_code_url TEXT,

    -- Settings
    settings JSONB DEFAULT '{
        "points_per_scan": 10,
        "points_per_dollar": 1,
        "daily_scan_limit": 5,
        "welcome_points": 50,
        "require_email": true,
        "require_phone": false,
        "tier_thresholds": {
            "silver": 500,
            "gold": 1500,
            "platinum": 5000
        }
    }',

    -- Status
    is_active BOOLEAN DEFAULT false,
    is_published BOOLEAN DEFAULT false,

    -- Soft delete
    deleted_at TIMESTAMPTZ DEFAULT NULL,
    deleted_by UUID REFERENCES profiles(id),

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for customer_apps
CREATE INDEX IF NOT EXISTS idx_customer_apps_org ON customer_apps(organization_id);
CREATE INDEX IF NOT EXISTS idx_customer_apps_project ON customer_apps(project_id);
CREATE INDEX IF NOT EXISTS idx_customer_apps_slug ON customer_apps(slug);
CREATE INDEX IF NOT EXISTS idx_customer_apps_qr_code ON customer_apps(qr_code_id);
CREATE INDEX IF NOT EXISTS idx_customer_apps_deleted ON customer_apps(organization_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_customer_apps_active ON customer_apps(organization_id, is_active, is_published)
    WHERE deleted_at IS NULL;


-- =====================================================
-- 2. ADD APP_ID TO AUTOMATIONS
-- Many automations can share one app
-- =====================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'automations' AND column_name = 'app_id'
    ) THEN
        ALTER TABLE automations ADD COLUMN app_id UUID REFERENCES customer_apps(id) ON DELETE SET NULL;
        CREATE INDEX idx_automations_app ON automations(app_id);
    END IF;
END $$;


-- =====================================================
-- 3. APP_MEMBERS TABLE
-- Customer accounts within an app
-- =====================================================

CREATE TABLE IF NOT EXISTS app_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,

    -- Member Identity
    email TEXT,
    phone TEXT,
    first_name TEXT,
    last_name TEXT,
    display_name TEXT,
    avatar_url TEXT,

    -- Authentication
    pin_hash TEXT,
    auth_token TEXT,
    last_login_at TIMESTAMPTZ,

    -- Points & Status
    points_balance INTEGER DEFAULT 0,
    total_points_earned INTEGER DEFAULT 0,
    total_points_redeemed INTEGER DEFAULT 0,
    tier TEXT DEFAULT 'bronze',  -- 'bronze', 'silver', 'gold', 'platinum'

    -- Profile Settings
    profile_public BOOLEAN DEFAULT false,
    notifications_enabled BOOLEAN DEFAULT true,

    -- Referral
    referral_code TEXT UNIQUE,
    referred_by UUID REFERENCES app_members(id),

    -- Soft delete
    deleted_at TIMESTAMPTZ DEFAULT NULL,

    -- Timestamps
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CONSTRAINT app_members_email_unique UNIQUE(app_id, email),
    CONSTRAINT app_members_phone_unique UNIQUE(app_id, phone)
);

-- Indexes for app_members
CREATE INDEX IF NOT EXISTS idx_app_members_app ON app_members(app_id);
CREATE INDEX IF NOT EXISTS idx_app_members_customer ON app_members(customer_id);
CREATE INDEX IF NOT EXISTS idx_app_members_email ON app_members(app_id, email);
CREATE INDEX IF NOT EXISTS idx_app_members_phone ON app_members(app_id, phone);
CREATE INDEX IF NOT EXISTS idx_app_members_points ON app_members(app_id, points_balance DESC);
CREATE INDEX IF NOT EXISTS idx_app_members_tier ON app_members(app_id, tier);
CREATE INDEX IF NOT EXISTS idx_app_members_referral ON app_members(referral_code);
CREATE INDEX IF NOT EXISTS idx_app_members_leaderboard ON app_members(app_id, profile_public, points_balance DESC)
    WHERE deleted_at IS NULL AND profile_public = true;


-- =====================================================
-- 4. POINTS_TRANSACTIONS TABLE
-- All points activity (earn/redeem)
-- =====================================================

CREATE TABLE IF NOT EXISTS points_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES app_members(id) ON DELETE CASCADE,

    -- Transaction Details
    type TEXT NOT NULL,  -- 'scan', 'purchase', 'reward_redeem', 'referral', 'bonus', 'adjustment', 'welcome'
    points_change INTEGER NOT NULL,  -- positive for earn, negative for redeem
    balance_after INTEGER NOT NULL,

    -- Context
    description TEXT,
    reference_id UUID,  -- link to reward_redemptions, purchases, etc.
    reference_type TEXT, -- 'reward', 'purchase', 'referral'
    metadata JSONB DEFAULT '{}',  -- store purchase amount, scan location, staff id, etc.

    -- Staff who processed (for scan/purchase)
    processed_by UUID REFERENCES profiles(id),

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for points_transactions
CREATE INDEX IF NOT EXISTS idx_points_transactions_app ON points_transactions(app_id);
CREATE INDEX IF NOT EXISTS idx_points_transactions_member ON points_transactions(member_id);
CREATE INDEX IF NOT EXISTS idx_points_transactions_type ON points_transactions(type);
CREATE INDEX IF NOT EXISTS idx_points_transactions_created ON points_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_points_transactions_member_recent ON points_transactions(member_id, created_at DESC);


-- =====================================================
-- 5. APP_REWARDS TABLE
-- Rewards catalog
-- =====================================================

CREATE TABLE IF NOT EXISTS app_rewards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,

    -- Reward Details
    name TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    points_cost INTEGER NOT NULL,

    -- Value (for display)
    retail_value DECIMAL(10,2),

    -- Availability
    is_active BOOLEAN DEFAULT true,
    quantity_available INTEGER,  -- NULL = unlimited
    quantity_redeemed INTEGER DEFAULT 0,

    -- Restrictions
    tier_required TEXT,  -- minimum tier to redeem (NULL = any tier)
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    max_per_member INTEGER,  -- NULL = unlimited per member

    -- Display
    display_order INTEGER DEFAULT 0,
    featured BOOLEAN DEFAULT false,
    category TEXT,

    -- Soft delete
    deleted_at TIMESTAMPTZ DEFAULT NULL,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for app_rewards
CREATE INDEX IF NOT EXISTS idx_app_rewards_app ON app_rewards(app_id);
CREATE INDEX IF NOT EXISTS idx_app_rewards_active ON app_rewards(app_id, is_active)
    WHERE is_active = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_app_rewards_featured ON app_rewards(app_id, featured, display_order)
    WHERE is_active = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_app_rewards_category ON app_rewards(app_id, category)
    WHERE is_active = true AND deleted_at IS NULL;


-- =====================================================
-- 6. REWARD_REDEMPTIONS TABLE
-- Redemption history
-- =====================================================

CREATE TABLE IF NOT EXISTS reward_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES app_members(id) ON DELETE CASCADE,
    reward_id UUID NOT NULL REFERENCES app_rewards(id) ON DELETE CASCADE,

    -- Redemption Details
    points_spent INTEGER NOT NULL,
    reward_name TEXT NOT NULL,  -- snapshot of reward name at time of redemption
    status TEXT DEFAULT 'pending',  -- 'pending', 'confirmed', 'fulfilled', 'cancelled', 'expired'

    -- Redemption Code (for in-store verification)
    redemption_code TEXT UNIQUE,

    -- Staff who fulfilled
    fulfilled_by UUID REFERENCES profiles(id),

    -- Notes
    notes TEXT,

    -- Timestamps
    redeemed_at TIMESTAMPTZ DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    fulfilled_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,  -- optional expiry for redemption codes
    cancelled_at TIMESTAMPTZ
);

-- Indexes for reward_redemptions
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_app ON reward_redemptions(app_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_member ON reward_redemptions(member_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_reward ON reward_redemptions(reward_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_status ON reward_redemptions(status);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_code ON reward_redemptions(redemption_code);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_pending ON reward_redemptions(app_id, status)
    WHERE status IN ('pending', 'confirmed');


-- =====================================================
-- 7. APP_MENU_ITEMS TABLE
-- Menu/catalog items
-- =====================================================

CREATE TABLE IF NOT EXISTS app_menu_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,

    -- Item Details
    name TEXT NOT NULL,
    description TEXT,
    price DECIMAL(10,2),
    image_url TEXT,
    category TEXT,

    -- Points
    points_value INTEGER,  -- points earned when purchasing this item

    -- Tags
    tags TEXT[] DEFAULT '{}',  -- e.g., 'vegetarian', 'spicy', 'new', 'popular'

    -- Availability
    is_available BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,

    -- Soft delete
    deleted_at TIMESTAMPTZ DEFAULT NULL,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for app_menu_items
CREATE INDEX IF NOT EXISTS idx_app_menu_items_app ON app_menu_items(app_id);
CREATE INDEX IF NOT EXISTS idx_app_menu_items_category ON app_menu_items(app_id, category)
    WHERE is_available = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_app_menu_items_available ON app_menu_items(app_id, is_available, display_order)
    WHERE deleted_at IS NULL;


-- =====================================================
-- 8. APP_ANNOUNCEMENTS TABLE
-- Business updates/promos
-- =====================================================

CREATE TABLE IF NOT EXISTS app_announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,

    -- Announcement Details
    title TEXT NOT NULL,
    content TEXT,
    image_url TEXT,
    link_url TEXT,
    link_text TEXT,

    -- Display
    is_pinned BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,

    -- Scheduling
    starts_at TIMESTAMPTZ DEFAULT NOW(),
    ends_at TIMESTAMPTZ,

    -- Targeting (optional)
    target_tiers TEXT[],  -- NULL = all tiers, or specific tiers like ['gold', 'platinum']

    -- Soft delete
    deleted_at TIMESTAMPTZ DEFAULT NULL,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for app_announcements
CREATE INDEX IF NOT EXISTS idx_app_announcements_app ON app_announcements(app_id);
CREATE INDEX IF NOT EXISTS idx_app_announcements_active ON app_announcements(app_id, is_active, starts_at, ends_at)
    WHERE is_active = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_app_announcements_pinned ON app_announcements(app_id, is_pinned, display_order)
    WHERE is_active = true AND deleted_at IS NULL;


-- =====================================================
-- 9. APP_EVENTS TABLE
-- Activity stream for automation triggers
-- =====================================================

CREATE TABLE IF NOT EXISTS app_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,
    member_id UUID REFERENCES app_members(id) ON DELETE CASCADE,

    -- Event Details
    event_type TEXT NOT NULL,  -- 'member_joined', 'points_earned', 'reward_redeemed', 'tier_upgrade', 'scan', 'visit', 'referral'
    event_data JSONB DEFAULT '{}',

    -- For automation triggers
    processed BOOLEAN DEFAULT false,
    processed_at TIMESTAMPTZ,
    automation_id UUID REFERENCES automations(id),

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for app_events
CREATE INDEX IF NOT EXISTS idx_app_events_app ON app_events(app_id);
CREATE INDEX IF NOT EXISTS idx_app_events_member ON app_events(member_id);
CREATE INDEX IF NOT EXISTS idx_app_events_type ON app_events(event_type);
CREATE INDEX IF NOT EXISTS idx_app_events_unprocessed ON app_events(app_id, processed)
    WHERE processed = false;
CREATE INDEX IF NOT EXISTS idx_app_events_recent ON app_events(app_id, created_at DESC);


-- =====================================================
-- 10. RLS POLICIES
-- Row-level security for multi-tenant access
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE customer_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_events ENABLE ROW LEVEL SECURITY;

-- customer_apps: org members can manage
DROP POLICY IF EXISTS "Org members can manage apps" ON customer_apps;
CREATE POLICY "Org members can manage apps" ON customer_apps
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = customer_apps.organization_id
            AND organization_members.user_id = auth.uid()
        )
    );

-- customer_apps: public can view published apps (for customer-facing pages)
DROP POLICY IF EXISTS "Public can view published apps" ON customer_apps;
CREATE POLICY "Public can view published apps" ON customer_apps
    FOR SELECT USING (
        is_published = true
        AND is_active = true
        AND deleted_at IS NULL
    );

-- app_members: org members can manage all members in their apps
DROP POLICY IF EXISTS "Org can manage app members" ON app_members;
CREATE POLICY "Org can manage app members" ON app_members
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON om.organization_id = ca.organization_id
            WHERE ca.id = app_members.app_id
            AND om.user_id = auth.uid()
        )
    );

-- app_members: public can insert (for join flow) into published apps
DROP POLICY IF EXISTS "Public can join published apps" ON app_members;
CREATE POLICY "Public can join published apps" ON app_members
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            WHERE ca.id = app_members.app_id
            AND ca.is_published = true
            AND ca.is_active = true
            AND ca.deleted_at IS NULL
        )
    );

-- points_transactions: org members can manage
DROP POLICY IF EXISTS "Org can manage points transactions" ON points_transactions;
CREATE POLICY "Org can manage points transactions" ON points_transactions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON om.organization_id = ca.organization_id
            WHERE ca.id = points_transactions.app_id
            AND om.user_id = auth.uid()
        )
    );

-- app_rewards: org members can manage
DROP POLICY IF EXISTS "Org can manage rewards" ON app_rewards;
CREATE POLICY "Org can manage rewards" ON app_rewards
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON om.organization_id = ca.organization_id
            WHERE ca.id = app_rewards.app_id
            AND om.user_id = auth.uid()
        )
    );

-- app_rewards: public can view active rewards in published apps
DROP POLICY IF EXISTS "Public can view active rewards" ON app_rewards;
CREATE POLICY "Public can view active rewards" ON app_rewards
    FOR SELECT USING (
        is_active = true
        AND deleted_at IS NULL
        AND EXISTS (
            SELECT 1 FROM customer_apps ca
            WHERE ca.id = app_rewards.app_id
            AND ca.is_published = true
            AND ca.is_active = true
        )
    );

-- reward_redemptions: org members can manage
DROP POLICY IF EXISTS "Org can manage redemptions" ON reward_redemptions;
CREATE POLICY "Org can manage redemptions" ON reward_redemptions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON om.organization_id = ca.organization_id
            WHERE ca.id = reward_redemptions.app_id
            AND om.user_id = auth.uid()
        )
    );

-- app_menu_items: org members can manage
DROP POLICY IF EXISTS "Org can manage menu items" ON app_menu_items;
CREATE POLICY "Org can manage menu items" ON app_menu_items
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON om.organization_id = ca.organization_id
            WHERE ca.id = app_menu_items.app_id
            AND om.user_id = auth.uid()
        )
    );

-- app_menu_items: public can view available items in published apps
DROP POLICY IF EXISTS "Public can view menu items" ON app_menu_items;
CREATE POLICY "Public can view menu items" ON app_menu_items
    FOR SELECT USING (
        is_available = true
        AND deleted_at IS NULL
        AND EXISTS (
            SELECT 1 FROM customer_apps ca
            WHERE ca.id = app_menu_items.app_id
            AND ca.is_published = true
            AND ca.is_active = true
        )
    );

-- app_announcements: org members can manage
DROP POLICY IF EXISTS "Org can manage announcements" ON app_announcements;
CREATE POLICY "Org can manage announcements" ON app_announcements
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON om.organization_id = ca.organization_id
            WHERE ca.id = app_announcements.app_id
            AND om.user_id = auth.uid()
        )
    );

-- app_announcements: public can view active announcements in published apps
DROP POLICY IF EXISTS "Public can view announcements" ON app_announcements;
CREATE POLICY "Public can view announcements" ON app_announcements
    FOR SELECT USING (
        is_active = true
        AND deleted_at IS NULL
        AND (starts_at IS NULL OR starts_at <= NOW())
        AND (ends_at IS NULL OR ends_at >= NOW())
        AND EXISTS (
            SELECT 1 FROM customer_apps ca
            WHERE ca.id = app_announcements.app_id
            AND ca.is_published = true
            AND ca.is_active = true
        )
    );

-- app_events: org members can manage
DROP POLICY IF EXISTS "Org can manage app events" ON app_events;
CREATE POLICY "Org can manage app events" ON app_events
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON om.organization_id = ca.organization_id
            WHERE ca.id = app_events.app_id
            AND om.user_id = auth.uid()
        )
    );


-- =====================================================
-- 11. HELPER FUNCTIONS
-- =====================================================

-- Drop existing function first if return type changed
DROP FUNCTION IF EXISTS get_app_by_slug(TEXT);

-- Function to get app by slug (for public access)
CREATE OR REPLACE FUNCTION get_app_by_slug(p_slug TEXT)
RETURNS TABLE (
    id UUID,
    organization_id UUID,
    name TEXT,
    slug TEXT,
    description TEXT,
    app_type TEXT,
    branding JSONB,
    features JSONB,
    settings JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ca.id,
        ca.organization_id,
        ca.name,
        ca.slug,
        ca.description,
        ca.app_type,
        ca.branding,
        ca.features,
        -- Only return non-sensitive settings
        jsonb_build_object(
            'welcome_points', ca.settings->'welcome_points',
            'require_email', ca.settings->'require_email',
            'require_phone', ca.settings->'require_phone'
        ) as settings
    FROM customer_apps ca
    WHERE ca.slug = p_slug
      AND ca.is_published = true
      AND ca.is_active = true
      AND ca.deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Function to get leaderboard for an app
CREATE OR REPLACE FUNCTION get_app_leaderboard(p_app_id UUID, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
    rank BIGINT,
    display_name TEXT,
    avatar_url TEXT,
    points_balance INTEGER,
    tier TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ROW_NUMBER() OVER (ORDER BY am.points_balance DESC) as rank,
        COALESCE(am.display_name, am.first_name, 'Anonymous') as display_name,
        am.avatar_url,
        am.points_balance,
        am.tier
    FROM app_members am
    WHERE am.app_id = p_app_id
      AND am.profile_public = true
      AND am.deleted_at IS NULL
    ORDER BY am.points_balance DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Function to award points to a member
CREATE OR REPLACE FUNCTION award_points(
    p_app_id UUID,
    p_member_id UUID,
    p_points INTEGER,
    p_type TEXT,
    p_description TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS TABLE (
    new_balance INTEGER,
    new_tier TEXT,
    tier_changed BOOLEAN
) AS $$
DECLARE
    v_old_balance INTEGER;
    v_new_balance INTEGER;
    v_old_tier TEXT;
    v_new_tier TEXT;
    v_tier_thresholds JSONB;
BEGIN
    -- Get current balance and tier
    SELECT points_balance, tier INTO v_old_balance, v_old_tier
    FROM app_members
    WHERE id = p_member_id AND app_id = p_app_id;

    -- Calculate new balance
    v_new_balance := v_old_balance + p_points;

    -- Get tier thresholds
    SELECT settings->'tier_thresholds' INTO v_tier_thresholds
    FROM customer_apps
    WHERE id = p_app_id;

    -- Determine new tier based on total earned
    SELECT
        CASE
            WHEN v_new_balance >= COALESCE((v_tier_thresholds->>'platinum')::INTEGER, 5000) THEN 'platinum'
            WHEN v_new_balance >= COALESCE((v_tier_thresholds->>'gold')::INTEGER, 1500) THEN 'gold'
            WHEN v_new_balance >= COALESCE((v_tier_thresholds->>'silver')::INTEGER, 500) THEN 'silver'
            ELSE 'bronze'
        END INTO v_new_tier;

    -- Update member
    UPDATE app_members
    SET
        points_balance = v_new_balance,
        total_points_earned = total_points_earned + GREATEST(p_points, 0),
        tier = v_new_tier,
        updated_at = NOW()
    WHERE id = p_member_id;

    -- Record transaction
    INSERT INTO points_transactions (app_id, member_id, type, points_change, balance_after, description, metadata)
    VALUES (p_app_id, p_member_id, p_type, p_points, v_new_balance, p_description, p_metadata);

    -- If tier changed, record event
    IF v_new_tier != v_old_tier AND p_points > 0 THEN
        INSERT INTO app_events (app_id, member_id, event_type, event_data)
        VALUES (p_app_id, p_member_id, 'tier_upgrade', jsonb_build_object(
            'old_tier', v_old_tier,
            'new_tier', v_new_tier
        ));
    END IF;

    RETURN QUERY SELECT v_new_balance, v_new_tier, (v_new_tier != v_old_tier);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Function to redeem a reward
CREATE OR REPLACE FUNCTION redeem_reward(
    p_app_id UUID,
    p_member_id UUID,
    p_reward_id UUID
)
RETURNS TABLE (
    success BOOLEAN,
    redemption_id UUID,
    redemption_code TEXT,
    error_message TEXT
) AS $$
DECLARE
    v_reward RECORD;
    v_member RECORD;
    v_redemption_id UUID;
    v_redemption_code TEXT;
    v_member_redemption_count INTEGER;
BEGIN
    -- Get reward
    SELECT * INTO v_reward
    FROM app_rewards
    WHERE id = p_reward_id AND app_id = p_app_id AND is_active = true AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Reward not found or inactive';
        RETURN;
    END IF;

    -- Check dates
    IF v_reward.start_date IS NOT NULL AND v_reward.start_date > NOW() THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Reward not yet available';
        RETURN;
    END IF;

    IF v_reward.end_date IS NOT NULL AND v_reward.end_date < NOW() THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Reward has expired';
        RETURN;
    END IF;

    -- Check quantity
    IF v_reward.quantity_available IS NOT NULL AND v_reward.quantity_redeemed >= v_reward.quantity_available THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Reward is out of stock';
        RETURN;
    END IF;

    -- Get member
    SELECT * INTO v_member
    FROM app_members
    WHERE id = p_member_id AND app_id = p_app_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Member not found';
        RETURN;
    END IF;

    -- Check tier requirement
    IF v_reward.tier_required IS NOT NULL THEN
        IF v_reward.tier_required = 'platinum' AND v_member.tier NOT IN ('platinum') THEN
            RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Platinum tier required';
            RETURN;
        ELSIF v_reward.tier_required = 'gold' AND v_member.tier NOT IN ('gold', 'platinum') THEN
            RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Gold tier or higher required';
            RETURN;
        ELSIF v_reward.tier_required = 'silver' AND v_member.tier NOT IN ('silver', 'gold', 'platinum') THEN
            RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Silver tier or higher required';
            RETURN;
        END IF;
    END IF;

    -- Check points
    IF v_member.points_balance < v_reward.points_cost THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Insufficient points';
        RETURN;
    END IF;

    -- Check max per member
    IF v_reward.max_per_member IS NOT NULL THEN
        SELECT COUNT(*) INTO v_member_redemption_count
        FROM reward_redemptions
        WHERE member_id = p_member_id AND reward_id = p_reward_id AND status != 'cancelled';

        IF v_member_redemption_count >= v_reward.max_per_member THEN
            RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Maximum redemptions reached for this reward';
            RETURN;
        END IF;
    END IF;

    -- Generate redemption code
    v_redemption_code := upper(substring(md5(random()::text) from 1 for 8));

    -- Create redemption
    INSERT INTO reward_redemptions (app_id, member_id, reward_id, points_spent, reward_name, redemption_code, expires_at)
    VALUES (p_app_id, p_member_id, p_reward_id, v_reward.points_cost, v_reward.name, v_redemption_code, NOW() + INTERVAL '30 days')
    RETURNING id INTO v_redemption_id;

    -- Deduct points
    PERFORM award_points(p_app_id, p_member_id, -v_reward.points_cost, 'reward_redeem',
        'Redeemed: ' || v_reward.name,
        jsonb_build_object('reward_id', p_reward_id, 'redemption_id', v_redemption_id));

    -- Update reward quantity
    UPDATE app_rewards
    SET quantity_redeemed = quantity_redeemed + 1, updated_at = NOW()
    WHERE id = p_reward_id;

    -- Update member total redeemed
    UPDATE app_members
    SET total_points_redeemed = total_points_redeemed + v_reward.points_cost, updated_at = NOW()
    WHERE id = p_member_id;

    -- Record event
    INSERT INTO app_events (app_id, member_id, event_type, event_data)
    VALUES (p_app_id, p_member_id, 'reward_redeemed', jsonb_build_object(
        'reward_id', p_reward_id,
        'reward_name', v_reward.name,
        'points_spent', v_reward.points_cost,
        'redemption_id', v_redemption_id
    ));

    RETURN QUERY SELECT true, v_redemption_id, v_redemption_code, NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Function to get app stats for business dashboard
CREATE OR REPLACE FUNCTION get_app_stats(p_app_id UUID)
RETURNS TABLE (
    total_members BIGINT,
    new_members_this_month BIGINT,
    total_points_issued BIGINT,
    total_points_redeemed BIGINT,
    total_redemptions BIGINT,
    pending_redemptions BIGINT
) AS $$
DECLARE
    start_of_month TIMESTAMPTZ;
BEGIN
    start_of_month := date_trunc('month', NOW());

    RETURN QUERY
    SELECT
        (SELECT COUNT(*) FROM app_members WHERE app_id = p_app_id AND deleted_at IS NULL)::BIGINT,
        (SELECT COUNT(*) FROM app_members WHERE app_id = p_app_id AND deleted_at IS NULL AND joined_at >= start_of_month)::BIGINT,
        COALESCE((SELECT SUM(points_change) FROM points_transactions WHERE app_id = p_app_id AND points_change > 0), 0)::BIGINT,
        COALESCE((SELECT SUM(ABS(points_change)) FROM points_transactions WHERE app_id = p_app_id AND points_change < 0), 0)::BIGINT,
        (SELECT COUNT(*) FROM reward_redemptions WHERE app_id = p_app_id)::BIGINT,
        (SELECT COUNT(*) FROM reward_redemptions WHERE app_id = p_app_id AND status IN ('pending', 'confirmed'))::BIGINT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =====================================================
-- 11.5 CUSTOMER APP SIGNUP FUNCTION
-- Handles full signup flow atomically (for anon users)
-- =====================================================

-- Function to handle customer app signup
CREATE OR REPLACE FUNCTION customer_app_signup(
    p_app_id UUID,
    p_first_name TEXT,
    p_last_name TEXT,
    p_email TEXT,
    p_phone TEXT DEFAULT NULL,
    p_pin_hash TEXT DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    member_id UUID,
    customer_id UUID,
    welcome_points INTEGER,
    error_message TEXT
) AS $$
DECLARE
    v_app RECORD;
    v_customer_id UUID;
    v_member_id UUID;
    v_welcome_points INTEGER;
    v_existing_member UUID;
BEGIN
    -- Get app and validate
    SELECT * INTO v_app
    FROM customer_apps
    WHERE id = p_app_id
      AND is_published = true
      AND is_active = true
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::INTEGER, 'App not found or not published'::TEXT;
        RETURN;
    END IF;

    -- Check for existing member with this email
    SELECT id INTO v_existing_member
    FROM app_members
    WHERE app_id = p_app_id AND email = lower(p_email) AND deleted_at IS NULL;

    IF FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::INTEGER, 'Email already registered. Please log in instead.'::TEXT;
        RETURN;
    END IF;

    -- Check for existing member with this phone (if phone provided)
    IF p_phone IS NOT NULL AND p_phone != '' THEN
        SELECT id INTO v_existing_member
        FROM app_members
        WHERE app_id = p_app_id AND phone = p_phone AND deleted_at IS NULL;

        IF FOUND THEN
            RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::INTEGER, 'Phone number already registered. Please use a different number or log in.'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- Get welcome points from settings
    v_welcome_points := COALESCE((v_app.settings->>'welcome_points')::INTEGER, 50);

    -- Create customer record in org's customers table
    INSERT INTO customers (
        organization_id,
        first_name,
        last_name,
        email,
        phone,
        source,
        tags
    ) VALUES (
        v_app.organization_id,
        p_first_name,
        p_last_name,
        lower(p_email),
        p_phone,
        'app',
        ARRAY['app-member']
    )
    RETURNING id INTO v_customer_id;

    -- Create app member record
    INSERT INTO app_members (
        app_id,
        customer_id,
        first_name,
        last_name,
        email,
        phone,
        display_name,
        pin_hash,
        points_balance,
        total_points_earned,
        tier,
        profile_public,
        notifications_enabled
    ) VALUES (
        p_app_id,
        v_customer_id,
        p_first_name,
        p_last_name,
        lower(p_email),
        p_phone,
        p_first_name,
        p_pin_hash,
        v_welcome_points,
        v_welcome_points,
        'bronze',
        false,
        true
    )
    RETURNING id INTO v_member_id;

    -- Create welcome points transaction
    INSERT INTO points_transactions (
        app_id,
        member_id,
        type,
        points_change,
        balance_after,
        description
    ) VALUES (
        p_app_id,
        v_member_id,
        'welcome',
        v_welcome_points,
        v_welcome_points,
        'Welcome bonus'
    );

    -- Create member_joined event
    INSERT INTO app_events (
        app_id,
        member_id,
        event_type,
        event_data
    ) VALUES (
        p_app_id,
        v_member_id,
        'member_joined',
        jsonb_build_object(
            'first_name', p_first_name,
            'email', lower(p_email),
            'welcome_points', v_welcome_points
        )
    );

    RETURN QUERY SELECT true, v_member_id, v_customer_id, v_welcome_points, NULL::TEXT;

EXCEPTION
    WHEN unique_violation THEN
        -- Check what constraint was violated
        IF SQLERRM LIKE '%phone%' THEN
            RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::INTEGER, 'Phone number already registered. Please use a different number or log in.'::TEXT;
        ELSE
            RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::INTEGER, 'Email already registered. Please log in instead.'::TEXT;
        END IF;
    WHEN OTHERS THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::INTEGER, ('Signup failed: ' || SQLERRM)::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =====================================================
-- 12. GRANT PERMISSIONS
-- =====================================================

GRANT EXECUTE ON FUNCTION customer_app_signup(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_app_by_slug(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_app_leaderboard(UUID, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION award_points(UUID, UUID, INTEGER, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION redeem_reward(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_app_stats(UUID) TO authenticated;


-- =====================================================
-- 13. TRIGGERS FOR UPDATED_AT
-- =====================================================

-- Trigger function for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to customer_apps
DROP TRIGGER IF EXISTS set_updated_at_customer_apps ON customer_apps;
CREATE TRIGGER set_updated_at_customer_apps
    BEFORE UPDATE ON customer_apps
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Apply to app_members
DROP TRIGGER IF EXISTS set_updated_at_app_members ON app_members;
CREATE TRIGGER set_updated_at_app_members
    BEFORE UPDATE ON app_members
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Apply to app_rewards
DROP TRIGGER IF EXISTS set_updated_at_app_rewards ON app_rewards;
CREATE TRIGGER set_updated_at_app_rewards
    BEFORE UPDATE ON app_rewards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Apply to app_menu_items
DROP TRIGGER IF EXISTS set_updated_at_app_menu_items ON app_menu_items;
CREATE TRIGGER set_updated_at_app_menu_items
    BEFORE UPDATE ON app_menu_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Apply to app_announcements
DROP TRIGGER IF EXISTS set_updated_at_app_announcements ON app_announcements;
CREATE TRIGGER set_updated_at_app_announcements
    BEFORE UPDATE ON app_announcements
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- =====================================================
-- VERIFICATION QUERIES (run to check tables exist)
-- =====================================================

-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- AND table_name LIKE 'app%' OR table_name = 'customer_apps'
-- ORDER BY table_name;

-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'customer_apps'
-- ORDER BY ordinal_position;
