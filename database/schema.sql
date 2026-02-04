-- Royalty Database Schema
-- Run this in Supabase SQL Editor

-- =====================================================
-- 1. ORGANIZATIONS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    logo_url TEXT,
    settings JSONB DEFAULT '{}',
    searchable_name TEXT GENERATED ALWAYS AS (
        LOWER(COALESCE(name, '') || ' ' || COALESCE(slug, ''))
    ) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- Indexes for searching organizations
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_searchable ON organizations USING GIN (to_tsvector('english', searchable_name));

-- =====================================================
-- 2. PROFILES TABLE (extends auth.users)
-- =====================================================

CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    searchable_name TEXT GENERATED ALWAYS AS (
        LOWER(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '') || ' ' || email)
    ) STORED,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast user searching
CREATE INDEX IF NOT EXISTS idx_profiles_searchable_name ON profiles USING GIN (to_tsvector('english', searchable_name));

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

-- =====================================================
-- 3. ORGANIZATION MEMBERS TABLE (junction)
-- =====================================================

CREATE TABLE IF NOT EXISTS organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member', -- 'owner', 'admin', 'member'
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

-- Enable RLS
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON organization_members(user_id);

-- Organization members policies
CREATE POLICY "Users can view their org memberships" ON organization_members
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view members of their orgs" ON organization_members
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = organization_members.organization_id
            AND om.user_id = auth.uid()
        )
    );

-- Organization policies (users can see orgs they belong to)
CREATE POLICY "Users can view their organizations" ON organizations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = organizations.id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Org owners can update their organization" ON organizations
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = organizations.id
            AND organization_members.user_id = auth.uid()
            AND organization_members.role = 'owner'
        )
    );

-- Auto-create profile and default organization on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    new_org_id UUID;
    user_first_name TEXT;
    user_last_name TEXT;
    org_name TEXT;
    org_slug TEXT;
