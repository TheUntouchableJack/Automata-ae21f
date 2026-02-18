-- =====================================================
-- FIX: Remove birthday references from data collection trigger
-- Bug: initialize_member_data_gaps() references NEW.birthday
--      but app_members table has no birthday column
-- =====================================================

-- Recreate trigger function without birthday reference
CREATE OR REPLACE FUNCTION initialize_member_data_gaps()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_organization_id UUID;
BEGIN
  SELECT organization_id INTO v_organization_id
  FROM customer_apps
  WHERE id = NEW.app_id;

  IF NEW.phone IS NULL OR NEW.phone = '' THEN
    INSERT INTO customer_data_gaps (member_id, organization_id, missing_field, priority_score)
    VALUES (NEW.id, v_organization_id, 'phone', 70)
    ON CONFLICT DO NOTHING;
  END IF;

  IF NEW.email IS NULL OR NEW.email = '' THEN
    INSERT INTO customer_data_gaps (member_id, organization_id, missing_field, priority_score)
    VALUES (NEW.id, v_organization_id, 'email', 60)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Note: birthday column does not exist on app_members yet
  -- When added, re-enable this check

  RETURN NEW;
END;
$$;

-- Also fix update_member_data_gaps which likely has the same issue
CREATE OR REPLACE FUNCTION update_member_data_gaps()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Phone filled in
  IF (OLD.phone IS NULL OR OLD.phone = '') AND NEW.phone IS NOT NULL AND NEW.phone != '' THEN
    DELETE FROM customer_data_gaps
    WHERE member_id = NEW.id AND missing_field = 'phone';
  END IF;

  -- Email filled in
  IF (OLD.email IS NULL OR OLD.email = '') AND NEW.email IS NOT NULL AND NEW.email != '' THEN
    DELETE FROM customer_data_gaps
    WHERE member_id = NEW.id AND missing_field = 'email';
  END IF;

  -- Note: birthday column does not exist on app_members yet

  RETURN NEW;
END;
$$;
