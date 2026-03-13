-- Add billing/plan columns to organizations table
-- These were referenced in code (read_own_revenue tool, admin RPCs) but never created
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT 'free';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_lifetime BOOLEAN DEFAULT FALSE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'inactive';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS appsumo_tier INTEGER;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS has_royalty_pro BOOLEAN DEFAULT FALSE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_limits_override JSONB;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_changed_at TIMESTAMPTZ;
