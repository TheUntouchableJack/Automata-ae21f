-- =====================================================
-- AUTO-CREATE SUPPORT SETTINGS FOR NEW APPS
-- Run this after support-system-migration.sql
-- Ensures every new customer_app gets AI support enabled
-- =====================================================

-- Function to auto-create support_settings when a customer_app is created
CREATE OR REPLACE FUNCTION auto_create_support_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Create default support_settings for the new app
    INSERT INTO support_settings (
        app_id,
        organization_id,
        ai_support_enabled,
        business_hours,
        escalation_triggers,
        after_hours_message
    ) VALUES (
        NEW.id,
        NEW.organization_id,
        true,  -- AI enabled by default
        jsonb_build_object(
            'enabled', false,  -- 24/7 support by default
            'timezone', 'America/New_York',
            'hours', jsonb_build_object(
                'monday', jsonb_build_object('start', '09:00', 'end', '17:00'),
                'tuesday', jsonb_build_object('start', '09:00', 'end', '17:00'),
                'wednesday', jsonb_build_object('start', '09:00', 'end', '17:00'),
                'thursday', jsonb_build_object('start', '09:00', 'end', '17:00'),
                'friday', jsonb_build_object('start', '09:00', 'end', '17:00')
            )
        ),
        jsonb_build_object(
            'keywords', ARRAY['human', 'person', 'manager', 'speak to someone', 'real person'],
            'max_ai_turns_before_offer_human', 5,
            'low_confidence_threshold', 0.5
        ),
        'Our team is currently offline but will respond during business hours.'
    )
    ON CONFLICT (app_id) DO NOTHING;

    RETURN NEW;
END;
$$;

-- Create trigger on customer_apps table
DROP TRIGGER IF EXISTS auto_create_support_settings_trigger ON customer_apps;
CREATE TRIGGER auto_create_support_settings_trigger
    AFTER INSERT ON customer_apps
    FOR EACH ROW
    EXECUTE FUNCTION auto_create_support_settings();

-- =====================================================
-- BACKFILL: Create support_settings for existing apps
-- =====================================================

INSERT INTO support_settings (app_id, organization_id, ai_support_enabled, business_hours, escalation_triggers, after_hours_message)
SELECT
    ca.id as app_id,
    ca.organization_id,
    true as ai_support_enabled,
    jsonb_build_object(
        'enabled', false,
        'timezone', 'America/New_York',
        'hours', jsonb_build_object(
            'monday', jsonb_build_object('start', '09:00', 'end', '17:00'),
            'tuesday', jsonb_build_object('start', '09:00', 'end', '17:00'),
            'wednesday', jsonb_build_object('start', '09:00', 'end', '17:00'),
            'thursday', jsonb_build_object('start', '09:00', 'end', '17:00'),
            'friday', jsonb_build_object('start', '09:00', 'end', '17:00')
        )
    ) as business_hours,
    jsonb_build_object(
        'keywords', ARRAY['human', 'person', 'manager', 'speak to someone', 'real person'],
        'max_ai_turns_before_offer_human', 5,
        'low_confidence_threshold', 0.5
    ) as escalation_triggers,
    'Our team is currently offline but will respond during business hours.' as after_hours_message
FROM customer_apps ca
WHERE NOT EXISTS (
    SELECT 1 FROM support_settings ss WHERE ss.app_id = ca.id
);

-- Show how many were created
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count FROM support_settings;
    RAISE NOTICE 'Total support_settings records: %', v_count;
END $$;
