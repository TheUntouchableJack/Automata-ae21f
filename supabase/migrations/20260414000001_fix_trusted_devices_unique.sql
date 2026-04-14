-- Fix trusted_devices: add UNIQUE constraint + backfill email MFA
--
-- Bug 1: upsert in mfaTrustDevice() requires a UNIQUE constraint on
--         (user_id, device_token_hash) to work. Without it, duplicates
--         accumulate and maybeSingle() errors on lookup.
--
-- Bug 2: The 20260323 backfill only added 'email' to users with
--         mfa_enabled=false, missing users who already had TOTP enrolled.

-- 1. Remove duplicate trusted_devices rows (keep latest expires_at per pair)
DELETE FROM trusted_devices td
WHERE td.id NOT IN (
    SELECT DISTINCT ON (user_id, device_token_hash) id
    FROM trusted_devices
    ORDER BY user_id, device_token_hash, expires_at DESC
);

-- 2. Add UNIQUE constraint (required for upsert onConflict to work)
ALTER TABLE trusted_devices
    ADD CONSTRAINT trusted_devices_user_device_unique
    UNIQUE (user_id, device_token_hash);

-- 3. Backfill: ensure all MFA-enabled users have 'email' in their methods
UPDATE profiles
SET mfa_methods = array_append(mfa_methods, 'email')
WHERE mfa_enabled = true
  AND NOT ('email' = ANY(mfa_methods));
