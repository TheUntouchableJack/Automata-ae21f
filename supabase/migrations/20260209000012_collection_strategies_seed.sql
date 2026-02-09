-- Data Collection Learning System
-- Phase 4: Collection Strategy Templates (Seed Data)
-- Pre-built strategies based on industry best practices

-- ============================================================================
-- PHONE COLLECTION STRATEGIES
-- ============================================================================

-- Receipt via Text (works at checkout)
INSERT INTO collection_strategy_performance (
  industry, business_size, target_field, strategy_type, touchpoint,
  total_attempts, total_successes, avg_conversion_rate, sample_size, confidence_score,
  best_value_proposition, optimal_incentive_points
) VALUES
-- Restaurant industry
('restaurant', NULL, 'phone', 'receipt_sms', 'checkout',
  1000, 350, 0.35, 50, 0.85,
  'Want your receipt texted to you?', 0),
('restaurant', NULL, 'phone', 'order_ready', 'order_placed',
  1000, 550, 0.55, 50, 0.90,
  'We''ll text you when your order is ready', 0),
('restaurant', NULL, 'phone', 'waitlist', 'waitlist_join',
  1000, 700, 0.70, 50, 0.92,
  'We''ll text when your table is ready', 0),

-- Cafe/Bakery
('cafe', NULL, 'phone', 'order_ready', 'order_placed',
  500, 300, 0.60, 30, 0.80,
  'We''ll text when your order is up!', 0),
('cafe', NULL, 'phone', 'receipt_sms', 'checkout',
  500, 175, 0.35, 30, 0.80,
  'Receipt via text?', 0),

-- Retail
('retail', NULL, 'phone', 'receipt_sms', 'checkout',
  800, 320, 0.40, 40, 0.85,
  'Email or text your receipt?', 0),
('retail', NULL, 'phone', 'flash_deals', 'post_visit',
  800, 240, 0.30, 40, 0.80,
  'Get flash deal alerts via text (avg 2/month)', 25),

-- Salon/Barbershop
('salon', NULL, 'phone', 'appointment_reminder', 'booking',
  600, 480, 0.80, 35, 0.88,
  'We''ll text you a reminder before your appointment', 0),
('salon', NULL, 'phone', 'waitlist', 'waitlist_join',
  400, 280, 0.70, 25, 0.82,
  'We''ll text when a spot opens up', 0),

-- Fitness
('fitness', NULL, 'phone', 'class_reminder', 'class_booking',
  500, 375, 0.75, 30, 0.85,
  'Get a reminder text before class?', 0),
('fitness', NULL, 'phone', 'flash_deals', 'post_visit',
  400, 140, 0.35, 25, 0.78,
  'Get notified about limited spots in popular classes', 0),

-- Generic (fallback for unknown industries)
(NULL, NULL, 'phone', 'receipt_sms', 'checkout',
  2000, 700, 0.35, 100, 0.90,
  'Want your receipt texted?', 0),
(NULL, NULL, 'phone', 'points_bonus', 'loyalty_signup',
  2000, 900, 0.45, 100, 0.90,
  'Add your phone for 50 bonus points', 50),
(NULL, NULL, 'phone', 'vip_early_access', 'tier_upgrade',
  1000, 500, 0.50, 50, 0.85,
  'VIP members get new items via text first', 0)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- BIRTHDAY COLLECTION STRATEGIES
-- ============================================================================

INSERT INTO collection_strategy_performance (
  industry, business_size, target_field, strategy_type, touchpoint,
  total_attempts, total_successes, avg_conversion_rate, sample_size, confidence_score,
  best_value_proposition, optimal_incentive_points
) VALUES
-- Restaurant/Cafe/Bakery (free treat works great)
('restaurant', NULL, 'birthday', 'free_treat', 'loyalty_signup',
  1000, 600, 0.60, 50, 0.88,
  'Join our birthday club - free dessert on your day!', 0),
('cafe', NULL, 'birthday', 'free_treat', 'loyalty_signup',
  500, 325, 0.65, 30, 0.85,
  'Free drink on your birthday! Just add your date', 0),
('bakery', NULL, 'birthday', 'free_treat', 'loyalty_signup',
  400, 280, 0.70, 25, 0.82,
  'Free cupcake on your birthday!', 0),

-- Retail (points work better)
('retail', NULL, 'birthday', 'birthday_points', 'profile_update',
  600, 330, 0.55, 35, 0.83,
  'Earn 2x points during your birthday week', 0),

-- Salon
('salon', NULL, 'birthday', 'birthday_discount', 'loyalty_signup',
  400, 260, 0.65, 25, 0.80,
  '20% off any service during your birthday month', 0),

