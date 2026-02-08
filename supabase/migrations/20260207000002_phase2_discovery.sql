-- Migration: Phase 2 - Proactive Discovery Enhancements
-- Adds smart question prioritization, skip tracking, and follow-up chains

-- ============================================================================
-- 1. SCHEMA UPDATES
-- ============================================================================

-- Add skip_count to track how many times a question has been skipped
ALTER TABLE org_discovery_progress
ADD COLUMN IF NOT EXISTS skip_count INTEGER DEFAULT 0;

-- Update status constraint to include 'retired' for permanently skipped questions
ALTER TABLE org_discovery_progress
DROP CONSTRAINT IF EXISTS org_discovery_progress_status_check;

ALTER TABLE org_discovery_progress
ADD CONSTRAINT org_discovery_progress_status_check
CHECK (status IN ('pending', 'asked', 'answered', 'skipped', 'deferred', 'retired'));

-- Add index for efficient cooldown queries
CREATE INDEX IF NOT EXISTS idx_progress_skipped_at
ON org_discovery_progress(organization_id, skipped_at)
WHERE status IN ('skipped', 'deferred');

-- ============================================================================
-- 2. SMART QUESTION PRIORITIZATION (v2)
-- Context-aware question selection with scoring
-- ============================================================================

CREATE OR REPLACE FUNCTION get_next_discovery_question_v2(
    p_org_id UUID,
    p_conversation_context TEXT DEFAULT NULL,  -- Current topic: 'costs', 'revenue', etc.
    p_last_question_id UUID DEFAULT NULL,      -- For follow-up chaining
    p_session_questions_asked INTEGER DEFAULT 0, -- Enforce 1-2 per session limit
    p_business_type TEXT DEFAULT NULL          -- For targeting restaurant-only questions
)
RETURNS TABLE(
    question_id UUID,
    domain TEXT,
    question TEXT,
    why_asking TEXT,
    priority INTEGER,
    score_breakdown JSONB
) AS $$
DECLARE
    v_profile_completeness INTEGER;
BEGIN
    -- Enforce max 2 questions per session
    IF p_session_questions_asked >= 2 THEN
        RETURN;
    END IF;

    -- Get profile completeness for min_profile_completeness check
    SELECT COALESCE(bp.profile_completeness, 0) INTO v_profile_completeness
    FROM business_profiles bp
    WHERE bp.organization_id = p_org_id;

    RETURN QUERY
    WITH scored_questions AS (
        SELECT
            dq.id as question_id,
            dq.domain,
            dq.question,
            dq.why_asking,
            dq.priority as base_priority,

            -- Knowledge gap bonus: +30 if this fills an empty profile field
            CASE
                WHEN dq.maps_to_field IS NOT NULL AND EXISTS (
                    SELECT 1 FROM business_profiles bp
                    WHERE bp.organization_id = p_org_id
                    AND (
                        (dq.maps_to_field = 'avg_ticket' AND bp.avg_ticket IS NULL) OR
                        (dq.maps_to_field = 'food_cost_pct' AND bp.food_cost_pct IS NULL) OR
                        (dq.maps_to_field = 'labor_cost_pct' AND bp.labor_cost_pct IS NULL) OR
                        (dq.maps_to_field = 'gross_margin_pct' AND bp.gross_margin_pct IS NULL) OR
                        (dq.maps_to_field = 'price_positioning' AND bp.price_positioning IS NULL) OR
                        (dq.maps_to_field = 'competitive_advantage' AND bp.competitive_advantage IS NULL) OR
                        (dq.maps_to_field = 'current_stage' AND bp.current_stage IS NULL) OR
                        (dq.maps_to_field = 'biggest_challenge' AND bp.biggest_challenge IS NULL) OR
                        (dq.maps_to_field = 'success_vision' AND bp.success_vision IS NULL) OR
                        (dq.maps_to_field = 'ideal_customer_description' AND bp.ideal_customer_description IS NULL) OR
                        (dq.maps_to_field = 'primary_age_range' AND bp.primary_age_range IS NULL) OR
                        (dq.maps_to_field = 'location_type' AND bp.location_type IS NULL) OR
                        (dq.maps_to_field = 'foot_traffic_level' AND bp.foot_traffic_level IS NULL) OR
                        (dq.maps_to_field = 'staff_count' AND bp.staff_count IS NULL) OR
                        (dq.maps_to_field = 'owner_hours_weekly' AND bp.owner_hours_weekly IS NULL)
                    )
                )
                THEN 30
                ELSE 0
            END as knowledge_gap_bonus,

            -- Context match bonus: +40 if question domain matches conversation context
            CASE
                WHEN p_conversation_context IS NOT NULL
                    AND dq.domain = p_conversation_context
                THEN 40
                ELSE 0
            END as context_match_bonus,

            -- Follow-up bonus: +50 if this is a follow-up to the last answered question
            CASE
                WHEN p_last_question_id IS NOT NULL
                    AND dq.asks_after IS NOT NULL
                    AND p_last_question_id::text = ANY(dq.asks_after)
                THEN 50
                ELSE 0
            END as follow_up_bonus,

            -- Business type penalty: -100 if wrong business type
            CASE
                WHEN dq.business_types IS NOT NULL
                    AND p_business_type IS NOT NULL
                    AND NOT (p_business_type = ANY(dq.business_types))
                THEN -100
                ELSE 0
            END as business_type_penalty,

            -- Progress status for filtering
            odp.status as progress_status,
            odp.skip_count,
            odp.skipped_at

        FROM discovery_questions dq
        LEFT JOIN org_discovery_progress odp
            ON odp.question_id = dq.id AND odp.organization_id = p_org_id
        WHERE dq.is_active = TRUE
            -- Only pending or never asked
            AND (odp.status IS NULL OR odp.status = 'pending')
            -- Profile completeness gate
            AND dq.min_profile_completeness <= COALESCE(v_profile_completeness, 0)
            -- Skip cooldown: exclude questions skipped in last 7 days
            AND (
                odp.status IS NULL
                OR odp.status != 'skipped'
                OR odp.skipped_at < NOW() - INTERVAL '7 days'
            )
            -- Defer cooldown: exclude questions deferred in last 2 days
            AND (
                odp.status IS NULL
                OR odp.status != 'deferred'
                OR odp.skipped_at < NOW() - INTERVAL '2 days'
            )
            -- Never ask retired questions (3+ skips)
            AND (odp.status IS NULL OR odp.status != 'retired')
    )
    SELECT
        sq.question_id,
        sq.domain,
        sq.question,
        sq.why_asking,
        (sq.base_priority + sq.knowledge_gap_bonus + sq.context_match_bonus +
         sq.follow_up_bonus + sq.business_type_penalty)::INTEGER as priority,
        jsonb_build_object(
            'base', sq.base_priority,
            'knowledge_gap', sq.knowledge_gap_bonus,
            'context_match', sq.context_match_bonus,
            'follow_up', sq.follow_up_bonus,
            'business_type', sq.business_type_penalty
        ) as score_breakdown
    FROM scored_questions sq
    WHERE (sq.base_priority + sq.knowledge_gap_bonus + sq.context_match_bonus +
           sq.follow_up_bonus + sq.business_type_penalty) > 0
    ORDER BY
        (sq.base_priority + sq.knowledge_gap_bonus + sq.context_match_bonus +
         sq.follow_up_bonus + sq.business_type_penalty) DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 3. FOLLOW-UP QUESTION SELECTION
