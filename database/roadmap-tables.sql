-- =====================================================
-- ROADMAP FEATURE TABLES
-- Copy and paste this entire file into Supabase SQL Editor
-- =====================================================

-- 1. ROADMAP ITEMS TABLE
CREATE TABLE IF NOT EXISTS roadmap_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'feature',
    status TEXT NOT NULL DEFAULT 'ideas',
    is_public BOOLEAN DEFAULT false,
    votes INTEGER DEFAULT 0,
    display_order INTEGER DEFAULT 0,
    deployed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE roadmap_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_roadmap_items_status ON roadmap_items(status);
CREATE INDEX IF NOT EXISTS idx_roadmap_items_is_public ON roadmap_items(is_public);

CREATE POLICY "Public can view public roadmap items" ON roadmap_items
    FOR SELECT USING (is_public = true);

CREATE POLICY "Admins can view all roadmap items" ON roadmap_items
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
    );

CREATE POLICY "Admins can create roadmap items" ON roadmap_items
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
    );

CREATE POLICY "Admins can update roadmap items" ON roadmap_items
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
    );

CREATE POLICY "Admins can delete roadmap items" ON roadmap_items
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
    );

-- 2. FEATURE REQUESTS TABLE
CREATE TABLE IF NOT EXISTS feature_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'feature',
    email TEXT,
    submitted_by UUID REFERENCES profiles(id),
    status TEXT DEFAULT 'pending',
    admin_notes TEXT,
    converted_to_roadmap_id UUID REFERENCES roadmap_items(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE feature_requests ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_feature_requests_status ON feature_requests(status);

CREATE POLICY "Anyone can submit feature requests" ON feature_requests
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can view own feature requests" ON feature_requests
    FOR SELECT USING (submitted_by = auth.uid());

CREATE POLICY "Admins can view all feature requests" ON feature_requests
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
    );

CREATE POLICY "Admins can update feature requests" ON feature_requests
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
    );

-- 3. ROADMAP VOTES TABLE
CREATE TABLE IF NOT EXISTS roadmap_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    roadmap_item_id UUID NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(id),
    session_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(roadmap_item_id, user_id),
    UNIQUE(roadmap_item_id, session_id)
);

ALTER TABLE roadmap_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can create votes" ON roadmap_votes FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can view own votes" ON roadmap_votes FOR SELECT USING (user_id = auth.uid() OR user_id IS NULL);
CREATE POLICY "Users can delete own votes" ON roadmap_votes FOR DELETE USING (user_id = auth.uid());

-- 4. APP SETTINGS TABLE
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view settings" ON app_settings
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
    );

INSERT INTO app_settings (key, value, description) VALUES
    ('notification_webhook_url', '""'::jsonb, 'Webhook URL for notifications')
ON CONFLICT (key) DO NOTHING;

-- 5. SAMPLE ROADMAP DATA (optional - delete if you want empty board)
INSERT INTO roadmap_items (title, description, category, status, is_public, votes) VALUES
    ('Twilio SMS Integration', 'Send automated SMS messages through Twilio', 'integration', 'ideas', true, 24),
    ('Customer Segmentation', 'Create dynamic customer segments', 'feature', 'ideas', true, 18),
    ('Zapier Integration', 'Connect with 5,000+ apps', 'integration', 'ideas', true, 15),
    ('Email Template Builder', 'Drag-and-drop email builder', 'improvement', 'in_progress', true, 0),
    ('AI-Powered Onboarding', 'Smart onboarding recommendations', 'feature', 'deployed', true, 0),
    ('Multi-Language Support', '8 language localization', 'improvement', 'deployed', true, 0);

-- 6. MAKE YOURSELF AN ADMIN (replace with your email!)
-- UPDATE profiles SET is_admin = true WHERE email = 'your@email.com';

-- Done! Refresh roadmap page after running this.
