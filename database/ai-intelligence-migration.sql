-- =====================================================
-- AI INTELLIGENCE FEED - Database Migration
-- Run this in Supabase SQL Editor
-- =====================================================

-- =====================================================
-- 1. AI RECOMMENDATIONS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS ai_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    recommendation_type TEXT NOT NULL, -- 'opportunity', 'efficiency', 'risk', 'growth', 'automation'
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    analysis_data JSONB DEFAULT '{}', -- raw analysis that led to this
    confidence_score DECIMAL(3,2) CHECK (confidence_score >= 0 AND confidence_score <= 1), -- 0-1
    potential_impact TEXT CHECK (potential_impact IN ('low', 'medium', 'high')),
    suggested_action TEXT, -- what to do
    action_type TEXT, -- 'create_automation', 'create_app', 'contact_customer', 'review_data', etc.
    action_payload JSONB DEFAULT '{}', -- pre-filled data for the action
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'implemented', 'dismissed', 'expired')),
    implemented_at TIMESTAMPTZ,
    dismissed_at TIMESTAMPTZ,
    feedback TEXT, -- user feedback on recommendation
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE ai_recommendations ENABLE ROW LEVEL SECURITY;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ai_recommendations_org_id ON ai_recommendations(organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_recommendations_status ON ai_recommendations(status);
CREATE INDEX IF NOT EXISTS idx_ai_recommendations_type ON ai_recommendations(recommendation_type);
CREATE INDEX IF NOT EXISTS idx_ai_recommendations_created ON ai_recommendations(created_at DESC);

-- RLS Policies - Only org members can access their recommendations
CREATE POLICY "Users can view org recommendations" ON ai_recommendations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = ai_recommendations.organization_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create org recommendations" ON ai_recommendations
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = ai_recommendations.organization_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update org recommendations" ON ai_recommendations
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = ai_recommendations.organization_id
            AND organization_members.user_id = auth.uid()
        )
    );

-- =====================================================
-- 2. AI RECOMMENDATION OUTCOMES TABLE (Track results)
-- =====================================================

CREATE TABLE IF NOT EXISTS ai_recommendation_outcomes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recommendation_id UUID NOT NULL REFERENCES ai_recommendations(id) ON DELETE CASCADE,
    outcome_type TEXT CHECK (outcome_type IN ('success', 'partial', 'failed', 'pending')),
    metrics JSONB DEFAULT '{}', -- measured results
    notes TEXT,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE ai_recommendation_outcomes ENABLE ROW LEVEL SECURITY;

-- Index
CREATE INDEX IF NOT EXISTS idx_ai_outcomes_recommendation ON ai_recommendation_outcomes(recommendation_id);

-- RLS Policies (via recommendation ownership)
CREATE POLICY "Users can view recommendation outcomes" ON ai_recommendation_outcomes
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM ai_recommendations ar
            JOIN organization_members om ON om.organization_id = ar.organization_id
            WHERE ar.id = ai_recommendation_outcomes.recommendation_id
            AND om.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create recommendation outcomes" ON ai_recommendation_outcomes
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM ai_recommendations ar
            JOIN organization_members om ON om.organization_id = ar.organization_id
            WHERE ar.id = ai_recommendation_outcomes.recommendation_id
            AND om.user_id = auth.uid()
        )
    );

-- =====================================================
-- 3. AI ANALYSIS HISTORY TABLE (Track analysis runs)
-- =====================================================

CREATE TABLE IF NOT EXISTS ai_analysis_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    triggered_by UUID REFERENCES profiles(id), -- who triggered it (null if automated)
    trigger_type TEXT DEFAULT 'manual' CHECK (trigger_type IN ('manual', 'scheduled', 'event')),
    analysis_summary JSONB DEFAULT '{}', -- summary of what was analyzed
    recommendations_generated INTEGER DEFAULT 0,
    tokens_used INTEGER DEFAULT 0,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE ai_analysis_history ENABLE ROW LEVEL SECURITY;

-- Index
CREATE INDEX IF NOT EXISTS idx_ai_analysis_org ON ai_analysis_history(organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_created ON ai_analysis_history(created_at DESC);

-- RLS Policies
CREATE POLICY "Users can view org analysis history" ON ai_analysis_history
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = ai_analysis_history.organization_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create org analysis history" ON ai_analysis_history
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = ai_analysis_history.organization_id
            AND organization_members.user_id = auth.uid()
        )
    );

-- =====================================================
-- 4. HELPER FUNCTIONS
-- =====================================================

