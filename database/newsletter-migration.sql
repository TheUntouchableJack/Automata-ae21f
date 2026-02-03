-- =====================================================
-- NEWSLETTER APP MIGRATION
-- Run this in Supabase SQL Editor
-- Creates tables for newsletter/blogger app functionality
-- =====================================================

-- =====================================================
-- 1. ADD 'newsletter' TO APP TYPE (if enum exists)
-- =====================================================

-- Note: If app_type is stored as TEXT, skip this
-- ALTER TYPE app_type ADD VALUE IF NOT EXISTS 'newsletter';

-- =====================================================
-- 2. ARTICLE SERIES TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS article_series (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,

    -- Content
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    cover_image_url TEXT,

    -- SEO
    meta_title TEXT,
    meta_description TEXT,

    -- Status
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
    article_count INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    UNIQUE(app_id, slug)
);

-- Enable RLS
ALTER TABLE article_series ENABLE ROW LEVEL SECURITY;

-- RLS Policies for article_series
CREATE POLICY "Users can view series for their org apps" ON article_series
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = article_series.app_id
            AND om.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage series for their org apps" ON article_series
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = article_series.app_id
            AND om.user_id = auth.uid()
        )
    );

-- Public can view published series
CREATE POLICY "Public can view active series" ON article_series
    FOR SELECT USING (
        status = 'active'
        AND deleted_at IS NULL
        AND EXISTS (
            SELECT 1 FROM customer_apps ca
            WHERE ca.id = article_series.app_id
            AND ca.is_published = true
            AND ca.deleted_at IS NULL
        )
    );

-- =====================================================
-- 3. NEWSLETTER ARTICLES TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS newsletter_articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,
    automation_id UUID REFERENCES automations(id) ON DELETE SET NULL,

    -- Content
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    excerpt TEXT,
    content TEXT NOT NULL,
    content_html TEXT,

    -- SEO
    meta_title TEXT,
    meta_description TEXT,
    canonical_url TEXT,
    og_image_url TEXT,
    schema_json JSONB,

    -- Categorization
    primary_topic TEXT,
    tags TEXT[] DEFAULT '{}',
    series_id UUID REFERENCES article_series(id) ON DELETE SET NULL,
    series_order INTEGER,

    -- Interlinking
    related_article_ids UUID[] DEFAULT '{}',
    auto_related_ids UUID[] DEFAULT '{}',
    internal_links JSONB DEFAULT '[]',

    -- Publishing
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'published', 'archived')),
    language TEXT DEFAULT 'en',
    is_primary_language BOOLEAN DEFAULT true,
    primary_article_id UUID REFERENCES newsletter_articles(id) ON DELETE SET NULL,

    -- Timestamps
    published_at TIMESTAMPTZ,
    scheduled_for TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    -- Author tracking
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id),

    UNIQUE(app_id, slug, language)
);

-- Enable RLS
ALTER TABLE newsletter_articles ENABLE ROW LEVEL SECURITY;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_newsletter_articles_published
    ON newsletter_articles(app_id, status, language, published_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_newsletter_articles_slug
    ON newsletter_articles(app_id, slug, language)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_newsletter_articles_series
    ON newsletter_articles(series_id, series_order)
    WHERE series_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_newsletter_articles_topic
    ON newsletter_articles(app_id, primary_topic)
    WHERE status = 'published' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_newsletter_articles_primary
    ON newsletter_articles(primary_article_id)
    WHERE primary_article_id IS NOT NULL;

-- RLS Policies for newsletter_articles
CREATE POLICY "Users can view articles for their org apps" ON newsletter_articles
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = newsletter_articles.app_id
            AND om.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage articles for their org apps" ON newsletter_articles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = newsletter_articles.app_id
            AND om.user_id = auth.uid()
        )
    );

-- Public can view published articles
CREATE POLICY "Public can view published articles" ON newsletter_articles
    FOR SELECT USING (
        status = 'published'
        AND deleted_at IS NULL
        AND EXISTS (
            SELECT 1 FROM customer_apps ca
            WHERE ca.id = newsletter_articles.app_id
            AND ca.is_published = true
            AND ca.deleted_at IS NULL
        )
    );

