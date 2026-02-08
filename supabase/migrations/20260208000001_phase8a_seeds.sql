-- Phase 8A: Seed automation templates and message templates
-- Pre-built automations and localized message content

-- ============================================================================
-- 1. AUTOMATION TEMPLATE SEEDS (15+ pre-built automations)
-- ============================================================================

-- Welcome & Onboarding
INSERT INTO automation_definitions (organization_id, name, description, category, template_key, is_template, trigger_type, trigger_event, action_type, action_config, ai_can_enable, confidence_threshold) VALUES
(NULL, 'Welcome Message', 'Send welcome message to new members', 'welcome', 'welcome_message', TRUE, 'event', 'member_joined', 'send_message', '{"channel": "email", "template_key": "welcome", "delay_minutes": 5}', TRUE, 0.80),
(NULL, 'First Visit Bonus', 'Award bonus points on first check-in', 'welcome', 'first_visit_bonus', TRUE, 'event', 'first_visit', 'award_points', '{"points": 50, "reason": "Welcome bonus for your first visit!"}', TRUE, 0.85),
(NULL, 'Program Explainer', 'Explain loyalty program after 3 visits', 'welcome', 'program_explainer', TRUE, 'condition', NULL, 'send_message', '{"channel": "push", "template_key": "program_explainer", "condition": {"visit_count": 3}}', TRUE, 0.75),
(NULL, 'Profile Completion Reward', 'Reward completing profile', 'welcome', 'profile_complete', TRUE, 'event', 'profile_completed', 'award_points', '{"points": 25, "reason": "Thanks for completing your profile!"}', TRUE, 0.90);

-- Engagement & Retention
INSERT INTO automation_definitions (organization_id, name, description, category, template_key, is_template, trigger_type, trigger_event, trigger_condition, action_type, action_config, ai_can_enable, confidence_threshold, delay_minutes) VALUES
(NULL, 'Birthday Reward', 'Send birthday greeting with special offer', 'engagement', 'birthday_reward', TRUE, 'schedule', 'birthday', NULL, 'send_message', '{"channel": "email", "template_key": "birthday", "include_bonus": true, "bonus_points": 100}', TRUE, 0.90, 0),
(NULL, 'Anniversary Celebration', 'Celebrate membership anniversary', 'engagement', 'anniversary', TRUE, 'schedule', 'anniversary', NULL, 'send_message', '{"channel": "email", "template_key": "anniversary", "include_bonus": true, "bonus_multiplier": 2}', TRUE, 0.85, 0),
(NULL, 'Streak Bonus (5 days)', 'Reward 5-day visit streak', 'engagement', 'streak_5', TRUE, 'event', 'streak_reached', '{"streak_days": 5}', 'award_points', '{"points": 75, "reason": "Amazing! 5 visits in a row!", "multiplier": 1.5}', TRUE, 0.85, 0),
(NULL, 'Streak Bonus (10 days)', 'Reward 10-day visit streak', 'engagement', 'streak_10', TRUE, 'event', 'streak_reached', '{"streak_days": 10}', 'award_points', '{"points": 200, "reason": "Incredible! 10 visits in a row!", "multiplier": 2.0}', TRUE, 0.80, 0),
(NULL, 'Tier Upgrade Notification', 'Congratulate on tier upgrade', 'engagement', 'tier_upgrade', TRUE, 'event', 'tier_changed', '{"direction": "up"}', 'send_message', '{"channel": "push", "template_key": "tier_upgrade"}', TRUE, 0.90, 0),
(NULL, 'VIP Appreciation', 'Monthly VIP thank you', 'engagement', 'vip_appreciation', TRUE, 'schedule', 'monthly', '{"tier": ["gold", "platinum"]}', 'send_message', '{"channel": "email", "template_key": "vip_appreciation", "include_exclusive": true}', TRUE, 0.80, 0),
(NULL, 'Points Expiring Soon', 'Warn about expiring points', 'retention', 'points_expiring', TRUE, 'schedule', 'daily', '{"points_expire_within_days": 30}', 'send_message', '{"channel": "push", "template_key": "points_expiring"}', TRUE, 0.85, 0);

