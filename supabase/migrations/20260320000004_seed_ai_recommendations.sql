-- Seed AI recommendations with correct columns
DO $$
DECLARE
    v_org_id UUID;
BEGIN
    SELECT id INTO v_org_id FROM organizations LIMIT 1;
    IF v_org_id IS NULL THEN RETURN; END IF;

    INSERT INTO ai_recommendations (organization_id, recommendation_type, title, description, status, confidence_score, potential_impact, suggested_action, action_type, created_at)
    VALUES
        (v_org_id, 'opportunity',
         'Launch a weekend loyalty boost campaign',
         'Your visit data shows 40% higher foot traffic on weekends. A double-points weekend campaign could increase repeat visits by an estimated 25%.',
         'pending', 0.88, 'high', 'Create weekend automation', 'create_automation', NOW() - INTERVAL '2 hours'),

        (v_org_id, 'growth',
         'Activate dormant VIP members',
         '12 VIP members haven''t visited in 30+ days. A personalized re-engagement message with bonus points could recover 60% of them based on similar campaigns.',
         'pending', 0.82, 'high', 'Send re-engagement message', 'send_message', NOW() - INTERVAL '1 hour'),

        (v_org_id, 'efficiency',
         'Optimize email send times',
         'Your open rates peak on Tuesdays and Thursdays at 10 AM. Shifting scheduled campaigns to these windows could improve open rates by 15-20%.',
         'pending', 0.75, 'medium', 'Update campaign schedule', 'navigate', NOW() - INTERVAL '30 minutes'),

        (v_org_id, 'risk',
         'Address rising churn in new members',
         '8 members who joined in the last 14 days haven''t returned for a second visit. An automated welcome-back message at day 7 could reduce early churn by 30%.',
         'pending', 0.85, 'high', 'Create welcome-back automation', 'create_automation', NOW() - INTERVAL '15 minutes');

    RAISE NOTICE 'Seeded 4 AI recommendations for org %', v_org_id;
END $$;