-- =====================================================
-- 4. NEWSLETTER SUBSCRIBERS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,

    -- Contact
    email TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,

    -- Preferences
    preferred_language TEXT DEFAULT 'en',
    frequency_preference TEXT DEFAULT 'all' CHECK (frequency_preference IN ('all', 'weekly_digest', 'monthly_digest')),
    topic_preferences TEXT[] DEFAULT '{}',

    -- Status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'unsubscribed', 'bounced', 'complained')),
    confirmed_at TIMESTAMPTZ,
    unsubscribed_at TIMESTAMPTZ,
    unsubscribe_reason TEXT,

    -- Tracking
    source TEXT,
    referrer_id UUID REFERENCES newsletter_subscribers(id),
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,

    -- Engagement metrics
    emails_sent INTEGER DEFAULT 0,
    emails_opened INTEGER DEFAULT 0,
    emails_clicked INTEGER DEFAULT 0,
    last_email_at TIMESTAMPTZ,
    last_opened_at TIMESTAMPTZ,
    last_clicked_at TIMESTAMPTZ,

    -- Compliance
    ip_address INET,
    user_agent TEXT,
    consent_text TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    -- Confirmation token
    confirmation_token TEXT,
    confirmation_expires_at TIMESTAMPTZ,

    UNIQUE(app_id, email)
);

-- Enable RLS
ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_active
    ON newsletter_subscribers(app_id, status)
    WHERE status = 'active' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_email
    ON newsletter_subscribers(app_id, email)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_confirmation
    ON newsletter_subscribers(confirmation_token)
    WHERE confirmation_token IS NOT NULL;

-- RLS Policies for newsletter_subscribers
CREATE POLICY "Users can view subscribers for their org apps" ON newsletter_subscribers
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = newsletter_subscribers.app_id
            AND om.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage subscribers for their org apps" ON newsletter_subscribers
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = newsletter_subscribers.app_id
            AND om.user_id = auth.uid()
        )
    );

-- =====================================================
-- 5. EMAIL CAMPAIGNS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS email_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,
    article_id UUID REFERENCES newsletter_articles(id) ON DELETE SET NULL,

    -- Content
    subject TEXT NOT NULL,
    preview_text TEXT,
    body_html TEXT NOT NULL,
    body_text TEXT,

    -- Targeting
    target_languages TEXT[] DEFAULT '{}',
    target_topics TEXT[] DEFAULT '{}',

    -- Status
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled')),
    scheduled_for TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,

    -- Stats
    recipients_count INTEGER DEFAULT 0,
    delivered_count INTEGER DEFAULT 0,
    opened_count INTEGER DEFAULT 0,
    clicked_count INTEGER DEFAULT 0,
    unsubscribed_count INTEGER DEFAULT 0,
    bounced_count INTEGER DEFAULT 0,
    complained_count INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Author tracking
    created_by UUID REFERENCES auth.users(id),
    sent_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view campaigns for their org apps" ON email_campaigns
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = email_campaigns.app_id
            AND om.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage campaigns for their org apps" ON email_campaigns
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = email_campaigns.app_id
            AND om.user_id = auth.uid()
        )
    );

-- =====================================================
-- 6. CUSTOM APP REQUESTS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS custom_app_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

    -- Contact
    email TEXT NOT NULL,
    name TEXT,

    -- Request details
    description TEXT NOT NULL,
    use_case TEXT,
    industry TEXT,

    -- Status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'approved', 'declined', 'completed')),
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES auth.users(id),
    review_notes TEXT,

    -- Metadata
    source TEXT,
    source_article_id UUID REFERENCES newsletter_articles(id),

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE custom_app_requests ENABLE ROW LEVEL SECURITY;

-- Admins can view all requests
CREATE POLICY "Admins can view all custom requests" ON custom_app_requests
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid() AND p.is_admin = true
        )
    );

-- Anyone can insert (public form)
CREATE POLICY "Anyone can submit custom requests" ON custom_app_requests
    FOR INSERT WITH CHECK (true);

-- Admins can manage
CREATE POLICY "Admins can manage custom requests" ON custom_app_requests
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid() AND p.is_admin = true
        )
    );

-- =====================================================
-- 7. RPC FUNCTIONS
-- =====================================================

