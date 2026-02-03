-- =====================================================
-- PROJECT CONTENT CALENDAR MIGRATION
-- Run this in Supabase SQL Editor
-- Adds project-level content strategy and AI generation pipeline
-- =====================================================

-- =====================================================
-- 1. CONTENT CALENDARS (Project-Level Strategy)
-- =====================================================

CREATE TABLE IF NOT EXISTS content_calendars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Strategy configuration (user input)
    strategy_prompt TEXT,                    -- User's goals/direction for content
    brand_voice TEXT,                        -- Tone/voice guidelines
    target_audience TEXT,                    -- Who the content is for
    content_pillars JSONB DEFAULT '[]',      -- Key topics/themes (array of strings)
    topics_to_avoid JSONB DEFAULT '[]',      -- What NOT to write about

    -- AI-generated strategy
    ai_strategy JSONB,                       -- Generated content calendar/plan
    ai_strategy_generated_at TIMESTAMPTZ,

    -- Publishing settings
    publish_frequency TEXT DEFAULT 'weekly', -- daily, twice_weekly, weekly, biweekly, monthly
    preferred_days JSONB DEFAULT '["monday"]', -- Array of days: ["monday", "thursday"]
    preferred_time TIME DEFAULT '09:00',     -- Default publish time (UTC)

    -- Quality gate settings
    quality_threshold INTEGER DEFAULT 80,    -- Min score (0-100) to auto-publish
    auto_publish BOOLEAN DEFAULT false,      -- Auto-publish if above threshold
    require_review BOOLEAN DEFAULT true,     -- Always require human review

    -- Stats
    posts_generated INTEGER DEFAULT 0,
    posts_published INTEGER DEFAULT 0,
    total_views INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- One calendar per project
    UNIQUE(project_id)
);

-- Enable RLS
ALTER TABLE content_calendars ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_content_calendars_org ON content_calendars(organization_id);
CREATE INDEX IF NOT EXISTS idx_content_calendars_project ON content_calendars(project_id);

-- RLS Policies
CREATE POLICY "Users can view calendars for their org" ON content_calendars
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = content_calendars.organization_id
            AND om.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage calendars for their org" ON content_calendars
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = content_calendars.organization_id
            AND om.user_id = auth.uid()
        )
    );

-- =====================================================
-- 2. CONTENT POSTS (AI-Generated Content Pipeline)
-- =====================================================

CREATE TABLE IF NOT EXISTS content_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    calendar_id UUID REFERENCES content_calendars(id) ON DELETE SET NULL,
    app_id UUID REFERENCES customer_apps(id) ON DELETE SET NULL,

    -- Content
    title TEXT NOT NULL,
    slug TEXT,
    excerpt TEXT,                            -- Short summary/preview
    body TEXT,                               -- Full content (markdown)
    body_html TEXT,                          -- Rendered HTML

    -- Media
    hero_image_url TEXT,                     -- Main image URL
    hero_image_alt TEXT,                     -- Alt text for accessibility
    hero_image_prompt TEXT,                  -- AI prompt used to generate image
    media_assets JSONB DEFAULT '[]',         -- Additional images [{url, alt, type, prompt}]

    -- Social variants (auto-generated)
    social_snippets JSONB DEFAULT '{}',      -- {twitter, instagram, linkedin, facebook, tiktok}
    email_subject TEXT,                      -- Newsletter subject line
    email_preview TEXT,                      -- Newsletter preview text

    -- SEO
    meta_title TEXT,
    meta_description TEXT,
    keywords JSONB DEFAULT '[]',             -- Array of target keywords

    -- AI metadata
    ai_generated BOOLEAN DEFAULT true,
    ai_model TEXT DEFAULT 'claude-3-opus',
    ai_prompt_used TEXT,                     -- Full prompt for regeneration
    generation_context JSONB,                -- Project/brand context snapshot

    -- Quality scoring (0-100)
    quality_score INTEGER,                   -- Overall score
    quality_breakdown JSONB,                 -- {brand: 92, seo: 85, engagement: 88, accuracy: 90}
    quality_notes TEXT,                      -- AI explanation of score

    -- Publishing workflow
    status TEXT DEFAULT 'draft',             -- draft, pending_review, approved, scheduled, published, failed
    status_changed_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_by UUID REFERENCES auth.users(id),
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,

    -- Scheduling
    scheduled_for TIMESTAMPTZ,               -- When to publish
    published_at TIMESTAMPTZ,                -- When actually published
    publish_error TEXT,                      -- Error message if publish failed

    -- Performance tracking (updated after publish)
    views INTEGER DEFAULT 0,
    unique_views INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    time_on_page_avg INTEGER,                -- Seconds

    -- Versioning
    version INTEGER DEFAULT 1,
    parent_id UUID REFERENCES content_posts(id), -- For revisions

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ                   -- Soft delete
);

