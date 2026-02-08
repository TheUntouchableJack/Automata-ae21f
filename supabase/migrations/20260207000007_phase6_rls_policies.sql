-- Migration: Phase 6 - RLS Policies for User Education Tables
-- Allows public read access to global FAQ, KB, and coaching content

-- ============================================================================
-- 1. Enable RLS on tables
-- ============================================================================

ALTER TABLE global_faq ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_kb ENABLE ROW LEVEL SECURITY;
ALTER TABLE coaching_triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_coaching_progress ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. Global FAQ Policies (public read access)
-- ============================================================================

-- Anyone can read active FAQs
CREATE POLICY "Public can read active FAQs" ON global_faq
    FOR SELECT
    USING (is_active = TRUE);

-- ============================================================================
-- 3. Global KB Policies (public read access)
-- ============================================================================

-- Anyone can read published articles
CREATE POLICY "Public can read published KB articles" ON global_kb
    FOR SELECT
    USING (is_published = TRUE);

-- ============================================================================
-- 4. Coaching Triggers Policies (public read access)
-- ============================================================================

-- Anyone can read active coaching triggers
CREATE POLICY "Public can read active coaching triggers" ON coaching_triggers
    FOR SELECT
    USING (is_active = TRUE);

-- ============================================================================
-- 5. User Coaching Progress Policies (user-specific access)
-- ============================================================================

-- Users can read their own coaching progress
CREATE POLICY "Users can read own coaching progress" ON user_coaching_progress
    FOR SELECT
    USING (user_id = auth.uid());

-- Users can insert their own coaching progress
CREATE POLICY "Users can insert own coaching progress" ON user_coaching_progress
    FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- Users can update their own coaching progress
CREATE POLICY "Users can update own coaching progress" ON user_coaching_progress
    FOR UPDATE
    USING (user_id = auth.uid());