-- Subscribe to newsletter (public, rate limited)
CREATE OR REPLACE FUNCTION subscribe_to_newsletter(
    p_app_id UUID,
    p_email TEXT,
    p_first_name TEXT DEFAULT NULL,
    p_last_name TEXT DEFAULT NULL,
    p_preferred_language TEXT DEFAULT 'en',
    p_source TEXT DEFAULT 'signup_form',
    p_utm_source TEXT DEFAULT NULL,
    p_utm_medium TEXT DEFAULT NULL,
    p_utm_campaign TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_app customer_apps%ROWTYPE;
    v_existing newsletter_subscribers%ROWTYPE;
    v_subscriber newsletter_subscribers%ROWTYPE;
    v_token TEXT;
    v_is_allowed BOOLEAN;
BEGIN
    -- Validate email format
    IF p_email IS NULL OR p_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Invalid email address'
        );
    END IF;

    -- Rate limit: 10 signups per hour per email
    v_is_allowed := check_and_record_rate_limit(
        LOWER(p_email),
        'newsletter_subscribe',
        10,
        60
    );

    IF NOT v_is_allowed THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Too many attempts. Please try again later.'
        );
    END IF;

    -- Check app exists and is published
    SELECT * INTO v_app
    FROM customer_apps
    WHERE id = p_app_id
      AND is_published = true
      AND deleted_at IS NULL;

    IF v_app.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Newsletter not found'
        );
    END IF;

    -- Check for existing subscription
    SELECT * INTO v_existing
    FROM newsletter_subscribers
    WHERE app_id = p_app_id
      AND LOWER(email) = LOWER(p_email)
      AND deleted_at IS NULL;

    IF v_existing.id IS NOT NULL THEN
        -- Already exists
        IF v_existing.status = 'active' THEN
            RETURN jsonb_build_object(
                'success', false,
                'error_message', 'This email is already subscribed'
            );
        ELSIF v_existing.status = 'unsubscribed' THEN
            -- Allow re-subscription
            v_token := encode(gen_random_bytes(32), 'hex');

            UPDATE newsletter_subscribers
            SET status = 'pending',
                confirmation_token = v_token,
                confirmation_expires_at = NOW() + INTERVAL '24 hours',
                unsubscribed_at = NULL,
                unsubscribe_reason = NULL,
                updated_at = NOW()
            WHERE id = v_existing.id;

            RETURN jsonb_build_object(
                'success', true,
                'message', 'Please check your email to confirm your subscription',
                'confirmation_token', v_token,
                'subscriber_id', v_existing.id
            );
        ELSE
            -- Pending - resend confirmation
            v_token := encode(gen_random_bytes(32), 'hex');

            UPDATE newsletter_subscribers
            SET confirmation_token = v_token,
                confirmation_expires_at = NOW() + INTERVAL '24 hours',
                updated_at = NOW()
            WHERE id = v_existing.id;

            RETURN jsonb_build_object(
                'success', true,
                'message', 'Confirmation email resent',
                'confirmation_token', v_token,
                'subscriber_id', v_existing.id
            );
        END IF;
    END IF;

    -- Generate confirmation token
    v_token := encode(gen_random_bytes(32), 'hex');

    -- Create new subscriber
    INSERT INTO newsletter_subscribers (
        app_id,
        email,
        first_name,
        last_name,
        preferred_language,
        source,
        utm_source,
        utm_medium,
        utm_campaign,
        confirmation_token,
        confirmation_expires_at
    ) VALUES (
        p_app_id,
        LOWER(p_email),
        p_first_name,
        p_last_name,
        p_preferred_language,
        p_source,
        p_utm_source,
        p_utm_medium,
        p_utm_campaign,
        v_token,
        NOW() + INTERVAL '24 hours'
    )
    RETURNING * INTO v_subscriber;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Please check your email to confirm your subscription',
        'confirmation_token', v_token,
        'subscriber_id', v_subscriber.id
    );
END;
$$;

