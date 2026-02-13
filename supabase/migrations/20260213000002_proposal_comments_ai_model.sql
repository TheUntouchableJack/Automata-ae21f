-- Add ai_model column to proposal_comments for model attribution
ALTER TABLE proposal_comments ADD COLUMN IF NOT EXISTS ai_model TEXT;

-- Drop old 6-param overload before creating 7-param version
DROP FUNCTION IF EXISTS submit_proposal_comment(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

-- Recreate submit RPC with ai_model parameter
CREATE OR REPLACE FUNCTION submit_proposal_comment(
    p_proposal_id TEXT,
    p_question TEXT,
    p_answer TEXT,
    p_submitter_name TEXT DEFAULT NULL,
    p_submitter_email TEXT DEFAULT NULL,
    p_session_id TEXT DEFAULT NULL,
    p_ai_model TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_is_allowed BOOLEAN;
    v_comment_id UUID;
BEGIN
    IF p_session_id IS NOT NULL THEN
        SELECT check_and_record_rate_limit(
            p_session_id, 'proposal_comment', 10, 60
        ) INTO v_is_allowed;
        IF NOT v_is_allowed THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Too many questions. Please wait before submitting more.',
                'rate_limited', true
            );
        END IF;
    END IF;

    INSERT INTO proposal_comments (
        proposal_id, question, answer, submitter_name,
        submitter_email, session_id, category, draft, ai_model
    ) VALUES (
        p_proposal_id, p_question, p_answer, p_submitter_name,
        p_submitter_email, p_session_id, 'client', TRUE, p_ai_model
    )
    RETURNING id INTO v_comment_id;

    RETURN jsonb_build_object('success', true, 'comment_id', v_comment_id);
END;
$$;

GRANT EXECUTE ON FUNCTION submit_proposal_comment TO anon;