-- Win-Back & Recovery
INSERT INTO automation_definitions (organization_id, name, description, category, template_key, is_template, trigger_type, trigger_condition, action_type, action_config, ai_can_enable, confidence_threshold, max_frequency_days) VALUES
(NULL, 'At-Risk Check-in', 'Gentle message after 14+ days inactive', 'recovery', 'at_risk_checkin', TRUE, 'condition', '{"days_since_visit": 14}', 'send_message', '{"channel": "email", "template_key": "at_risk", "tone": "gentle"}', TRUE, 0.75, 14),
(NULL, 'Win-Back Offer', 'Special offer after 30+ days', 'recovery', 'win_back_30', TRUE, 'condition', '{"days_since_visit": 30}', 'send_message', '{"channel": "email", "template_key": "win_back", "include_offer": true, "bonus_points": 50}', TRUE, 0.70, 30),
(NULL, 'Lapsed Member Recovery', 'Aggressive offer after 60+ days', 'recovery', 'lapsed_60', TRUE, 'condition', '{"days_since_visit": 60}', 'send_message', '{"channel": "email", "template_key": "lapsed", "include_offer": true, "bonus_points": 100, "multiplier": 2.0}', TRUE, 0.65, 60),
(NULL, 'Churned Reactivation', 'Last chance after 90+ days', 'recovery', 'churned_90', TRUE, 'condition', '{"days_since_visit": 90}', 'send_message', '{"channel": "email", "template_key": "churned", "include_survey": true, "bonus_points": 200}', TRUE, 0.60, 90);

-- Behavioral Triggers
INSERT INTO automation_definitions (organization_id, name, description, category, template_key, is_template, trigger_type, trigger_event, trigger_condition, action_type, action_config, ai_can_enable, confidence_threshold) VALUES
(NULL, 'High Spender Recognition', 'Thank big spenders', 'behavioral', 'high_spender', TRUE, 'event', 'transaction', '{"amount_gte": 100}', 'send_message', '{"channel": "push", "template_key": "high_spender", "consider_vip_invite": true}', TRUE, 0.80),
(NULL, 'Referral Thanks', 'Thank for successful referral', 'behavioral', 'referral_thanks', TRUE, 'event', 'referral_completed', NULL, 'award_points', '{"points": 100, "reason": "Thanks for referring a friend!"}', TRUE, 0.90),
(NULL, 'Review Request', 'Ask for review after 3+ visits', 'behavioral', 'review_request', TRUE, 'condition', NULL, '{"visit_count_gte": 3, "no_review_requested": true}', 'send_message', '{"channel": "email", "template_key": "review_request", "platforms": ["google", "yelp"]}', TRUE, 0.70),
(NULL, 'Redemption Follow-up', 'Ask about reward experience', 'behavioral', 'redemption_followup', TRUE, 'event', 'reward_redeemed', NULL, 'send_message', '{"channel": "push", "template_key": "redemption_followup", "delay_hours": 24}', TRUE, 0.75),
(NULL, 'Points Milestone', 'Celebrate reaching point milestones', 'behavioral', 'points_milestone', TRUE, 'event', 'points_milestone', '{"milestones": [500, 1000, 2500, 5000]}', 'send_message', '{"channel": "push", "template_key": "points_milestone"}', TRUE, 0.85);

-- Proactive Campaigns (AI-Initiated)
INSERT INTO automation_definitions (organization_id, name, description, category, template_key, is_template, trigger_type, action_type, action_config, ai_can_enable, ai_can_trigger, confidence_threshold) VALUES
(NULL, 'Slow Day Boost', 'Flash promo on predicted slow days', 'proactive', 'slow_day_boost', TRUE, 'ai', 'create_promo', '{"multiplier": 2.0, "duration_hours": 6, "segment": "active"}', TRUE, TRUE, 0.60),
(NULL, 'Weather Response', 'Comfort promo during bad weather', 'proactive', 'weather_response', TRUE, 'ai', 'send_message', '{"channel": "push", "template_key": "weather_comfort"}', TRUE, TRUE, 0.55),
(NULL, 'Seasonal Prep', 'Pre-holiday engagement', 'proactive', 'seasonal_prep', TRUE, 'ai', 'send_message', '{"channel": "email", "template_key": "seasonal"}', TRUE, TRUE, 0.65);

