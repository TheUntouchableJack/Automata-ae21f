-- Royalty Pro Add-on Migration
-- Adds columns to support Royalty Pro subscription for LTD users
-- Run this after stripe-subscription-migration.sql

-- =====================================================
-- ADD ROYALTY PRO COLUMNS TO ORGANIZATIONS
-- =====================================================

-- Flag indicating if org has active Royalty Pro add-on
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS has_royalty_pro BOOLEAN DEFAULT FALSE;

-- Stripe subscription ID for Royalty Pro (separate from main subscription)
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS royalty_pro_subscription_id TEXT;

-- Status of Royalty Pro subscription: 'active', 'past_due', 'canceled', etc.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS royalty_pro_status TEXT;

-- Index for quick lookups of Royalty Pro subscribers
CREATE INDEX IF NOT EXISTS idx_organizations_royalty_pro ON organizations(has_royalty_pro) WHERE has_royalty_pro = TRUE;

-- =====================================================
-- COMMENT ON COLUMNS
-- =====================================================

COMMENT ON COLUMN organizations.has_royalty_pro IS 'Whether org has active Royalty Pro add-on ($39/mo for LTD users)';
COMMENT ON COLUMN organizations.royalty_pro_subscription_id IS 'Stripe subscription ID for Royalty Pro add-on';
COMMENT ON COLUMN organizations.royalty_pro_status IS 'Status of Royalty Pro subscription: active, past_due, canceled, etc.';
