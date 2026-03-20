-- Retry seed: find app_id from existing batches or customer_apps
DO $$
DECLARE
    v_org_id UUID;
    v_app_id UUID;
    v_auto_id UUID;
BEGIN
    -- Find first organization
    SELECT id INTO v_org_id FROM organizations LIMIT 1;
    IF v_org_id IS NULL THEN
        RAISE NOTICE 'No organization found, skipping';
        RETURN;
    END IF;

    -- Try finding app_id from existing message batches first
    SELECT app_id INTO v_app_id FROM app_message_batches WHERE organization_id = v_org_id LIMIT 1;

    -- Fallback: try customer_apps
    IF v_app_id IS NULL THEN
        SELECT id INTO v_app_id FROM customer_apps WHERE organization_id = v_org_id LIMIT 1;
    END IF;

    -- Fallback: try any customer_apps
    IF v_app_id IS NULL THEN
        SELECT id INTO v_app_id FROM customer_apps LIMIT 1;
    END IF;

    IF v_app_id IS NULL THEN
        RAISE NOTICE 'No app found anywhere, skipping';
        RETURN;
    END IF;

    -- Find an automation for linking (optional)
    SELECT id INTO v_auto_id FROM automation_definitions WHERE organization_id = v_org_id LIMIT 1;

    -- Scheduled campaigns (future dates)
    INSERT INTO app_message_batches (app_id, organization_id, channel, subject, body, segment, scheduled_for, status, total_recipients, created_by, automation_id)
    VALUES
        (v_app_id, v_org_id, 'email',
         'Weekend Special: Double Points',
         'Hey {first_name}! This weekend only — earn DOUBLE points on every visit. Don''t miss out!',
         'all', NOW() + INTERVAL '1 day', 'scheduled', 245, 'automation', v_auto_id),

        (v_app_id, v_org_id, 'email',
         'VIP Member Appreciation',
         'As a valued VIP member, we want to say thank you. Enjoy an exclusive 20% bonus on your next points redemption.',
         'vip', NOW() + INTERVAL '3 days', 'scheduled', 38, 'automation', v_auto_id),

        (v_app_id, v_org_id, 'sms',
         'Spring Re-engagement',
         'We miss you! It''s been a while since your last visit. Come back this week and we''ll add 50 bonus points to your account.',
         'at_risk', NOW() + INTERVAL '7 days', 'scheduled', 112, 'ai', NULL),

        (v_app_id, v_org_id, 'email',
         'Flash Sale Alert',
         'FLASH SALE: For the next 48 hours, redeem any reward for 25% fewer points! Visit us today.',
         'active', NOW() + INTERVAL '2 days', 'paused', 189, 'automation', v_auto_id);

    -- Seed AI recommendations
    BEGIN
        INSERT INTO ai_recommendations (organization_id, recommendation_type, title, description, status, priority, impact_score, action_type, created_at)
        VALUES
            (v_org_id, 'opportunity',
             'Launch a weekend loyalty boost campaign',
             'Your visit data shows 40% higher foot traffic on weekends. A double-points weekend campaign could increase repeat visits by an estimated 25%.',
             'pending', 'high', 85, 'create_automation', NOW() - INTERVAL '2 hours'),

            (v_org_id, 'growth',
             'Activate dormant VIP members',
             '12 VIP members haven''t visited in 30+ days. A personalized re-engagement message with bonus points could recover 60% of them based on similar campaigns.',
             'pending', 'high', 78, 'send_message', NOW() - INTERVAL '1 hour'),

            (v_org_id, 'efficiency',
             'Optimize email send times',
             'Your open rates peak on Tuesdays and Thursdays at 10 AM. Shifting scheduled campaigns to these windows could improve open rates by 15-20%.',
             'pending', 'medium', 65, 'update_settings', NOW() - INTERVAL '30 minutes'),

            (v_org_id, 'risk',
             'Address rising churn in new members',
             '8 members who joined in the last 14 days haven''t returned for a second visit. An automated welcome-back message at day 7 could reduce early churn by 30%.',
             'pending', 'high', 82, 'create_automation', NOW() - INTERVAL '15 minutes');
    EXCEPTION WHEN undefined_table THEN
        RAISE NOTICE 'ai_recommendations table does not exist, skipping';
    WHEN OTHERS THEN
        RAISE NOTICE 'ai_recommendations insert error: %', SQLERRM;
    END;

    RAISE NOTICE 'Seeded campaigns and recommendations for org % with app %', v_org_id, v_app_id;
END $$;
