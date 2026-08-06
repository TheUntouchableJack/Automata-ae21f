-- Somewhere to put the two things about a hero image that need naming.
--
-- newsletter_articles already has og_image_url, but a URL alone can't answer
-- "what is in this picture" or "who took it":
--
--   og_image_alt         Description of the photo for screen readers and for
--                        anyone whose images fail to load. blog.js currently
--                        falls back to alt = article title, which makes a
--                        screen reader announce the headline twice and
--                        describes nothing.
--   og_image_credit      Photographer's name. Pexels' licence does not require
--                        attribution, but we know who took the photo, and a
--                        name costs nothing to carry.
--   og_image_credit_url  Link to the photographer / original photo.
--
-- Purely additive: three nullable columns, no function or policy changes.
-- Articles without them keep rendering exactly as they do today.

ALTER TABLE newsletter_articles
  ADD COLUMN IF NOT EXISTS og_image_alt        TEXT,
  ADD COLUMN IF NOT EXISTS og_image_credit     TEXT,
  ADD COLUMN IF NOT EXISTS og_image_credit_url TEXT;

COMMENT ON COLUMN newsletter_articles.og_image_alt IS
  'Alt text for og_image_url. Describe the photo, not the article — the title '
  'is already the <h1>, and repeating it tells a screen reader nothing new.';

COMMENT ON COLUMN newsletter_articles.og_image_credit IS
  'Photographer or source name for og_image_url (e.g. a Pexels photographer).';

COMMENT ON COLUMN newsletter_articles.og_image_credit_url IS
  'Link for og_image_credit — the photographer profile or original photo page.';
