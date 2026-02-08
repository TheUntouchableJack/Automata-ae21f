-- =====================================================
-- SUPABASE PERFORMANCE FIXES
-- RLS Policy Optimization + Missing Indexes
-- Fixes ~225 performance linter warnings
-- Run after supabase-security-views-functions.sql
-- =====================================================

-- =====================================================
-- SECTION D: RLS POLICY OPTIMIZATION
-- Change auth.uid() -> (SELECT auth.uid()) for once-per-query evaluation
-- This prevents re-evaluation per row, yielding 10-100x faster queries
-- =====================================================


-- =====================================================
-- Table: profiles
-- Source: schema.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile" ON profiles
    FOR SELECT USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING ((SELECT auth.uid()) = id);


-- =====================================================
-- Table: organizations
-- Source: schema.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view their organizations" ON organizations;
CREATE POLICY "Users can view their organizations" ON organizations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = organizations.id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Org owners can update their organization" ON organizations;
CREATE POLICY "Org owners can update their organization" ON organizations
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = organizations.id
            AND organization_members.user_id = (SELECT auth.uid())
            AND organization_members.role = 'owner'
        )
    );


-- =====================================================
-- Table: organization_members
-- Source: schema.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view their org memberships" ON organization_members;
CREATE POLICY "Users can view their org memberships" ON organization_members
    FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view members of their orgs" ON organization_members;
CREATE POLICY "Users can view members of their orgs" ON organization_members
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = organization_members.organization_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: projects
-- Source: schema.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view org projects" ON projects;
CREATE POLICY "Users can view org projects" ON projects
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = projects.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can create org projects" ON projects;
CREATE POLICY "Users can create org projects" ON projects
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = projects.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can update org projects" ON projects;
CREATE POLICY "Users can update org projects" ON projects
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = projects.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can delete org projects" ON projects;
CREATE POLICY "Users can delete org projects" ON projects
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = projects.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
            AND organization_members.role IN ('owner', 'admin')
        )
    );


-- =====================================================
-- Table: automations
-- Source: migration_preserve_automations.sql (supersedes schema.sql)
-- =====================================================

DROP POLICY IF EXISTS "Users can view org automations" ON automations;
CREATE POLICY "Users can view org automations" ON automations
    FOR SELECT USING (
        deleted_at IS NULL
        AND (
            EXISTS (
                SELECT 1 FROM projects
                JOIN organization_members ON organization_members.organization_id = projects.organization_id
                WHERE projects.id = automations.project_id
                AND organization_members.user_id = (SELECT auth.uid())
            )
            OR
            EXISTS (
                SELECT 1 FROM organization_members
                WHERE organization_members.organization_id = automations.organization_id
                AND organization_members.user_id = (SELECT auth.uid())
            )
        )
    );

DROP POLICY IF EXISTS "Users can create org automations" ON automations;
CREATE POLICY "Users can create org automations" ON automations
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE projects.id = automations.project_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can update org automations" ON automations;
CREATE POLICY "Users can update org automations" ON automations
    FOR UPDATE USING (
        deleted_at IS NULL
        AND EXISTS (
            SELECT 1 FROM projects
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE projects.id = automations.project_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can soft delete org automations" ON automations;
CREATE POLICY "Users can soft delete org automations" ON automations
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM projects
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE projects.id = automations.project_id
            AND organization_members.user_id = (SELECT auth.uid())
            AND organization_members.role IN ('owner', 'admin')
        )
    );

DROP POLICY IF EXISTS "Super admins can view all automations" ON automations;
CREATE POLICY "Super admins can view all automations" ON automations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = (SELECT auth.uid())
            AND profiles.is_admin = true
        )
    );

DROP POLICY IF EXISTS "Super admins can update all automations" ON automations;
CREATE POLICY "Super admins can update all automations" ON automations
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = (SELECT auth.uid())
            AND profiles.is_admin = true
        )
    );

DROP POLICY IF EXISTS "Super admins can delete automations" ON automations;
CREATE POLICY "Super admins can delete automations" ON automations
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = (SELECT auth.uid())
            AND profiles.is_admin = true
        )
    );


-- =====================================================
-- Table: blog_posts
-- Source: schema.sql
-- NOTE: "Public can view published posts" uses status='published' only, no auth.uid() -- SKIP
-- =====================================================

