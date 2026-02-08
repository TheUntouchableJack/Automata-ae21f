-- Migration: Add timezone, city, state columns for location-aware AI features
-- Run this in Supabase SQL Editor

-- =====================================================
-- 1. ADD TIMEZONE TO ORGANIZATIONS
-- =====================================================

-- Timezone for the business (e.g., 'America/New_York', 'America/Los_Angeles')
-- Used for time-based recommendations and scheduling
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS timezone TEXT;

-- Default to null - can be auto-detected or set by user during onboarding
COMMENT ON COLUMN organizations.timezone IS 'IANA timezone string for the business location';

-- =====================================================
-- 2. ADD CITY AND STATE TO PROJECTS
-- =====================================================

-- City and state for location-based AI features
-- Used by ExternalContext to fetch weather, local events, etc.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS state TEXT;

COMMENT ON COLUMN projects.city IS 'Business city for weather/location-based AI recommendations';
COMMENT ON COLUMN projects.state IS 'Business state/region for weather/location-based AI recommendations';

-- =====================================================
-- SUMMARY
-- =====================================================
-- This migration adds:
-- - organizations.timezone: For time-aware features
-- - projects.city: For weather-based recommendations
-- - projects.state: For location-based recommendations
--
-- These fields power the PlanningCycles module's ability to suggest:
-- - Weather-based promotions ("It's cold, push hot drinks")
-- - Time-zone aware scheduling
-- - Location-specific opportunities
