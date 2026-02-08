-- Fix: Grant for create_custom_automation (correct 16-param signature)

DO $$
BEGIN
  GRANT EXECUTE ON FUNCTION create_custom_automation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB, INTEGER, INTEGER, INTEGER, BOOLEAN, TEXT) TO authenticated;
  GRANT EXECUTE ON FUNCTION create_custom_automation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB, INTEGER, INTEGER, INTEGER, BOOLEAN, TEXT) TO service_role;
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'create_custom_automation function not found';
END $$;