-- ============================================================================
-- 2. MESSAGE TEMPLATE SEEDS (Multi-language)
-- ============================================================================

-- System templates (organization_id = NULL, is_system = TRUE)

-- Welcome templates
INSERT INTO message_templates (organization_id, template_key, channel, locale, subject, title, body, is_system, variables) VALUES
(NULL, 'welcome', 'email', 'en', 'Welcome to {{business_name}}! 🎉', NULL, 'Hi {{name}},\n\nWelcome to our loyalty program! You''ve just earned {{points}} points for signing up.\n\nStart earning more with every visit. We can''t wait to see you!\n\nBest,\n{{business_name}}', TRUE, '["name", "points", "business_name"]'),
(NULL, 'welcome', 'email', 'es', '¡Bienvenido a {{business_name}}! 🎉', NULL, 'Hola {{name}},\n\n¡Bienvenido a nuestro programa de lealtad! Acabas de ganar {{points}} puntos por registrarte.\n\nComienza a ganar más con cada visita. ¡Te esperamos!\n\nSaludos,\n{{business_name}}', TRUE, '["name", "points", "business_name"]'),
(NULL, 'welcome', 'email', 'fr', 'Bienvenue chez {{business_name}} ! 🎉', NULL, 'Bonjour {{name}},\n\nBienvenue dans notre programme de fidélité ! Vous venez de gagner {{points}} points pour votre inscription.\n\nCommencez à gagner plus à chaque visite. Nous avons hâte de vous voir !\n\nCordialement,\n{{business_name}}', TRUE, '["name", "points", "business_name"]'),
(NULL, 'welcome', 'email', 'de', 'Willkommen bei {{business_name}}! 🎉', NULL, 'Hallo {{name}},\n\nWillkommen in unserem Treueprogramm! Du hast gerade {{points}} Punkte für deine Anmeldung erhalten.\n\nSammle bei jedem Besuch mehr Punkte. Wir freuen uns auf dich!\n\nMit freundlichen Grüßen,\n{{business_name}}', TRUE, '["name", "points", "business_name"]'),
(NULL, 'welcome', 'push', 'en', NULL, 'Welcome aboard! 🎉', 'You just earned {{points}} points. Start collecting rewards!', TRUE, '["points"]'),
(NULL, 'welcome', 'push', 'es', NULL, '¡Bienvenido! 🎉', 'Acabas de ganar {{points}} puntos. ¡Comienza a coleccionar recompensas!', TRUE, '["points"]');

-- Birthday templates
INSERT INTO message_templates (organization_id, template_key, channel, locale, subject, title, body, is_system, variables) VALUES
(NULL, 'birthday', 'email', 'en', 'Happy Birthday, {{name}}! 🎂', NULL, 'Happy Birthday, {{name}}!\n\nTo celebrate your special day, we''re giving you {{bonus_points}} bonus points!\n\nEnjoy your day and treat yourself to something special.\n\nCheers,\n{{business_name}}', TRUE, '["name", "bonus_points", "business_name"]'),
(NULL, 'birthday', 'email', 'es', '¡Feliz cumpleaños, {{name}}! 🎂', NULL, '¡Feliz cumpleaños, {{name}}!\n\nPara celebrar tu día especial, te regalamos {{bonus_points}} puntos de bonificación.\n\nDisfruta tu día y date un gusto.\n\n¡Salud!\n{{business_name}}', TRUE, '["name", "bonus_points", "business_name"]'),
(NULL, 'birthday', 'email', 'fr', 'Joyeux anniversaire, {{name}} ! 🎂', NULL, 'Joyeux anniversaire, {{name}} !\n\nPour célébrer votre journée spéciale, nous vous offrons {{bonus_points}} points bonus !\n\nProfitez de votre journée et faites-vous plaisir.\n\nBien à vous,\n{{business_name}}', TRUE, '["name", "bonus_points", "business_name"]'),
(NULL, 'birthday', 'email', 'de', 'Alles Gute zum Geburtstag, {{name}}! 🎂', NULL, 'Alles Gute zum Geburtstag, {{name}}!\n\nUm deinen besonderen Tag zu feiern, schenken wir dir {{bonus_points}} Bonuspunkte!\n\nGenieß deinen Tag und gönn dir etwas Besonderes.\n\nHerzliche Grüße,\n{{business_name}}', TRUE, '["name", "bonus_points", "business_name"]'),
(NULL, 'birthday', 'email', 'ja', '{{name}}様、お誕生日おめでとうございます！ 🎂', NULL, '{{name}}様\n\nお誕生日おめでとうございます！\n\n特別な日をお祝いして、{{bonus_points}}ボーナスポイントをプレゼントいたします。\n\n素敵な一日をお過ごしください。\n\n{{business_name}}', TRUE, '["name", "bonus_points", "business_name"]'),
(NULL, 'birthday', 'push', 'en', NULL, 'Happy Birthday! 🎂', '{{bonus_points}} bonus points are waiting for you!', TRUE, '["bonus_points"]');