DROP POLICY IF EXISTS "Users can view org posts" ON blog_posts;
CREATE POLICY "Users can view org posts" ON blog_posts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM automations
            JOIN projects ON projects.id = automations.project_id
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE automations.id = blog_posts.automation_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can create org posts" ON blog_posts;
CREATE POLICY "Users can create org posts" ON blog_posts
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM automations
            JOIN projects ON projects.id = automations.project_id
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE automations.id = blog_posts.automation_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can update org posts" ON blog_posts;
CREATE POLICY "Users can update org posts" ON blog_posts
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM automations
            JOIN projects ON projects.id = automations.project_id
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE automations.id = blog_posts.automation_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can delete org posts" ON blog_posts;
CREATE POLICY "Users can delete org posts" ON blog_posts
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM automations
            JOIN projects ON projects.id = automations.project_id
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE automations.id = blog_posts.automation_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: custom_fields
-- Source: schema.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view org custom fields" ON custom_fields;
CREATE POLICY "Users can view org custom fields" ON custom_fields
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = custom_fields.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can create org custom fields" ON custom_fields;
CREATE POLICY "Users can create org custom fields" ON custom_fields
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = custom_fields.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can update org custom fields" ON custom_fields;
CREATE POLICY "Users can update org custom fields" ON custom_fields
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = custom_fields.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can delete org custom fields" ON custom_fields;
CREATE POLICY "Users can delete org custom fields" ON custom_fields
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = custom_fields.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
            AND organization_members.role IN ('owner', 'admin')
        )
    );


-- =====================================================
-- Table: customers
-- Source: schema.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view org customers" ON customers;
CREATE POLICY "Users can view org customers" ON customers
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = customers.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can create org customers" ON customers;
CREATE POLICY "Users can create org customers" ON customers
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = customers.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can update org customers" ON customers;
CREATE POLICY "Users can update org customers" ON customers
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = customers.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can delete org customers" ON customers;
CREATE POLICY "Users can delete org customers" ON customers
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = customers.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
            AND organization_members.role IN ('owner', 'admin')
        )
    );


-- =====================================================
-- Table: project_customers
-- Source: schema.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view project customers" ON project_customers;
CREATE POLICY "Users can view project customers" ON project_customers
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM projects
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE projects.id = project_customers.project_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can add project customers" ON project_customers;
CREATE POLICY "Users can add project customers" ON project_customers
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE projects.id = project_customers.project_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can remove project customers" ON project_customers;
CREATE POLICY "Users can remove project customers" ON project_customers
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM projects
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE projects.id = project_customers.project_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: opportunities
-- Source: schema.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view project opportunities" ON opportunities;
CREATE POLICY "Users can view project opportunities" ON opportunities
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM projects
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE projects.id = opportunities.project_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can create project opportunities" ON opportunities;
CREATE POLICY "Users can create project opportunities" ON opportunities
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE projects.id = opportunities.project_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can update project opportunities" ON opportunities;
CREATE POLICY "Users can update project opportunities" ON opportunities
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM projects
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE projects.id = opportunities.project_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: csv_imports
-- Source: schema.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view org csv imports" ON csv_imports;
CREATE POLICY "Users can view org csv imports" ON csv_imports
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = csv_imports.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can create org csv imports" ON csv_imports;
CREATE POLICY "Users can create org csv imports" ON csv_imports
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = csv_imports.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: roadmap_items
-- Source: schema.sql
-- NOTE: "Public can view public roadmap items" uses is_public=true only -- SKIP
-- =====================================================

DROP POLICY IF EXISTS "Admins can view all roadmap items" ON roadmap_items;
CREATE POLICY "Admins can view all roadmap items" ON roadmap_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = (SELECT auth.uid())
            AND profiles.is_admin = true
        )
    );

DROP POLICY IF EXISTS "Admins can create roadmap items" ON roadmap_items;
CREATE POLICY "Admins can create roadmap items" ON roadmap_items
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = (SELECT auth.uid())
            AND profiles.is_admin = true
        )
    );

DROP POLICY IF EXISTS "Admins can update roadmap items" ON roadmap_items;
CREATE POLICY "Admins can update roadmap items" ON roadmap_items
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = (SELECT auth.uid())
            AND profiles.is_admin = true
        )
    );

