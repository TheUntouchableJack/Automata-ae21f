-- =====================================================
-- Add AI proposal column to reward_suggestions
-- Royal AI analyzes each suggestion and proposes an optimized reward
-- =====================================================

ALTER TABLE reward_suggestions ADD COLUMN ai_proposal JSONB;

-- ai_proposal stores:
-- {
--   "reward_name": "Free Regular Coffee",
--   "description": "One complimentary regular-size coffee",
--   "points_cost": 180,
--   "category": "Food & Drink",
--   "reasoning": "Based on avg ticket and visit frequency..."
-- }