BEGIN
    -- Get user names
    user_first_name := NEW.raw_user_meta_data->>'first_name';
    user_last_name := NEW.raw_user_meta_data->>'last_name';

    -- Create profile
    INSERT INTO public.profiles (id, email, first_name, last_name)
    VALUES (
        NEW.id,
        NEW.email,
        user_first_name,
        user_last_name
    );

    -- Create default organization for user
    org_name := COALESCE(user_first_name || '''s Organization', 'My Organization');
    org_slug := LOWER(REPLACE(NEW.email, '@', '-at-') || '-' || SUBSTRING(NEW.id::TEXT, 1, 8));

    INSERT INTO public.organizations (id, name, slug)
    VALUES (gen_random_uuid(), org_name, org_slug)
    RETURNING id INTO new_org_id;

    -- Add user as owner of their organization
    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (new_org_id, NEW.id, 'owner');

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for new user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- 5. PROJECTS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES profiles(id), -- who created it
    name TEXT NOT NULL,
    description TEXT,
    industry TEXT, -- e.g., 'food', 'health', 'politics', 'service'
    settings JSONB DEFAULT '{}', -- flexible config for AI guidance
    searchable_name TEXT GENERATED ALWAYS AS (
        LOWER(COALESCE(name, '') || ' ' || COALESCE(description, '') || ' ' || COALESCE(industry, ''))
    ) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Index for searching projects
CREATE INDEX IF NOT EXISTS idx_projects_searchable ON projects USING GIN (to_tsvector('english', searchable_name));

-- Projects policies (users can access projects in their organizations)
CREATE POLICY "Users can view org projects" ON projects
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = projects.organization_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create org projects" ON projects
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = projects.organization_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update org projects" ON projects
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = projects.organization_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete org projects" ON projects
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = projects.organization_id
            AND organization_members.user_id = auth.uid()
            AND organization_members.role IN ('owner', 'admin')
        )
    );

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 6. AUTOMATIONS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS automations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL DEFAULT 'blog_generation', -- 'blog_generation', 'email', etc.
    frequency TEXT DEFAULT 'weekly', -- 'daily', 'weekly', 'monthly'
    is_active BOOLEAN DEFAULT FALSE,
    settings JSONB DEFAULT '{}', -- automation-specific config
    searchable_name TEXT GENERATED ALWAYS AS (
        LOWER(COALESCE(name, '') || ' ' || COALESCE(description, '') || ' ' || COALESCE(type, ''))
    ) STORED,
    last_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for searching automations
CREATE INDEX IF NOT EXISTS idx_automations_searchable ON automations USING GIN (to_tsvector('english', searchable_name));

-- Enable RLS
ALTER TABLE automations ENABLE ROW LEVEL SECURITY;

-- Automations policies (via organization membership)
CREATE POLICY "Users can view org automations" ON automations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM projects
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE projects.id = automations.project_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create org automations" ON automations
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE projects.id = automations.project_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update org automations" ON automations
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM projects
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE projects.id = automations.project_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete org automations" ON automations
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM projects
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE projects.id = automations.project_id
            AND organization_members.user_id = auth.uid()
            AND organization_members.role IN ('owner', 'admin')
        )
    );

-- =====================================================
-- 7. BLOG POSTS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS blog_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    content TEXT, -- markdown or HTML
    industry TEXT,
    seo_keywords TEXT[] DEFAULT '{}',
    related_posts UUID[] DEFAULT '{}', -- for internal linking
    status TEXT DEFAULT 'draft', -- 'draft', 'published'
    searchable_name TEXT GENERATED ALWAYS AS (
        LOWER(COALESCE(title, '') || ' ' || COALESCE(industry, '') || ' ' || COALESCE(slug, ''))
    ) STORED,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for searching blog posts
CREATE INDEX IF NOT EXISTS idx_blog_posts_searchable ON blog_posts USING GIN (to_tsvector('english', searchable_name));

-- Enable RLS
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;

-- Blog posts policies
-- Public can read published posts
CREATE POLICY "Public can view published posts" ON blog_posts
    FOR SELECT USING (status = 'published');

-- Owners can view all their posts (including drafts)
CREATE POLICY "Users can view org posts" ON blog_posts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM automations
            JOIN projects ON projects.id = automations.project_id
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE automations.id = blog_posts.automation_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create org posts" ON blog_posts
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM automations
            JOIN projects ON projects.id = automations.project_id
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE automations.id = blog_posts.automation_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update org posts" ON blog_posts
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM automations
            JOIN projects ON projects.id = automations.project_id
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE automations.id = blog_posts.automation_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete org posts" ON blog_posts
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM automations
            JOIN projects ON projects.id = automations.project_id
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE automations.id = blog_posts.automation_id
            AND organization_members.user_id = auth.uid()
        )
    );

-- =====================================================
-- 8. ADDITIONAL INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_projects_org_id ON projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_automations_project_id ON automations(project_id);
CREATE INDEX IF NOT EXISTS idx_blog_posts_automation_id ON blog_posts(automation_id);
CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON blog_posts(slug);
CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts(status);
CREATE INDEX IF NOT EXISTS idx_blog_posts_industry ON blog_posts(industry);

-- =====================================================
-- 9. ALTER PROJECTS TABLE FOR CUSTOMER FEATURES
-- =====================================================

ALTER TABLE projects ADD COLUMN IF NOT EXISTS goals TEXT[];
ALTER TABLE projects ADD COLUMN IF NOT EXISTS pain_points TEXT[];
ALTER TABLE projects ADD COLUMN IF NOT EXISTS competitors TEXT[];
ALTER TABLE projects ADD COLUMN IF NOT EXISTS target_market TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS competitive_advantage TEXT;

-- =====================================================
-- 10. CUSTOM FIELDS TABLE (Organization-level field definitions)
-- =====================================================

CREATE TABLE IF NOT EXISTS custom_fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    field_key TEXT NOT NULL,
    field_type TEXT NOT NULL, -- 'text', 'number', 'date', 'select', 'boolean', 'email', 'phone'
    options JSONB, -- for 'select' type
    is_required BOOLEAN DEFAULT false,
    is_industry_standard BOOLEAN DEFAULT false,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE custom_fields ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_custom_fields_org_id ON custom_fields(organization_id);

-- Custom fields policies
CREATE POLICY "Users can view org custom fields" ON custom_fields
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = custom_fields.organization_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create org custom fields" ON custom_fields
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = custom_fields.organization_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update org custom fields" ON custom_fields
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = custom_fields.organization_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete org custom fields" ON custom_fields
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = custom_fields.organization_id
            AND organization_members.user_id = auth.uid()
            AND organization_members.role IN ('owner', 'admin')
        )
    );

-- =====================================================
-- 11. CUSTOMERS TABLE (Organization-level customer records)
-- =====================================================

CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    company TEXT,
    custom_data JSONB DEFAULT '{}',
    tags TEXT[],
    source TEXT, -- 'csv_import', 'manual', 'api'
    searchable_name TEXT GENERATED ALWAYS AS (
        LOWER(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '') || ' ' || COALESCE(email, '') || ' ' || COALESCE(company, ''))
    ) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_customers_org_id ON customers(organization_id);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(organization_id, email);
CREATE INDEX IF NOT EXISTS idx_customers_searchable ON customers USING GIN (to_tsvector('english', searchable_name));

-- Auto-update updated_at trigger
CREATE TRIGGER update_customers_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Customers policies
CREATE POLICY "Users can view org customers" ON customers
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = customers.organization_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create org customers" ON customers
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = customers.organization_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update org customers" ON customers
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = customers.organization_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete org customers" ON customers
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = customers.organization_id
            AND organization_members.user_id = auth.uid()
            AND organization_members.role IN ('owner', 'admin')
        )
    );

-- =====================================================
-- 12. PROJECT CUSTOMERS TABLE (Customer subsets per project)
-- =====================================================

CREATE TABLE IF NOT EXISTS project_customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    segment_data JSONB DEFAULT '{}',
    added_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, customer_id)
);

-- Enable RLS
ALTER TABLE project_customers ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_project_customers_project_id ON project_customers(project_id);
CREATE INDEX IF NOT EXISTS idx_project_customers_customer_id ON project_customers(customer_id);

-- Project customers policies (via organization membership)
CREATE POLICY "Users can view project customers" ON project_customers
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM projects
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE projects.id = project_customers.project_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can add project customers" ON project_customers
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE projects.id = project_customers.project_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can remove project customers" ON project_customers
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM projects
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE projects.id = project_customers.project_id
            AND organization_members.user_id = auth.uid()
        )
    );

-- =====================================================
-- 13. OPPORTUNITIES TABLE (AI-generated automation opportunities)
-- =====================================================

CREATE TABLE IF NOT EXISTS opportunities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    opportunity_type TEXT, -- 'email', 'workflow', 'notification', 'report'
    target_segment TEXT,
    estimated_impact TEXT, -- 'high', 'medium', 'low'
    implementation_complexity TEXT, -- 'easy', 'moderate', 'complex'
    ai_reasoning TEXT,
    status TEXT DEFAULT 'suggested', -- 'suggested', 'accepted', 'dismissed', 'implemented'
    batch_number INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_opportunities_project_id ON opportunities(project_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);

-- Opportunities policies (via organization membership)
CREATE POLICY "Users can view project opportunities" ON opportunities
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM projects
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE projects.id = opportunities.project_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create project opportunities" ON opportunities
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE projects.id = opportunities.project_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update project opportunities" ON opportunities
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM projects
            JOIN organization_members ON organization_members.organization_id = projects.organization_id
            WHERE projects.id = opportunities.project_id
            AND organization_members.user_id = auth.uid()
        )
    );

-- =====================================================
-- 14. CSV IMPORTS TABLE (Track import history)
-- =====================================================

CREATE TABLE IF NOT EXISTS csv_imports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    filename TEXT,
    row_count INTEGER,
    column_mapping JSONB,
    status TEXT DEFAULT 'completed',
    imported_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE csv_imports ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_csv_imports_org_id ON csv_imports(organization_id);

-- CSV imports policies
CREATE POLICY "Users can view org csv imports" ON csv_imports
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = csv_imports.organization_id
            AND organization_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create org csv imports" ON csv_imports
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = csv_imports.organization_id
            AND organization_members.user_id = auth.uid()
        )
    );

-- =====================================================
-- 15. INDUSTRY STANDARD FIELDS FUNCTION
-- =====================================================

-- Function to create industry-standard custom fields for an organization
CREATE OR REPLACE FUNCTION create_industry_fields(org_id UUID, industry TEXT)
RETURNS void AS $$
BEGIN
    -- Universal fields for all industries
    INSERT INTO custom_fields (organization_id, name, field_key, field_type, is_industry_standard, display_order) VALUES
        (org_id, 'Customer Since', 'customer_since', 'date', true, 1),
        (org_id, 'Lifetime Value', 'lifetime_value', 'number', true, 2),
        (org_id, 'Last Purchase Date', 'last_purchase_date', 'date', true, 3),
        (org_id, 'Total Orders', 'total_orders', 'number', true, 4)
    ON CONFLICT DO NOTHING;

    -- Industry-specific fields
    IF industry = 'food' THEN
        INSERT INTO custom_fields (organization_id, name, field_key, field_type, options, is_industry_standard, display_order) VALUES
            (org_id, 'Dietary Restrictions', 'dietary_restrictions', 'select', '["None", "Vegetarian", "Vegan", "Gluten-Free", "Halal", "Kosher", "Other"]'::jsonb, true, 10),
            (org_id, 'Favorite Items', 'favorite_items', 'text', null, true, 11),
            (org_id, 'Loyalty Points', 'loyalty_points', 'number', null, true, 12)
        ON CONFLICT DO NOTHING;
    ELSIF industry = 'health' THEN
        INSERT INTO custom_fields (organization_id, name, field_key, field_type, options, is_industry_standard, display_order) VALUES
            (org_id, 'Membership Type', 'membership_type', 'select', '["Basic", "Premium", "VIP", "Corporate"]'::jsonb, true, 10),
            (org_id, 'Health Goals', 'health_goals', 'text', null, true, 11),
            (org_id, 'Insurance Provider', 'insurance_provider', 'text', null, true, 12)
        ON CONFLICT DO NOTHING;
    ELSIF industry = 'service' THEN
        INSERT INTO custom_fields (organization_id, name, field_key, field_type, is_industry_standard, display_order) VALUES
            (org_id, 'Contract Value', 'contract_value', 'number', true, 10),
            (org_id, 'Renewal Date', 'renewal_date', 'date', true, 11),
            (org_id, 'NPS Score', 'nps_score', 'number', true, 12)
        ON CONFLICT DO NOTHING;
    ELSIF industry = 'retail' THEN
        INSERT INTO custom_fields (organization_id, name, field_key, field_type, is_industry_standard, display_order) VALUES
            (org_id, 'Preferred Categories', 'preferred_categories', 'text', true, 10),
            (org_id, 'Returns Rate', 'returns_rate', 'number', true, 11),
            (org_id, 'Wishlist Items', 'wishlist_items', 'text', true, 12)
        ON CONFLICT DO NOTHING;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 16. ROADMAP ITEMS TABLE (Public product roadmap)
-- =====================================================

CREATE TABLE IF NOT EXISTS roadmap_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'feature', -- 'feature', 'improvement', 'integration', 'bug'
    status TEXT NOT NULL DEFAULT 'ideas', -- 'ideas', 'in_progress', 'deployed'
    is_public BOOLEAN DEFAULT false, -- Only show on frontend if true
    votes INTEGER DEFAULT 0,
    display_order INTEGER DEFAULT 0,
    deployed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE roadmap_items ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_roadmap_items_status ON roadmap_items(status);
CREATE INDEX IF NOT EXISTS idx_roadmap_items_is_public ON roadmap_items(is_public);

-- Public can view public items
CREATE POLICY "Public can view public roadmap items" ON roadmap_items
    FOR SELECT USING (is_public = true);

-- Admins can view all items
CREATE POLICY "Admins can view all roadmap items" ON roadmap_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.is_admin = true
        )
    );

-- Admins can insert roadmap items
CREATE POLICY "Admins can create roadmap items" ON roadmap_items
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.is_admin = true
        )
    );

-- Admins can update roadmap items
CREATE POLICY "Admins can update roadmap items" ON roadmap_items
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.is_admin = true
        )
    );

-- Admins can delete roadmap items
CREATE POLICY "Admins can delete roadmap items" ON roadmap_items
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.is_admin = true
        )
    );

-- Auto-update updated_at
CREATE TRIGGER update_roadmap_items_updated_at
    BEFORE UPDATE ON roadmap_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 17. FEATURE REQUESTS TABLE (User submissions)
-- =====================================================

CREATE TABLE IF NOT EXISTS feature_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'feature', -- 'feature', 'improvement', 'integration', 'bug'
    email TEXT, -- optional contact email
    submitted_by UUID REFERENCES profiles(id), -- null if anonymous
    status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'converted'
    admin_notes TEXT,
    converted_to_roadmap_id UUID REFERENCES roadmap_items(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE feature_requests ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_feature_requests_status ON feature_requests(status);
CREATE INDEX IF NOT EXISTS idx_feature_requests_submitted_by ON feature_requests(submitted_by);

-- Anyone can submit feature requests (including anonymous)
CREATE POLICY "Anyone can submit feature requests" ON feature_requests
    FOR INSERT WITH CHECK (true);

-- Users can view their own submissions
CREATE POLICY "Users can view own feature requests" ON feature_requests
    FOR SELECT USING (
        submitted_by = auth.uid()
    );

-- Admins can view all feature requests
CREATE POLICY "Admins can view all feature requests" ON feature_requests
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.is_admin = true
        )
    );

-- Admins can update feature requests
CREATE POLICY "Admins can update feature requests" ON feature_requests
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.is_admin = true
        )
    );

-- Admins can delete feature requests
CREATE POLICY "Admins can delete feature requests" ON feature_requests
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.is_admin = true
        )
    );

-- =====================================================
-- 18. ROADMAP VOTES TABLE (Track user votes)
-- =====================================================

CREATE TABLE IF NOT EXISTS roadmap_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    roadmap_item_id UUID NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(id), -- null for anonymous votes via localStorage
    session_id TEXT, -- for anonymous vote tracking
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(roadmap_item_id, user_id),
    UNIQUE(roadmap_item_id, session_id)
);

-- Enable RLS
ALTER TABLE roadmap_votes ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_roadmap_votes_item_id ON roadmap_votes(roadmap_item_id);
CREATE INDEX IF NOT EXISTS idx_roadmap_votes_user_id ON roadmap_votes(user_id);

-- Anyone can vote
CREATE POLICY "Anyone can create votes" ON roadmap_votes
    FOR INSERT WITH CHECK (true);

-- Users can view their own votes
CREATE POLICY "Users can view own votes" ON roadmap_votes
    FOR SELECT USING (
        user_id = auth.uid() OR user_id IS NULL
    );

-- Users can delete their own votes (unvote)
CREATE POLICY "Users can delete own votes" ON roadmap_votes
    FOR DELETE USING (
        user_id = auth.uid()
    );

-- =====================================================
-- 19. APP SETTINGS TABLE (Global app configuration)
-- =====================================================

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Only admins can view/modify settings
CREATE POLICY "Admins can view settings" ON app_settings
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.is_admin = true
        )
    );

CREATE POLICY "Admins can update settings" ON app_settings
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.is_admin = true
        )
    );

CREATE POLICY "Admins can insert settings" ON app_settings
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.is_admin = true
        )
    );

-- Insert default notification settings
INSERT INTO app_settings (key, value, description) VALUES
    ('notification_webhook_url', '""'::jsonb, 'Webhook URL for feature request notifications (Slack, Discord, Zapier, etc.)'),
    ('admin_email', '""'::jsonb, 'Admin email address for notifications')
ON CONFLICT (key) DO NOTHING;

-- =====================================================
-- 20. FEATURE REQUEST NOTIFICATION FUNCTION & TRIGGER
-- =====================================================

-- Enable pg_net extension for HTTP requests (run this first in Supabase SQL Editor)
-- CREATE EXTENSION IF NOT EXISTS pg_net;

-- Function to send notification when feature request is submitted
CREATE OR REPLACE FUNCTION notify_feature_request()
RETURNS TRIGGER AS $$
DECLARE
    webhook_url TEXT;
    payload JSONB;
    submitter_email TEXT;
BEGIN
    -- Get webhook URL from settings
    SELECT value::text INTO webhook_url
    FROM app_settings
    WHERE key = 'notification_webhook_url';

    -- Remove quotes from JSON string
    webhook_url := TRIM(BOTH '"' FROM webhook_url);

    -- Skip if no webhook configured
    IF webhook_url IS NULL OR webhook_url = '' THEN
        RETURN NEW;
    END IF;

    -- Get submitter email if available
    IF NEW.submitted_by IS NOT NULL THEN
        SELECT email INTO submitter_email FROM profiles WHERE id = NEW.submitted_by;
    ELSE
        submitter_email := NEW.email;
    END IF;

    -- Build payload (Slack-compatible format)
    payload := jsonb_build_object(
        'text', '🚀 *New Feature Request*',
        'blocks', jsonb_build_array(
            jsonb_build_object(
                'type', 'header',
                'text', jsonb_build_object(
                    'type', 'plain_text',
                    'text', '🚀 New Feature Request'
                )
            ),
            jsonb_build_object(
                'type', 'section',
                'fields', jsonb_build_array(
                    jsonb_build_object('type', 'mrkdwn', 'text', '*Title:*\n' || NEW.title),
                    jsonb_build_object('type', 'mrkdwn', 'text', '*Category:*\n' || COALESCE(NEW.category, 'feature'))
                )
            ),
            jsonb_build_object(
                'type', 'section',
                'text', jsonb_build_object(
                    'type', 'mrkdwn',
                    'text', '*Description:*\n' || COALESCE(NEW.description, '_No description provided_')
                )
            ),
            jsonb_build_object(
                'type', 'context',
                'elements', jsonb_build_array(
                    jsonb_build_object('type', 'mrkdwn', 'text', '📧 From: ' || COALESCE(submitter_email, '_Anonymous_'))
                )
            )
        )
    );

    -- Send webhook notification using pg_net
    -- Note: Requires pg_net extension enabled in Supabase
    PERFORM net.http_post(
        url := webhook_url,
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := payload::text
    );

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- Log error but don't fail the insert
        RAISE WARNING 'Failed to send feature request notification: %', SQLERRM;
        RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for new feature requests
DROP TRIGGER IF EXISTS on_feature_request_created ON feature_requests;
CREATE TRIGGER on_feature_request_created
    AFTER INSERT ON feature_requests
    FOR EACH ROW EXECUTE FUNCTION notify_feature_request();

-- =====================================================
-- 21. RATE LIMITS TABLE (Track request rates)
-- =====================================================

CREATE TABLE IF NOT EXISTS rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier TEXT NOT NULL, -- IP address, user_id, or session_id
    action_type TEXT NOT NULL, -- 'feature_request', 'waitlist', 'ai_analysis', 'business_analysis', 'vote'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS (but allow all operations - tracking happens server-side)
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup
    ON rate_limits(identifier, action_type, created_at DESC);

-- Allow inserts for tracking
CREATE POLICY "Anyone can insert rate limit records" ON rate_limits
    FOR INSERT WITH CHECK (true);

-- Allow reads for checking limits
CREATE POLICY "Anyone can view rate limits" ON rate_limits
    FOR SELECT USING (true);

-- Cleanup old records (older than 24 hours)
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS void AS $$
BEGIN
    DELETE FROM rate_limits WHERE created_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if action is rate limited
-- Returns TRUE if rate limited (too many requests), FALSE if allowed
CREATE OR REPLACE FUNCTION check_rate_limit(
    p_identifier TEXT,
    p_action_type TEXT,
    p_max_requests INTEGER,
    p_window_minutes INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
    request_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO request_count
    FROM rate_limits
    WHERE identifier = p_identifier
      AND action_type = p_action_type
      AND created_at > NOW() - (p_window_minutes || ' minutes')::INTERVAL;

    RETURN request_count >= p_max_requests;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to record a rate limit attempt
CREATE OR REPLACE FUNCTION record_rate_limit(
    p_identifier TEXT,
    p_action_type TEXT
)
RETURNS void AS $$
BEGIN
    INSERT INTO rate_limits (identifier, action_type)
    VALUES (p_identifier, p_action_type);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Combined function: check and record in one call
-- Returns TRUE if allowed (and records the attempt), FALSE if rate limited
CREATE OR REPLACE FUNCTION check_and_record_rate_limit(
    p_identifier TEXT,
    p_action_type TEXT,
    p_max_requests INTEGER,
    p_window_minutes INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
    is_limited BOOLEAN;
BEGIN
    -- Check if currently rate limited
    is_limited := check_rate_limit(p_identifier, p_action_type, p_max_requests, p_window_minutes);

    -- If not limited, record this attempt
    IF NOT is_limited THEN
        PERFORM record_rate_limit(p_identifier, p_action_type);
    END IF;

    -- Return TRUE if allowed (not limited), FALSE if blocked
    RETURN NOT is_limited;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