-- Generic
(NULL, NULL, 'birthday', 'free_treat', 'loyalty_signup',
  2000, 1100, 0.55, 100, 0.90,
  'Join our birthday club for a free treat on your day!', 0),
(NULL, NULL, 'birthday', 'birthday_points', 'profile_update',
  1500, 825, 0.55, 75, 0.88,
  'Add your birthday for 100 bonus points on your special day', 100)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- EMAIL COLLECTION STRATEGIES
-- ============================================================================

INSERT INTO collection_strategy_performance (
  industry, business_size, target_field, strategy_type, touchpoint,
  total_attempts, total_successes, avg_conversion_rate, sample_size, confidence_score,
  best_value_proposition, optimal_incentive_points
) VALUES
-- Retail (email works well)
('retail', NULL, 'email', 'digital_receipt', 'checkout',
  1000, 450, 0.45, 50, 0.87,
  'Email your receipt?', 0),
('retail', NULL, 'email', 'weekly_deals', 'post_visit',
  800, 200, 0.25, 40, 0.82,
  'Get our weekly deals email (unsubscribe anytime)', 25),

-- Restaurant
('restaurant', NULL, 'email', 'weekly_specials', 'post_visit',
  600, 150, 0.25, 35, 0.80,
  'Get weekly specials sent to your inbox', 25),

-- Generic
(NULL, NULL, 'email', 'digital_receipt', 'checkout',
  2000, 800, 0.40, 100, 0.90,
  'Email your receipt? (saves paper!)', 0),
(NULL, NULL, 'email', 'weekly_deals', 'post_visit',
  1500, 375, 0.25, 75, 0.85,
  'Get deals via email (1-2 per week, unsubscribe anytime)', 25)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PREFERENCES COLLECTION STRATEGIES
-- ============================================================================

INSERT INTO collection_strategy_performance (
  industry, business_size, target_field, strategy_type, touchpoint,
  total_attempts, total_successes, avg_conversion_rate, sample_size, confidence_score,
  best_value_proposition, optimal_incentive_points
) VALUES
-- Restaurant/Cafe
('restaurant', NULL, 'preferences', 'favorite_item', 'redemption',
  400, 180, 0.45, 25, 0.78,
  'What''s your go-to order? We''ll remember it!', 0),
('cafe', NULL, 'preferences', 'favorite_item', 'post_purchase',
  300, 150, 0.50, 20, 0.75,
  'What''s your usual? Reply: 1=Coffee 2=Tea 3=Smoothie', 0),

-- Salon
('salon', NULL, 'preferences', 'personalization_quiz', 'post_visit',
  300, 120, 0.40, 20, 0.75,
  '30-second quiz to personalize your experience', 50),

-- Fitness
('fitness', NULL, 'preferences', 'workout_preference', 'loyalty_signup',
  400, 160, 0.40, 25, 0.78,
  'What classes interest you? We''ll send relevant schedules', 25),

-- Generic
(NULL, NULL, 'preferences', 'personalization_quiz', 'post_purchase',
  1000, 350, 0.35, 50, 0.85,
  'Quick 30-second quiz for personalized recommendations', 50),
(NULL, NULL, 'preferences', 'favorite_item', 'redemption',
  800, 360, 0.45, 40, 0.82,
  'What''s your favorite? We''ll remember it for next time!', 0)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- CREATE DEFAULT PROFILE COMPLETION REWARDS FOR EXISTING ORGS
-- (Runs only if organizations table exists)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organizations') THEN
    INSERT INTO profile_completion_rewards (organization_id)
    SELECT id FROM organizations
    WHERE id NOT IN (SELECT organization_id FROM profile_completion_rewards)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ============================================================================
-- BACKFILL DATA GAPS FOR EXISTING MEMBERS
-- Note: Run this manually after migration if you have existing data
-- ============================================================================
-- The triggers will automatically create gaps for new members.
-- For existing members, run this one-time backfill:
/*
INSERT INTO customer_data_gaps (member_id, organization_id, missing_field, priority_score)
SELECT m.id, a.organization_id, 'phone', 70
FROM app_members m
JOIN apps a ON m.app_id = a.id
WHERE (m.phone IS NULL OR m.phone = '')
AND m.deleted_at IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO customer_data_gaps (member_id, organization_id, missing_field, priority_score)
SELECT m.id, a.organization_id, 'email', 60
FROM app_members m
JOIN apps a ON m.app_id = a.id
WHERE (m.email IS NULL OR m.email = '')
AND m.deleted_at IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO customer_data_gaps (member_id, organization_id, missing_field, priority_score)
SELECT m.id, a.organization_id, 'birthday', 50
FROM app_members m
JOIN apps a ON m.app_id = a.id
WHERE m.birthday IS NULL
AND m.deleted_at IS NULL
ON CONFLICT DO NOTHING;
*/
