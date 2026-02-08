-- Migration: AI Intelligence Foundation Tables
-- Phase 1 of Royal AI Production Plan
-- Creates tables for business knowledge storage, discovery questions, and owner patterns

-- ============================================================================
-- 1. BUSINESS KNOWLEDGE STORE
-- Stores facts learned from conversations, research, and integrations
-- ============================================================================
CREATE TABLE IF NOT EXISTS business_knowledge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Classification
    layer TEXT NOT NULL CHECK (layer IN ('operational', 'customer', 'financial', 'market', 'growth', 'regulatory')),
    category TEXT NOT NULL,  -- 'margin', 'competitor', 'regulation', 'preference', etc.

    -- The knowledge
    fact TEXT NOT NULL,
    confidence DECIMAL(3,2) CHECK (confidence >= 0 AND confidence <= 1),
    importance TEXT DEFAULT 'medium' CHECK (importance IN ('critical', 'high', 'medium', 'low')),

    -- Source tracking
    source_type TEXT NOT NULL CHECK (source_type IN ('conversation', 'research', 'integration', 'inferred')),
    source_url TEXT,              -- For research-sourced facts
    source_thread_id UUID REFERENCES ai_threads(id) ON DELETE SET NULL,

    -- Lifecycle
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'invalidated')),
    expires_at TIMESTAMPTZ,       -- Some facts expire (regulations, market data)
    last_verified TIMESTAMPTZ,
    confirmed_by_user BOOLEAN DEFAULT FALSE,

    -- Usage tracking
    times_used INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX idx_knowledge_org ON business_knowledge(organization_id);
CREATE INDEX idx_knowledge_layer ON business_knowledge(organization_id, layer);
CREATE INDEX idx_knowledge_status ON business_knowledge(organization_id, status) WHERE status = 'active';
CREATE INDEX idx_knowledge_importance ON business_knowledge(organization_id, importance);

-- Comments for documentation
COMMENT ON TABLE business_knowledge IS 'Stores facts Royal AI learns about each business from conversations, research, and integrations';
COMMENT ON COLUMN business_knowledge.layer IS 'Knowledge category: operational, customer, financial, market, growth, regulatory';
COMMENT ON COLUMN business_knowledge.confidence IS 'How confident AI is in this fact (0-1)';
COMMENT ON COLUMN business_knowledge.times_used IS 'How many times this fact has been used in AI responses';

