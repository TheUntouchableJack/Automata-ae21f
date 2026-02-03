-- =====================================================
-- AUDIT LOG MIGRATION
-- Copy and paste this entire file into Supabase SQL Editor
-- =====================================================

-- 1. CREATE AUDIT_LOGS TABLE
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Who performed the action
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
    user_email TEXT NOT NULL,
    user_name TEXT,

    -- What was changed
    entity_type TEXT NOT NULL,  -- 'project', 'automation', 'customer', 'team_member', 'team_invite', 'settings'
    entity_id UUID,             -- ID of the affected entity (nullable for bulk/org-level actions)
    entity_name TEXT,           -- Denormalized name for display

    -- Action details
    action TEXT NOT NULL,       -- 'create', 'update', 'delete', 'activate', 'deactivate', 'invite', 'remove', 'role_change', 'cancel'

    -- Snapshot data for potential future rollback
    previous_data JSONB,        -- State before the change
    new_data JSONB,             -- State after the change
    changes_summary JSONB,      -- { field: { old: ..., new: ... } } for updates

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ENABLE ROW LEVEL SECURITY
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- 3. CREATE INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_id ON audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON audit_logs(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created ON audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON audit_logs(user_id, created_at DESC);

-- Composite index for common query pattern (org + entity type + date range)
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_type_date ON audit_logs(organization_id, entity_type, created_at DESC);

-- 4. RLS POLICIES

-- Members can view their own audit logs
CREATE POLICY "Users can view own audit logs" ON audit_logs
    FOR SELECT USING (user_id = auth.uid());

-- Admins and Owners can view all organization audit logs
CREATE POLICY "Admins can view all org audit logs" ON audit_logs
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = audit_logs.organization_id
            AND organization_members.user_id = auth.uid()
            AND organization_members.role IN ('owner', 'admin')
        )
    );

-- Organization members can create audit logs
CREATE POLICY "Org members can create audit logs" ON audit_logs
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = audit_logs.organization_id
            AND organization_members.user_id = auth.uid()
        )
    );

-- Note: No UPDATE or DELETE policies - audit logs are immutable

-- Done! The audit_logs table is ready to use.
