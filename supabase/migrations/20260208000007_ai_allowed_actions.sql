-- Migration: Add ai_allowed_actions column to organizations
-- Stores which action types Royal AI is allowed to execute autonomously

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS ai_allowed_actions TEXT[] DEFAULT ARRAY['announcements', 'messages', 'promotions', 'automations'];

COMMENT ON COLUMN organizations.ai_allowed_actions IS 'Action types Royal AI can execute: announcements, messages, promotions, points, automations';
