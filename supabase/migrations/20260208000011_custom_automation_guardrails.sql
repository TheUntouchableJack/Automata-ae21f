-- Phase 3: Custom Automation Creation with Guardrails
-- Enables AI to create any automation with safety limits and duplicate detection

-- ============================================================================
-- 1. VALIDATION FUNCTION - Checks automation config against guardrails
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_automation_config(
    p_action_type TEXT,
    p_action_config JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_errors TEXT[] := '{}';
    v_warnings TEXT[] := '{}';
    v_points_value INTEGER;
    v_multiplier DECIMAL;
    v_discount_percent DECIMAL;
BEGIN
    -- Extract values from config
    v_points_value := (p_action_config->>'points')::INTEGER;
    v_multiplier := (p_action_config->>'multiplier')::DECIMAL;
    v_discount_percent := (p_action_config->>'discount_percent')::DECIMAL;

    -- GUARDRAIL: Points award limit (max 500)
    IF v_points_value IS NOT NULL AND v_points_value > 500 THEN
        v_errors := array_append(v_errors, 'Points award exceeds maximum of 500. Use manual approval for larger rewards.');
    ELSIF v_points_value IS NOT NULL AND v_points_value > 200 THEN
        v_warnings := array_append(v_warnings, 'Points award (' || v_points_value || ') is above typical range.');
    END IF;

    -- GUARDRAIL: Multiplier limit (max 5x)
    IF v_multiplier IS NOT NULL AND v_multiplier > 5.0 THEN
        v_errors := array_append(v_errors, 'Points multiplier exceeds maximum of 5x. Use manual approval for higher.');
    ELSIF v_multiplier IS NOT NULL AND v_multiplier > 3.0 THEN
        v_warnings := array_append(v_warnings, 'Multiplier (' || v_multiplier || 'x) is above typical range.');
    END IF;

    -- GUARDRAIL: Discount limit (max 50%)
    IF v_discount_percent IS NOT NULL AND v_discount_percent > 50 THEN
        v_errors := array_append(v_errors, 'Discount exceeds maximum of 50%. Use manual approval for higher.');
    ELSIF v_discount_percent IS NOT NULL AND v_discount_percent > 30 THEN
        v_warnings := array_append(v_warnings, 'Discount (' || v_discount_percent || '%) is above typical range.');
    END IF;

    -- GUARDRAIL: Email content must have subject
    IF p_action_type = 'send_message' AND p_action_config->>'channel' = 'email' THEN
        IF p_action_config->>'subject' IS NULL OR LENGTH(p_action_config->>'subject') < 3 THEN
            v_errors := array_append(v_errors, 'Email automation must have a subject line.');
        END IF;
    END IF;

    -- GUARDRAIL: Award points needs target specification
    IF p_action_type = 'award_points' AND v_points_value IS NOT NULL THEN
        IF p_action_config->>'target_segment' IS NULL AND p_action_config->>'condition' IS NULL THEN
            v_warnings := array_append(v_warnings, 'Points award without segment or condition will apply broadly.');
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'valid', array_length(v_errors, 1) IS NULL,
        'errors', to_jsonb(v_errors),
        'warnings', to_jsonb(v_warnings)
    );
END;
$$;