-- ============================================================================
-- 2. BUSINESS PROFILES (Structured Business Model Data)
-- Beyond free-form facts, stores structured business model data
-- ============================================================================
CREATE TABLE IF NOT EXISTS business_profiles (
    organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,

    -- Business Model
    business_type TEXT CHECK (business_type IN ('restaurant', 'retail', 'service', 'hybrid', 'other')),
    business_subtype TEXT,        -- 'coffee_shop', 'salon', 'gym', etc.
    revenue_model TEXT CHECK (revenue_model IN ('transactional', 'subscription', 'membership', 'hybrid')),
    primary_revenue_streams JSONB DEFAULT '[]'::jsonb,  -- [{name, percentage}]

    -- Financial
    avg_ticket DECIMAL(10,2),
    gross_margin_pct DECIMAL(5,2),
    food_cost_pct DECIMAL(5,2),   -- For restaurants
    labor_cost_pct DECIMAL(5,2),
    rent_pct DECIMAL(5,2),
    break_even_daily DECIMAL(10,2),

    -- Market Position
    price_positioning TEXT CHECK (price_positioning IN ('budget', 'mid-market', 'premium', 'luxury')),
    primary_competitors JSONB DEFAULT '[]'::jsonb,  -- [{name, strengths, weaknesses}]
    competitive_advantage TEXT,
    unique_selling_points TEXT[],

    -- Growth
    current_stage TEXT CHECK (current_stage IN ('startup', 'growing', 'established', 'expanding', 'mature')),
    growth_goals JSONB DEFAULT '[]'::jsonb,  -- [{goal, timeline, metrics}]
    expansion_interest TEXT[],    -- ['second_location', 'franchise', 'ecommerce']
    biggest_challenge TEXT,
    success_vision TEXT,

    -- Location Context
    location_type TEXT CHECK (location_type IN ('downtown', 'suburban', 'mall', 'strip', 'standalone', 'mixed')),
    foot_traffic_level TEXT CHECK (foot_traffic_level IN ('low', 'medium', 'high', 'very_high')),
    parking_situation TEXT CHECK (parking_situation IN ('none', 'limited', 'adequate', 'ample')),
    nearby_anchors TEXT[],        -- Major nearby businesses driving traffic

    -- Operations
    peak_hours JSONB DEFAULT '{}'::jsonb,   -- {monday: ['11-13', '18-20'], ...}
    slow_periods JSONB DEFAULT '{}'::jsonb, -- {days: ['Monday', 'Tuesday'], hours: ['14-16']}
    staff_count INTEGER,
    owner_hours_weekly INTEGER,

    -- Customer Profile
    ideal_customer_description TEXT,
    primary_age_range TEXT,       -- '25-40'
    customer_frequency TEXT,      -- 'daily', 'weekly', 'monthly'

    -- Metadata
    profile_completeness INTEGER DEFAULT 0,  -- Percentage 0-100
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE business_profiles IS 'Structured business model data for each organization';
COMMENT ON COLUMN business_profiles.profile_completeness IS 'Percentage of profile fields filled (0-100)';

-- ============================================================================
-- 3. DISCOVERY QUESTIONS (Question Bank)
-- Pre-seeded questions Royal AI asks to learn about businesses
-- ============================================================================
CREATE TABLE IF NOT EXISTS discovery_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Classification
    domain TEXT NOT NULL CHECK (domain IN ('revenue', 'costs', 'customers', 'competition', 'operations', 'growth', 'marketing', 'team', 'finances', 'personal')),
    priority INTEGER DEFAULT 50 CHECK (priority >= 1 AND priority <= 100),  -- Higher = ask sooner

    -- The question
    question TEXT NOT NULL,
    why_asking TEXT,              -- Explanation to share with user
    follow_ups TEXT[],            -- Related questions if they answer
    maps_to_field TEXT,           -- Which business_profiles field this populates

    -- Targeting
    business_types TEXT[],        -- NULL = all, or ['restaurant', 'retail']
    asks_after TEXT[],            -- Question IDs that should be answered first
    min_profile_completeness INTEGER DEFAULT 0,  -- Only ask after profile is X% complete

    -- Metadata
    avg_response_time_seconds INTEGER,
    skip_rate DECIMAL(3,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_questions_domain ON discovery_questions(domain);
CREATE INDEX idx_questions_priority ON discovery_questions(priority DESC) WHERE is_active = TRUE;
CREATE INDEX idx_questions_business_type ON discovery_questions USING GIN(business_types);

COMMENT ON TABLE discovery_questions IS 'Bank of discovery questions Royal AI asks to learn about businesses';
COMMENT ON COLUMN discovery_questions.priority IS 'Higher priority (1-100) questions are asked sooner';
COMMENT ON COLUMN discovery_questions.maps_to_field IS 'Which business_profiles field this answer populates';

-- ============================================================================
-- 4. ORG DISCOVERY PROGRESS
-- Tracks which questions have been asked/answered for each organization
-- ============================================================================
CREATE TABLE IF NOT EXISTS org_discovery_progress (
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    question_id UUID REFERENCES discovery_questions(id) ON DELETE CASCADE,

    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'asked', 'answered', 'skipped', 'deferred')),
    asked_at TIMESTAMPTZ,
    answered_at TIMESTAMPTZ,
    skipped_at TIMESTAMPTZ,
    answer_thread_id UUID REFERENCES ai_threads(id) ON DELETE SET NULL,

    -- For learning which questions work
    response_time_seconds INTEGER,  -- How long user took to answer
    answer_quality TEXT CHECK (answer_quality IN ('detailed', 'brief', 'unclear', 'skipped')),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (organization_id, question_id)
);

CREATE INDEX idx_progress_org_status ON org_discovery_progress(organization_id, status);

COMMENT ON TABLE org_discovery_progress IS 'Tracks which discovery questions have been asked/answered per organization';

