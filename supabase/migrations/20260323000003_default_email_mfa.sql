-- Default email MFA for all users
-- Email OTP is the recommended MFA method; enable it by default so new
-- signups get email-based 2FA out of the box.

-- 1. Set column defaults for future signups
ALTER TABLE profiles
  ALTER COLUMN mfa_enabled SET DEFAULT true,
  ALTER COLUMN mfa_methods SET DEFAULT '{email}'::text[];

-- 2. Backfill existing users who have no MFA configured
UPDATE profiles
SET mfa_enabled = true, mfa_methods = '{email}'::text[]
WHERE mfa_enabled = false
  AND (mfa_methods IS NULL OR mfa_methods = '{}');
