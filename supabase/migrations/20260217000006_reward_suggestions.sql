-- =====================================================
-- Reward Suggestions: customers suggest rewards when none exist
-- =====================================================

CREATE TABLE reward_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES customer_apps(id) ON DELETE CASCADE,
    member_id UUID REFERENCES app_members(id),
    organization_id UUID NOT NULL,

    reward_name TEXT NOT NULL,
    description TEXT,
    suggested_points INTEGER,
    category TEXT,

    status TEXT NOT NULL DEFAULT 'new',  -- new | reviewed | approved | dismissed
    admin_notes TEXT,
    created_reward_id UUID REFERENCES app_rewards(id),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ
);

-- RLS
ALTER TABLE reward_suggestions ENABLE ROW LEVEL SECURITY;

-- Org members can view/manage all suggestions for their apps
CREATE POLICY "Org can manage suggestions" ON reward_suggestions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM organization_members om
            WHERE om.organization_id = reward_suggestions.organization_id
            AND om.user_id = auth.uid()
        )
    );

-- Anyone can insert a suggestion (customer app uses anon client)
CREATE POLICY "Anyone can suggest rewards" ON reward_suggestions
    FOR INSERT WITH CHECK (true);

-- RPC for safe anonymous insert (validates app exists, rate-limits)
CREATE OR REPLACE FUNCTION submit_reward_suggestion(
    p_app_id UUID,
    p_member_id UUID,
    p_reward_name TEXT,
    p_description TEXT DEFAULT NULL,
    p_suggested_points INTEGER DEFAULT NULL,
    p_category TEXT DEFAULT NULL
)
RETURNS TABLE (success BOOLEAN, suggestion_id UUID, error_message TEXT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_org_id UUID;
    v_suggestion_id UUID;
    v_recent_count INTEGER;
BEGIN
    -- Validate app exists
    SELECT organization_id INTO v_org_id
    FROM customer_apps WHERE id = p_app_id AND is_active = true AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, 'App not found'::TEXT;
        RETURN;
    END IF;

    -- Rate limit: max 3 suggestions per member per app per day
    IF p_member_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_recent_count
        FROM reward_suggestions
        WHERE member_id = p_member_id AND app_id = p_app_id
          AND created_at > NOW() - INTERVAL '24 hours';

        IF v_recent_count >= 3 THEN
            RETURN QUERY SELECT false, NULL::UUID, 'You can submit up to 3 suggestions per day'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- Validate name length
    IF length(trim(p_reward_name)) < 2 THEN
        RETURN QUERY SELECT false, NULL::UUID, 'Reward name is too short'::TEXT;
        RETURN;
    END IF;

    INSERT INTO reward_suggestions (app_id, member_id, organization_id, reward_name, description, suggested_points, category)
    VALUES (p_app_id, p_member_id, v_org_id, trim(p_reward_name), trim(p_description), p_suggested_points, trim(p_category))
    RETURNING id INTO v_suggestion_id;

    RETURN QUERY SELECT true, v_suggestion_id, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_reward_suggestion(UUID, UUID, TEXT, TEXT, INTEGER, TEXT) TO anon, authenticated;
