-- Migration: Create ai_prompts table for Royal AI conversational prompts
-- Date: 2026-02-06

-- Create the ai_prompts table
CREATE TABLE IF NOT EXISTS ai_prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    prompt_text TEXT NOT NULL,
    context JSONB DEFAULT '{}',
    response JSONB DEFAULT '{}',
    ideas_generated INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for monthly usage counting (plan limits)
CREATE INDEX idx_ai_prompts_org_month
ON ai_prompts(organization_id, created_at);

-- Index for session-based conversation retrieval
CREATE INDEX idx_ai_prompts_session
ON ai_prompts(session_id, created_at);

-- Index for user lookup
CREATE INDEX idx_ai_prompts_user
ON ai_prompts(user_id, created_at);

-- Enable Row Level Security
ALTER TABLE ai_prompts ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view prompts from their organization
CREATE POLICY "Users can view own org prompts"
ON ai_prompts FOR SELECT
USING (
    organization_id IN (
        SELECT organization_id
        FROM organization_members
        WHERE user_id = auth.uid()
    )
);

-- Policy: Users can insert prompts for their organization
CREATE POLICY "Users can insert for own org"
ON ai_prompts FOR INSERT
WITH CHECK (
    organization_id IN (
        SELECT organization_id
        FROM organization_members
        WHERE user_id = auth.uid()
    )
);

-- Grant access to service role (for edge functions)
GRANT ALL ON ai_prompts TO service_role;

-- Add comment
COMMENT ON TABLE ai_prompts IS 'Stores Royal AI conversational prompts and responses with session memory support';
