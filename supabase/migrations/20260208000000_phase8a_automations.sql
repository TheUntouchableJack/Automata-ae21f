-- Phase 8A: Customer Lifecycle Automation - Database Foundation
-- Creates tables for message batches, promotions, automation definitions, and templates

-- ============================================================================
-- 1. MESSAGE BATCHES - Email/push/SMS queuing and delivery tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS app_message_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Message content
    channel TEXT NOT NULL CHECK (channel IN ('email', 'push', 'in_app', 'sms')),
    subject TEXT,
    body TEXT NOT NULL,
    template_id TEXT,

    -- Targeting
    segment TEXT CHECK (segment IN ('all', 'vip', 'at_risk', 'new', 'active', 'churned', 'custom')),
    member_ids UUID[],
    filter_criteria JSONB,

    -- Scheduling
    scheduled_for TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,

    -- Stats
    total_recipients INTEGER DEFAULT 0,
    delivered INTEGER DEFAULT 0,
    opened INTEGER DEFAULT 0,
    clicked INTEGER DEFAULT 0,
    bounced INTEGER DEFAULT 0,
    unsubscribed INTEGER DEFAULT 0,

    -- Source
    created_by TEXT CHECK (created_by IN ('manual', 'automation', 'ai')),
    automation_id UUID,
    ai_action_id UUID,

    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'partially_sent', 'failed', 'cancelled')),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_message_batches_org ON app_message_batches(organization_id);
CREATE INDEX idx_message_batches_app ON app_message_batches(app_id);
CREATE INDEX idx_message_batches_status ON app_message_batches(status) WHERE status IN ('scheduled', 'sending');
CREATE INDEX idx_message_batches_scheduled ON app_message_batches(scheduled_for) WHERE status = 'scheduled';

-- ============================================================================
-- 2. PROMOTIONS - Flash promos, multipliers, discounts
-- ============================================================================
CREATE TABLE IF NOT EXISTS app_promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Promotion details
    name TEXT NOT NULL,
    description TEXT,
    promotion_type TEXT NOT NULL CHECK (promotion_type IN ('multiplier', 'bonus', 'discount', 'flash', 'tiered')),

    -- Value (at least one should be set)
    multiplier DECIMAL(3,1) CHECK (multiplier >= 1.0 AND multiplier <= 10.0),
    bonus_points INTEGER CHECK (bonus_points >= 0),
    discount_percent DECIMAL(5,2) CHECK (discount_percent >= 0 AND discount_percent <= 100),

    -- Targeting
    segment TEXT CHECK (segment IN ('all', 'vip', 'at_risk', 'new', 'active', 'custom')),
    member_ids UUID[],
    tier_required TEXT,
    min_purchase DECIMAL(10,2),

    -- Timing
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    CHECK (ends_at > starts_at),

    -- Limits
    max_uses INTEGER,
    max_per_member INTEGER DEFAULT 1,
    current_uses INTEGER DEFAULT 0,

    -- Source
    created_by TEXT CHECK (created_by IN ('manual', 'automation', 'ai')),
    ai_action_id UUID,

    status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'paused', 'ended', 'cancelled')),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_promotions_org ON app_promotions(organization_id);
CREATE INDEX idx_promotions_app ON app_promotions(app_id);
CREATE INDEX idx_promotions_active ON app_promotions(starts_at, ends_at) WHERE status = 'active';
CREATE INDEX idx_promotions_scheduled ON app_promotions(starts_at) WHERE status = 'scheduled';

-- ============================================================================
-- 3. AUTOMATION DEFINITIONS - Enhanced automation templates with AI control
-- ============================================================================
CREATE TABLE IF NOT EXISTS automation_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    app_id UUID REFERENCES customer_apps(id) ON DELETE CASCADE,

    -- Identity
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL CHECK (category IN ('welcome', 'engagement', 'retention', 'recovery', 'behavioral', 'proactive')),

    -- Template reference (for pre-built automations)
    template_key TEXT,
    is_template BOOLEAN DEFAULT FALSE,

    -- Trigger
    trigger_type TEXT NOT NULL CHECK (trigger_type IN ('event', 'schedule', 'condition', 'ai')),
    trigger_event TEXT,
    trigger_condition JSONB,
    trigger_schedule TEXT,

    -- Action
    action_type TEXT NOT NULL CHECK (action_type IN ('send_message', 'award_points', 'create_promo', 'notify_staff', 'update_tier', 'custom')),
    action_config JSONB NOT NULL,

    -- Delays & Limits
    delay_minutes INTEGER DEFAULT 0,
    max_frequency_days INTEGER,
    daily_limit INTEGER,
    cooldown_hours INTEGER DEFAULT 24,

    -- AI Control
    ai_can_enable BOOLEAN DEFAULT TRUE,
    ai_can_modify BOOLEAN DEFAULT FALSE,
    ai_can_trigger BOOLEAN DEFAULT FALSE,
    confidence_threshold DECIMAL(3,2) DEFAULT 0.70,

    -- Status
    is_enabled BOOLEAN DEFAULT FALSE,
    is_archived BOOLEAN DEFAULT FALSE,
    last_triggered_at TIMESTAMPTZ,
    trigger_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_automation_defs_org ON automation_definitions(organization_id);