-- ============================================================================
-- 2. DUPLICATE DETECTION FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION check_automation_duplicate(
    p_organization_id UUID,
    p_trigger_type TEXT,
    p_trigger_event TEXT,
    p_action_type TEXT,
    p_category TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_similar RECORD;
    v_count INTEGER;
BEGIN
    -- Check for exact duplicates (same trigger + action type)
    SELECT COUNT(*) INTO v_count
    FROM automation_definitions
    WHERE organization_id = p_organization_id
        AND is_archived = FALSE
        AND trigger_type = p_trigger_type
        AND (trigger_event = p_trigger_event OR (trigger_event IS NULL AND p_trigger_event IS NULL))
        AND action_type = p_action_type;

    IF v_count > 0 THEN
        -- Get the existing automation
        SELECT id, name, is_enabled INTO v_similar
        FROM automation_definitions
        WHERE organization_id = p_organization_id
            AND is_archived = FALSE
            AND trigger_type = p_trigger_type
            AND (trigger_event = p_trigger_event OR (trigger_event IS NULL AND p_trigger_event IS NULL))
            AND action_type = p_action_type
        LIMIT 1;

        RETURN jsonb_build_object(
            'is_duplicate', true,
            'existing_automation', jsonb_build_object(
                'id', v_similar.id,
                'name', v_similar.name,
                'is_enabled', v_similar.is_enabled
            ),
            'recommendation', CASE
                WHEN v_similar.is_enabled THEN 'A similar automation already exists and is active. Consider modifying it instead.'
                ELSE 'A similar automation exists but is disabled. Consider enabling it instead of creating a new one.'
            END
        );
    END IF;

    -- Check for similar automations (same category)
    SELECT COUNT(*) INTO v_count
    FROM automation_definitions
    WHERE organization_id = p_organization_id
        AND is_archived = FALSE
        AND category = p_category
        AND is_enabled = TRUE;

    IF v_count >= 3 THEN
        RETURN jsonb_build_object(
            'is_duplicate', false,
            'warning', 'Already have ' || v_count || ' active automations in the "' || p_category || '" category. Consider consolidating.'
        );
    END IF;

    RETURN jsonb_build_object('is_duplicate', false);
END;
$$;

-- ============================================================================
-- 3. CONFIDENCE SCORING FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_automation_confidence(
    p_action_type TEXT,
    p_action_config JSONB,
    p_delay_minutes INTEGER,
    p_max_frequency_days INTEGER,
    p_is_custom BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_base_score DECIMAL := 0.65;
    v_score DECIMAL;
    v_factors JSONB := '[]'::JSONB;
    v_points_value INTEGER;
    v_multiplier DECIMAL;
    v_discount_percent DECIMAL;
BEGIN
    v_score := v_base_score;

    -- Extract values
    v_points_value := (p_action_config->>'points')::INTEGER;
    v_multiplier := (p_action_config->>'multiplier')::DECIMAL;
    v_discount_percent := (p_action_config->>'discount_percent')::DECIMAL;

    -- FACTOR: High-value promotions reduce confidence
    IF v_points_value IS NOT NULL AND v_points_value > 200 THEN
        v_score := v_score - 0.10;
        v_factors := v_factors || jsonb_build_object('factor', 'high_value_reward', 'modifier', -0.10);
    END IF;

    IF v_multiplier IS NOT NULL AND v_multiplier > 3.0 THEN
        v_score := v_score - 0.10;
        v_factors := v_factors || jsonb_build_object('factor', 'high_multiplier', 'modifier', -0.10);
    END IF;

    IF v_discount_percent IS NOT NULL AND v_discount_percent > 30 THEN
        v_score := v_score - 0.10;
        v_factors := v_factors || jsonb_build_object('factor', 'high_discount', 'modifier', -0.10);
    END IF;

    -- FACTOR: No frequency limits reduces confidence
    IF p_max_frequency_days IS NULL THEN
        v_score := v_score - 0.10;
        v_factors := v_factors || jsonb_build_object('factor', 'no_frequency_limit', 'modifier', -0.10);
    END IF;

    -- FACTOR: Conservative delay increases confidence
    IF p_delay_minutes IS NOT NULL AND p_delay_minutes >= 30 THEN
        v_score := v_score + 0.05;
        v_factors := v_factors || jsonb_build_object('factor', 'conservative_delay', 'modifier', 0.05);
    END IF;

    -- FACTOR: Long frequency increases confidence
    IF p_max_frequency_days IS NOT NULL AND p_max_frequency_days >= 14 THEN
        v_score := v_score + 0.05;
        v_factors := v_factors || jsonb_build_object('factor', 'conservative_frequency', 'modifier', 0.05);
    END IF;

    -- FACTOR: Send message is lower risk than award_points
    IF p_action_type = 'send_message' THEN
        v_score := v_score + 0.05;
        v_factors := v_factors || jsonb_build_object('factor', 'low_risk_action', 'modifier', 0.05);
    END IF;

    -- CAP: Custom automations max out at 0.80 (always some oversight)
    IF p_is_custom THEN
        v_score := LEAST(v_score, 0.80);
    END IF;

    -- FLOOR: Minimum confidence
    v_score := GREATEST(v_score, 0.40);

    RETURN jsonb_build_object(
        'score', ROUND(v_score, 2),
        'base', v_base_score,
        'factors', v_factors,
        'auto_approve_eligible', v_score >= 0.70,
        'requires_review', v_score < 0.70
    );
END;
$$;

-- ============================================================================
-- 4. CREATE AUTOMATION RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION create_custom_automation(
    p_organization_id UUID,
    p_app_id UUID,
    p_name TEXT,
    p_description TEXT,
    p_category TEXT,
    p_trigger_type TEXT,
    p_trigger_event TEXT DEFAULT NULL,
    p_trigger_condition JSONB DEFAULT NULL,
    p_trigger_schedule TEXT DEFAULT NULL,
    p_action_type TEXT DEFAULT 'send_message',
    p_action_config JSONB DEFAULT '{}'::JSONB,
    p_delay_minutes INTEGER DEFAULT 0,
    p_max_frequency_days INTEGER DEFAULT NULL,
    p_daily_limit INTEGER DEFAULT NULL,
    p_auto_enable BOOLEAN DEFAULT FALSE,
    p_created_by TEXT DEFAULT 'ai'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_validation JSONB;
    v_duplicate_check JSONB;
    v_confidence JSONB;
    v_automation_id UUID;
    v_should_enable BOOLEAN;
BEGIN
    -- Step 1: Validate config against guardrails
    v_validation := validate_automation_config(p_action_type, p_action_config);

    IF NOT (v_validation->>'valid')::BOOLEAN THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Validation failed',
            'validation_errors', v_validation->'errors'
        );
    END IF;

    -- Step 2: Check for duplicates
    v_duplicate_check := check_automation_duplicate(
        p_organization_id,
        p_trigger_type,
        p_trigger_event,
        p_action_type,
        p_category
    );

    IF (v_duplicate_check->>'is_duplicate')::BOOLEAN THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Duplicate automation',
            'duplicate_info', v_duplicate_check
        );
    END IF;

    -- Step 3: Calculate confidence score
    v_confidence := calculate_automation_confidence(
        p_action_type,
        p_action_config,
        p_delay_minutes,
        p_max_frequency_days,
        TRUE
    );

    -- Step 4: Determine if should auto-enable
    v_should_enable := p_auto_enable AND (v_confidence->>'auto_approve_eligible')::BOOLEAN;

    -- Step 5: Create the automation
    INSERT INTO automation_definitions (
        organization_id,
        app_id,
        name,
        description,
        category,
        trigger_type,
        trigger_event,
        trigger_condition,
        trigger_schedule,
        action_type,
        action_config,
        delay_minutes,
        max_frequency_days,
        daily_limit,
        is_enabled,
        ai_can_enable,
        ai_can_modify,
        confidence_threshold
    ) VALUES (
        p_organization_id,
        p_app_id,
        p_name,
        p_description,
        p_category,
        p_trigger_type,
        p_trigger_event,
        p_trigger_condition,
        p_trigger_schedule,
        p_action_type,
        p_action_config,
        p_delay_minutes,
        p_max_frequency_days,
        p_daily_limit,
        v_should_enable,
        TRUE,
        FALSE,
        (v_confidence->>'score')::DECIMAL
    )
    RETURNING id INTO v_automation_id;

    RETURN jsonb_build_object(
        'success', true,
        'automation_id', v_automation_id,
        'name', p_name,
        'is_enabled', v_should_enable,
        'confidence', v_confidence,
        'validation_warnings', v_validation->'warnings',
        'duplicate_warning', v_duplicate_check->'warning',
        'message', CASE
            WHEN v_should_enable THEN 'Automation created and activated'
            ELSE 'Automation created but requires manual activation (confidence: ' || ROUND((v_confidence->>'score')::DECIMAL * 100) || '%)'
        END
    );
END;
$$;

-- ============================================================================
-- 5. COMMENTS
-- ============================================================================

COMMENT ON FUNCTION validate_automation_config IS 'Validates automation action config against safety guardrails (points max 500, multiplier max 5x, discount max 50%)';
COMMENT ON FUNCTION check_automation_duplicate IS 'Checks for duplicate or similar automations to prevent redundancy';
COMMENT ON FUNCTION calculate_automation_confidence IS 'Calculates confidence score (0.40-0.80) for auto-approval eligibility';
COMMENT ON FUNCTION create_custom_automation IS 'Creates a custom automation with validation, duplicate check, and confidence scoring';