-- Get pending recommendations for an org (most recent first)
CREATE OR REPLACE FUNCTION get_pending_recommendations(org_id UUID, limit_count INTEGER DEFAULT 10)
RETURNS TABLE (
    id UUID,
    recommendation_type TEXT,
    title TEXT,
    description TEXT,
    confidence_score DECIMAL,
    potential_impact TEXT,
    suggested_action TEXT,
    action_type TEXT,
    action_payload JSONB,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ar.id,
        ar.recommendation_type,
        ar.title,
        ar.description,
        ar.confidence_score,
        ar.potential_impact,
        ar.suggested_action,
        ar.action_type,
        ar.action_payload,
        ar.created_at
    FROM ai_recommendations ar
    WHERE ar.organization_id = org_id
      AND ar.status = 'pending'
    ORDER BY
        CASE ar.potential_impact
            WHEN 'high' THEN 1
            WHEN 'medium' THEN 2
            WHEN 'low' THEN 3
        END,
        ar.confidence_score DESC,
        ar.created_at DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Dismiss a recommendation
CREATE OR REPLACE FUNCTION dismiss_recommendation(rec_id UUID, user_feedback TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE ai_recommendations
    SET status = 'dismissed',
        dismissed_at = NOW(),
        feedback = COALESCE(user_feedback, feedback)
    WHERE id = rec_id
      AND EXISTS (
          SELECT 1 FROM organization_members om
          WHERE om.organization_id = ai_recommendations.organization_id
          AND om.user_id = auth.uid()
      );

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Mark a recommendation as implemented
CREATE OR REPLACE FUNCTION implement_recommendation(rec_id UUID, user_feedback TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE ai_recommendations
    SET status = 'implemented',
        implemented_at = NOW(),
        feedback = COALESCE(user_feedback, feedback)
    WHERE id = rec_id
      AND EXISTS (
          SELECT 1 FROM organization_members om
          WHERE om.organization_id = ai_recommendations.organization_id
          AND om.user_id = auth.uid()
      );

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get organization analysis data (for AI prompt)
CREATE OR REPLACE FUNCTION get_org_analysis_data(org_id UUID)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    org_record RECORD;
    customer_stats JSONB;
    project_stats JSONB;
    automation_stats JSONB;
BEGIN
    -- Get org info
    SELECT * INTO org_record FROM organizations WHERE id = org_id;

    -- Customer statistics
    SELECT jsonb_build_object(
        'total', COUNT(*),
        'recent_30_days', COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days'),
        'by_source', jsonb_object_agg(COALESCE(source, 'unknown'), cnt)
    ) INTO customer_stats
    FROM (
        SELECT source, COUNT(*) as cnt
        FROM customers
        WHERE organization_id = org_id AND deleted_at IS NULL
        GROUP BY source
    ) sub;

    -- Project statistics
    SELECT jsonb_build_object(
        'total', COUNT(*),
        'by_industry', jsonb_object_agg(COALESCE(industry, 'unset'), cnt)
    ) INTO project_stats
    FROM (
        SELECT industry, COUNT(*) as cnt
        FROM projects
        WHERE organization_id = org_id AND deleted_at IS NULL
        GROUP BY industry
    ) sub;

    -- Automation statistics
    SELECT jsonb_build_object(
        'total', COUNT(*),
        'active', COUNT(*) FILTER (WHERE is_active = true),
        'by_type', jsonb_object_agg(COALESCE(type, 'other'), cnt)
    ) INTO automation_stats
    FROM (
        SELECT a.type, COUNT(*) as cnt
        FROM automations a
        JOIN projects p ON p.id = a.project_id
        WHERE p.organization_id = org_id
          AND p.deleted_at IS NULL
          AND a.deleted_at IS NULL
        GROUP BY a.type
    ) sub;

    -- Build result
    result := jsonb_build_object(
        'organization', jsonb_build_object(
            'name', org_record.name,
            'created_at', org_record.created_at,
            'plan_type', COALESCE(org_record.plan_type, 'free')
        ),
        'customers', COALESCE(customer_stats, '{}'::jsonb),
        'projects', COALESCE(project_stats, '{}'::jsonb),
        'automations', COALESCE(automation_stats, '{}'::jsonb)
    );

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 5. ADD COLUMNS TO ORGANIZATIONS (if not exists)
-- =====================================================

-- Track last analysis time
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS last_ai_analysis_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ai_analysis_enabled BOOLEAN DEFAULT true;

-- =====================================================
-- 6. AI AUTONOMY SETTINGS
-- Controls whether AI acts automatically or requires approval
-- =====================================================

-- Add autonomy setting to customer_apps (per-app control)
ALTER TABLE customer_apps ADD COLUMN IF NOT EXISTS ai_autonomy_mode TEXT DEFAULT 'auto_pilot'
    CHECK (ai_autonomy_mode IN ('manual_approve', 'auto_pilot'));

COMMENT ON COLUMN customer_apps.ai_autonomy_mode IS
    'manual_approve = AI proposes, owner approves each action; auto_pilot = AI acts automatically, owner gets notified';

-- AI Actions Log - Track what AI does automatically
CREATE TABLE IF NOT EXISTS ai_actions_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    app_id UUID REFERENCES customer_apps(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL, -- 'win_back_sent', 'birthday_reward', 'streak_bonus', 'tier_upgrade', 'referral_nudge'
    member_id UUID REFERENCES app_members(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    result TEXT DEFAULT 'sent', -- 'sent', 'opened', 'clicked', 'converted', 'failed'
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE ai_actions_log ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_actions_org ON ai_actions_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_actions_app ON ai_actions_log(app_id);
CREATE INDEX IF NOT EXISTS idx_ai_actions_created ON ai_actions_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_actions_type ON ai_actions_log(action_type);

-- RLS Policy
CREATE POLICY "Users can view org ai actions" ON ai_actions_log
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = ai_actions_log.organization_id
            AND organization_members.user_id = auth.uid()
        )
    );

-- Automated Campaigns - Define what AI can run
CREATE TABLE IF NOT EXISTS automated_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,
    campaign_type TEXT NOT NULL, -- 'win_back', 'birthday', 'streak_bonus', 'tier_motivation', 'milestone', 'referral_nudge'
    is_enabled BOOLEAN DEFAULT true,
    settings JSONB DEFAULT '{}', -- thresholds, message templates, etc.
    last_run_at TIMESTAMPTZ,
    total_sent INTEGER DEFAULT 0,
    total_converted INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(app_id, campaign_type)
);

-- Enable RLS
ALTER TABLE automated_campaigns ENABLE ROW LEVEL SECURITY;

-- Index
CREATE INDEX IF NOT EXISTS idx_auto_campaigns_app ON automated_campaigns(app_id);

-- RLS Policies
CREATE POLICY "Users can view app campaigns" ON automated_campaigns
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON om.organization_id = ca.organization_id
            WHERE ca.id = automated_campaigns.app_id
            AND om.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage app campaigns" ON automated_campaigns
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON om.organization_id = ca.organization_id
            WHERE ca.id = automated_campaigns.app_id
            AND om.user_id = auth.uid()
        )
    );