-- ============================================================================
-- 5. OWNER PATTERNS (Emergent Personality)
-- Tracks owner behavior patterns to adapt Royal AI style automatically
-- ============================================================================
CREATE TABLE IF NOT EXISTS owner_patterns (
    organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,

    -- Communication style (learned from interactions)
    avg_message_length INTEGER,           -- Characters per message
    uses_emojis BOOLEAN DEFAULT FALSE,
    preferred_time_of_day TEXT CHECK (preferred_time_of_day IN ('morning', 'afternoon', 'evening', 'night')),
    avg_response_delay_minutes INTEGER,
    typical_session_duration_minutes INTEGER,

    -- Engagement patterns
    topics_engaged TEXT[],                -- Topics they ask about
    topics_skipped TEXT[],                -- Topics they ignore
    preferred_day_of_week TEXT,
    engagement_frequency TEXT CHECK (engagement_frequency IN ('daily', 'few_times_week', 'weekly', 'occasional')),

    -- Calculated preferences
    formality_score DECIMAL(3,2) DEFAULT 0.5,  -- 0 = very casual, 1 = very formal
    detail_preference TEXT DEFAULT 'standard' CHECK (detail_preference IN ('brief', 'standard', 'detailed')),
    proactivity_comfort TEXT DEFAULT 'helpful_nudges' CHECK (proactivity_comfort IN ('minimal', 'helpful_nudges', 'proactive', 'aggressive')),

    -- Stress detection
    stress_signals_detected INTEGER DEFAULT 0,
    last_stress_signal TIMESTAMPTZ,
    current_stress_level TEXT DEFAULT 'normal' CHECK (current_stress_level IN ('normal', 'elevated', 'high')),

    -- Learning metadata
    total_interactions INTEGER DEFAULT 0,
    last_pattern_update TIMESTAMPTZ,
    pattern_confidence DECIMAL(3,2) DEFAULT 0,  -- How confident we are in these patterns

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE owner_patterns IS 'Learned behavior patterns for adapting Royal AI style per owner';
COMMENT ON COLUMN owner_patterns.formality_score IS '0 = very casual, 1 = very formal';
COMMENT ON COLUMN owner_patterns.pattern_confidence IS 'Confidence in patterns (needs ~10+ interactions)';

-- ============================================================================
-- 6. OWNER INTERACTIONS (Pattern Learning Input)
-- Individual interactions used to learn owner patterns
-- ============================================================================
CREATE TABLE IF NOT EXISTS owner_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- What happened
    interaction_type TEXT NOT NULL CHECK (interaction_type IN ('message', 'report_view', 'action_approval', 'action_rejection', 'skip', 'settings_change')),
    content_length INTEGER,
    response_time_seconds INTEGER,
    time_of_day TEXT CHECK (time_of_day IN ('morning', 'afternoon', 'evening', 'night')),
    day_of_week TEXT,

    -- Signals
    used_emoji BOOLEAN DEFAULT FALSE,
    seemed_stressed BOOLEAN DEFAULT FALSE,  -- Short, terse, unusual time
    topic TEXT,
    sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative', 'frustrated')),

    -- Thread context
    thread_id UUID REFERENCES ai_threads(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_interactions_org ON owner_interactions(organization_id, created_at DESC);
-- Note: Partial index with NOW() not possible (not IMMUTABLE). Use regular index instead.
-- Filter by date in queries, not in index predicate.

COMMENT ON TABLE owner_interactions IS 'Individual interactions used to learn and update owner patterns';

-- ============================================================================
-- 7. RLS POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE business_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_discovery_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_interactions ENABLE ROW LEVEL SECURITY;

-- business_knowledge policies
CREATE POLICY "Users can view their org's knowledge" ON business_knowledge
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "Users can insert knowledge for their org" ON business_knowledge
    FOR INSERT WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "Users can update their org's knowledge" ON business_knowledge
    FOR UPDATE USING (
        organization_id IN (
            SELECT organization_id FROM profiles WHERE id = auth.uid()
        )
    );

-- business_profiles policies
CREATE POLICY "Users can view their org's profile" ON business_profiles
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "Users can upsert their org's profile" ON business_profiles
    FOR ALL USING (
        organization_id IN (
            SELECT organization_id FROM profiles WHERE id = auth.uid()
        )
    );

-- discovery_questions policies (read-only for all authenticated users)
CREATE POLICY "Authenticated users can view questions" ON discovery_questions
    FOR SELECT USING (auth.role() = 'authenticated');

-- org_discovery_progress policies
CREATE POLICY "Users can view their org's progress" ON org_discovery_progress
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "Users can manage their org's progress" ON org_discovery_progress
    FOR ALL USING (
        organization_id IN (
            SELECT organization_id FROM profiles WHERE id = auth.uid()
        )
    );

-- owner_patterns policies
CREATE POLICY "Users can view their org's patterns" ON owner_patterns
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "Users can manage their org's patterns" ON owner_patterns
    FOR ALL USING (
        organization_id IN (
            SELECT organization_id FROM profiles WHERE id = auth.uid()
        )
    );

-- owner_interactions policies
CREATE POLICY "Users can view their org's interactions" ON owner_interactions
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "Users can insert interactions for their org" ON owner_interactions
    FOR INSERT WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM profiles WHERE id = auth.uid()
        )
    );

