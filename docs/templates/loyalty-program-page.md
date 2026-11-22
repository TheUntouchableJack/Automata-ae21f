# Industry landing page: `/loyalty-program/<industry>`

Pilots (2026-11-22): `coffee-shop`, `barbershop`, `nail-salon`. Judge them on 4 weeks of Search Console data
before adding more. Each page is hand-edited: Google's scaled-content policy penalises pages that differ only
by a swapped noun, so every section has to say something true and specific about that trade.

## Adding a page

1. Copy `loyalty-program/coffee-shop.html` to `loyalty-program/<slug>.html`. Keep the shell (nav, footer,
   analytics, `/styles.css`, `/loyalty-program/industry.css`, `/script.js?v=N`) unchanged.
2. Rewrite the head: `<title>` ≤ 60 characters, meta description ≤ 155, canonical and `og:url` =
   `https://royaltyapp.ai/loyalty-program/<slug>` (the clean URL), FAQPage JSON-LD matching the visible FAQ
   word for word, BreadcrumbList.
3. Rewrite the body, keeping the section order:
   - one H1 and an answer-first box that states the trade's visit rhythm and the reward ladder in visits;
   - the generator form (`action="/" method="get"`, textarea `name="prompt"` maxlength 500 with a sample
     description that contains "called <Name>", hidden `from=industry-<slug>`, `data-industry="<slug>"`);
   - who it's for; reward ideas priced in visits (4-6); a 4-step tier ladder with time-to-reach; 3-4 tips
     (where the QR code goes, birthday, win-back after N days, one trade-specific); 3-4 FAQs;
   - links to the other industry pages (add the new one to every existing page's list too).
4. **Numbers must match the generator.** The rewards and tier ladder on the page are the niche's `rewards`
   and `tiers` in `app/app-config-fallback.js` (NICHES). Add or update the niche first, then quote it. A
   visitor who presses "Build my loyalty app" must get the app the page described.
5. `netlify.toml`: add a `/loyalty-program/<slug>` → `.html` status-200 block next to the others (above the
   `/*` → 404 catch-all). `sitemap.xml`: add the clean URL.
6. `tests/industry-pages.test.js`: add the slug to `PAGES`. Run `npx vitest run`.
7. Check it at 390px and 1280px wide, then submit the URL in Search Console (URL Inspection → Request indexing).

## Rules

- No invented statistics, testimonials or customer names presented as real. The sample business names in the
  generator box are examples and read as such.
- No gradients (CLAUDE.md rule 8). Body text uses `--color-text` / `--color-text-secondary` only.
- English only, like `royalty-vs-loyalty.html`: nav and footer use the shared i18n keys; the body does not.
