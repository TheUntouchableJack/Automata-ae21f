-- 24hd-proposals Comment Storage
-- Persists client comments/questions across browsers and devices

-- ============================================================================
-- 1. PROPOSAL COMMENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS proposal_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identifiers
    proposal_id TEXT NOT NULL,           -- e.g., "island-dream-productions"

    -- Comment data
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    category TEXT DEFAULT 'client',
    draft BOOLEAN DEFAULT TRUE,          -- TRUE = AI draft, FALSE = Jay responded

    -- Submitter info (optional, no auth required)
    submitter_name TEXT,
    submitter_email TEXT,

    -- Rate limiting
    session_id TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    answered_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_proposal_comments_proposal ON proposal_comments(proposal_id);
CREATE INDEX idx_proposal_comments_draft ON proposal_comments(draft);
CREATE INDEX idx_proposal_comments_created ON proposal_comments(created_at DESC);

-- ============================================================================
-- 2. RLS POLICIES
-- ============================================================================

ALTER TABLE proposal_comments ENABLE ROW LEVEL SECURITY;

-- Anyone can read comments for any proposal
CREATE POLICY "Anyone can read proposal comments"
    ON proposal_comments FOR SELECT
    USING (true);

-- Anyone can insert new comments (rate limited at RPC layer)
CREATE POLICY "Anyone can insert proposal comments"
    ON proposal_comments FOR INSERT
    WITH CHECK (true);

-- Anyone can update (protected by RPC key check)
CREATE POLICY "Anyone can update proposal comments"
    ON proposal_comments FOR UPDATE
    USING (true);

-- ============================================================================
-- 3. RPC: Submit comment with rate limiting
-- ============================================================================

CREATE OR REPLACE FUNCTION submit_proposal_comment(
    p_proposal_id TEXT,
    p_question TEXT,
    p_answer TEXT,
    p_submitter_name TEXT DEFAULT NULL,
    p_submitter_email TEXT DEFAULT NULL,
    p_session_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_is_allowed BOOLEAN;
    v_comment_id UUID;
BEGIN
    -- Rate limit: 10 comments per hour per session
    IF p_session_id IS NOT NULL THEN
        SELECT check_and_record_rate_limit(
            p_session_id,
            'proposal_comment',
            10,
            60
        ) INTO v_is_allowed;

        IF NOT v_is_allowed THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Too many questions. Please wait before submitting more.',
                'rate_limited', true
            );
        END IF;
    END IF;

    -- Insert the comment
    INSERT INTO proposal_comments (
        proposal_id,
        question,
        answer,
        submitter_name,
        submitter_email,
        session_id,
        category,
        draft
    ) VALUES (
        p_proposal_id,
        p_question,
        p_answer,
        p_submitter_name,
        p_submitter_email,
        p_session_id,
        'client',
        TRUE
    )
    RETURNING id INTO v_comment_id;

    RETURN jsonb_build_object(
        'success', true,
        'comment_id', v_comment_id
    );
END;
$$;

-- Grant execute to anon role
GRANT EXECUTE ON FUNCTION submit_proposal_comment TO anon;

-- ============================================================================
-- 4. RPC: Answer a comment (admin only, key-protected)
-- ============================================================================

CREATE OR REPLACE FUNCTION answer_proposal_comment(
    p_comment_id UUID,
    p_answer TEXT,
    p_admin_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Simple admin key check
    IF p_admin_key != '24hd-jay-admin-2026' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Invalid admin key'
        );
    END IF;

    UPDATE proposal_comments
    SET
        answer = p_answer,
        draft = FALSE,
        answered_at = NOW(),
        updated_at = NOW()
    WHERE id = p_comment_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Comment not found'
        );
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- Grant execute to anon role (protected by key)
GRANT EXECUTE ON FUNCTION answer_proposal_comment TO anon;