-- Win-back templates
INSERT INTO message_templates (organization_id, template_key, channel, locale, subject, title, body, is_system, variables) VALUES
(NULL, 'win_back', 'email', 'en', 'We miss you, {{name}}! 💙', NULL, 'Hi {{name}},\n\nIt''s been a while since your last visit, and we miss you!\n\nHere''s {{bonus_points}} bonus points to welcome you back. They''re waiting for your next visit.\n\nHope to see you soon!\n\n{{business_name}}', TRUE, '["name", "bonus_points", "business_name"]'),
(NULL, 'win_back', 'email', 'es', '¡Te extrañamos, {{name}}! 💙', NULL, 'Hola {{name}},\n\nHa pasado tiempo desde tu última visita, ¡y te extrañamos!\n\nAquí tienes {{bonus_points}} puntos de bonificación para darte la bienvenida. Te esperan en tu próxima visita.\n\n¡Esperamos verte pronto!\n\n{{business_name}}', TRUE, '["name", "bonus_points", "business_name"]'),
(NULL, 'win_back', 'email', 'fr', 'Tu nous manques, {{name}} ! 💙', NULL, 'Bonjour {{name}},\n\nCela fait un moment depuis ta dernière visite, et tu nous manques !\n\nVoici {{bonus_points}} points bonus pour te souhaiter la bienvenue. Ils t''attendent lors de ta prochaine visite.\n\nÀ très bientôt !\n\n{{business_name}}', TRUE, '["name", "bonus_points", "business_name"]'),
(NULL, 'win_back', 'email', 'de', 'Wir vermissen dich, {{name}}! 💙', NULL, 'Hallo {{name}},\n\nEs ist eine Weile her seit deinem letzten Besuch, und wir vermissen dich!\n\nHier sind {{bonus_points}} Bonuspunkte zur Begrüßung. Sie warten auf deinen nächsten Besuch.\n\nWir hoffen, dich bald zu sehen!\n\n{{business_name}}', TRUE, '["name", "bonus_points", "business_name"]'),
(NULL, 'win_back', 'email', 'ja', '{{name}}様、お待ちしておりました 💙', NULL, '{{name}}様\n\nご無沙汰しております。またのお越しを心よりお待ちしておりました。\n\nお帰りの特典として{{bonus_points}}ボーナスポイントをご用意いたしました。\n\n{{business_name}}', TRUE, '["name", "bonus_points", "business_name"]'),
(NULL, 'win_back', 'push', 'en', NULL, 'We miss you! 💙', '{{bonus_points}} points are waiting for your return', TRUE, '["bonus_points"]');

-- At-risk templates
INSERT INTO message_templates (organization_id, template_key, channel, locale, subject, title, body, is_system, variables) VALUES
(NULL, 'at_risk', 'email', 'en', 'How''s everything, {{name}}?', NULL, 'Hi {{name}},\n\nJust checking in! We noticed you haven''t visited in a while.\n\nYou currently have {{points}} points waiting for you. Is there anything we can help with?\n\nWe''d love to see you again!\n\n{{business_name}}', TRUE, '["name", "points", "business_name"]'),
(NULL, 'at_risk', 'email', 'es', '¿Cómo estás, {{name}}?', NULL, 'Hola {{name}},\n\n¡Solo queríamos saludarte! Notamos que no has visitado en un tiempo.\n\nTienes {{points}} puntos esperándote. ¿Hay algo en lo que podamos ayudar?\n\n¡Nos encantaría verte de nuevo!\n\n{{business_name}}', TRUE, '["name", "points", "business_name"]');