-- Confirm newsletter subscription
CREATE OR REPLACE FUNCTION confirm_newsletter_subscription(
    p_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_subscriber newsletter_subscribers%ROWTYPE;
BEGIN
    -- Find subscriber by token
    SELECT * INTO v_subscriber
    FROM newsletter_subscribers
    WHERE confirmation_token = p_token
      AND deleted_at IS NULL;

    IF v_subscriber.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Invalid confirmation link'
        );
    END IF;

    -- Check expiry
    IF v_subscriber.confirmation_expires_at < NOW() THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Confirmation link has expired. Please subscribe again.'
        );
    END IF;

    -- Already confirmed
    IF v_subscriber.status = 'active' THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Your subscription is already confirmed'
        );
    END IF;

    -- Confirm subscription
    UPDATE newsletter_subscribers
    SET status = 'active',
        confirmed_at = NOW(),
        confirmation_token = NULL,
        confirmation_expires_at = NULL,
        updated_at = NOW()
    WHERE id = v_subscriber.id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Your subscription has been confirmed!'
    );
END;
$$;

-- Get published articles with interlinking
CREATE OR REPLACE FUNCTION get_published_articles(
    p_app_id UUID,
    p_language TEXT DEFAULT 'en',
    p_topic TEXT DEFAULT NULL,
    p_series_id UUID DEFAULT NULL,
    p_limit INTEGER DEFAULT 20,
    p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_articles JSONB;
    v_total INTEGER;
BEGIN
    -- Get total count
    SELECT COUNT(*) INTO v_total
    FROM newsletter_articles
    WHERE app_id = p_app_id
      AND language = p_language
      AND status = 'published'
      AND deleted_at IS NULL
      AND (p_topic IS NULL OR primary_topic = p_topic)
      AND (p_series_id IS NULL OR series_id = p_series_id);

    -- Get articles
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', a.id,
            'title', a.title,
            'slug', a.slug,
            'excerpt', a.excerpt,
            'og_image_url', a.og_image_url,
            'primary_topic', a.primary_topic,
            'tags', a.tags,
            'published_at', a.published_at,
            'series', CASE WHEN a.series_id IS NOT NULL THEN
                jsonb_build_object(
                    'id', s.id,
                    'title', s.title,
                    'slug', s.slug,
                    'order', a.series_order
                )
            ELSE NULL END
        ) ORDER BY a.published_at DESC
    ) INTO v_articles
    FROM newsletter_articles a
    LEFT JOIN article_series s ON a.series_id = s.id
    WHERE a.app_id = p_app_id
      AND a.language = p_language
      AND a.status = 'published'
      AND a.deleted_at IS NULL
      AND (p_topic IS NULL OR a.primary_topic = p_topic)
      AND (p_series_id IS NULL OR a.series_id = p_series_id)
    LIMIT p_limit
    OFFSET p_offset;

    RETURN jsonb_build_object(
        'articles', COALESCE(v_articles, '[]'::jsonb),
        'total', v_total,
        'limit', p_limit,
        'offset', p_offset
    );
END;
$$;

