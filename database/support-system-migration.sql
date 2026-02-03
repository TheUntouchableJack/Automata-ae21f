-- =====================================================
-- CUSTOMER SUPPORT SYSTEM - Database Migration
-- Run this in Supabase SQL Editor
-- =====================================================

-- =====================================================
-- 1. SUPPORT_TICKETS TABLE
-- Core ticket tracking for customer inquiries
-- =====================================================

CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,
    member_id UUID REFERENCES app_members(id) ON DELETE SET NULL,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Ticket Identity
    ticket_number TEXT UNIQUE NOT NULL,  -- Human-readable: APP-XXXXXX
    subject TEXT NOT NULL,
    description TEXT NOT NULL,

    -- Classification
    ticket_type TEXT NOT NULL DEFAULT 'question',  -- 'question', 'bug_report', 'feature_request', 'complaint', 'feedback'
    category TEXT,  -- 'rewards', 'points', 'account', 'app_issue', 'general'
    priority TEXT DEFAULT 'normal',  -- 'low', 'normal', 'high', 'urgent'

    -- Status
    status TEXT DEFAULT 'open',  -- 'open', 'awaiting_response', 'in_progress', 'pending_customer', 'resolved', 'closed'
    resolution TEXT,  -- How was it resolved

    -- AI Handling
    ai_handled BOOLEAN DEFAULT false,  -- Was AI involved?
    ai_confidence DECIMAL(3,2),  -- 0-1 confidence in AI response
    ai_response_draft TEXT,  -- AI-generated response (for manual_approve mode)
    ai_approved BOOLEAN,  -- If in manual_approve mode, was AI response approved?
    requires_human BOOLEAN DEFAULT false,  -- Escalated to human?
    escalation_reason TEXT,

    -- Assignment
    assigned_to UUID REFERENCES profiles(id),
    assigned_at TIMESTAMPTZ,

    -- Customer satisfaction
    satisfaction_rating INTEGER CHECK (satisfaction_rating >= 1 AND satisfaction_rating <= 5),
    satisfaction_feedback TEXT,

    -- Metadata
    source TEXT DEFAULT 'app',  -- 'app', 'email', 'chat', 'api'
    metadata JSONB DEFAULT '{}',  -- browser info, app version, etc.

    -- Timestamps
    first_response_at TIMESTAMPTZ,  -- Time to first response tracking
    resolved_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_support_tickets_app ON support_tickets(app_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_org ON support_tickets(organization_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_member ON support_tickets(member_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_type ON support_tickets(ticket_type);
CREATE INDEX IF NOT EXISTS idx_support_tickets_number ON support_tickets(ticket_number);
CREATE INDEX IF NOT EXISTS idx_support_tickets_escalated ON support_tickets(requires_human, status)
    WHERE requires_human = true AND status NOT IN ('resolved', 'closed');
CREATE INDEX IF NOT EXISTS idx_support_tickets_open ON support_tickets(app_id, status)
    WHERE status NOT IN ('resolved', 'closed');
CREATE INDEX IF NOT EXISTS idx_support_tickets_created ON support_tickets(created_at DESC);

-- Enable RLS
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Org members can view support tickets" ON support_tickets
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = support_tickets.organization_id
            AND om.user_id = auth.uid()
        )
    );

CREATE POLICY "Org members can manage support tickets" ON support_tickets
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = support_tickets.organization_id
            AND om.user_id = auth.uid()
        )
    );

-- Allow customers to create tickets via anon key (RPC will handle)
CREATE POLICY "Anyone can create tickets via RPC" ON support_tickets
    FOR INSERT WITH CHECK (true);

-- =====================================================
-- 2. TICKET_MESSAGES TABLE
-- Conversation thread within a ticket
-- =====================================================

