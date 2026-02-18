-- Reload PostgREST schema cache after mass function ALTER in migration 000008
-- PostgREST caches function metadata; after altering 188 functions' search_path,
-- the cache is stale and RPC calls return 404
NOTIFY pgrst, 'reload schema';
