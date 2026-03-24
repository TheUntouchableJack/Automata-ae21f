-- Populate roadmap with all built features
-- Updates existing seed items + inserts new deployed features + new ideas

-- 1. Update existing seed items
UPDATE roadmap_items SET status = 'deployed', is_public = true, deployed_at = '2026-02-08' WHERE title = 'Twilio SMS Integration';
UPDATE roadmap_items SET status = 'ideas', is_public = true WHERE title = 'Email Template Builder';
UPDATE roadmap_items SET is_public = true, deployed_at = COALESCE(deployed_at, '2026-02-01') WHERE title IN ('AI-Powered Onboarding', 'Multi-Language Support');
UPDATE roadmap_items SET is_public = true WHERE title IN ('Customer Segmentation', 'Zapier Integration');

-- 2. Insert new DEPLOYED features
INSERT INTO roadmap_items (title, description, category, status, is_public, deployed_at, display_order) VALUES
('Points & Tiers System', 'Earn points through visits, unlock Bronze/Silver/Gold tiers automatically', 'feature', 'deployed', true, '2026-01-28', 1),
('Rewards Catalog & Redemption', 'Create custom rewards, customers redeem with points + unique codes', 'feature', 'deployed', true, '2026-01-28', 2),
('App Builder', 'Build your branded loyalty app in 60 seconds with our 6-step wizard', 'feature', 'deployed', true, '2026-02-01', 3),
('Customer Leaderboard', 'Public leaderboard ranking top members by points earned', 'feature', 'deployed', true, '2026-02-01', 4),
('Dashboard with Live Preview', 'Real-time metrics dashboard with branded app preview panel', 'feature', 'deployed', true, '2026-02-04', 5),
('Customer App', 'Branded mobile-ready app for customers to check points, rewards, and leaderboard', 'feature', 'deployed', true, '2026-02-01', 6),
('AI Intelligence Feed', 'AI-powered recommendations for growing your loyalty program', 'feature', 'deployed', true, '2026-02-06', 7),
('AI Autonomous Mode', 'Let AI run your loyalty program on autopilot with confidence-gated actions', 'feature', 'deployed', true, '2026-02-12', 8),
('AI Learning Loop', 'AI learns from outcomes and adapts strategy over time', 'feature', 'deployed', true, '2026-02-12', 9),
('Automated Campaigns', 'Win-back, birthday, streak, and milestone campaigns that run themselves', 'feature', 'deployed', true, '2026-02-08', 10),
('Resend Email Integration', 'Send emails to customers with delivery tracking and webhooks', 'integration', 'deployed', true, '2026-02-08', 11),
('Stripe Payments', 'Subscription billing and payment processing', 'integration', 'deployed', true, '2026-02-24', 12),
('Customer Fatigue Tracking', 'Smart fatigue scoring prevents over-messaging your customers', 'feature', 'deployed', true, '2026-02-08', 13),
('AI Reward Suggestions', 'Customers suggest rewards, AI analyzes and recommends pricing', 'feature', 'deployed', true, '2026-02-17', 14),
('Blog & Content Generator', 'AI-powered article writing with SEO optimization', 'feature', 'deployed', true, '2026-02-01', 15),
('Venue Discovery', 'Social app type with map-based venue exploration', 'feature', 'deployed', true, '2026-02-25', 16),
('Audit Logging', 'Complete activity tracking for all actions in your account', 'improvement', 'deployed', true, '2026-02-01', 17),
('Soft Delete with Undo', 'Accidentally deleted something? Undo it instantly', 'improvement', 'deployed', true, '2026-02-01', 18),
('Rate Limiting', 'Built-in abuse prevention on all public endpoints', 'improvement', 'deployed', true, '2026-02-01', 19),
('Product Roadmap & Voting', 'Public roadmap where customers vote on features', 'feature', 'deployed', true, '2026-02-01', 20);

-- 3. Insert new IDEAS (future features for customers to vote on)
INSERT INTO roadmap_items (title, description, category, status, is_public, display_order) VALUES
('QR Code Scanner', 'Scan QR codes for instant check-ins at your business', 'feature', 'ideas', true, 1),
('Push Notifications', 'Send push notifications to customers on mobile', 'feature', 'ideas', true, 2),
('Profile Photo Upload', 'Let customers and business owners upload profile photos', 'improvement', 'ideas', true, 3),
('Referral Program', 'Reward customers for referring friends to your business', 'feature', 'ideas', true, 4),
('Analytics Dashboard', 'Advanced charts and insights for business performance', 'feature', 'ideas', true, 5),
('Custom Domain Support', 'Use your own domain for your customer loyalty app', 'improvement', 'ideas', true, 6);