CREATE TABLE IF NOT EXISTS ticket_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,

    -- Sender
    sender_type TEXT NOT NULL,  -- 'customer', 'staff', 'ai', 'system'
    sender_id UUID,  -- member_id or profile_id
    sender_name TEXT,  -- Display name

    -- Content
    message TEXT NOT NULL,
    attachments JSONB DEFAULT '[]',  -- [{url, type, name, size}]

    -- AI Metadata
    ai_generated BOOLEAN DEFAULT false,
    ai_model TEXT,  -- 'claude-sonnet-4' etc.
    ai_sources JSONB DEFAULT '[]',  -- KB articles referenced

    -- Status
    is_internal BOOLEAN DEFAULT false,  -- Staff-only note
    read_at TIMESTAMPTZ,  -- When customer read it

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_sender ON ticket_messages(sender_type, sender_id);

-- Enable RLS
ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies (via ticket ownership)
CREATE POLICY "Users can view ticket messages" ON ticket_messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM support_tickets st
            JOIN organization_members om ON om.organization_id = st.organization_id
            WHERE st.id = ticket_messages.ticket_id
            AND om.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create ticket messages" ON ticket_messages
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM support_tickets st
            JOIN organization_members om ON om.organization_id = st.organization_id
            WHERE st.id = ticket_messages.ticket_id
            AND om.user_id = auth.uid()
        )
    );

-- =====================================================
-- 3. KNOWLEDGEBASE_ARTICLES TABLE
-- Help articles for self-service
-- =====================================================

CREATE TABLE IF NOT EXISTS knowledgebase_articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID REFERENCES customer_apps(id) ON DELETE CASCADE,  -- NULL = global/system article
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

    -- Article Content
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    content TEXT NOT NULL,  -- Markdown format
    excerpt TEXT,  -- Short description

    -- Classification
    category TEXT NOT NULL,  -- 'getting_started', 'rewards', 'points', 'account', 'troubleshooting'
    tags TEXT[] DEFAULT '{}',

    -- AI Integration (vector for semantic search - future)
    ai_summary TEXT,  -- AI-generated summary
    ai_keywords TEXT[],  -- AI-extracted keywords

    -- Display
    is_published BOOLEAN DEFAULT false,
    is_featured BOOLEAN DEFAULT false,
    display_order INTEGER DEFAULT 0,

    -- Stats
    view_count INTEGER DEFAULT 0,
    helpful_count INTEGER DEFAULT 0,
    not_helpful_count INTEGER DEFAULT 0,

    -- SEO
    meta_title TEXT,
    meta_description TEXT,

    -- Author
    created_by UUID REFERENCES profiles(id),
    updated_by UUID REFERENCES profiles(id),

    -- Timestamps
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique slug per app
CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_articles_slug ON knowledgebase_articles(app_id, slug);
CREATE INDEX IF NOT EXISTS idx_kb_articles_app ON knowledgebase_articles(app_id);
CREATE INDEX IF NOT EXISTS idx_kb_articles_org ON knowledgebase_articles(organization_id);
CREATE INDEX IF NOT EXISTS idx_kb_articles_category ON knowledgebase_articles(app_id, category);
CREATE INDEX IF NOT EXISTS idx_kb_articles_published ON knowledgebase_articles(app_id, is_published)
    WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_kb_articles_search ON knowledgebase_articles
    USING GIN (to_tsvector('english', title || ' ' || COALESCE(content, '')));

-- Enable RLS
ALTER TABLE knowledgebase_articles ENABLE ROW LEVEL SECURITY;

-- Public can view published KB articles
CREATE POLICY "Public can view published KB articles" ON knowledgebase_articles
    FOR SELECT USING (
        is_published = true
        OR EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = knowledgebase_articles.organization_id
            AND om.user_id = auth.uid()
        )
    );

-- Org members can manage KB articles
CREATE POLICY "Org members can manage KB articles" ON knowledgebase_articles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = knowledgebase_articles.organization_id
            AND om.user_id = auth.uid()
        )
    );

-- =====================================================
-- 4. FAQ_ITEMS TABLE
-- Quick Q&A pairs (simpler than full articles)
-- =====================================================

CREATE TABLE IF NOT EXISTS faq_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Q&A
    question TEXT NOT NULL,
    answer TEXT NOT NULL,

    -- Classification
    category TEXT DEFAULT 'general',  -- 'getting_started', 'rewards', 'points', 'account', 'general'

    -- Display
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,

    -- Stats
    times_shown INTEGER DEFAULT 0,
    times_helpful INTEGER DEFAULT 0,
    times_not_helpful INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_faq_items_app ON faq_items(app_id);