DROP POLICY IF EXISTS "Admins can delete roadmap items" ON roadmap_items;
CREATE POLICY "Admins can delete roadmap items" ON roadmap_items
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = (SELECT auth.uid())
            AND profiles.is_admin = true
        )
    );


-- =====================================================
-- Table: feature_requests
-- Source: schema.sql
-- NOTE: "Anyone can submit feature requests" uses true only -- SKIP
-- =====================================================

DROP POLICY IF EXISTS "Users can view own feature requests" ON feature_requests;
CREATE POLICY "Users can view own feature requests" ON feature_requests
    FOR SELECT USING (
        submitted_by = (SELECT auth.uid())
    );

DROP POLICY IF EXISTS "Admins can view all feature requests" ON feature_requests;
CREATE POLICY "Admins can view all feature requests" ON feature_requests
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = (SELECT auth.uid())
            AND profiles.is_admin = true
        )
    );

DROP POLICY IF EXISTS "Admins can update feature requests" ON feature_requests;
CREATE POLICY "Admins can update feature requests" ON feature_requests
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = (SELECT auth.uid())
            AND profiles.is_admin = true
        )
    );

DROP POLICY IF EXISTS "Admins can delete feature requests" ON feature_requests;
CREATE POLICY "Admins can delete feature requests" ON feature_requests
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = (SELECT auth.uid())
            AND profiles.is_admin = true
        )
    );


-- =====================================================
-- Table: roadmap_votes
-- Source: schema.sql
-- NOTE: "Anyone can create votes" uses true only -- SKIP
-- =====================================================

DROP POLICY IF EXISTS "Users can view own votes" ON roadmap_votes;
CREATE POLICY "Users can view own votes" ON roadmap_votes
    FOR SELECT USING (
        user_id = (SELECT auth.uid()) OR user_id IS NULL
    );

DROP POLICY IF EXISTS "Users can delete own votes" ON roadmap_votes;
CREATE POLICY "Users can delete own votes" ON roadmap_votes
    FOR DELETE USING (
        user_id = (SELECT auth.uid())
    );


-- =====================================================
-- Table: app_settings
-- Source: schema.sql
-- =====================================================

DROP POLICY IF EXISTS "Admins can view settings" ON app_settings;
CREATE POLICY "Admins can view settings" ON app_settings
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = (SELECT auth.uid())
            AND profiles.is_admin = true
        )
    );

DROP POLICY IF EXISTS "Admins can update settings" ON app_settings;
CREATE POLICY "Admins can update settings" ON app_settings
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = (SELECT auth.uid())
            AND profiles.is_admin = true
        )
    );

DROP POLICY IF EXISTS "Admins can insert settings" ON app_settings;
CREATE POLICY "Admins can insert settings" ON app_settings
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = (SELECT auth.uid())
            AND profiles.is_admin = true
        )
    );


-- =====================================================
-- Table: customer_apps
-- Source: customer-apps-migration.sql
-- NOTE: "Public can view published apps" uses no auth.uid() -- SKIP
-- =====================================================

DROP POLICY IF EXISTS "Org members can manage apps" ON customer_apps;
CREATE POLICY "Org members can manage apps" ON customer_apps
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = customer_apps.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: app_members
-- Source: customer-apps-migration.sql
-- NOTE: "Public can join published apps" uses no auth.uid() -- SKIP
-- =====================================================

DROP POLICY IF EXISTS "Org can manage app members" ON app_members;
CREATE POLICY "Org can manage app members" ON app_members
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON om.organization_id = ca.organization_id
            WHERE ca.id = app_members.app_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: points_transactions
-- Source: customer-apps-migration.sql
-- =====================================================

DROP POLICY IF EXISTS "Org can manage points transactions" ON points_transactions;
CREATE POLICY "Org can manage points transactions" ON points_transactions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON om.organization_id = ca.organization_id
            WHERE ca.id = points_transactions.app_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: app_rewards
-- Source: customer-apps-migration.sql
-- NOTE: "Public can view active rewards" uses no auth.uid() -- SKIP
-- =====================================================

DROP POLICY IF EXISTS "Org can manage rewards" ON app_rewards;
CREATE POLICY "Org can manage rewards" ON app_rewards
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON om.organization_id = ca.organization_id
            WHERE ca.id = app_rewards.app_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: reward_redemptions
