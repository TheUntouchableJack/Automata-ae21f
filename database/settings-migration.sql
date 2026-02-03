-- =====================================================
-- SETTINGS PAGE MIGRATION
-- Copy and paste this entire file into Supabase SQL Editor
-- =====================================================

-- 1. ADD PROFILE COLUMNS
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT;

-- 2. ORGANIZATION INVITATIONS TABLE
CREATE TABLE IF NOT EXISTS organization_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    invited_by UUID REFERENCES profiles(id),
    token TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
    status TEXT DEFAULT 'pending', -- 'pending', 'accepted', 'expired', 'cancelled'
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, email)
);

-- Enable RLS on invitations
ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_org_invitations_org_id ON organization_invitations(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_invitations_email ON organization_invitations(email);
CREATE INDEX IF NOT EXISTS idx_org_invitations_token ON organization_invitations(token);

-- Policies for organization invitations
CREATE POLICY "Org admins can view invitations" ON organization_invitations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = organization_invitations.organization_id
            AND organization_members.user_id = auth.uid()
            AND organization_members.role IN ('owner', 'admin')
        )
    );

CREATE POLICY "Org admins can create invitations" ON organization_invitations
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = organization_invitations.organization_id
            AND organization_members.user_id = auth.uid()
            AND organization_members.role IN ('owner', 'admin')
        )
    );

CREATE POLICY "Org admins can update invitations" ON organization_invitations
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = organization_invitations.organization_id
            AND organization_members.user_id = auth.uid()
            AND organization_members.role IN ('owner', 'admin')
        )
    );

CREATE POLICY "Org admins can delete invitations" ON organization_invitations
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_members.organization_id = organization_invitations.organization_id
            AND organization_members.user_id = auth.uid()
            AND organization_members.role IN ('owner', 'admin')
        )
    );

-- Anyone can view invitations by token (for accepting)
CREATE POLICY "Anyone can view invitations by token" ON organization_invitations
    FOR SELECT USING (true);

-- 3. STORAGE BUCKET SETUP
-- NOTE: Create the 'avatars' bucket manually in Supabase Dashboard:
--   Storage > New Bucket > Name: "avatars" > Public: checked

-- Storage policies (run AFTER creating the bucket)
-- These allow users to upload to their own folder

-- Users can upload their own avatar
CREATE POLICY "Users can upload own avatar"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'avatars' AND
    auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can update their own avatar
CREATE POLICY "Users can update own avatar"
ON storage.objects FOR UPDATE
USING (
    bucket_id = 'avatars' AND
    auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can delete their own avatar
CREATE POLICY "Users can delete own avatar"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'avatars' AND
    auth.uid()::text = (storage.foldername(name))[1]
);

-- Anyone can view avatars (public)
CREATE POLICY "Anyone can view avatars"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

-- Done! Remember to:
-- 1. Create the 'avatars' bucket in Supabase Dashboard (Storage > New Bucket)
-- 2. Set the bucket to PUBLIC