CREATE INDEX IF NOT EXISTS idx_faq_items_active ON faq_items(app_id, is_active, display_order)
    WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_faq_items_category ON faq_items(app_id, category);
CREATE INDEX IF NOT EXISTS idx_faq_items_search ON faq_items
    USING GIN (to_tsvector('english', question || ' ' || answer));

-- Enable RLS
ALTER TABLE faq_items ENABLE ROW LEVEL SECURITY;

-- Public can view active FAQs
CREATE POLICY "Public can view FAQs" ON faq_items
    FOR SELECT USING (
        is_active = true
        OR EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = faq_items.organization_id
            AND om.user_id = auth.uid()
        )
    );

-- Org members can manage FAQs
CREATE POLICY "Org members can manage FAQs" ON faq_items
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = faq_items.organization_id
            AND om.user_id = auth.uid()
        )
    );

-- =====================================================
-- 5. AI_SUPPORT_SESSIONS TABLE
-- Track AI chat sessions with customers
-- =====================================================

CREATE TABLE IF NOT EXISTS ai_support_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,
    member_id UUID REFERENCES app_members(id) ON DELETE SET NULL,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Session State
    status TEXT DEFAULT 'active',  -- 'active', 'escalated', 'resolved', 'abandoned'

    -- Context (snapshot of member/app data for AI)
    context JSONB DEFAULT '{}',
    conversation_summary TEXT,  -- AI-generated summary

    -- Outcome
    resolved_without_human BOOLEAN,
    escalated_to_ticket_id UUID REFERENCES support_tickets(id),
    kb_articles_referenced UUID[],
    faq_items_referenced UUID[],

    -- Stats
    message_count INTEGER DEFAULT 0,
    ai_response_time_avg_ms INTEGER,

    -- Feedback
    satisfaction_rating INTEGER CHECK (satisfaction_rating >= 1 AND satisfaction_rating <= 5),
    feedback_text TEXT,

    -- Timestamps
    started_at TIMESTAMPTZ DEFAULT NOW(),
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_sessions_app ON ai_support_sessions(app_id);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_org ON ai_support_sessions(organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_member ON ai_support_sessions(member_id);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_active ON ai_support_sessions(app_id, status)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_ai_sessions_created ON ai_support_sessions(started_at DESC);

-- Enable RLS
ALTER TABLE ai_support_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Org members can view AI sessions" ON ai_support_sessions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = ai_support_sessions.organization_id
            AND om.user_id = auth.uid()
        )
    );

CREATE POLICY "Anyone can create AI sessions via RPC" ON ai_support_sessions
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update AI sessions via RPC" ON ai_support_sessions
    FOR UPDATE USING (true);

-- =====================================================
-- 6. AI_SUPPORT_MESSAGES TABLE
-- Individual messages in AI chat
-- =====================================================

CREATE TABLE IF NOT EXISTS ai_support_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES ai_support_sessions(id) ON DELETE CASCADE,

    -- Message
    role TEXT NOT NULL,  -- 'user', 'assistant'
    content TEXT NOT NULL,

    -- AI Metadata
    model TEXT,  -- 'claude-sonnet-4-20250514' etc.
    tokens_used INTEGER,
    response_time_ms INTEGER,
    kb_sources JSONB DEFAULT '[]',  -- Articles/FAQs used
    confidence_score DECIMAL(3,2),
    intent_detected TEXT,  -- 'ask_points', 'how_to_redeem', 'report_bug', 'request_human', etc.

    -- Feedback
    was_helpful BOOLEAN,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_support_messages(session_id, created_at);

-- Enable RLS
ALTER TABLE ai_support_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies (via session ownership)
CREATE POLICY "Users can view AI messages" ON ai_support_messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM ai_support_sessions ss
            JOIN organization_members om ON om.organization_id = ss.organization_id
            WHERE ss.id = ai_support_messages.session_id
            AND om.user_id = auth.uid()
        )
    );

CREATE POLICY "Anyone can create AI messages via RPC" ON ai_support_messages
    FOR INSERT WITH CHECK (true);