-- Source: customer-apps-migration.sql
-- =====================================================

DROP POLICY IF EXISTS "Org can manage redemptions" ON reward_redemptions;
CREATE POLICY "Org can manage redemptions" ON reward_redemptions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON om.organization_id = ca.organization_id
            WHERE ca.id = reward_redemptions.app_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: app_menu_items
-- Source: customer-apps-migration.sql
-- NOTE: "Public can view menu items" uses no auth.uid() -- SKIP
-- =====================================================

DROP POLICY IF EXISTS "Org can manage menu items" ON app_menu_items;
CREATE POLICY "Org can manage menu items" ON app_menu_items
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON om.organization_id = ca.organization_id
            WHERE ca.id = app_menu_items.app_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: app_announcements
-- Source: customer-apps-migration.sql
-- NOTE: "Public can view announcements" uses no auth.uid() -- SKIP
-- =====================================================

DROP POLICY IF EXISTS "Org can manage announcements" ON app_announcements;
CREATE POLICY "Org can manage announcements" ON app_announcements
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON om.organization_id = ca.organization_id
            WHERE ca.id = app_announcements.app_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: app_events
-- Source: customer-apps-migration.sql
-- =====================================================

DROP POLICY IF EXISTS "Org can manage app events" ON app_events;
CREATE POLICY "Org can manage app events" ON app_events
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON om.organization_id = ca.organization_id
            WHERE ca.id = app_events.app_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: support_tickets
-- Source: support-system-migration.sql
-- NOTE: "Anyone can create tickets via RPC" uses true only -- SKIP
-- =====================================================

DROP POLICY IF EXISTS "Org members can view support tickets" ON support_tickets;
CREATE POLICY "Org members can view support tickets" ON support_tickets
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = support_tickets.organization_id
            AND om.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Org members can manage support tickets" ON support_tickets;
CREATE POLICY "Org members can manage support tickets" ON support_tickets
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = support_tickets.organization_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: ticket_messages
-- Source: support-system-migration.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view ticket messages" ON ticket_messages;
CREATE POLICY "Users can view ticket messages" ON ticket_messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM support_tickets st
            JOIN organization_members om ON om.organization_id = st.organization_id
            WHERE st.id = ticket_messages.ticket_id
            AND om.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can create ticket messages" ON ticket_messages;
CREATE POLICY "Users can create ticket messages" ON ticket_messages
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM support_tickets st
            JOIN organization_members om ON om.organization_id = st.organization_id
            WHERE st.id = ticket_messages.ticket_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: knowledgebase_articles
-- Source: support-system-migration.sql
-- =====================================================

