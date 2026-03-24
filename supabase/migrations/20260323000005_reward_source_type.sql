-- V3.x: Add source_type to reward_suggestions
-- Distinguishes customer suggestions from AI-proactive proposals

ALTER TABLE reward_suggestions
ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'customer';

COMMENT ON COLUMN reward_suggestions.source_type IS 'Origin: customer = from app member, ai_proactive = AI proposed based on business knowledge';
