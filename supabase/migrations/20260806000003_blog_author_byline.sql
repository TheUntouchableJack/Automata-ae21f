-- A real name on the byline.
--
-- newsletter_articles tracks created_by/updated_by as auth.users UUIDs, which
-- is provenance, not a byline — there is nowhere to put the name and role a
-- reader (or Google) should see. Until now prerender-blog.mjs emitted
-- author: Organization "Royalty", which is honest but anonymous, and Google
-- treats an identifiable author with a stated role as an E-E-A-T signal.
--
-- Nullable on purpose. Articles without an author_name keep falling back to
-- the Royalty organisation, so nothing has to be backfilled, and nobody has
-- to invent a persona to fill the column.

ALTER TABLE newsletter_articles
  ADD COLUMN IF NOT EXISTS author_name  TEXT,
  ADD COLUMN IF NOT EXISTS author_title TEXT;

COMMENT ON COLUMN newsletter_articles.author_name IS
  'Display name for the byline, e.g. "Jay Whitley Jr.". NULL falls back to '
  'author: Organization "Royalty" in the Article JSON-LD. Only put a real '
  'person here — a fabricated author is worse than no author.';

COMMENT ON COLUMN newsletter_articles.author_title IS
  'Role shown after author_name and emitted as jobTitle, e.g. "Founder".';