DROP POLICY IF EXISTS "Public can view published KB articles" ON knowledgebase_articles;
CREATE POLICY "Public can view published KB articles" ON knowledgebase_articles
    FOR SELECT USING (
        is_published = true
        OR EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = knowledgebase_articles.organization_id
            AND om.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Org members can manage KB articles" ON knowledgebase_articles;
CREATE POLICY "Org members can manage KB articles" ON knowledgebase_articles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = knowledgebase_articles.organization_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: faq_items
-- Source: support-system-migration.sql
-- =====================================================

DROP POLICY IF EXISTS "Public can view FAQs" ON faq_items;
CREATE POLICY "Public can view FAQs" ON faq_items
    FOR SELECT USING (
        is_active = true
        OR EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = faq_items.organization_id
            AND om.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Org members can manage FAQs" ON faq_items;
CREATE POLICY "Org members can manage FAQs" ON faq_items
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = faq_items.organization_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: ai_support_sessions
-- Source: support-system-migration.sql
-- NOTE: "Anyone can create AI sessions via RPC" uses true only -- SKIP
-- NOTE: "Anyone can update AI sessions via RPC" uses true only -- SKIP
-- =====================================================

DROP POLICY IF EXISTS "Org members can view AI sessions" ON ai_support_sessions;
CREATE POLICY "Org members can view AI sessions" ON ai_support_sessions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = ai_support_sessions.organization_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: ai_support_messages
-- Source: support-system-migration.sql
-- NOTE: "Anyone can create AI messages via RPC" uses true only -- SKIP
-- =====================================================

DROP POLICY IF EXISTS "Users can view AI messages" ON ai_support_messages;
CREATE POLICY "Users can view AI messages" ON ai_support_messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM ai_support_sessions ss
            JOIN organization_members om ON om.organization_id = ss.organization_id
            WHERE ss.id = ai_support_messages.session_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: support_settings
-- Source: support-system-migration.sql
-- =====================================================

DROP POLICY IF EXISTS "Org members can view support settings" ON support_settings;
CREATE POLICY "Org members can view support settings" ON support_settings
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = support_settings.organization_id
            AND om.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Org members can manage support settings" ON support_settings;
CREATE POLICY "Org members can manage support settings" ON support_settings
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = support_settings.organization_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: bug_reports
-- Source: support-system-migration.sql
-- NOTE: "Anyone can create bug reports via RPC" uses true only -- SKIP
-- =====================================================

DROP POLICY IF EXISTS "Org members can view bug reports" ON bug_reports;
CREATE POLICY "Org members can view bug reports" ON bug_reports
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = bug_reports.organization_id
            AND om.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Org members can manage bug reports" ON bug_reports;
CREATE POLICY "Org members can manage bug reports" ON bug_reports
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = bug_reports.organization_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: article_series
-- Source: newsletter-migration.sql
-- NOTE: "Public can view active series" uses no auth.uid() -- SKIP
-- =====================================================

DROP POLICY IF EXISTS "Users can view series for their org apps" ON article_series;
CREATE POLICY "Users can view series for their org apps" ON article_series
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = article_series.app_id
            AND om.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can manage series for their org apps" ON article_series;
CREATE POLICY "Users can manage series for their org apps" ON article_series
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = article_series.app_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: newsletter_articles
-- Source: newsletter-migration.sql
-- NOTE: "Public can view published articles" uses no auth.uid() -- SKIP
-- =====================================================

DROP POLICY IF EXISTS "Users can view articles for their org apps" ON newsletter_articles;
CREATE POLICY "Users can view articles for their org apps" ON newsletter_articles
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = newsletter_articles.app_id
            AND om.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can manage articles for their org apps" ON newsletter_articles;
CREATE POLICY "Users can manage articles for their org apps" ON newsletter_articles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = newsletter_articles.app_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: newsletter_subscribers
-- Source: newsletter-migration.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view subscribers for their org apps" ON newsletter_subscribers;
CREATE POLICY "Users can view subscribers for their org apps" ON newsletter_subscribers
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = newsletter_subscribers.app_id
            AND om.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can manage subscribers for their org apps" ON newsletter_subscribers;
CREATE POLICY "Users can manage subscribers for their org apps" ON newsletter_subscribers
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = newsletter_subscribers.app_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: email_campaigns
-- Source: newsletter-migration.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view campaigns for their org apps" ON email_campaigns;
CREATE POLICY "Users can view campaigns for their org apps" ON email_campaigns
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = email_campaigns.app_id
            AND om.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can manage campaigns for their org apps" ON email_campaigns;
CREATE POLICY "Users can manage campaigns for their org apps" ON email_campaigns
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = email_campaigns.app_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: custom_app_requests
-- Source: newsletter-migration.sql
-- NOTE: "Anyone can submit custom requests" uses true only -- SKIP
-- =====================================================

DROP POLICY IF EXISTS "Admins can view all custom requests" ON custom_app_requests;
CREATE POLICY "Admins can view all custom requests" ON custom_app_requests
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = (SELECT auth.uid()) AND p.is_admin = true
        )
    );

DROP POLICY IF EXISTS "Admins can manage custom requests" ON custom_app_requests;
CREATE POLICY "Admins can manage custom requests" ON custom_app_requests
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = (SELECT auth.uid()) AND p.is_admin = true
        )
    );


-- =====================================================
-- Table: owner_notifications
-- Source: escalation-notifications-migration.sql
-- NOTE: "System can create notifications" uses true only -- SKIP
-- =====================================================

DROP POLICY IF EXISTS "Org members can view notifications" ON owner_notifications;
CREATE POLICY "Org members can view notifications" ON owner_notifications
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = owner_notifications.organization_id
            AND om.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Org members can update notifications" ON owner_notifications;