CREATE INDEX idx_automation_defs_app ON automation_definitions(app_id);
CREATE INDEX idx_automation_defs_enabled ON automation_definitions(organization_id) WHERE is_enabled = TRUE;
CREATE INDEX idx_automation_defs_event ON automation_definitions(trigger_event) WHERE trigger_type = 'event';
CREATE INDEX idx_automation_defs_template ON automation_definitions(template_key) WHERE is_template = TRUE;

-- ============================================================================
-- 4. AUTOMATION EXECUTIONS - Execution logs with outcome measurement
-- ============================================================================
CREATE TABLE IF NOT EXISTS automation_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    automation_id UUID NOT NULL REFERENCES automation_definitions(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Target
    member_id UUID,
    batch_id UUID REFERENCES app_message_batches(id),

    -- Execution
    triggered_at TIMESTAMPTZ DEFAULT NOW(),
    scheduled_for TIMESTAMPTZ,
    executed_at TIMESTAMPTZ,

    -- Context
    trigger_context JSONB,

    -- Result
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'executing', 'completed', 'failed', 'skipped', 'cancelled')),
    result JSONB,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,

    -- Outcome (measured 24-48h later)
    measured_at TIMESTAMPTZ,
    outcome JSONB,
    success_score DECIMAL(3,2),

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_automation_exec_automation ON automation_executions(automation_id);
CREATE INDEX idx_automation_exec_org ON automation_executions(organization_id);
CREATE INDEX idx_automation_exec_member ON automation_executions(member_id);
CREATE INDEX idx_automation_exec_pending ON automation_executions(scheduled_for) WHERE status = 'pending';
CREATE INDEX idx_automation_exec_measure ON automation_executions(executed_at) WHERE measured_at IS NULL AND status = 'completed';

-- ============================================================================
-- 5. MESSAGE TEMPLATES - Multi-language templates for all channels
-- ============================================================================
CREATE TABLE IF NOT EXISTS message_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

    -- Identity
    template_key TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('email', 'push', 'in_app', 'sms')),
    locale TEXT NOT NULL DEFAULT 'en',

    -- Content
    subject TEXT,
    title TEXT,
    body TEXT NOT NULL,
    html_body TEXT,

    -- Metadata
    is_default BOOLEAN DEFAULT FALSE,
    is_system BOOLEAN DEFAULT FALSE,
    variables JSONB,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(organization_id, template_key, channel, locale)
);

CREATE INDEX idx_message_templates_key ON message_templates(template_key, channel, locale);
CREATE INDEX idx_message_templates_org ON message_templates(organization_id);
CREATE INDEX idx_message_templates_default ON message_templates(template_key, channel) WHERE is_default = TRUE;

-- ============================================================================
-- 6. MEMBER LOCALIZATION COLUMNS
-- ============================================================================
ALTER TABLE app_members ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'en';
ALTER TABLE app_members ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/New_York';
ALTER TABLE app_members ADD COLUMN IF NOT EXISTS country_code TEXT;
ALTER TABLE app_members ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD';
ALTER TABLE app_members ADD COLUMN IF NOT EXISTS communication_preferences JSONB DEFAULT '{"email": true, "push": true, "sms": false, "in_app": true}';
ALTER TABLE app_members ADD COLUMN IF NOT EXISTS quiet_hours JSONB;

-- ============================================================================
-- 7. RLS POLICIES
-- ============================================================================

-- Enable RLS on all new tables
ALTER TABLE app_message_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

-- Message Batches: Org members can view/manage their batches
CREATE POLICY "Users can view their org message batches" ON app_message_batches
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM user_organizations WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert message batches for their org" ON app_message_batches
    FOR INSERT WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM user_organizations WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update their org message batches" ON app_message_batches
    FOR UPDATE USING (
        organization_id IN (
            SELECT organization_id FROM user_organizations WHERE user_id = auth.uid()
        )
    );

-- Promotions: Org members can view/manage their promotions
CREATE POLICY "Users can view their org promotions" ON app_promotions
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM user_organizations WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage their org promotions" ON app_promotions
    FOR ALL USING (
        organization_id IN (
            SELECT organization_id FROM user_organizations WHERE user_id = auth.uid()
        )
    );

-- Automation Definitions: Org members can view/manage
CREATE POLICY "Users can view their org automations" ON automation_definitions
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM user_organizations WHERE user_id = auth.uid()
        )
        OR is_template = TRUE
    );

CREATE POLICY "Users can manage their org automations" ON automation_definitions
    FOR ALL USING (
        organization_id IN (
            SELECT organization_id FROM user_organizations WHERE user_id = auth.uid()
        )
    );

