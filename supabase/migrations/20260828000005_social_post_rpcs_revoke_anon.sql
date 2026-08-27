-- Make 20260828000002's grant footer actually restrict anon.
--
-- What was wrong
-- --------------
-- 20260828000002 ends with the house pattern, copied from social_member_signup
-- (20260821000002:176-177):
--
--     REVOKE ALL ON FUNCTION create_social_post(...) FROM PUBLIC;
--     GRANT EXECUTE ON FUNCTION create_social_post(...) TO authenticated;
--
-- That does not do what it reads like. Supabase ships
--
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS
--         TO anon, authenticated, service_role;
--
-- so a function created in `public` by `postgres` is granted EXECUTE to `anon`
-- DIRECTLY, as its own grant. REVOKE ... FROM PUBLIC removes only the implicit
-- PUBLIC grant and leaves the direct one untouched. Measured, not assumed —
-- with the footer in place, an anon-key POST to /rest/v1/rpc/create_social_post
-- returned 200 and ran the function body.
--
-- Nothing was exposed: both functions gate on auth.uid() first and an anon
-- caller gets {success:false, "You must be signed in"} without touching a row.
-- auth.uid() is the authoritative check and always was. But the migration said
-- PUBLIC "has no business executing them" while anon could, and a comment that
-- is quietly false is how the next person builds on a guarantee that is not
-- there.
--
-- Scope: the two functions this feature owns. social_member_signup has the same
-- gap and is deliberately NOT touched here — it is outside this change, it is
-- equally harmless (it also refuses on auth.uid()), and quietly altering an
-- unrelated function's grants in a migration about posting is exactly the kind
-- of surprise this file exists to prevent. Worth its own migration.
--
-- Rollback
-- --------
--   GRANT EXECUTE ON FUNCTION create_social_post(UUID, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER, BIGINT, DECIMAL, DECIMAL) TO anon;
--   GRANT EXECUTE ON FUNCTION delete_social_post(UUID) TO anon;
--
-- Verify (should be 42501 "permission denied for function", not 200):
--   curl -s -o /dev/null -w '%{http_code}\n' -X POST \
--     "$SUPABASE_URL/rest/v1/rpc/delete_social_post" \
--     -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
--     -H 'Content-Type: application/json' -d '{"p_media_id":"<any-uuid>"}'

REVOKE ALL ON FUNCTION create_social_post(UUID, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER, BIGINT, DECIMAL, DECIMAL) FROM anon;
REVOKE ALL ON FUNCTION delete_social_post(UUID) FROM anon;

-- Re-stated so this file is self-contained: the only role that may call these
-- is a signed-in one. service_role keeps its default grant for edge functions.
GRANT EXECUTE ON FUNCTION create_social_post(UUID, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER, BIGINT, DECIMAL, DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_social_post(UUID) TO authenticated;