CREATE POLICY "Org members can update notifications" ON owner_notifications
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = owner_notifications.organization_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: ai_recommendations
-- Source: ai-intelligence-migration.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view org recommendations" ON ai_recommendations;
CREATE POLICY "Users can view org recommendations" ON ai_recommendations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = ai_recommendations.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can create org recommendations" ON ai_recommendations;
CREATE POLICY "Users can create org recommendations" ON ai_recommendations
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = ai_recommendations.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can update org recommendations" ON ai_recommendations;
CREATE POLICY "Users can update org recommendations" ON ai_recommendations
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = ai_recommendations.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: ai_recommendation_outcomes
-- Source: ai-intelligence-migration.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view recommendation outcomes" ON ai_recommendation_outcomes;
CREATE POLICY "Users can view recommendation outcomes" ON ai_recommendation_outcomes
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM ai_recommendations ar
            JOIN organization_members om ON om.organization_id = ar.organization_id
            WHERE ar.id = ai_recommendation_outcomes.recommendation_id
            AND om.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can create recommendation outcomes" ON ai_recommendation_outcomes;
CREATE POLICY "Users can create recommendation outcomes" ON ai_recommendation_outcomes
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM ai_recommendations ar
            JOIN organization_members om ON om.organization_id = ar.organization_id
            WHERE ar.id = ai_recommendation_outcomes.recommendation_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: ai_analysis_history
-- Source: ai-intelligence-migration.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view org analysis history" ON ai_analysis_history;
CREATE POLICY "Users can view org analysis history" ON ai_analysis_history
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = ai_analysis_history.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can create org analysis history" ON ai_analysis_history;
CREATE POLICY "Users can create org analysis history" ON ai_analysis_history
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = ai_analysis_history.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: ai_actions_log
-- Source: ai-intelligence-migration.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view org ai actions" ON ai_actions_log;
CREATE POLICY "Users can view org ai actions" ON ai_actions_log
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = ai_actions_log.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: automated_campaigns
-- Source: ai-intelligence-migration.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view app campaigns" ON automated_campaigns;
CREATE POLICY "Users can view app campaigns" ON automated_campaigns
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON om.organization_id = ca.organization_id
            WHERE ca.id = automated_campaigns.app_id
            AND om.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can manage app campaigns" ON automated_campaigns;
CREATE POLICY "Users can manage app campaigns" ON automated_campaigns
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON om.organization_id = ca.organization_id
            WHERE ca.id = automated_campaigns.app_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: competitor_research
-- Source: content-engine-migration.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view research for their org" ON competitor_research;
CREATE POLICY "Users can view research for their org" ON competitor_research
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = competitor_research.organization_id
            AND om.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can manage research for their org" ON competitor_research;
CREATE POLICY "Users can manage research for their org" ON competitor_research
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = competitor_research.organization_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: content_strategies
-- Source: content-engine-migration.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view strategies for their org apps" ON content_strategies;
CREATE POLICY "Users can view strategies for their org apps" ON content_strategies
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = content_strategies.app_id
            AND om.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can manage strategies for their org apps" ON content_strategies;
CREATE POLICY "Users can manage strategies for their org apps" ON content_strategies
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = content_strategies.app_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: content_generation_log
-- Source: content-engine-migration.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view logs for their org apps" ON content_generation_log;
CREATE POLICY "Users can view logs for their org apps" ON content_generation_log
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = content_generation_log.app_id
            AND om.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can manage logs for their org apps" ON content_generation_log;
CREATE POLICY "Users can manage logs for their org apps" ON content_generation_log
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM customer_apps ca
            JOIN organization_members om ON ca.organization_id = om.organization_id
            WHERE ca.id = content_generation_log.app_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: appsumo_codes
-- Source: migration_appsumo_plans.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can verify their own codes" ON appsumo_codes;
CREATE POLICY "Users can verify their own codes" ON appsumo_codes
    FOR SELECT USING (
        redeemed_by_org_id IN (
            SELECT organization_id FROM organization_members
            WHERE user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: usage_tracking
-- Source: migration_appsumo_plans.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view org usage" ON usage_tracking;
CREATE POLICY "Users can view org usage" ON usage_tracking
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = usage_tracking.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can update org usage" ON usage_tracking;
CREATE POLICY "Users can update org usage" ON usage_tracking
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = usage_tracking.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can insert org usage" ON usage_tracking;
CREATE POLICY "Users can insert org usage" ON usage_tracking
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = usage_tracking.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: organization_invitations
-- Source: settings-migration.sql
-- NOTE: "Anyone can view invitations by token" uses true only -- SKIP
-- =====================================================

DROP POLICY IF EXISTS "Org admins can view invitations" ON organization_invitations;
CREATE POLICY "Org admins can view invitations" ON organization_invitations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = organization_invitations.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
            AND organization_members.role IN ('owner', 'admin')
        )
    );