-- Enable RLS
ALTER TABLE content_posts ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_content_posts_org ON content_posts(organization_id);
CREATE INDEX IF NOT EXISTS idx_content_posts_project ON content_posts(project_id);
CREATE INDEX IF NOT EXISTS idx_content_posts_calendar ON content_posts(calendar_id);
CREATE INDEX IF NOT EXISTS idx_content_posts_app ON content_posts(app_id);
CREATE INDEX IF NOT EXISTS idx_content_posts_status ON content_posts(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_content_posts_scheduled ON content_posts(scheduled_for)
    WHERE status = 'scheduled' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_content_posts_published ON content_posts(published_at DESC)
    WHERE status = 'published' AND deleted_at IS NULL;

-- RLS Policies
CREATE POLICY "Users can view posts for their org" ON content_posts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = content_posts.organization_id
            AND om.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage posts for their org" ON content_posts
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = content_posts.organization_id
            AND om.user_id = auth.uid()
        )
    );

-- =====================================================
-- 3. HELPER FUNCTIONS
-- =====================================================

-- Get or create content calendar for a project
CREATE OR REPLACE FUNCTION get_or_create_content_calendar(
    p_organization_id UUID,
    p_project_id UUID
)
RETURNS content_calendars AS $$
DECLARE
    v_calendar content_calendars;
BEGIN
    -- Try to get existing calendar
    SELECT * INTO v_calendar
    FROM content_calendars
    WHERE project_id = p_project_id;

    -- Create if doesn't exist
    IF v_calendar.id IS NULL THEN
        INSERT INTO content_calendars (organization_id, project_id)
        VALUES (p_organization_id, p_project_id)
        RETURNING * INTO v_calendar;
    END IF;

    RETURN v_calendar;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_or_create_content_calendar(UUID, UUID) TO authenticated;

-- Get content pipeline stats for a project
CREATE OR REPLACE FUNCTION get_content_pipeline_stats(p_project_id UUID)
RETURNS TABLE (
    total_posts BIGINT,
    drafts BIGINT,
    pending_review BIGINT,
    approved BIGINT,
    scheduled BIGINT,
    published BIGINT,
    avg_quality_score NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*) as total_posts,
        COUNT(*) FILTER (WHERE status = 'draft') as drafts,
        COUNT(*) FILTER (WHERE status = 'pending_review') as pending_review,
        COUNT(*) FILTER (WHERE status = 'approved') as approved,
        COUNT(*) FILTER (WHERE status = 'scheduled') as scheduled,
        COUNT(*) FILTER (WHERE status = 'published') as published,
        ROUND(AVG(quality_score), 1) as avg_quality_score
    FROM content_posts
    WHERE project_id = p_project_id
      AND deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_content_pipeline_stats(UUID) TO authenticated;

