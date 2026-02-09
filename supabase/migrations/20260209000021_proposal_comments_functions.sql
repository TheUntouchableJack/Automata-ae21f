-- Fix: Ensure proposal comment functions exist
-- (The previous migration may have failed before creating these)

-- ============================================================================
-- RPC: Submit comment with rate limiting
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
-- RPC: Answer a comment (admin only, key-protected)
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

-- Create any missing indexes (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_proposal_comments_proposal ON proposal_comments(proposal_id);
CREATE INDEX IF NOT EXISTS idx_proposal_comments_draft ON proposal_comments(draft);
CREATE INDEX IF NOT EXISTS idx_proposal_comments_created ON proposal_comments(created_at DESC);
