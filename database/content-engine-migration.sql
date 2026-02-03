-- =====================================================
-- AI CONTENT ENGINE MIGRATION
-- Run this in Supabase SQL Editor
-- Adds tables for content context, competitor research, and quality tracking
-- =====================================================

-- =====================================================
-- 1. COMPETITOR RESEARCH TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS competitor_research (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Competitor info
    competitor_url TEXT NOT NULL,
    competitor_name TEXT,

    -- Analysis results
    topics JSONB DEFAULT '[]',           -- Topics they cover
    headlines JSONB DEFAULT '[]',        -- Their headline styles
    content_gaps JSONB DEFAULT '[]',     -- What they're missing
    voice_analysis TEXT,                 -- How they sound
    opportunities JSONB DEFAULT '[]',    -- Where we can differentiate
    top_performing JSONB DEFAULT '[]',   -- Their best content

    -- Metrics
    articles_analyzed INTEGER DEFAULT 0,
    avg_word_count INTEGER,
    publish_frequency TEXT,              -- 'daily', 'weekly', 'monthly'

    -- Status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'analyzing', 'completed', 'failed')),
    error_message TEXT,
    last_analyzed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(app_id, competitor_url)
);

-- Enable RLS
ALTER TABLE competitor_research ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_competitor_research_app
    ON competitor_research(app_id, status);

CREATE INDEX IF NOT EXISTS idx_competitor_research_org
    ON competitor_research(organization_id);

-- RLS Policies
CREATE POLICY "Users can view research for their org" ON competitor_research
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = competitor_research.organization_id
            AND om.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage research for their org" ON competitor_research
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = competitor_research.organization_id
            AND om.user_id = auth.uid()
        )
    );

-- =====================================================
-- 2. CONTENT STRATEGIES TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS content_strategies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,

    -- Strategy content
    content_pillars JSONB DEFAULT '[]',   -- Main themes to cover
    topic_calendar JSONB DEFAULT '[]',    -- Planned articles
    series_ideas JSONB DEFAULT '[]',      -- Multi-part series
    differentiation TEXT,                 -- How we stand out

    -- Generation context
    context_used JSONB,                   -- Snapshot of context at generation
    research_used JSONB,                  -- Snapshot of competitor research
    industry_data JSONB,                  -- Industry insights used

    -- Status
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
    approved_at TIMESTAMPTZ,
    approved_by UUID REFERENCES auth.users(id),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE content_strategies ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_content_strategies_app
    ON content_strategies(app_id, status);

-- RLS Policies
CREATE POLICY "Users can view strategies for their org apps" ON content_strategies
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = content_strategies.app_id
            AND om.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage strategies for their org apps" ON content_strategies
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = content_strategies.app_id
            AND om.user_id = auth.uid()
        )
    );

-- =====================================================
-- 3. CONTENT GENERATION LOG TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS content_generation_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    article_id UUID REFERENCES newsletter_articles(id) ON DELETE SET NULL,
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,

    -- Generation details
    topic TEXT NOT NULL,
    outline JSONB,
    strategy_id UUID REFERENCES content_strategies(id),
    competitor_insights_used JSONB,

    -- Quality metrics
    initial_score DECIMAL(3,1),           -- First draft score
    final_score DECIMAL(3,1),             -- After rewrites
    rewrites_needed INTEGER DEFAULT 0,
    edits_applied INTEGER DEFAULT 0,
    quality_issues JSONB DEFAULT '[]',    -- What was flagged

    -- Generation timing
    generation_started_at TIMESTAMPTZ,
    generation_completed_at TIMESTAMPTZ,
    generation_duration_ms INTEGER,

    -- Post-publish performance (updated later)
    views INTEGER DEFAULT 0,
    unique_visitors INTEGER DEFAULT 0,
    avg_time_on_page_seconds INTEGER,
    scroll_depth_percent DECIMAL(5,2),
    shares INTEGER DEFAULT 0,
    subscriber_conversions INTEGER DEFAULT 0,

    -- For learning
    user_edits_made BOOLEAN DEFAULT false,  -- Did human edit after AI?
    user_satisfaction INTEGER,              -- 1-5 rating if provided

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE content_generation_log ENABLE ROW LEVEL SECURITY;

-- Indexes for learning and optimization
CREATE INDEX IF NOT EXISTS idx_content_log_performance
    ON content_generation_log(app_id, final_score DESC, views DESC);

CREATE INDEX IF NOT EXISTS idx_content_log_quality
    ON content_generation_log(app_id, final_score, user_edits_made);

-- RLS Policies
CREATE POLICY "Users can view logs for their org apps" ON content_generation_log
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = content_generation_log.app_id
            AND om.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage logs for their org apps" ON content_generation_log
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = content_generation_log.app_id
            AND om.user_id = auth.uid()
        )
    );

-- =====================================================
-- 4. CONTENT CONTEXT (Stored in customer_apps.settings)
-- =====================================================

