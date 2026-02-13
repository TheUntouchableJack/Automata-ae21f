-- Q&A Full Admin CRUD: Delete + Add RPCs

-- 1. DELETE RLS policy (only SELECT/INSERT/UPDATE exist currently)
CREATE POLICY "Anyone can delete proposal comments"
    ON proposal_comments FOR DELETE USING (true);

-- 2. Delete RPC (admin-key protected)
CREATE OR REPLACE FUNCTION delete_proposal_comment(
    p_comment_id UUID,
    p_admin_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF p_admin_key != '24hd-jay-admin-2026' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid admin key');
    END IF;

    DELETE FROM proposal_comments WHERE id = p_comment_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Comment not found');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION delete_proposal_comment TO anon;

-- 3. Add Q&A RPC (admin-key protected, no rate limiting, inserted as confirmed)
CREATE OR REPLACE FUNCTION add_proposal_comment(
    p_proposal_id TEXT,
    p_question TEXT,
    p_answer TEXT,
    p_admin_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id UUID;
BEGIN
    IF p_admin_key != '24hd-jay-admin-2026' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid admin key');
    END IF;

    INSERT INTO proposal_comments (
        proposal_id, question, answer, category, draft, answered_at
    ) VALUES (
        p_proposal_id, p_question, p_answer, 'general', FALSE, NOW()
    )
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('success', true, 'comment_id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION add_proposal_comment TO anon;