-- Function to get weekly AI summary for an app
CREATE OR REPLACE FUNCTION get_ai_weekly_summary(p_app_id UUID)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    week_start TIMESTAMPTZ := NOW() - INTERVAL '7 days';
BEGIN
    SELECT jsonb_build_object(
        'total_actions', COUNT(*),
        'by_type', (
            SELECT jsonb_object_agg(action_type, cnt)
            FROM (
                SELECT action_type, COUNT(*) as cnt
                FROM ai_actions_log
                WHERE app_id = p_app_id AND created_at > week_start
                GROUP BY action_type
            ) sub
        ),
        'conversions', COUNT(*) FILTER (WHERE result = 'converted'),
        'period_start', week_start,
        'period_end', NOW()
    ) INTO result
    FROM ai_actions_log
    WHERE app_id = p_app_id AND created_at > week_start;

    RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Default campaign settings for new apps
CREATE OR REPLACE FUNCTION create_default_campaigns()
RETURNS TRIGGER AS $$
BEGIN
    -- Win-back campaign (14 days no visit)
    INSERT INTO automated_campaigns (app_id, campaign_type, settings)
    VALUES (NEW.id, 'win_back', '{"days_inactive": 14, "bonus_multiplier": 2}'::jsonb);

    -- Birthday rewards
    INSERT INTO automated_campaigns (app_id, campaign_type, settings)
    VALUES (NEW.id, 'birthday', '{"days_before": 7, "bonus_points": 50}'::jsonb);

    -- Streak bonuses
    INSERT INTO automated_campaigns (app_id, campaign_type, settings)
    VALUES (NEW.id, 'streak_bonus', '{"3_day": 5, "7_day": 15, "30_day": 50}'::jsonb);

    -- Tier motivation
    INSERT INTO automated_campaigns (app_id, campaign_type, settings)
    VALUES (NEW.id, 'tier_motivation', '{"points_threshold": 50}'::jsonb);

    -- Milestone celebrations
    INSERT INTO automated_campaigns (app_id, campaign_type, settings)
    VALUES (NEW.id, 'milestone', '{"visits": [10, 50, 100], "bonus": [25, 100, 250]}'::jsonb);

    -- Referral nudges
    INSERT INTO automated_campaigns (app_id, campaign_type, settings)
    VALUES (NEW.id, 'referral_nudge', '{"min_tier": "gold", "bonus_points": 100}'::jsonb);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to create default campaigns when a new app is created
DROP TRIGGER IF EXISTS create_default_campaigns_trigger ON customer_apps;
CREATE TRIGGER create_default_campaigns_trigger
    AFTER INSERT ON customer_apps
    FOR EACH ROW
    EXECUTE FUNCTION create_default_campaigns();

-- =====================================================
-- DONE! Run this migration in Supabase SQL Editor
-- =====================================================