-- =====================================================
-- 7. SUPPORT_SETTINGS TABLE
-- Per-app support configuration
-- =====================================================

CREATE TABLE IF NOT EXISTS support_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID UNIQUE NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- AI Agent Settings
    ai_support_enabled BOOLEAN DEFAULT true,
    ai_autonomy_mode TEXT DEFAULT 'auto_pilot',  -- 'auto_pilot', 'manual_approve'
    ai_greeting_message TEXT DEFAULT 'Hi! I''m here to help. What can I assist you with today?',
    ai_personality TEXT DEFAULT 'friendly',  -- 'friendly', 'professional', 'casual'

    -- Escalation Rules
    escalation_triggers JSONB DEFAULT '{
        "keywords": ["speak to human", "real person", "manager", "supervisor"],
        "low_confidence_threshold": 0.6,
        "max_ai_turns_before_offer_human": 5,
        "negative_sentiment_escalate": true
    }',

    -- Business Hours
    business_hours JSONB DEFAULT '{
        "monday": {"open": "09:00", "close": "17:00"},
        "tuesday": {"open": "09:00", "close": "17:00"},
        "wednesday": {"open": "09:00", "close": "17:00"},
        "thursday": {"open": "09:00", "close": "17:00"},
        "friday": {"open": "09:00", "close": "17:00"},
        "saturday": null,
        "sunday": null,
        "timezone": "America/New_York"
    }',

    -- Response Templates
    after_hours_message TEXT DEFAULT 'Thanks for reaching out! We''re currently closed but will get back to you during business hours.',
    human_unavailable_message TEXT DEFAULT 'Our team is currently unavailable. Would you like to leave a message?',

    -- Notifications
    notify_on_escalation BOOLEAN DEFAULT true,
    notify_on_new_ticket BOOLEAN DEFAULT true,
    notification_email TEXT,
    notification_webhook_url TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_settings_app ON support_settings(app_id);

-- Enable RLS
ALTER TABLE support_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Org members can view support settings" ON support_settings
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = support_settings.organization_id
            AND om.user_id = auth.uid()
        )
    );

CREATE POLICY "Org members can manage support settings" ON support_settings
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = support_settings.organization_id
            AND om.user_id = auth.uid()
        )
    );

-- =====================================================
-- 8. BUG_REPORTS TABLE
-- Structured bug reports
-- =====================================================

CREATE TABLE IF NOT EXISTS bug_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    member_id UUID REFERENCES app_members(id) ON DELETE SET NULL,
    ticket_id UUID REFERENCES support_tickets(id) ON DELETE SET NULL,

    -- Bug Details
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    steps_to_reproduce TEXT,
    expected_behavior TEXT,
    actual_behavior TEXT,

    -- Technical Info
    app_version TEXT,
    device_info JSONB DEFAULT '{}',  -- OS, browser, screen size
    console_logs TEXT,
    screenshot_urls TEXT[],

    -- Status
    status TEXT DEFAULT 'new',  -- 'new', 'confirmed', 'in_progress', 'fixed', 'wont_fix', 'duplicate'
    severity TEXT DEFAULT 'medium',  -- 'low', 'medium', 'high', 'critical'

    -- Resolution
    resolved_by UUID REFERENCES profiles(id),
    resolution_notes TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bug_reports_app ON bug_reports(app_id);
CREATE INDEX IF NOT EXISTS idx_bug_reports_org ON bug_reports(organization_id);
CREATE INDEX IF NOT EXISTS idx_bug_reports_status ON bug_reports(status);
CREATE INDEX IF NOT EXISTS idx_bug_reports_severity ON bug_reports(severity);

-- Enable RLS
ALTER TABLE bug_reports ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Org members can view bug reports" ON bug_reports
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = bug_reports.organization_id
            AND om.user_id = auth.uid()
        )
    );

CREATE POLICY "Org members can manage bug reports" ON bug_reports
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = bug_reports.organization_id
            AND om.user_id = auth.uid()
        )
    );

CREATE POLICY "Anyone can create bug reports via RPC" ON bug_reports
    FOR INSERT WITH CHECK (true);

