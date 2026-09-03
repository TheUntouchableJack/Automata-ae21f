-- Pay off the grant debt 20260828000005 named and deliberately left alone.
--
-- Why
-- ---
-- 20260828000005 fixed create_social_post and delete_social_post, and its header
-- says in as many words that social_member_signup has the same gap, that it was
-- out of scope for a migration about posting, and that it is "worth its own
-- migration". This is that migration, extended to the two sibling functions from
-- the same file (20260821000002) which carry the identical footer:
--
--     REVOKE ALL ON FUNCTION f(...) FROM PUBLIC;
--     GRANT EXECUTE ON FUNCTION f(...) TO authenticated;
--
-- That reads like "signed-in callers only" and is not. Supabase ships
--
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS
--         TO anon, authenticated, service_role;
--
-- so a function created in `public` is granted EXECUTE to `anon` DIRECTLY, as
-- its own grant. REVOKE ... FROM PUBLIC removes only the implicit PUBLIC grant
-- and leaves the direct one in place. The three lines below are the shape that
-- actually restricts anon, and 20260828000005:46-52 is the only correct example
-- of it in this repo.
--
-- Nothing is exposed today: all three functions gate on auth.uid() and an anon
-- caller gets 'Not authenticated' (or zero rows) without touching data.
-- auth.uid() is the authority and always was. This closes the gap between what
-- the grants say and what they do, before Phase 2 adds five more functions that
-- are supposed to be readable by anon — at which point "which of these is
-- anon-callable?" has to be answerable by reading the footer.
--
-- Scope: GRANTS ONLY. No function body is touched, no table is altered, no
-- return type changes. Nothing needs a client deploy.
--
-- ⚠️ Do NOT copy this footer onto get_venue_feed / get_venues_for_map /
-- get_venue_detail / get_recent_post_pins. Those are anon-readable by design and
-- adding it empties the feed for every signed-out visitor, silently — see
-- 20260828000003:21-28.
--
-- Rollback
-- --------
--   GRANT EXECUTE ON FUNCTION social_member_signup(UUID, TEXT, TEXT, TEXT) TO anon;
--   GRANT EXECUTE ON FUNCTION get_social_member(UUID) TO anon;
--   GRANT EXECUTE ON FUNCTION delete_social_member_data(UUID) TO anon;
--
-- Verify (each should be 42501 "permission denied for function", not 200):
--   for fn in get_social_member delete_social_member_data; do
--     curl -s -o /dev/null -w "$fn %{http_code}\n" -X POST \
--       "$SUPABASE_URL/rest/v1/rpc/$fn" \
--       -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
--       -H 'Content-Type: application/json' -d '{"p_app_id":"<uuid>"}'
--   done


-- ===== 1. social_member_signup =====

REVOKE ALL ON FUNCTION social_member_signup(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION social_member_signup(UUID, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION social_member_signup(UUID, TEXT, TEXT, TEXT) TO authenticated;


-- ===== 2. get_social_member =====

REVOKE ALL ON FUNCTION get_social_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_social_member(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION get_social_member(UUID) TO authenticated;


-- ===== 3. delete_social_member_data =====

REVOKE ALL ON FUNCTION delete_social_member_data(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION delete_social_member_data(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION delete_social_member_data(UUID) TO authenticated;

-- service_role keeps its default grant throughout: the delete-social-account
-- edge function calls delete_social_member_data with the service key.