-- Save content calendar settings
CREATE OR REPLACE FUNCTION save_content_calendar_settings(
    p_project_id UUID,
    p_strategy_prompt TEXT DEFAULT NULL,
    p_brand_voice TEXT DEFAULT NULL,
    p_target_audience TEXT DEFAULT NULL,
    p_content_pillars JSONB DEFAULT NULL,
    p_topics_to_avoid JSONB DEFAULT NULL,
    p_publish_frequency TEXT DEFAULT NULL,
    p_preferred_days JSONB DEFAULT NULL,
    p_quality_threshold INTEGER DEFAULT NULL,
    p_auto_publish BOOLEAN DEFAULT NULL,
    p_require_review BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_calendar content_calendars;
    v_project projects;
BEGIN
    -- Get project to verify org access
    SELECT * INTO v_project
    FROM projects
    WHERE id = p_project_id
      AND deleted_at IS NULL;

    IF v_project.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Project not found');
    END IF;

    -- Verify user has access
    IF NOT EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = v_project.organization_id
        AND om.user_id = auth.uid()
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Access denied');
    END IF;

    -- Get or create calendar
    SELECT * INTO v_calendar
    FROM get_or_create_content_calendar(v_project.organization_id, p_project_id);

    -- Update with provided values (only non-null)
    UPDATE content_calendars SET
        strategy_prompt = COALESCE(p_strategy_prompt, strategy_prompt),
        brand_voice = COALESCE(p_brand_voice, brand_voice),
        target_audience = COALESCE(p_target_audience, target_audience),
        content_pillars = COALESCE(p_content_pillars, content_pillars),
        topics_to_avoid = COALESCE(p_topics_to_avoid, topics_to_avoid),
        publish_frequency = COALESCE(p_publish_frequency, publish_frequency),
        preferred_days = COALESCE(p_preferred_days, preferred_days),
        quality_threshold = COALESCE(p_quality_threshold, quality_threshold),
        auto_publish = COALESCE(p_auto_publish, auto_publish),
        require_review = COALESCE(p_require_review, require_review),
        updated_at = NOW()
    WHERE id = v_calendar.id
    RETURNING * INTO v_calendar;

    RETURN jsonb_build_object(
        'success', true,
        'calendar', to_jsonb(v_calendar)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION save_content_calendar_settings TO authenticated;

-- Approve content post
CREATE OR REPLACE FUNCTION approve_content_post(
    p_post_id UUID,
    p_schedule_for TIMESTAMPTZ DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_post content_posts;
    v_new_status TEXT;
BEGIN
    -- Get post
    SELECT * INTO v_post
    FROM content_posts
    WHERE id = p_post_id
      AND deleted_at IS NULL;

    IF v_post.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Post not found');
    END IF;

    -- Verify access
    IF NOT EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = v_post.organization_id
        AND om.user_id = auth.uid()
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Access denied');
    END IF;

    -- Determine new status
    IF p_schedule_for IS NOT NULL THEN
        v_new_status := 'scheduled';
    ELSE
        v_new_status := 'approved';
    END IF;

    -- Update post
    UPDATE content_posts SET
        status = v_new_status,
        status_changed_at = NOW(),
        reviewed_by = auth.uid(),
        reviewed_at = NOW(),
        review_notes = p_notes,
        scheduled_for = p_schedule_for,
        updated_at = NOW()
    WHERE id = p_post_id
    RETURNING * INTO v_post;

    RETURN jsonb_build_object(
        'success', true,
        'post', to_jsonb(v_post)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION approve_content_post TO authenticated;

-- Publish content post
CREATE OR REPLACE FUNCTION publish_content_post(p_post_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_post content_posts;
    v_calendar content_calendars;
BEGIN
    -- Get post
    SELECT * INTO v_post
    FROM content_posts
    WHERE id = p_post_id
      AND deleted_at IS NULL;

    IF v_post.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Post not found');
    END IF;

    -- Verify access
    IF NOT EXISTS (
        SELECT 1 FROM organization_members om
        WHERE om.organization_id = v_post.organization_id
        AND om.user_id = auth.uid()
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Access denied');
    END IF;

    -- Update post to published
    UPDATE content_posts SET
        status = 'published',
        status_changed_at = NOW(),
        published_at = NOW(),
        updated_at = NOW()
    WHERE id = p_post_id
    RETURNING * INTO v_post;

    -- Update calendar stats
    IF v_post.calendar_id IS NOT NULL THEN
        UPDATE content_calendars SET
            posts_published = posts_published + 1,
            updated_at = NOW()
        WHERE id = v_post.calendar_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'post', to_jsonb(v_post)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION publish_content_post TO authenticated;

-- =====================================================
-- 4. TRIGGERS
-- =====================================================

-- Update timestamps
CREATE OR REPLACE FUNCTION update_content_calendar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS content_calendars_updated_at ON content_calendars;
CREATE TRIGGER content_calendars_updated_at
    BEFORE UPDATE ON content_calendars
    FOR EACH ROW
    EXECUTE FUNCTION update_content_calendar_timestamp();

CREATE OR REPLACE FUNCTION update_content_post_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS content_posts_updated_at ON content_posts;
CREATE TRIGGER content_posts_updated_at
    BEFORE UPDATE ON content_posts
    FOR EACH ROW
    EXECUTE FUNCTION update_content_post_timestamp();

-- =====================================================
-- DONE! Content calendar tables are ready.
-- Run this migration, then you can use the Content tab in Projects.
-- =====================================================