-- Get related questions after one is answered
-- ============================================================================

CREATE OR REPLACE FUNCTION get_follow_up_questions(
    p_org_id UUID,
    p_answered_question_id UUID,
    p_limit INTEGER DEFAULT 3
)
RETURNS TABLE(
    question_id UUID,
    domain TEXT,
    question TEXT,
    why_asking TEXT,
    priority INTEGER,
    is_direct_follow_up BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    -- First: Direct follow-ups from the answered question's follow_ups array
    SELECT
        dq.id as question_id,
        dq.domain,
        dq.question,
        dq.why_asking,
        (dq.priority + 100)::INTEGER as priority,  -- Boost direct follow-ups
        TRUE as is_direct_follow_up
    FROM discovery_questions dq
    LEFT JOIN org_discovery_progress odp
        ON odp.question_id = dq.id AND odp.organization_id = p_org_id
    WHERE dq.id = ANY(
        SELECT UNNEST(follow_ups::uuid[])
        FROM discovery_questions
        WHERE id = p_answered_question_id
    )
    AND (odp.status IS NULL OR odp.status = 'pending')
    AND dq.is_active = TRUE

    UNION ALL

    -- Second: Questions that have p_answered_question_id in their asks_after array
    SELECT
        dq.id as question_id,
        dq.domain,
        dq.question,
        dq.why_asking,
        (dq.priority + 50)::INTEGER as priority,  -- Moderate boost
        FALSE as is_direct_follow_up
    FROM discovery_questions dq
    LEFT JOIN org_discovery_progress odp
        ON odp.question_id = dq.id AND odp.organization_id = p_org_id
    WHERE p_answered_question_id::text = ANY(dq.asks_after)
    AND (odp.status IS NULL OR odp.status = 'pending')
    AND dq.is_active = TRUE

    ORDER BY priority DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 4. QUESTION OUTCOME HANDLER
-- Handle answered, skipped, or deferred questions
-- ============================================================================

CREATE OR REPLACE FUNCTION handle_question_outcome(
    p_org_id UUID,
    p_question_id UUID,
    p_outcome TEXT,  -- 'answered', 'skipped', 'deferred'
    p_thread_id UUID DEFAULT NULL,
    p_answer_text TEXT DEFAULT NULL,
    p_response_time_seconds INTEGER DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_current_skip_count INTEGER := 0;
    v_result JSONB;
    v_new_status TEXT;
BEGIN
    -- Validate outcome
    IF p_outcome NOT IN ('answered', 'skipped', 'deferred') THEN
        RETURN jsonb_build_object('error', 'Invalid outcome. Must be answered, skipped, or deferred.');
    END IF;

    -- Get current skip count
    SELECT COALESCE(skip_count, 0) INTO v_current_skip_count
    FROM org_discovery_progress
    WHERE organization_id = p_org_id AND question_id = p_question_id;

    IF p_outcome = 'answered' THEN
        -- Mark as answered with metadata
        INSERT INTO org_discovery_progress (
            organization_id,
            question_id,
            status,
            answered_at,
            answer_thread_id,
            response_time_seconds,
            answer_quality
        ) VALUES (
            p_org_id,
            p_question_id,
            'answered',
            NOW(),
            p_thread_id,
            p_response_time_seconds,
            CASE
                WHEN length(COALESCE(p_answer_text, '')) > 100 THEN 'detailed'
                WHEN length(COALESCE(p_answer_text, '')) > 20 THEN 'brief'
                ELSE 'unclear'
            END
        )
        ON CONFLICT (organization_id, question_id) DO UPDATE SET
            status = 'answered',
            answered_at = NOW(),
            answer_thread_id = EXCLUDED.answer_thread_id,
            response_time_seconds = EXCLUDED.response_time_seconds,
            answer_quality = EXCLUDED.answer_quality,
            updated_at = NOW();

        v_result := jsonb_build_object(
            'status', 'answered',
            'action', 'recorded',
            'answer_quality', CASE
                WHEN length(COALESCE(p_answer_text, '')) > 100 THEN 'detailed'
                WHEN length(COALESCE(p_answer_text, '')) > 20 THEN 'brief'
                ELSE 'unclear'
            END
        );

    ELSIF p_outcome = 'skipped' THEN
        -- Increment skip count
        v_current_skip_count := v_current_skip_count + 1;

        -- Determine new status: retire after 3 skips
        v_new_status := CASE WHEN v_current_skip_count >= 3 THEN 'retired' ELSE 'skipped' END;

        INSERT INTO org_discovery_progress (
            organization_id,
            question_id,
            status,
            skipped_at,
            skip_count
        ) VALUES (
            p_org_id,
            p_question_id,
            v_new_status,
            NOW(),
            v_current_skip_count
        )
        ON CONFLICT (organization_id, question_id) DO UPDATE SET
            status = v_new_status,
            skipped_at = NOW(),
            skip_count = v_current_skip_count,
            updated_at = NOW();

        v_result := jsonb_build_object(
            'status', v_new_status,
            'skip_count', v_current_skip_count,
            'cooldown_until', CASE
                WHEN v_current_skip_count >= 3 THEN NULL  -- Retired, never ask again
                ELSE NOW() + INTERVAL '7 days'
            END,
            'is_retired', v_current_skip_count >= 3
        );

    ELSIF p_outcome = 'deferred' THEN
        -- User said "ask me later" - shorter cooldown (2 days)
        INSERT INTO org_discovery_progress (
            organization_id,
            question_id,
            status,
            skipped_at
        ) VALUES (
            p_org_id,
            p_question_id,
            'deferred',
            NOW()
        )
        ON CONFLICT (organization_id, question_id) DO UPDATE SET
            status = 'deferred',
            skipped_at = NOW(),
            updated_at = NOW();

        v_result := jsonb_build_object(
            'status', 'deferred',
            'cooldown_until', NOW() + INTERVAL '2 days'
        );
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5. GET SESSION DISCOVERY STATE
-- Check how many questions asked in current session
-- ============================================================================

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
BEGIN
    -- Count questions asked in this session within lookback window
    SELECT
        COUNT(*),
        (array_agg(response->>'discovery_question_asked' ORDER BY created_at DESC))[1]
    INTO v_questions_asked, v_last_question_id
    FROM ai_prompts
    WHERE organization_id = p_org_id
        AND session_id = p_session_id
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

-- ============================================================================
-- 6. UPDATE ORIGINAL FUNCTION TO USE V2 INTERNALLY
-- Keep backwards compatibility
-- ============================================================================

CREATE OR REPLACE FUNCTION get_next_discovery_question(p_org_id UUID)
RETURNS TABLE(
    question_id UUID,
    domain TEXT,
    question TEXT,
    why_asking TEXT,
    priority INTEGER
) AS $$
BEGIN
    -- Delegate to v2 with default parameters
    RETURN QUERY
    SELECT
        q.question_id,
        q.domain,
        q.question,
        q.why_asking,
        q.priority
    FROM get_next_discovery_question_v2(p_org_id) q;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 7. COMMENTS
-- ============================================================================

COMMENT ON FUNCTION get_next_discovery_question_v2 IS 'Smart question selection with context awareness, knowledge gaps, follow-ups, and skip cooldowns';
COMMENT ON FUNCTION get_follow_up_questions IS 'Get related questions after one is answered';
COMMENT ON FUNCTION handle_question_outcome IS 'Handle answered, skipped, or deferred discovery questions';
COMMENT ON FUNCTION get_session_discovery_state IS 'Get discovery question state for current session';