-- ============================================================================
-- 8. HELPER FUNCTIONS
-- ============================================================================

-- Function to get next discovery question for an org
CREATE OR REPLACE FUNCTION get_next_discovery_question(p_org_id UUID)
RETURNS TABLE(
    question_id UUID,
    domain TEXT,
    question TEXT,
    why_asking TEXT,
    priority INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        dq.id as question_id,
        dq.domain,
        dq.question,
        dq.why_asking,
        dq.priority
    FROM discovery_questions dq
    LEFT JOIN org_discovery_progress odp
        ON odp.question_id = dq.id AND odp.organization_id = p_org_id
    LEFT JOIN business_profiles bp ON bp.organization_id = p_org_id
    WHERE dq.is_active = TRUE
        AND (odp.status IS NULL OR odp.status = 'pending')
        AND (dq.min_profile_completeness <= COALESCE(bp.profile_completeness, 0))
    ORDER BY dq.priority DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to calculate profile completeness
CREATE OR REPLACE FUNCTION calculate_profile_completeness(p_org_id UUID)
RETURNS INTEGER AS $$
DECLARE
    total_fields INTEGER := 20;  -- Approximate number of key fields
    filled_fields INTEGER := 0;
    profile RECORD;
BEGIN
    SELECT * INTO profile FROM business_profiles WHERE organization_id = p_org_id;

    IF profile IS NULL THEN
        RETURN 0;
    END IF;

    -- Count filled fields
    IF profile.business_type IS NOT NULL THEN filled_fields := filled_fields + 1; END IF;
    IF profile.revenue_model IS NOT NULL THEN filled_fields := filled_fields + 1; END IF;
    IF profile.avg_ticket IS NOT NULL THEN filled_fields := filled_fields + 1; END IF;
    IF profile.gross_margin_pct IS NOT NULL THEN filled_fields := filled_fields + 1; END IF;
    IF profile.labor_cost_pct IS NOT NULL THEN filled_fields := filled_fields + 1; END IF;
    IF profile.price_positioning IS NOT NULL THEN filled_fields := filled_fields + 1; END IF;
    IF profile.competitive_advantage IS NOT NULL THEN filled_fields := filled_fields + 1; END IF;
    IF profile.current_stage IS NOT NULL THEN filled_fields := filled_fields + 1; END IF;
    IF profile.biggest_challenge IS NOT NULL THEN filled_fields := filled_fields + 1; END IF;
    IF profile.success_vision IS NOT NULL THEN filled_fields := filled_fields + 1; END IF;
    IF profile.location_type IS NOT NULL THEN filled_fields := filled_fields + 1; END IF;
    IF profile.foot_traffic_level IS NOT NULL THEN filled_fields := filled_fields + 1; END IF;
    IF profile.ideal_customer_description IS NOT NULL THEN filled_fields := filled_fields + 1; END IF;
    IF profile.primary_age_range IS NOT NULL THEN filled_fields := filled_fields + 1; END IF;
    IF jsonb_array_length(profile.primary_competitors) > 0 THEN filled_fields := filled_fields + 1; END IF;
    IF jsonb_array_length(profile.growth_goals) > 0 THEN filled_fields := filled_fields + 1; END IF;
    IF profile.peak_hours != '{}'::jsonb THEN filled_fields := filled_fields + 1; END IF;
    IF profile.staff_count IS NOT NULL THEN filled_fields := filled_fields + 1; END IF;
    IF profile.owner_hours_weekly IS NOT NULL THEN filled_fields := filled_fields + 1; END IF;
    IF array_length(profile.unique_selling_points, 1) > 0 THEN filled_fields := filled_fields + 1; END IF;

    RETURN ROUND((filled_fields::DECIMAL / total_fields) * 100);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to update profile completeness
CREATE OR REPLACE FUNCTION update_profile_completeness()
RETURNS TRIGGER AS $$
BEGIN
    NEW.profile_completeness := calculate_profile_completeness(NEW.organization_id);
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_profile_completeness
    BEFORE INSERT OR UPDATE ON business_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_profile_completeness();

-- Trigger to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_knowledge_updated_at
    BEFORE UPDATE ON business_knowledge
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_progress_updated_at
    BEFORE UPDATE ON org_discovery_progress
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_patterns_updated_at
    BEFORE UPDATE ON owner_patterns
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