DROP POLICY IF EXISTS "Org admins can create invitations" ON organization_invitations;
CREATE POLICY "Org admins can create invitations" ON organization_invitations
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = organization_invitations.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
            AND organization_members.role IN ('owner', 'admin')
        )
    );

DROP POLICY IF EXISTS "Org admins can update invitations" ON organization_invitations;
CREATE POLICY "Org admins can update invitations" ON organization_invitations
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = organization_invitations.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
            AND organization_members.role IN ('owner', 'admin')
        )
    );

DROP POLICY IF EXISTS "Org admins can delete invitations" ON organization_invitations;
CREATE POLICY "Org admins can delete invitations" ON organization_invitations
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = organization_invitations.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
            AND organization_members.role IN ('owner', 'admin')
        )
    );


-- =====================================================
-- Table: audit_logs
-- Source: audit-log-migration.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view own audit logs" ON audit_logs;
CREATE POLICY "Users can view own audit logs" ON audit_logs
    FOR SELECT USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins can view all org audit logs" ON audit_logs;
CREATE POLICY "Admins can view all org audit logs" ON audit_logs
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = audit_logs.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
            AND organization_members.role IN ('owner', 'admin')
        )
    );

DROP POLICY IF EXISTS "Org members can create audit logs" ON audit_logs;
CREATE POLICY "Org members can create audit logs" ON audit_logs
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = audit_logs.organization_id
            AND organization_members.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: content_calendars
-- Source: project-content-calendar-migration.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view calendars for their org" ON content_calendars;
CREATE POLICY "Users can view calendars for their org" ON content_calendars
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = content_calendars.organization_id
            AND om.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can manage calendars for their org" ON content_calendars;
CREATE POLICY "Users can manage calendars for their org" ON content_calendars
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = content_calendars.organization_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: content_posts
-- Source: project-content-calendar-migration.sql
-- =====================================================

DROP POLICY IF EXISTS "Users can view posts for their org" ON content_posts;
CREATE POLICY "Users can view posts for their org" ON content_posts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = content_posts.organization_id
            AND om.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can manage posts for their org" ON content_posts;
CREATE POLICY "Users can manage posts for their org" ON content_posts
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = content_posts.organization_id
            AND om.user_id = (SELECT auth.uid())
        )
    );


-- =====================================================
-- Table: storage.objects (avatars bucket)
-- Source: settings-migration.sql
-- NOTE: "Anyone can view avatars" uses bucket_id check only -- SKIP
-- =====================================================

DROP POLICY IF EXISTS "Users can upload own avatar" ON storage.objects;
CREATE POLICY "Users can upload own avatar" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'avatars' AND
        (SELECT auth.uid())::text = (storage.foldername(name))[1]
    );

DROP POLICY IF EXISTS "Users can update own avatar" ON storage.objects;
CREATE POLICY "Users can update own avatar" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'avatars' AND
        (SELECT auth.uid())::text = (storage.foldername(name))[1]
    );

DROP POLICY IF EXISTS "Users can delete own avatar" ON storage.objects;
CREATE POLICY "Users can delete own avatar" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'avatars' AND
        (SELECT auth.uid())::text = (storage.foldername(name))[1]
    );


-- =====================================================
-- SECTION E: MISSING FK INDEXES
-- Foreign key columns without indexes cause slow joins
-- =====================================================