-- =====================================================
-- 9. HELPER FUNCTIONS
-- =====================================================

-- Generate ticket number (APP-XXXXXX format)
CREATE OR REPLACE FUNCTION generate_ticket_number(p_app_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_prefix TEXT;
    v_seq INTEGER;
BEGIN
    -- Get app slug prefix (first 3 chars, uppercase)
    SELECT UPPER(LEFT(slug, 3)) INTO v_prefix
    FROM customer_apps WHERE id = p_app_id;

    IF v_prefix IS NULL THEN
        v_prefix := 'TKT';
    END IF;

    -- Get next sequence number for this app
    SELECT COALESCE(MAX(
        CASE
            WHEN ticket_number ~ ('^' || v_prefix || '-[0-9]+$')
            THEN CAST(SUBSTRING(ticket_number FROM '[0-9]+$') AS INTEGER)
            ELSE 0
        END
    ), 0) + 1 INTO v_seq
    FROM support_tickets
    WHERE app_id = p_app_id;

    RETURN v_prefix || '-' || LPAD(v_seq::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- Create support ticket (for customer app to call)
CREATE OR REPLACE FUNCTION create_support_ticket(
    p_app_id UUID,
    p_member_id UUID,
    p_subject TEXT,
    p_description TEXT,
    p_ticket_type TEXT DEFAULT 'question',
    p_category TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS TABLE (
    success BOOLEAN,
    ticket_id UUID,
    ticket_number TEXT,
    error_message TEXT
) AS $$
DECLARE
    v_org_id UUID;
    v_ticket_id UUID;
    v_ticket_number TEXT;
BEGIN
    -- Get org from app
    SELECT organization_id INTO v_org_id
    FROM customer_apps WHERE id = p_app_id;

    IF v_org_id IS NULL THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'App not found';
        RETURN;
    END IF;

    -- Generate ticket number
    v_ticket_number := generate_ticket_number(p_app_id);

    -- Create ticket
    INSERT INTO support_tickets (
        app_id, member_id, organization_id,
        ticket_number, subject, description,
        ticket_type, category, metadata
    ) VALUES (
        p_app_id, p_member_id, v_org_id,
        v_ticket_number, p_subject, p_description,
        p_ticket_type, p_category, p_metadata
    )
    RETURNING id INTO v_ticket_id;

    -- Create initial message from customer
    INSERT INTO ticket_messages (
        ticket_id, sender_type, sender_id, message
    )
    SELECT v_ticket_id, 'customer', p_member_id, p_description;

    RETURN QUERY SELECT true, v_ticket_id, v_ticket_number, NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Search KB articles (text search)
CREATE OR REPLACE FUNCTION search_knowledgebase(
    p_app_id UUID,
    p_query TEXT,
    p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
    id UUID,
    title TEXT,
    excerpt TEXT,
    content TEXT,
    category TEXT,
    relevance REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ka.id,
        ka.title,
        ka.excerpt,
        ka.content,
        ka.category,
        ts_rank(
            to_tsvector('english', ka.title || ' ' || COALESCE(ka.content, '')),
            plainto_tsquery('english', p_query)
        ) as relevance
    FROM knowledgebase_articles ka
    WHERE ka.app_id = p_app_id
      AND ka.is_published = true
      AND to_tsvector('english', ka.title || ' ' || COALESCE(ka.content, ''))
          @@ plainto_tsquery('english', p_query)
    ORDER BY relevance DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Search FAQs (text search)
CREATE OR REPLACE FUNCTION search_faqs(
    p_app_id UUID,
    p_query TEXT,
    p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
    id UUID,
    question TEXT,
    answer TEXT,
    category TEXT,
    relevance REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        f.id,
        f.question,
        f.answer,
        f.category,
        ts_rank(
            to_tsvector('english', f.question || ' ' || f.answer),
            plainto_tsquery('english', p_query)
        ) as relevance
    FROM faq_items f
    WHERE f.app_id = p_app_id
      AND f.is_active = true
      AND to_tsvector('english', f.question || ' ' || f.answer)
          @@ plainto_tsquery('english', p_query)
    ORDER BY relevance DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get support stats for dashboard
CREATE OR REPLACE FUNCTION get_support_stats(p_app_id UUID)
RETURNS TABLE (
    open_tickets BIGINT,
    pending_response BIGINT,
    escalated_tickets BIGINT,
    avg_response_time_hours NUMERIC,
    avg_resolution_time_hours NUMERIC,
    satisfaction_avg NUMERIC,
    ai_resolution_rate NUMERIC,
    total_ai_sessions BIGINT,
    total_tickets_this_month BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed'))::BIGINT as open_tickets,
        COUNT(*) FILTER (WHERE status = 'awaiting_response')::BIGINT as pending_response,
        COUNT(*) FILTER (WHERE requires_human = true AND status NOT IN ('resolved', 'closed'))::BIGINT as escalated_tickets,
        ROUND(AVG(EXTRACT(EPOCH FROM (first_response_at - created_at)) / 3600)::NUMERIC, 1) as avg_response_time_hours,
        ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600)::NUMERIC, 1) as avg_resolution_time_hours,
        ROUND(AVG(satisfaction_rating)::NUMERIC, 1) as satisfaction_avg,
        ROUND(
            (COUNT(*) FILTER (WHERE ai_handled = true AND requires_human = false)::NUMERIC /
             NULLIF(COUNT(*) FILTER (WHERE ai_handled = true)::NUMERIC, 0)) * 100,
            1
        ) as ai_resolution_rate,
        (SELECT COUNT(*) FROM ai_support_sessions WHERE ai_support_sessions.app_id = p_app_id)::BIGINT as total_ai_sessions,
        COUNT(*) FILTER (WHERE created_at > date_trunc('month', NOW()))::BIGINT as total_tickets_this_month
    FROM support_tickets
    WHERE app_id = p_app_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get AI context for support (all business data the AI needs to know)
CREATE OR REPLACE FUNCTION get_ai_support_context(
    p_app_id UUID,
    p_member_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
    v_app RECORD;
    v_org RECORD;
    v_member RECORD;
    v_rewards JSONB;
    v_faqs JSONB;
    v_stats JSONB;
BEGIN
    -- Get app info
    SELECT * INTO v_app FROM customer_apps WHERE id = p_app_id;

    IF v_app IS NULL THEN
        RETURN jsonb_build_object('error', 'App not found');
    END IF;

    -- Get organization
    SELECT * INTO v_org FROM organizations WHERE id = v_app.organization_id;

    -- Get member if provided
    IF p_member_id IS NOT NULL THEN
        SELECT
            am.*,
            (SELECT COUNT(*) FROM member_visits WHERE member_id = am.id) as visit_count,
            (SELECT COUNT(*) FROM reward_redemptions WHERE member_id = am.id) as redemption_count
        INTO v_member
        FROM app_members am
        WHERE am.id = p_member_id;
    END IF;

    -- Get active rewards
    SELECT jsonb_agg(jsonb_build_object(
        'id', r.id,
        'name', r.name,
        'description', r.description,
        'points_cost', r.points_cost,
        'tier_required', r.tier_required
    )) INTO v_rewards
    FROM app_rewards r
    WHERE r.app_id = p_app_id AND r.is_active = true
    ORDER BY r.points_cost;

    -- Get top FAQs
    SELECT jsonb_agg(jsonb_build_object(
        'question', f.question,
        'answer', f.answer,
        'category', f.category
    )) INTO v_faqs
    FROM (
        SELECT * FROM faq_items
        WHERE app_id = p_app_id AND is_active = true
        ORDER BY display_order, times_shown DESC
        LIMIT 10
    ) f;

    -- Build result
    v_result := jsonb_build_object(
        'app', jsonb_build_object(
            'id', v_app.id,
            'name', v_app.name,
            'slug', v_app.slug,
            'app_type', v_app.app_type,
            'description', v_app.description,
            'settings', v_app.settings,
            'features', v_app.features,
            'ai_autonomy_mode', v_app.ai_autonomy_mode
        ),
        'organization', jsonb_build_object(
            'name', v_org.name,
            'plan_type', v_org.plan_type
        ),
        'rewards', COALESCE(v_rewards, '[]'::jsonb),
        'faqs', COALESCE(v_faqs, '[]'::jsonb),
        'tier_thresholds', COALESCE(v_app.settings->'tier_thresholds', '{"bronze": 0, "silver": 500, "gold": 1500, "platinum": 5000}'::jsonb)
    );

    -- Add member context if available
    IF v_member IS NOT NULL THEN
        v_result := v_result || jsonb_build_object(
            'member', jsonb_build_object(
                'id', v_member.id,
                'first_name', v_member.first_name,
                'display_name', v_member.display_name,
                'points_balance', v_member.points_balance,
                'total_points_earned', v_member.total_points_earned,
                'tier', v_member.tier,
                'visit_count', v_member.visit_count,
                'current_streak', v_member.current_streak,
                'longest_streak', v_member.longest_streak,
                'redemption_count', v_member.redemption_count,
                'joined_at', v_member.joined_at
            )
        );
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Record KB article helpful/not helpful
CREATE OR REPLACE FUNCTION record_kb_feedback(
    p_article_id UUID,
    p_helpful BOOLEAN
)
RETURNS BOOLEAN AS $$
BEGIN
    IF p_helpful THEN
        UPDATE knowledgebase_articles
        SET helpful_count = helpful_count + 1,
            view_count = view_count + 1
        WHERE id = p_article_id;
    ELSE
        UPDATE knowledgebase_articles
        SET not_helpful_count = not_helpful_count + 1,
            view_count = view_count + 1
        WHERE id = p_article_id;
    END IF;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Record FAQ helpful/not helpful
CREATE OR REPLACE FUNCTION record_faq_feedback(
    p_faq_id UUID,
    p_helpful BOOLEAN
)
RETURNS BOOLEAN AS $$
BEGIN
    IF p_helpful THEN
        UPDATE faq_items
        SET times_helpful = times_helpful + 1,
            times_shown = times_shown + 1
        WHERE id = p_faq_id;
    ELSE
        UPDATE faq_items
        SET times_not_helpful = times_not_helpful + 1,
            times_shown = times_shown + 1
        WHERE id = p_faq_id;
    END IF;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create default support settings when app is created
CREATE OR REPLACE FUNCTION create_default_support_settings()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO support_settings (app_id, organization_id)
    VALUES (NEW.id, NEW.organization_id)
    ON CONFLICT (app_id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to create default support settings
DROP TRIGGER IF EXISTS create_support_settings_trigger ON customer_apps;
CREATE TRIGGER create_support_settings_trigger
    AFTER INSERT ON customer_apps
    FOR EACH ROW
    EXECUTE FUNCTION create_default_support_settings();

-- Update ticket timestamps
CREATE OR REPLACE FUNCTION update_ticket_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();

    -- Track first response time
    IF OLD.first_response_at IS NULL AND NEW.status = 'awaiting_response' THEN
        NEW.first_response_at := NOW();
    END IF;

    -- Track resolution time
    IF OLD.status != 'resolved' AND NEW.status = 'resolved' THEN
        NEW.resolved_at := NOW();
    END IF;

    -- Track closed time
    IF OLD.status != 'closed' AND NEW.status = 'closed' THEN
        NEW.closed_at := NOW();
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_ticket_timestamps_trigger ON support_tickets;
CREATE TRIGGER update_ticket_timestamps_trigger
    BEFORE UPDATE ON support_tickets
    FOR EACH ROW
    EXECUTE FUNCTION update_ticket_timestamps();

-- =====================================================
-- 10. GRANT PERMISSIONS
-- =====================================================

GRANT EXECUTE ON FUNCTION create_support_ticket TO anon, authenticated;
GRANT EXECUTE ON FUNCTION search_knowledgebase TO anon, authenticated;
GRANT EXECUTE ON FUNCTION search_faqs TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_support_stats TO authenticated;
GRANT EXECUTE ON FUNCTION get_ai_support_context TO anon, authenticated;
GRANT EXECUTE ON FUNCTION record_kb_feedback TO anon, authenticated;
GRANT EXECUTE ON FUNCTION record_faq_feedback TO anon, authenticated;

-- =====================================================
-- DONE! Run this migration in Supabase SQL Editor
-- =====================================================
