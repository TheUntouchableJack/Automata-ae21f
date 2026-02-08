-- Migration: Create ai_threads table for chat thread management
-- Date: 2026-02-06

-- Create the ai_threads table
CREATE TABLE IF NOT EXISTS ai_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT DEFAULT 'New Conversation',
    mode TEXT DEFAULT 'review' CHECK (mode IN ('review', 'chat')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for listing threads by org/user
CREATE INDEX idx_ai_threads_org_user
ON ai_threads(organization_id, user_id, created_at DESC);

-- Index for active threads
CREATE INDEX idx_ai_threads_active
ON ai_threads(user_id, is_active, updated_at DESC);

-- Enable Row Level Security
ALTER TABLE ai_threads ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view threads from their organization
CREATE POLICY "Users can view own org threads"
ON ai_threads FOR SELECT
USING (
    organization_id IN (
        SELECT organization_id
        FROM organization_members
        WHERE user_id = auth.uid()
    )
);

-- Policy: Users can insert threads for their organization
CREATE POLICY "Users can insert threads for own org"
ON ai_threads FOR INSERT
WITH CHECK (
    organization_id IN (
        SELECT organization_id
        FROM organization_members
        WHERE user_id = auth.uid()
    )
);

-- Policy: Users can update their own threads
CREATE POLICY "Users can update own threads"
ON ai_threads FOR UPDATE
USING (user_id = auth.uid());

-- Grant access to service role
GRANT ALL ON ai_threads TO service_role;

-- Add thread_id column to ai_prompts
ALTER TABLE ai_prompts ADD COLUMN IF NOT EXISTS thread_id UUID REFERENCES ai_threads(id) ON DELETE SET NULL;

-- Add mode column to ai_prompts for tracking which mode generated the prompt
ALTER TABLE ai_prompts ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'review' CHECK (mode IN ('review', 'chat'));

-- Index for thread-based retrieval
CREATE INDEX IF NOT EXISTS idx_ai_prompts_thread
ON ai_prompts(thread_id, created_at);

-- Function to auto-update updated_at on ai_threads
CREATE OR REPLACE FUNCTION update_ai_threads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS ai_threads_updated_at ON ai_threads;
CREATE TRIGGER ai_threads_updated_at
    BEFORE UPDATE ON ai_threads
    FOR EACH ROW
    EXECUTE FUNCTION update_ai_threads_updated_at();

-- Comments
COMMENT ON TABLE ai_threads IS 'Chat threads for Royal AI conversations with mode support';
COMMENT ON COLUMN ai_threads.mode IS 'review = generates action cards, chat = conversational only';
COMMENT ON COLUMN ai_prompts.thread_id IS 'Reference to parent thread for conversation grouping';
COMMENT ON COLUMN ai_prompts.mode IS 'Mode in which this prompt was generated';