-- High priority (frequently joined FK columns)
CREATE INDEX IF NOT EXISTS idx_app_events_automation_id ON app_events(automation_id);
CREATE INDEX IF NOT EXISTS idx_newsletter_articles_automation_id ON newsletter_articles(automation_id);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_article_id ON email_campaigns(article_id);
CREATE INDEX IF NOT EXISTS idx_bug_reports_member_id ON bug_reports(member_id);
CREATE INDEX IF NOT EXISTS idx_bug_reports_ticket_id ON bug_reports(ticket_id);
CREATE INDEX IF NOT EXISTS idx_app_members_referred_by ON app_members(referred_by);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned_to ON support_tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_ai_support_sessions_escalated_to_ticket_id ON ai_support_sessions(escalated_to_ticket_id);
CREATE INDEX IF NOT EXISTS idx_custom_app_requests_organization_id ON custom_app_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_referrer_id ON newsletter_subscribers(referrer_id);
CREATE INDEX IF NOT EXISTS idx_organization_invitations_invited_by ON organization_invitations(invited_by);
CREATE INDEX IF NOT EXISTS idx_appsumo_codes_redeemed_by_org_id ON appsumo_codes(redeemed_by_org_id);

-- Medium priority (created_by, updated_by, deleted_by columns)
CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by);
CREATE INDEX IF NOT EXISTS idx_automations_created_by ON automations(created_by);
CREATE INDEX IF NOT EXISTS idx_blog_posts_created_by ON blog_posts(created_by);
CREATE INDEX IF NOT EXISTS idx_customers_created_by ON customers(created_by);
CREATE INDEX IF NOT EXISTS idx_projects_deleted_by ON projects(deleted_by);
CREATE INDEX IF NOT EXISTS idx_automations_deleted_by ON automations(deleted_by);
CREATE INDEX IF NOT EXISTS idx_blog_posts_deleted_by ON blog_posts(deleted_by);
CREATE INDEX IF NOT EXISTS idx_customers_deleted_by ON customers(deleted_by);
CREATE INDEX IF NOT EXISTS idx_csv_imports_uploaded_by ON csv_imports(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_opportunities_created_by ON opportunities(created_by);
CREATE INDEX IF NOT EXISTS idx_roadmap_items_created_by ON roadmap_items(created_by);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_created_by ON email_campaigns(created_by);
CREATE INDEX IF NOT EXISTS idx_newsletter_articles_created_by ON newsletter_articles(created_by);
CREATE INDEX IF NOT EXISTS idx_article_series_created_by ON article_series(created_by);
CREATE INDEX IF NOT EXISTS idx_content_strategies_approved_by ON content_strategies(approved_by);
CREATE INDEX IF NOT EXISTS idx_content_generation_log_article_id ON content_generation_log(article_id);
CREATE INDEX IF NOT EXISTS idx_content_generation_log_strategy_id ON content_generation_log(strategy_id);
CREATE INDEX IF NOT EXISTS idx_ai_recommendations_created_by ON ai_recommendations(created_by);
CREATE INDEX IF NOT EXISTS idx_ai_recommendation_outcomes_acted_by ON ai_recommendation_outcomes(acted_by);
CREATE INDEX IF NOT EXISTS idx_owner_notifications_user_id ON owner_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_email_notification_queue_notification_id ON email_notification_queue(notification_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_member_id ON support_tickets(member_id);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_sender_id ON ticket_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_ai_support_messages_session_id ON ai_support_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_organization_id ON usage_tracking(organization_id);

-- Low priority (columns that may already have indexes or are less frequently joined)
CREATE INDEX IF NOT EXISTS idx_newsletter_articles_series_id ON newsletter_articles(series_id);
CREATE INDEX IF NOT EXISTS idx_roadmap_votes_user_id ON roadmap_votes(user_id);
CREATE INDEX IF NOT EXISTS idx_roadmap_votes_item_id ON roadmap_votes(item_id);
CREATE INDEX IF NOT EXISTS idx_feature_requests_project_id ON feature_requests(project_id);


-- =====================================================
-- SECTION F: COMPOSITE INDEXES
-- Optimized for common query patterns
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_member_visits_member_date ON member_visits(member_id, (visited_at::date));
CREATE INDEX IF NOT EXISTS idx_points_transactions_app_created ON points_transactions(app_id, created_at) WHERE points_change > 0;
CREATE INDEX IF NOT EXISTS idx_app_members_app_joined ON app_members(app_id, joined_at);
CREATE INDEX IF NOT EXISTS idx_app_members_app_last_login ON app_members(app_id, last_login_at);


-- =====================================================
-- DONE
-- =====================================================
SELECT 'Performance policies and indexes migration complete' as status;