-- Example of content_context structure in customer_apps.settings JSONB:
/*
{
    "newsletter": {
        "content_context": {
            "story": {
                "origin": "How the business started",
                "mission": "What we believe",
                "differentiator": "What makes us unique",
                "milestone": "Proud achievements"
            },
            "audience": {
                "primary": "Description of ideal customer",
                "pain_points": ["Pain 1", "Pain 2"],
                "aspirations": ["Goal 1", "Goal 2"],
                "objections": ["Objection 1"]
            },
            "voice": {
                "personality": "How the brand sounds",
                "tone": "Formal/casual/etc",
                "avoid": ["Words to never use"],
                "examples": ["Links to content they like"]
            },
            "competitors": ["url1", "url2", "url3"],
            "topics": {
                "cover": ["Topics to cover"],
                "avoid": ["Topics to avoid"]
            },
            "goals": {
                "primary": "Main goal",
                "frequency": "weekly"
            }
        },
        "content_context_completed": true,
        "content_context_completed_at": "2026-01-31T..."
    }
}
*/

-- =====================================================
-- 5. RPC FUNCTION: Save Content Context
-- =====================================================

CREATE OR REPLACE FUNCTION save_content_context(
    p_app_id UUID,
    p_context JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_app customer_apps%ROWTYPE;
    v_settings JSONB;
BEGIN
    -- Get current app
    SELECT * INTO v_app
    FROM customer_apps
    WHERE id = p_app_id
      AND deleted_at IS NULL;

    IF v_app.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'App not found'
        );
    END IF;

    -- Verify user has access
    IF NOT EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = v_app.organization_id
        AND om.user_id = auth.uid()
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Access denied'
        );
    END IF;

    -- Merge content context into settings
    v_settings := COALESCE(v_app.settings, '{}'::jsonb);
    v_settings := jsonb_set(
        v_settings,
        '{newsletter,content_context}',
        p_context
    );
    v_settings := jsonb_set(
        v_settings,
        '{newsletter,content_context_completed}',
        'true'::jsonb
    );
    v_settings := jsonb_set(
        v_settings,
        '{newsletter,content_context_completed_at}',
        to_jsonb(NOW()::text)
    );

    -- Update app
    UPDATE customer_apps
    SET settings = v_settings,
        updated_at = NOW()
    WHERE id = p_app_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Content context saved'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION save_content_context TO authenticated;

-- =====================================================
-- 6. RPC FUNCTION: Add Competitor for Research
-- =====================================================

CREATE OR REPLACE FUNCTION add_competitor_for_research(
    p_app_id UUID,
    p_competitor_url TEXT,
    p_competitor_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_app customer_apps%ROWTYPE;
    v_research competitor_research%ROWTYPE;
BEGIN
    -- Validate URL
    IF p_competitor_url IS NULL OR LENGTH(p_competitor_url) < 10 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Invalid URL'
        );
    END IF;

    -- Get app and verify access
    SELECT * INTO v_app
    FROM customer_apps
    WHERE id = p_app_id
      AND deleted_at IS NULL;

    IF v_app.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'App not found'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = v_app.organization_id
        AND om.user_id = auth.uid()
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Access denied'
        );
    END IF;

    -- Check if already exists
    SELECT * INTO v_research
    FROM competitor_research
    WHERE app_id = p_app_id
      AND competitor_url = p_competitor_url;

    IF v_research.id IS NOT NULL THEN
        -- Already exists, just return it
        RETURN jsonb_build_object(
            'success', true,
            'research_id', v_research.id,
            'status', v_research.status,
            'message', 'Competitor already being tracked'
        );
    END IF;

    -- Create new research entry
    INSERT INTO competitor_research (
        app_id,
        organization_id,
        competitor_url,
        competitor_name,
        status
    ) VALUES (
        p_app_id,
        v_app.organization_id,
        p_competitor_url,
        p_competitor_name,
        'pending'
    )
    RETURNING * INTO v_research;

    RETURN jsonb_build_object(
        'success', true,
        'research_id', v_research.id,
        'status', 'pending',
        'message', 'Competitor added for analysis'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION add_competitor_for_research TO authenticated;

-- =====================================================
-- 7. RPC FUNCTION: Get Content Generation Stats
-- =====================================================

CREATE OR REPLACE FUNCTION get_content_generation_stats(
    p_app_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_stats JSONB;
BEGIN
    SELECT jsonb_build_object(
        'total_articles', COUNT(*),
        'avg_quality_score', ROUND(AVG(final_score)::numeric, 1),
        'articles_needing_rewrites', SUM(CASE WHEN rewrites_needed > 0 THEN 1 ELSE 0 END),
        'avg_rewrites', ROUND(AVG(rewrites_needed)::numeric, 1),
        'total_views', SUM(views),
        'avg_time_on_page', ROUND(AVG(avg_time_on_page_seconds)::numeric, 0),
        'total_conversions', SUM(subscriber_conversions),
        'human_edited_percent', ROUND(
            (SUM(CASE WHEN user_edits_made THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0)) * 100,
            1
        )
    ) INTO v_stats
    FROM content_generation_log
    WHERE app_id = p_app_id;

    RETURN v_stats;
END;
$$;

GRANT EXECUTE ON FUNCTION get_content_generation_stats TO authenticated;

-- =====================================================
-- 8. TRIGGERS
-- =====================================================

-- Auto-update updated_at for competitor_research
CREATE TRIGGER trigger_competitor_research_updated_at
BEFORE UPDATE ON competitor_research
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

-- Auto-update updated_at for content_strategies
CREATE TRIGGER trigger_content_strategies_updated_at
BEFORE UPDATE ON content_strategies
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

-- =====================================================
-- DONE! Content engine tables are ready.
-- =====================================================