-- Get article by slug with related content
CREATE OR REPLACE FUNCTION get_article_by_slug(
    p_app_id UUID,
    p_slug TEXT,
    p_language TEXT DEFAULT 'en'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_article newsletter_articles%ROWTYPE;
    v_result JSONB;
    v_series JSONB;
    v_prev_in_series JSONB;
    v_next_in_series JSONB;
    v_related JSONB;
    v_translations JSONB;
BEGIN
    -- Get article
    SELECT * INTO v_article
    FROM newsletter_articles
    WHERE app_id = p_app_id
      AND slug = p_slug
      AND language = p_language
      AND status = 'published'
      AND deleted_at IS NULL;

    IF v_article.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_message', 'Article not found'
        );
    END IF;

    -- Get series info if part of series
    IF v_article.series_id IS NOT NULL THEN
        SELECT jsonb_build_object(
            'id', s.id,
            'title', s.title,
            'slug', s.slug,
            'article_count', s.article_count
        ) INTO v_series
        FROM article_series s
        WHERE s.id = v_article.series_id;

        -- Get prev/next in series
        SELECT jsonb_build_object(
            'title', title,
            'slug', slug
        ) INTO v_prev_in_series
        FROM newsletter_articles
        WHERE series_id = v_article.series_id
          AND series_order = v_article.series_order - 1
          AND language = p_language
          AND status = 'published'
          AND deleted_at IS NULL;

        SELECT jsonb_build_object(
            'title', title,
            'slug', slug
        ) INTO v_next_in_series
        FROM newsletter_articles
        WHERE series_id = v_article.series_id
          AND series_order = v_article.series_order + 1
          AND language = p_language
          AND status = 'published'
          AND deleted_at IS NULL;
    END IF;

    -- Get related articles
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', a.id,
            'title', a.title,
            'slug', a.slug,
            'excerpt', a.excerpt,
            'og_image_url', a.og_image_url
        )
    ) INTO v_related
    FROM newsletter_articles a
    WHERE a.app_id = p_app_id
      AND a.language = p_language
      AND a.status = 'published'
      AND a.deleted_at IS NULL
      AND a.id != v_article.id
      AND (
          a.id = ANY(v_article.related_article_ids)
          OR a.primary_topic = v_article.primary_topic
          OR a.tags && v_article.tags
      )
    LIMIT 5;

    -- Get translations
    SELECT jsonb_agg(
        jsonb_build_object(
            'language', a.language,
            'slug', a.slug,
            'title', a.title
        )
    ) INTO v_translations
    FROM newsletter_articles a
    WHERE a.status = 'published'
      AND a.deleted_at IS NULL
      AND (
          (v_article.is_primary_language AND a.primary_article_id = v_article.id)
          OR (NOT v_article.is_primary_language AND (a.id = v_article.primary_article_id OR a.primary_article_id = v_article.primary_article_id))
      )
      AND a.id != v_article.id;

    -- Build result
    v_result := jsonb_build_object(
        'success', true,
        'article', jsonb_build_object(
            'id', v_article.id,
            'title', v_article.title,
            'slug', v_article.slug,
            'excerpt', v_article.excerpt,
            'content', v_article.content,
            'content_html', v_article.content_html,
            'meta_title', v_article.meta_title,
            'meta_description', v_article.meta_description,
            'canonical_url', v_article.canonical_url,
            'og_image_url', v_article.og_image_url,
            'schema_json', v_article.schema_json,
            'primary_topic', v_article.primary_topic,
            'tags', v_article.tags,
            'language', v_article.language,
            'published_at', v_article.published_at,
            'updated_at', v_article.updated_at
        ),
        'series', v_series,
        'prev_in_series', v_prev_in_series,
        'next_in_series', v_next_in_series,
        'related', COALESCE(v_related, '[]'::jsonb),
        'translations', COALESCE(v_translations, '[]'::jsonb)
    );

    RETURN v_result;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION subscribe_to_newsletter TO anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_newsletter_subscription TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_published_articles TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_article_by_slug TO anon, authenticated;

-- =====================================================
-- 8. UPDATE TRIGGERS
-- =====================================================

-- Update series article count when articles change
CREATE OR REPLACE FUNCTION update_series_article_count()
RETURNS TRIGGER AS $$
BEGIN
    -- Update old series count (if series changed)
    IF TG_OP = 'UPDATE' AND OLD.series_id IS NOT NULL AND OLD.series_id != COALESCE(NEW.series_id, OLD.series_id) THEN
        UPDATE article_series
        SET article_count = (
            SELECT COUNT(*) FROM newsletter_articles
            WHERE series_id = OLD.series_id
            AND status = 'published'
            AND deleted_at IS NULL
        )
        WHERE id = OLD.series_id;
    END IF;

    -- Update new series count
    IF NEW.series_id IS NOT NULL THEN
        UPDATE article_series
        SET article_count = (
            SELECT COUNT(*) FROM newsletter_articles
            WHERE series_id = NEW.series_id
            AND status = 'published'
            AND deleted_at IS NULL
        )
        WHERE id = NEW.series_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_series_count
AFTER INSERT OR UPDATE OR DELETE ON newsletter_articles
FOR EACH ROW
EXECUTE FUNCTION update_series_article_count();

-- Auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_newsletter_articles_updated_at
BEFORE UPDATE ON newsletter_articles
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_article_series_updated_at
BEFORE UPDATE ON article_series
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_newsletter_subscribers_updated_at
BEFORE UPDATE ON newsletter_subscribers
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

-- =====================================================
-- DONE! Newsletter tables and functions are ready.
-- =====================================================
