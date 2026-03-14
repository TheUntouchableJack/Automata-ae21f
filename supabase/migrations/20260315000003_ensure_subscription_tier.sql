-- Ensure subscription_tier column exists on organizations
-- Referenced by AppUtils.loadOrganization() but was never added via migration
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_tier TEXT;