-- Automation Executions: Org members can view
CREATE POLICY "Users can view their org automation executions" ON automation_executions
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM user_organizations WHERE user_id = auth.uid()
        )
    );

-- Message Templates: Org can view their templates + system defaults
CREATE POLICY "Users can view message templates" ON message_templates
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM user_organizations WHERE user_id = auth.uid()
        )
        OR is_system = TRUE
        OR organization_id IS NULL
    );

CREATE POLICY "Users can manage their org templates" ON message_templates
    FOR ALL USING (
        organization_id IN (
            SELECT organization_id FROM user_organizations WHERE user_id = auth.uid()
        )
    );

-- Service role bypass for edge functions
CREATE POLICY "Service role full access to message_batches" ON app_message_batches
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access to promotions" ON app_promotions
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access to automation_definitions" ON automation_definitions
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access to automation_executions" ON automation_executions
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access to message_templates" ON message_templates
    FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- ============================================================================
-- 8. HELPER FUNCTIONS
-- ============================================================================

-- Function to get active promotions for a member
CREATE OR REPLACE FUNCTION get_active_promotions_for_member(
    p_app_id UUID,
    p_member_id UUID,
    p_member_tier TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    promotion_type TEXT,
    multiplier DECIMAL,
    bonus_points INTEGER,
    discount_percent DECIMAL,
    ends_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.name,
        p.promotion_type,
        p.multiplier,
        p.bonus_points,
        p.discount_percent,
        p.ends_at
    FROM app_promotions p
    WHERE p.app_id = p_app_id
        AND p.status = 'active'
        AND NOW() BETWEEN p.starts_at AND p.ends_at
        AND (p.max_uses IS NULL OR p.current_uses < p.max_uses)
        AND (
            p.segment = 'all'
            OR p_member_id = ANY(p.member_ids)
            OR (p.tier_required IS NOT NULL AND p.tier_required = p_member_tier)
        );
END;
$$;

-- Function to check if automation should fire for member
CREATE OR REPLACE FUNCTION should_fire_automation(
    p_automation_id UUID,
    p_member_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_automation automation_definitions%ROWTYPE;
    v_last_execution TIMESTAMPTZ;
    v_today_count INTEGER;
BEGIN
    SELECT * INTO v_automation FROM automation_definitions WHERE id = p_automation_id;

    IF NOT FOUND OR NOT v_automation.is_enabled THEN
        RETURN FALSE;
    END IF;

    -- Check max frequency
    IF v_automation.max_frequency_days IS NOT NULL THEN
        SELECT MAX(triggered_at) INTO v_last_execution
        FROM automation_executions
        WHERE automation_id = p_automation_id
            AND member_id = p_member_id
            AND status = 'completed';

        IF v_last_execution IS NOT NULL
           AND v_last_execution > NOW() - (v_automation.max_frequency_days || ' days')::INTERVAL THEN
            RETURN FALSE;
        END IF;
    END IF;

    -- Check daily limit
    IF v_automation.daily_limit IS NOT NULL THEN
        SELECT COUNT(*) INTO v_today_count
        FROM automation_executions
        WHERE automation_id = p_automation_id
            AND triggered_at > CURRENT_DATE;

        IF v_today_count >= v_automation.daily_limit THEN
            RETURN FALSE;
        END IF;
    END IF;

    RETURN TRUE;
END;
$$;

-- Function to record automation execution
CREATE OR REPLACE FUNCTION record_automation_execution(
    p_automation_id UUID,
    p_member_id UUID,
    p_trigger_context JSONB DEFAULT NULL,
    p_delay_minutes INTEGER DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_org_id UUID;
    v_execution_id UUID;
    v_scheduled_for TIMESTAMPTZ;
BEGIN
    SELECT organization_id INTO v_org_id
    FROM automation_definitions
    WHERE id = p_automation_id;

    IF p_delay_minutes > 0 THEN
        v_scheduled_for := NOW() + (p_delay_minutes || ' minutes')::INTERVAL;
    END IF;

    INSERT INTO automation_executions (
        automation_id,
        organization_id,
        member_id,
        trigger_context,
        scheduled_for,
        status
    ) VALUES (
        p_automation_id,
        v_org_id,
        p_member_id,
        p_trigger_context,
        v_scheduled_for,
        CASE WHEN p_delay_minutes > 0 THEN 'scheduled' ELSE 'pending' END
    )
    RETURNING id INTO v_execution_id;

    -- Update automation stats
    UPDATE automation_definitions
    SET trigger_count = trigger_count + 1,
        last_triggered_at = NOW()
    WHERE id = p_automation_id;

    RETURN v_execution_id;
END;
$$;

-- ============================================================================
-- 9. UPDATED_AT TRIGGERS
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_message_batches_updated_at
    BEFORE UPDATE ON app_message_batches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_promotions_updated_at
    BEFORE UPDATE ON app_promotions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_automation_definitions_updated_at
    BEFORE UPDATE ON automation_definitions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_message_templates_updated_at
    BEFORE UPDATE ON message_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
