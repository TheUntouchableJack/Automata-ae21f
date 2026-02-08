-- Migration: Add business intelligence fields for Royal AI info-request cards
-- These fields allow Royal AI to gather and store business context to generate
-- more personalized and relevant suggestions.

-- Add business intel fields to organizations table
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS monthly_revenue INTEGER,
ADD COLUMN IF NOT EXISTS revenue_goal INTEGER,
ADD COLUMN IF NOT EXISTS slow_days TEXT[],
ADD COLUMN IF NOT EXISTS avg_transaction_value INTEGER,
ADD COLUMN IF NOT EXISTS peak_months TEXT[];

-- Add business intel fields to projects table
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS target_age_range TEXT,
ADD COLUMN IF NOT EXISTS retention_driver TEXT,
ADD COLUMN IF NOT EXISTS competitors TEXT,
ADD COLUMN IF NOT EXISTS current_challenge TEXT,
ADD COLUMN IF NOT EXISTS success_vision TEXT;

-- Add comments for documentation
COMMENT ON COLUMN organizations.monthly_revenue IS 'Average monthly revenue in dollars';
COMMENT ON COLUMN organizations.revenue_goal IS 'Revenue goal for the quarter in dollars';
COMMENT ON COLUMN organizations.slow_days IS 'Array of slow business days (e.g., Mon, Tue)';
COMMENT ON COLUMN organizations.avg_transaction_value IS 'Average transaction value in dollars';
COMMENT ON COLUMN organizations.peak_months IS 'Array of busiest months (e.g., Dec, Jul)';

COMMENT ON COLUMN projects.target_age_range IS 'Target customer age range (e.g., 25-34)';
COMMENT ON COLUMN projects.retention_driver IS 'What brings customers back most often';
COMMENT ON COLUMN projects.competitors IS 'Main local competitors';
COMMENT ON COLUMN projects.current_challenge IS 'Biggest current business challenge';
COMMENT ON COLUMN projects.success_vision IS 'What success looks like in 6 months';