-- Points expiring templates
INSERT INTO message_templates (organization_id, template_key, channel, locale, subject, title, body, is_system, variables) VALUES
(NULL, 'points_expiring', 'email', 'en', '{{name}}, your points expire soon!', NULL, 'Hi {{name}},\n\nHeads up! {{expiring_points}} of your points will expire in {{days_until_expiry}} days.\n\nDon''t let them go to waste - visit us soon to use them on a reward!\n\n{{business_name}}', TRUE, '["name", "expiring_points", "days_until_expiry", "business_name"]'),
(NULL, 'points_expiring', 'push', 'en', NULL, 'Points expiring soon! ⏰', '{{expiring_points}} points expire in {{days_until_expiry}} days. Use them now!', TRUE, '["expiring_points", "days_until_expiry"]');

-- Tier upgrade templates
INSERT INTO message_templates (organization_id, template_key, channel, locale, subject, title, body, is_system, variables) VALUES
(NULL, 'tier_upgrade', 'email', 'en', 'Congratulations {{name}}, you''re now {{new_tier}}! 🏆', NULL, 'Amazing news, {{name}}!\n\nYou''ve been upgraded to {{new_tier}} status!\n\nHere''s what you now enjoy:\n{{tier_benefits}}\n\nThank you for your loyalty!\n\n{{business_name}}', TRUE, '["name", "new_tier", "tier_benefits", "business_name"]'),
(NULL, 'tier_upgrade', 'push', 'en', NULL, 'You''re now {{new_tier}}! 🏆', 'Congrats on your upgrade! New perks await.', TRUE, '["new_tier"]');

-- Streak templates
INSERT INTO message_templates (organization_id, template_key, channel, locale, subject, title, body, is_system, variables) VALUES
(NULL, 'streak_bonus', 'push', 'en', NULL, '{{streak_days}}-day streak! 🔥', 'You''re on fire! Here''s {{bonus_points}} bonus points.', TRUE, '["streak_days", "bonus_points"]'),
(NULL, 'streak_bonus', 'push', 'es', NULL, '¡Racha de {{streak_days}} días! 🔥', '¡Estás en llamas! Aquí tienes {{bonus_points}} puntos de bonificación.', TRUE, '["streak_days", "bonus_points"]');

-- Review request templates
INSERT INTO message_templates (organization_id, template_key, channel, locale, subject, title, body, is_system, variables) VALUES
(NULL, 'review_request', 'email', 'en', '{{name}}, how are we doing?', NULL, 'Hi {{name}},\n\nThank you for being a valued member with {{visit_count}} visits!\n\nWe''d love to hear about your experience. Would you take a moment to leave us a review?\n\nYour feedback helps us improve and helps others discover us.\n\nThank you!\n{{business_name}}', TRUE, '["name", "visit_count", "business_name"]');

-- VIP appreciation templates
INSERT INTO message_templates (organization_id, template_key, channel, locale, subject, title, body, is_system, variables) VALUES
(NULL, 'vip_appreciation', 'email', 'en', 'Thank you, {{name}} - Our VIP!', NULL, 'Dear {{name}},\n\nAs one of our most valued {{tier}} members, we want to say thank you!\n\nYou''ve earned {{total_points}} points with us, and we truly appreciate your loyalty.\n\nHere''s an exclusive preview just for you:\n{{exclusive_content}}\n\nWith gratitude,\n{{business_name}}', TRUE, '["name", "tier", "total_points", "exclusive_content", "business_name"]');

-- Milestone templates
INSERT INTO message_templates (organization_id, template_key, channel, locale, subject, title, body, is_system, variables) VALUES
(NULL, 'points_milestone', 'push', 'en', NULL, '{{milestone}} points! 🎯', 'Amazing milestone! You''ve earned {{milestone}} total points.', TRUE, '["milestone"]'),
(NULL, 'points_milestone', 'email', 'en', 'Milestone achieved: {{milestone}} points! 🎯', NULL, 'Congratulations {{name}}!\n\nYou''ve reached an incredible milestone - {{milestone}} total points earned!\n\nThank you for your continued loyalty. Here''s to many more milestones together!\n\n{{business_name}}', TRUE, '["name", "milestone", "business_name"]');
