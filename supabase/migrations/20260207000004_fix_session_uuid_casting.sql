-- Migration: Fix get_session_discovery_state UUID casting for session_id
-- ai_prompts.session_id is UUID, function takes TEXT - need to cast properly

CREATE OR REPLACE FUNCTION get_session_discovery_state(
    p_org_id UUID,
    p_session_id TEXT,
    p_lookback_minutes INTEGER DEFAULT 30
)
RETURNS JSONB AS $$
DECLARE
    v_questions_asked INTEGER;
    v_last_question_id UUID;
    v_pending_question_id UUID;
    v_session_uuid UUID;
BEGIN
    -- Try to cast session_id to UUID if it's a valid UUID string
    BEGIN
        v_session_uuid := p_session_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        -- Not a valid UUID, return empty state
        RETURN jsonb_build_object(
            'questions_asked_this_session', 0,
            'last_question_id', NULL,
            'pending_question_id', NULL
        );
    END;

    -- Count questions asked in this session within lookback window
    SELECT
        COUNT(*),
        (array_agg((response->>'discovery_question_asked')::uuid ORDER BY created_at DESC))[1]
    INTO v_questions_asked, v_last_question_id
    FROM ai_prompts
    WHERE organization_id = p_org_id
        AND session_id = v_session_uuid
        AND created_at > NOW() - (p_lookback_minutes || ' minutes')::INTERVAL
        AND response->>'discovery_question_asked' IS NOT NULL;

    -- Get pending question (last asked but not yet answered)
    SELECT odp.question_id INTO v_pending_question_id
    FROM org_discovery_progress odp
    WHERE odp.organization_id = p_org_id
        AND odp.status = 'asked'
        AND odp.asked_at > NOW() - INTERVAL '1 hour'
    ORDER BY odp.asked_at DESC
    LIMIT 1;

    RETURN jsonb_build_object(
        'questions_asked_this_session', COALESCE(v_questions_asked, 0),
        'last_question_id', v_last_question_id,
        'pending_question_id', v_pending_question_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
