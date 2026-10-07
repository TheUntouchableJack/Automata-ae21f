/**
 * E2E: ViibeView / social app type — Phase 0 regression guards
 *
 * These lock down the class of bug that made the social app look functional
 * while being quietly broken. Each one shipped to production and none of them
 * threw an error — the app just showed nothing, or showed demo data, and there
 * was no signal anywhere that something was wrong.
 *
 * Runs against the live `viibeview` app row, so it needs the dev server
 * (playwright.config.js starts it) and network access to Supabase.
 */

// Stubs public venue-media GETs with a tiny decodable clip — see the header of
// e2e/fixtures/test.js. Do NOT import '@playwright/test' directly here; that
// silently reinstates ~230 MB of production egress per run.
import { test, expect } from '../fixtures/test.js';

const PRETTY_URL = '/a/viibeview/social';
const QUERY_URL = '/customer-app/social.html?slug=viibeview';

// Signing in writes to Royalty PRODUCTION (follow edges, and a last_login_at
// touch on a real member row), so the follow round-trip runs only when a real
// member's credentials are supplied. It is skipped, loudly, otherwise —
// reporting green over a test that never signed in is worse than reporting a
// skip.
const TEST_EMAIL = process.env.VIIBEVIEW_TEST_EMAIL;
const TEST_PASSWORD = process.env.VIIBEVIEW_TEST_PASSWORD;
const CAN_SIGN_IN = !!(TEST_EMAIL && TEST_PASSWORD);

async function loadApp(page, url = PRETTY_URL) {
    // ⚠️ Every Playwright context starts with EMPTY localStorage, which to
    // ViibeView means "first ever visit" — so the onboarding overlay (#1) covers
    // the app and intercepts every click in this file. Seed the dismissal so
    // these specs test what they are actually about.
    //
    // addInitScript re-running on page.reload() is CORRECT here: "already
    // onboarded" is precisely the thing that must stay true across a reload.
    //
    // The overlay's own behaviour is covered by the "first run" block, which
    // deliberately does NOT call this helper.
    await page.addInitScript(() => {
        try { localStorage.setItem('viibeview_onboarded_v1', '1'); } catch (e) { /* private mode */ }
    });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('#filter-pills .pill', { timeout: 15000 });
}

/**
 * Pans the map so the VENUE pins are on screen, and asserts at least one was.
 *
 * initMap() centres on the newest POST (social.js:1707-1723), and the newest
 * post in this app is venue-less and thousands of km from its one venue — so
 * the pin is mounted but off-screen, and renderMapPins() skips its fitBounds
 * safety valve whenever post pins exist (:1775). Leaflet keeps the marker in a
 * transformed pane inside a clipped container, which is why waitForSelector
 * resolves and `click({ force: true })` still fails with "Element is outside of
 * the viewport": force skips actionability CHECKS, but Playwright must still
 * compute a click point.
 *
 * Bring the venue into view rather than change where the map looks. That
 * centring rule is deliberate, documented product behaviour, and bending it to
 * suit a harness is the tail wagging the dog.
 *
 * Call this before every `.map-pin-wrapper` click, and click WITHOUT force so
 * the real actionability checks run.
 */
async function bringVenuePinsIntoView(page) {
    const fitted = await page.evaluate(() => {
        // Bare identifiers, not window.* — see the openFirstRealVenue note.
        const geo = filteredVenues().filter(v => v.latitude && v.longitude);
        if (!geo.length || !map) return 0;
        map.fitBounds(L.latLngBounds(geo.map(v => [v.latitude, v.longitude])),
            { padding: [60, 60] });
        return geo.length;
    });
    // Not vacuous: a zero here means nothing was ever brought on screen and the
    // click that follows would be testing the old off-screen state again.
    expect(fitted, 'no venue with coordinates to bring into view').toBeGreaterThan(0);
    await page.waitForTimeout(800);
}

/**
 * Opens the venue page for the app's first REAL venue, driving openVenuePage()
 * directly instead of clicking a map pin.
 *
 * Deliberately not `page.click('.map-pin-wrapper')` — not because that path is
 * broken (bringVenuePinsIntoView() makes it work, and two tests use it), but
 * because these tests are about what the venue PAGE does once open. Going
 * through the map would make them fail on map centring, which the sibling
 * "tapping a map pin opens the venue page" test already owns.
 *
 * Returns null when the app has no real venues — demo venue ids are the strings
 * 'demo-1'..'demo-5', not UUIDs, and nothing server-side accepts them.
 *
 * The id is read from the swim lane's data-venue-id because that is the
 * rendered contract, not because the state is unreachable. `venues` is a
 * top-level `let` in a CLASSIC script (social.html loads social.js with no
 * type="module"), so it lands in the global lexical environment: `window.venues`
 * is undefined, but a bare `venues` inside page.evaluate() resolves fine. Only
 * the `window.`-prefixed form fails. Function *declarations* like
 * openVenuePage() do become window properties, which is why the call below works.
 */
async function openFirstRealVenue(page) {
    await page.click('.nav-item[data-tab="map"]');
    await page.waitForTimeout(1200);

    const ids = await page.locator('#venue-swim-lane .swim-card').evaluateAll(
        cards => cards.map(c => c.dataset.venueId)
    );
    const venueId = ids.find(id => id && !id.startsWith('demo-')) || null;
    if (!venueId) return null;

    await page.evaluate(id => window.openVenuePage(id), venueId);
    await page.waitForTimeout(1500);
    return venueId;
}

test.describe('ViibeView social app', () => {
    test('pretty URL /a/:slug/social resolves the app', async ({ page }) => {
        // The Netlify/Vite rewrite is server-side: the browser stays on
        // /a/viibeview/social with an empty location.search, so reading the
        // slug from the query string alone produced "App not found".
        const failed = [];
        page.on('response', r => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });

        await loadApp(page, PRETTY_URL);

        await expect(page.locator('body')).not.toHaveText(/App not found/);
        await expect(page.locator('#header-app-name')).toHaveText('ViibeView');

        // Relative asset paths 404 under this route — the page rendered as
        // unstyled HTML in production.
        expect(failed, `unexpected failed requests:\n${failed.join('\n')}`).toEqual([]);
    });

    test('both entry URLs render the same app', async ({ page }) => {
        await loadApp(page, QUERY_URL);
        await expect(page.locator('#header-app-name')).toHaveText('ViibeView');
    });

    test('every category pill sends a slug the database can match', async ({ page }) => {
        // The original bug, in two parts: the "All" pill sent the literal
        // string 'all' (so the RPC filtered WHERE category = 'all' and matched
        // nothing), and the rest sent plurals against singular column values.
        const sent = [];
        page.on('request', r => {
            if (!r.url().includes('/rest/v1/rpc/get_venue_feed')) return;
            try { sent.push(JSON.parse(r.postData() || '{}').p_category); } catch { /* ignore */ }
        });

        await loadApp(page);

        const VALID = ['nightlife', 'bar', 'club', 'restaurant', 'lounge', 'rooftop', 'event_space'];
        const pillRow = page.locator('#filter-pills .pill');
        const pillCount = await pillRow.count();

        // The chip list is DERIVED from the venues this app has, so its length
        // is not fixed. What must hold is that "All" is present and every
        // category chip carries a real venues.category value.
        expect(pillCount, 'no filter chips rendered at all').toBeGreaterThan(0);

        // Re-query by index each iteration rather than holding ElementHandles.
        // The first click runs setFilter() -> renderFilterPills(), which
        // rewrites container.innerHTML (social.js:3523 -> :3433) and detaches
        // every handle resolved beforehand, so `page.$$` up front died on
        // iteration 2 with "Element is not attached to the DOM".
        //
        // Indexing is safe because a filter click changes neither the row's
        // length nor its order — availableFilters() takes the order from
        // window.VENUE_CATEGORIES, not from venue data (social.js:3385-3386),
        // and the Following chip cannot appear mid-loop while signed out. That
        // assumption is asserted below rather than trusted.
        for (let i = 0; i < pillCount; i++) {
            const pill = pillRow.nth(i);
            const kind = await pill.getAttribute('data-filter-kind');
            const slug = await pill.getAttribute('data-filter-value');
            if (kind === 'genre') continue;   // covered by the genre test below
            // The distance chip is a scope, not a category: it carries no
            // venues.category slug and never reaches p_category.
            if (kind === 'distance') continue;

            sent.length = 0;
            await pill.click();
            await page.waitForTimeout(600);

            expect(await pillRow.count(), 'the chip row changed length mid-loop, so the indices no longer line up')
                .toBe(pillCount);
            expect(sent.length, `"${slug}" triggered no feed reload`).toBeGreaterThan(0);
            const category = sent[sent.length - 1];

            if (kind === 'all') {
                // Must be SQL NULL so `p_category IS NULL OR ...` short-circuits
                expect(category, '"All" must clear the filter, not filter on "all"').toBeNull();
            } else {
                expect(VALID, `pill "${slug}" is not a real venues.category value`).toContain(category);
            }
        }
    });

    test('a genre chip filters on p_genre and clears p_category', async ({ page }) => {
        // One row, two axes, one active at a time: picking a genre must null
        // out the category rather than combine with it.
        const sent = [];
        page.on('request', r => {
            if (!r.url().includes('/rest/v1/rpc/get_venue_feed')) return;
            try {
                const b = JSON.parse(r.postData() || '{}');
                sent.push({ category: b.p_category, genre: b.p_genre });
            } catch { /* ignore */ }
        });

        await loadApp(page);

        const genre = page.locator('#filter-pills .pill[data-filter-kind="genre"]').first();
        if (await genre.count() === 0) {
            // Legitimate: no venue in this app has any music set yet, so the
            // row correctly offers no genre chips. Not a failure.
            test.skip(true, 'no genre chips — no venue has music_genres set');
            return;
        }

        const slug = await genre.getAttribute('data-filter-value');
        sent.length = 0;
        await genre.click();
        await page.waitForTimeout(800);

        const last = sent[sent.length - 1];
        expect(last, `"${slug}" triggered no feed reload`).toBeTruthy();
        expect(last.genre).toBe(slug);
        expect(last.category, 'a genre chip must clear the category filter').toBeNull();
    });

    test('changing category still reloads after the feed is exhausted', async ({ page }) => {
        // loadFeed() used to bail on `!append && !feedHasMore`, so once a feed
        // returned a short page every later category change was dropped.
        const sent = [];
        page.on('request', r => {
            if (r.url().includes('/rest/v1/rpc/get_venue_feed')) sent.push(1);
        });

        await loadApp(page);
        await page.waitForTimeout(1500);
        const before = sent.length;

        // Any selectable chip — the list is derived, so "rooftop" is not
        // guaranteed to exist for every tenant.
        // ⚠️ `:not([data-filter-kind="all"])` is NOT enough any more. The row
        // now leads with the DISTANCE chip (#5), which is also a .pill but is
        // not one of the mutually exclusive options — it opens a sheet and never
        // takes .active. Ask for a selectable chip explicitly.
        const SELECTABLE = '#filter-pills .pill[data-filter-kind="category"], #filter-pills .pill[data-filter-kind="genre"]';
        await page.locator(SELECTABLE).first().click();
        await page.waitForTimeout(800);

        expect(sent.length, 'category change did not refetch the feed').toBeGreaterThan(before);
    });

    test('category pills stay pinned below the header', async ({ page }) => {
        await loadApp(page);
        const pills = page.locator('#filter-pills');
        await expect(pills).toHaveCSS('position', 'sticky');

        const headerHeight = await page.locator('.social-header').evaluate(el => el.offsetHeight);
        const top = await pills.evaluate(el => parseInt(el.style.top, 10));
        expect(top).toBe(headerHeight);
    });

    test('the location banner never covers the category pills', async ({ page, context }) => {
        // It was position:fixed at top:56px, laid directly over the pills and
        // swallowed their clicks — denying location disabled filtering.
        await context.clearPermissions();
        await loadApp(page);
        await page.waitForTimeout(1500);

        // Clickable is the assertion that matters; this throws if intercepted.
        // Uses whichever chip the app actually renders — hardcoding "bar" made
        // this fail on any tenant without a bar, which is a data fact, not a
        // regression.
        // ⚠️ `:not([data-filter-kind="all"])` is NOT enough any more. The row
        // now leads with the DISTANCE chip (#5), which is also a .pill but is
        // not one of the mutually exclusive options — it opens a sheet and never
        // takes .active. Ask for a selectable chip explicitly.
        const SELECTABLE = '#filter-pills .pill[data-filter-kind="category"], #filter-pills .pill[data-filter-kind="genre"]';
        const chip = page.locator(SELECTABLE).first();
        await chip.click({ timeout: 5000 });
        await expect(chip).toHaveClass(/active/);
    });

    test('tapping a map pin opens the venue page', async ({ page }) => {
        // Post pins share the map but NOT this class — see the sibling test.
        // If they ever did, this would click a post pin and fail on a change
        // that is perfectly correct.
        await loadApp(page);
        await page.click('.nav-item[data-tab="map"]');
        await page.waitForSelector('.map-pin-wrapper', { timeout: 15000 });

        await bringVenuePinsIntoView(page);

        // No force: with the pin genuinely on screen the real actionability
        // checks run, so this now proves the pin is clickable rather than
        // merely present in the DOM.
        await page.click('.map-pin-wrapper');
        await page.waitForTimeout(1000);

        await expect(page.locator('#venue-page')).toHaveClass(/visible/);
        await expect(page.locator('#venue-page-title')).not.toBeEmpty();
    });

    test('tapping a post pin opens the preview without leaving the map', async ({ page }) => {
        await loadApp(page);
        await page.click('.nav-item[data-tab="map"]');
        await page.waitForTimeout(2000);

        const postPins = page.locator('.map-post-pin-wrapper');
        const count = await postPins.count();

        // Not vacuous: an app with no posted Viibes has no post pins, and the
        // assertion below would pass against zero of them. Say so out loud
        // rather than reporting a green test that checked nothing.
        test.skip(count === 0, 'no posts with coordinates in this app yet');

        await postPins.first().click({ force: true });
        await page.waitForTimeout(600);

        await expect(page.locator('#post-preview-modal')).toHaveClass(/visible/);
        // The map must still be mounted underneath — no switchTab, no
        // openVenuePage.
        await expect(page.locator('#tab-map')).toHaveClass(/active/);
        await expect(page.locator('#venue-page')).not.toHaveClass(/visible/);

        await page.click('#post-preview-close');
        await expect(page.locator('#post-preview-modal')).not.toHaveClass(/visible/);
    });

    test('search opens on the full venue list, not an empty hint', async ({ page }) => {
        await loadApp(page);
        await page.click('.nav-item[data-tab="search"]');
        await page.waitForTimeout(500);

        const cards = page.locator('#search-results .search-result-card');
        const total = await cards.count();
        expect(total, 'browse list rendered no venues').toBeGreaterThan(0);

        // The hint is now reserved for an app that genuinely has no venues.
        await expect(page.locator('#search-empty')).toBeHidden();
        await expect(page.locator('.search-section-title')).toBeVisible();
    });

    test('search matches a category by its display label', async ({ page }) => {
        // Typing a category's LABEL has to find a venue whose category column
        // stores the matching slug — "Bars" against `bar`.
        //
        // The label is derived, not hardcoded. This asserted "Bars" against a
        // tenant whose one venue is `nightlife`, so handleSearch took its
        // zero-results branch (social.js:2142-2144) and never rendered a card:
        // a test failing on a venue this app does not have. Same data-driven
        // rule this file states at :103-105 and applies at :174 and :200.
        await loadApp(page);

        const chip = page.locator('#filter-pills .pill[data-filter-kind="category"]').first();
        if (await chip.count() === 0) {
            // Legitimate: no venue in this app has a category set, so the row
            // correctly offers no category chips and there is no label to type.
            test.skip(true, 'no category chips — no venue has a category set');
            return;
        }

        // The SLUG comes off the chip; window.categoryLabel() maps it. NOT the
        // chip's own text — that has been through I18n.applyTranslations(),
        // while matchesQuery() compares against the untranslated label in
        // js/venue-categories.js, so the two disagree on any non-English locale.
        const slug = await chip.getAttribute('data-filter-value');
        const label = await page.evaluate(s => window.categoryLabel(s), slug);
        expect(label, `no display label for category "${slug}"`).toBeTruthy();

        await page.click('.nav-item[data-tab="search"]');
        await page.fill('#search-input', label);
        await page.waitForTimeout(700);

        await expect(page.locator('#search-results .search-result-card').first()).toBeVisible();
        // The "Search for venues nearby" hint used to stay visible under results
        await expect(page.locator('#search-empty')).toBeHidden();
    });

    test('the feed hides the nav on scroll and offers a way back up', async ({ page }) => {
        await loadApp(page);
        await page.waitForTimeout(2000);

        const cards = page.locator('#feed-container .feed-panel');
        const count = await cards.count();
        test.skip(count === 0, 'no posts in this app yet — nothing to scroll');

        await expect(page.locator('.bottom-nav')).not.toHaveClass(/hidden/);

        // Nav hides past 100px. Back-to-top appears past one full card, so the
        // two are asserted at their own thresholds rather than at one arbitrary
        // offset that may be past neither on a short feed.
        await page.evaluate(() => window.scrollTo(0, 300));
        await page.waitForTimeout(400);
        await expect(page.locator('.bottom-nav')).toHaveClass(/hidden/);

        const reach = await page.evaluate(() => {
            const card = document.querySelector('#feed-container .feed-panel');
            const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
            const threshold = card ? card.offsetHeight : 400;
            if (maxScroll <= threshold) return { ok: false, maxScroll, threshold };
            window.scrollTo(0, threshold + 50);
            return { ok: true, maxScroll, threshold };
        });

        // Not vacuous: on a feed too short to scroll past one card there is
        // nothing to assert, and pretending otherwise is how a test starts
        // passing against a state it never reached.
        if (reach.ok) {
            await page.waitForTimeout(400);
            await expect(page.locator('#back-to-top')).toHaveClass(/visible/);
        }

        // Scrolling back up returns the nav immediately, at any depth.
        await page.evaluate(() => window.scrollBy(0, -200));
        await page.waitForTimeout(400);
        await expect(page.locator('.bottom-nav')).not.toHaveClass(/hidden/);
    });

    test('every feed card is attributable and has a working options menu', async ({ page }) => {
        await loadApp(page);
        await page.waitForTimeout(2000);

        const cards = page.locator('#feed-container .feed-panel');
        const count = await cards.count();
        test.skip(count === 0, 'no posts in this app yet');

        // Nothing may render as an empty byline. Before venue_id was nullable,
        // every member post was forced onto an auto-created "General" venue —
        // the card read "General / General" and linked to a venue nobody made.
        const handles = await page.locator('#feed-container .venue-handle').allTextContents();
        expect(handles.length).toBe(count);
        handles.forEach(h => expect(h.trim().length, 'a card rendered a blank byline').toBeGreaterThan(0));

        // The 3-dots used to be a two-line alias for openVenuePage() with no
        // menu behind it, which is why it read as "does nothing".
        await page.locator('#feed-container .feed-more-btn').first().click();
        await expect(page.locator('#post-options-sheet')).toHaveClass(/visible/);
        await expect(page.locator('#post-options-body .post-option')).not.toHaveCount(0);
        await expect(page.locator('#venue-page')).not.toHaveClass(/visible/);

        await page.click('#post-options-close');
        await expect(page.locator('#post-options-sheet')).not.toHaveClass(/visible/);
    });

    test('dead UI is gone and the rest is bound', async ({ page }) => {
        await loadApp(page);

        // Removed: hamburger that opened nothing, and the unreachable
        // second venue implementation.
        await expect(page.locator('.menu-btn')).toHaveCount(0);
        await expect(page.locator('#venue-sheet')).toHaveCount(0);

        // The Profile tab resolves to a real state instead of the old
        // permanently-"--" card. Signed out that means the signup prompt;
        // the populated card is covered in viibeview-auth.spec.js.
        await page.click('.nav-item[data-tab="settings"]');
        await expect(page.locator('#profile-signed-out')).toBeVisible();
        await expect(page.locator('#profile-signed-in')).toBeHidden();

        // The logout button is inside the signed-in panel and bound, not the
        // dead markup it used to be.
        await expect(page.locator('#logout-btn')).toHaveCount(1);
    });

    // ===== Phase 2: profiles, follows, discovery =====

    test('the Following chip is absent when signed out', async ({ page }) => {
        // get_following_feed is authenticated-only. A chip offered to a
        // signed-out visitor could only ever return an empty feed, which reads
        // as "nobody you follow has posted" rather than "you are signed out".
        await loadApp(page);
        await expect(page.locator('#filter-pills .pill[data-filter-kind="following"]'))
            .toHaveCount(0);
    });

    test('an anonymous visitor can open a member profile from a feed card', async ({ page }) => {
        // The root cause behind "Viewing A Profile", "View Another User's
        // Followers" and "View Another User's Following" all failing together:
        // the author name on a feed card rendered with NO click handler, so
        // there was no route to a member profile from anywhere in the app.
        await loadApp(page);
        await page.waitForTimeout(2000);

        // Headers are AUTHOR-FIRST now, venue or no venue — a post made at a
        // venue reads as its author with an "at {venue}" line beneath, so this
        // no longer has to restrict itself to data-venue-id="". Only a pre-UGC
        // post, whose author was never recorded, has nothing to open.
        const authorCards = page.locator('#feed-container .feed-venue-info[onclick*="openMemberProfile"]');
        const count = await authorCards.count();
        test.skip(count === 0, 'every visible post predates authorship being recorded');

        await authorCards.first().click();
        await page.waitForTimeout(1200);

        await expect(page.locator('#member-page')).toHaveClass(/visible/);
        await expect(page.locator('#member-page-name')).not.toBeEmpty();

        // Anonymous means anonymous: opening a profile must not trip the auth
        // overlay. That is the whole reason get_member_profile ships with no
        // grant footer.
        await expect(page.locator('#auth-overlay')).not.toHaveClass(/visible/);

        // No follow button for a signed-out visitor's view of someone else —
        // it appears, but tapping it is what opens signup. What must NOT
        // happen is the profile refusing to render.
        await expect(page.locator('#member-page-stats .member-stat')).toHaveCount(3);

        await page.click('#member-page-back');
        await expect(page.locator('#member-page')).not.toHaveClass(/visible/);
    });

    test('a post made AT a venue still routes to its author', async ({ page }) => {
        // The gap this closes: postIdentity() used to branch on venue_id FIRST,
        // so a venue-attached post rendered the venue's avatar and opened the
        // venue page — with the author's id, name and avatar sitting unused in
        // the very same payload. There was no route to the author at all.
        await loadApp(page);
        await page.waitForTimeout(2000);

        const venueCards = page.locator('#feed-container .feed-panel:not([data-venue-id=""])');
        const count = await venueCards.count();
        test.skip(count === 0, 'no venue-attached posts in this app yet');

        const header = venueCards.first().locator('.feed-venue-info');
        const onclick = await header.getAttribute('onclick');
        test.skip(!onclick || !onclick.includes('openMemberProfile'),
            'the visible venue posts are venue-authored or predate authorship');

        // The venue is not lost — it moves to a nested subtitle whose own
        // handler stops propagation, so one tap cannot open both.
        const venueLine = header.locator('.venue-location-link');
        await expect(venueLine).toHaveCount(1);
        await expect(venueLine).toHaveAttribute('onclick', /openVenueFromPost/);

        await header.click();
        await page.waitForTimeout(1200);

        await expect(page.locator('#member-page')).toHaveClass(/visible/);
        // Tapping the author must NOT also have opened the venue underneath.
        await expect(page.locator('#venue-page')).not.toHaveClass(/visible/);
    });

    test('the venue page renders a reels grid, and exactly one tile expands', async ({ page }) => {
        // ⚠️ REWRITTEN IN PHASE 4. This used to assert author headers on
        // `#venue-page-feed .feed-card`. The venue page no longer renders
        // cards — it renders an Instagram-style grid of poster frames, and a
        // tile has no header to attribute. The author-attribution invariant
        // did not disappear; it moved to the MEMBER PROFILE, which is where
        // `.feed-card` lives now.
        //
        // What is asserted here instead is the grid's own invariant, and it is
        // the one a two-post tenant can still prove: tiles render media, and
        // tapping expands EXACTLY ONE. "One at a time" is what keeps a single
        // clip playing and is impossible to verify by eye on a short feed.
        await loadApp(page);
        await page.waitForTimeout(2000);

        // ⚠️ Navigate by id, not by clicking a panel's header. The header is
        // author-primary when the post has an author and venue-primary when it
        // does not, so a click path would silently depend on which shape this
        // tenant's data happens to produce.
        const venueId = await page.evaluate(() => {
            const c = document.querySelector('#feed-container .feed-panel:not([data-venue-id=""])');
            return c?.getAttribute('data-venue-id') || null;
        });
        test.skip(!venueId, 'no venue-attached posts in this app yet');

        await page.evaluate(id => window.openVenuePage(id), venueId);
        await expect(page.locator('#venue-page')).toHaveClass(/visible/);
        await page.waitForTimeout(2500);

        const tiles = page.locator('#venue-page-feed .member-grid-tile');
        const count = await tiles.count();
        test.skip(count === 0, 'this venue has no approved posts');

        // Hide-when-empty, from the other direction: with posts, all three
        // elements are showing. The empty case is unit-tested — a tenant with
        // an empty venue is not something this suite can arrange.
        await expect(page.locator('#venue-page-feed-header')).toBeVisible();
        await expect(page.locator('#venue-page-feed-divider')).toBeVisible();

        // Every tile paints something. A tile with neither an <img> nor a
        // <video> is a black square, which is what a wrong preload looks like.
        for (let i = 0; i < count; i++) {
            const media = tiles.nth(i).locator('img, video');
            expect(await media.count(), `tile ${i} rendered no media`).toBeGreaterThan(0);
        }

        // Nothing is expanded until something is tapped.
        await expect(page.locator('#venue-page-feed .member-grid-tile.is-expanded')).toHaveCount(0);

        await tiles.first().click();
        await page.waitForTimeout(600);
        await expect(page.locator('#venue-page-feed .member-grid-tile.is-expanded')).toHaveCount(1);

        // A second tile, when there is one, REPLACES the first rather than
        // joining it. This is the assertion that two clips cannot play at once.
        if (count > 1) {
            await tiles.nth(1).click();
            await page.waitForTimeout(600);
            await expect(page.locator('#venue-page-feed .member-grid-tile.is-expanded')).toHaveCount(1);
        }

        // Tapping the open tile closes it — otherwise the only way out is to
        // open a different one.
        await page.locator('#venue-page-feed .member-grid-tile.is-expanded').click();
        await page.waitForTimeout(600);
        await expect(page.locator('#venue-page-feed .member-grid-tile.is-expanded')).toHaveCount(0);
    });

    test('a private profile explains itself instead of opening blank', async ({ page }) => {
        // get_member_profile returns a ROW with is_private for a private
        // member, not zero rows, precisely so the overlay has something to say.
        // Asserted structurally: the state exists and is hidden until needed.
        await loadApp(page);
        await expect(page.locator('#member-page-private')).toBeHidden();
        await expect(page.locator('#member-page-private')).toBeAttached();
    });

    test('the people sheet opens on discover and closes cleanly', async ({ page }) => {
        // Discover is the only mode reachable without an account: followers and
        // following need a user id, and the Profile tab is signed-out here.
        await loadApp(page);
        await page.evaluate(() => window.openPeopleSheet('discover'));
        await page.waitForTimeout(800);

        await expect(page.locator('#people-sheet')).toHaveClass(/visible/);
        // discover_members is anon-readable, so this must resolve to a real
        // list or a real empty message — never a permission error rendered as
        // an empty box.
        const rows = await page.locator('#people-list .people-row').count();
        const emptyVisible = await page.locator('#people-empty').isVisible();
        expect(rows > 0 || emptyVisible, 'the sheet rendered neither rows nor an empty state').toBe(true);

        await page.click('#people-sheet-close');
        await expect(page.locator('#people-sheet')).not.toHaveClass(/visible/);
        // The body scroll lock is refcounted; closing the only open overlay
        // must release it.
        await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
    });

    test('the venue page offers a Follow button', async ({ page }) => {
        // social.html:259 has promised "follow venues" since the auth overlay
        // shipped, with nothing behind it. This is the control that makes it
        // true. Demo venues are excluded — their ids are not UUIDs and
        // follow_target rejects them.
        await loadApp(page);

        // Zero real venues is a data fact, not a regression — the Follow
        // button is omitted entirely for demo venues.
        const venueId = await openFirstRealVenue(page);
        test.skip(!venueId, 'demo venues only — nothing real to follow');

        await expect(page.locator('#venue-page')).toHaveClass(/visible/);

        const btn = page.locator('#venue-page-follow-btn');
        await expect(btn).toBeVisible();
        // paintFollowButton() is the single writer of the label, so an empty
        // one means the repaint never ran.
        await expect(btn).not.toBeEmpty();

        // Signed out, tapping it must open signup rather than fail silently.
        await btn.click();
        await page.waitForTimeout(800);
        await expect(page.locator('#auth-overlay')).toHaveClass(/visible/);
    });

    test('two overlays deep, closing the inner one keeps the body locked', async ({ page }) => {
        // ⚠️ A real regression, not hygiene. Phase 2 is the first time two
        // full-screen overlays can coexist, and every close path used to write
        // `document.body.style.overflow = ''` unconditionally — so closing the
        // inner overlay unlocked the page underneath the outer one.
        await loadApp(page);

        const venueId = await openFirstRealVenue(page);
        test.skip(!venueId, 'demo venues only — no venue page to nest under');

        await expect(page.locator('#venue-page')).toHaveClass(/visible/);
        await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');

        // Open the people sheet on top, then close it. The venue page is still
        // open, so the lock must survive.
        await page.evaluate(() => window.openPeopleSheet('discover'));
        await page.waitForTimeout(600);
        await page.click('#people-sheet-close');
        await page.waitForTimeout(300);

        await expect(page.locator('#venue-page')).toHaveClass(/visible/);
        await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');

        // And releasing the last one does unlock it.
        await page.click('#venue-page-back');
        await page.waitForTimeout(400);
        await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
    });

    test('signed in: the Following chip appears and follow/unfollow moves the count', async ({ page }) => {
        test.skip(!CAN_SIGN_IN,
            'needs VIIBEVIEW_TEST_EMAIL / VIIBEVIEW_TEST_PASSWORD — this writes follow edges to Royalty PROD');

        await loadApp(page);
        await page.click('.nav-item[data-tab="settings"]');
        await page.click('#profile-login-btn');
        await page.fill('#login-email', TEST_EMAIL);
        await page.fill('#login-password', TEST_PASSWORD);
        await page.click('#login-submit');
        await page.waitForTimeout(2500);

        await expect(page.locator('#profile-signed-in')).toBeVisible();

        // The chip only exists for a signed-in visitor, and onSignedIn() has to
        // rebuild the row for it to appear without a reload.
        await expect(page.locator('#filter-pills .pill[data-filter-kind="following"]'))
            .toHaveCount(1);

        // Follow a venue and watch the button invert. The count that must move
        // is the venue's follower count, which lives server-side — the client
        // cannot compute it, because it excludes soft-deleted members.
        await page.click('.nav-item[data-tab="map"]');
        await page.waitForSelector('.map-pin-wrapper', { timeout: 15000 });
        await bringVenuePinsIntoView(page);
        await page.click('.map-pin-wrapper');
        await page.waitForTimeout(1200);

        const btn = page.locator('#venue-page-follow-btn');
        test.skip(await btn.count() === 0, 'demo venues only — nothing real to follow');

        const before = (await btn.textContent()).trim();
        await btn.click();
        await page.waitForTimeout(1200);
        const after = (await btn.textContent()).trim();
        expect(after, 'the follow button did not change state').not.toBe(before);

        // Persists across a reload — an optimistic repaint that was never
        // written would pass the assertion above and fail this one.
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForSelector('#filter-pills .pill', { timeout: 15000 });
        await page.click('.nav-item[data-tab="map"]');
        await page.waitForSelector('.map-pin-wrapper', { timeout: 15000 });
        await bringVenuePinsIntoView(page);
        await page.click('.map-pin-wrapper');
        await page.waitForTimeout(1500);
        expect((await page.locator('#venue-page-follow-btn').textContent()).trim()).toBe(after);

        // Put it back, so the test is idempotent against a production row.
        await page.click('#venue-page-follow-btn');
        await page.waitForTimeout(1000);
        expect((await page.locator('#venue-page-follow-btn').textContent()).trim()).toBe(before);
    });

    test('loads without console errors', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

        await loadApp(page);
        await page.waitForTimeout(2000);

        expect(errors, errors.join('\n')).toEqual([]);
    });
});

/**
 * The 12-feature batch: onboarding (#1, #2), the distance chip (#5) and the
 * full-screen snap feed (#3, #4, #12).
 *
 * ⚠️ Prod holds one venue and two posts, so anything phrased as "every result
 * is within N miles" passes VACUOUSLY over an empty array. Nothing here is
 * phrased that way: these assert STRUCTURE (what the client sends, what the
 * scroller is, which observer roots where) — the parts that cannot be observed
 * against a two-post tenant at all, and the parts that fail silently.
 */
test.describe('ViibeView — onboarding, distance and the full-screen feed', () => {

    // Deliberately NOT loadApp(): this block is about the FIRST-RUN state that
    // loadApp() seeds away.
    test.describe('first run', () => {
        test('the onboarding overlay covers the app on a fresh device', async ({ page }) => {
            await page.goto(PRETTY_URL, { waitUntil: 'networkidle' });

            const overlay = page.locator('#onboarding-overlay');
            await expect(overlay).toHaveClass(/visible/);
            // Four panels: three intro, one picker.
            await expect(page.locator('#onboarding-track [data-ob-panel]')).toHaveCount(4);
            // Shown to signed-OUT visitors too — anonymous browsing is a
            // supported mode, so gating the intro behind an account would mean
            // most first-time visitors never saw it.
            await expect(page.locator('#auth-overlay')).not.toHaveClass(/visible/);
        });

        test('Skip closes it and it does not come back on reload', async ({ page }) => {
            await page.goto(PRETTY_URL, { waitUntil: 'networkidle' });
            await page.click('#onboarding-skip');
            await expect(page.locator('#onboarding-overlay')).not.toHaveClass(/visible/);

            await page.reload({ waitUntil: 'networkidle' });
            await expect(page.locator('#onboarding-overlay')).not.toHaveClass(/visible/);
        });

        test('the picker offers the shared vocabularies and remembers the picks', async ({ page }) => {
            await page.goto(PRETTY_URL, { waitUntil: 'networkidle' });

            // Not a parallel taxonomy: the chips come from
            // /js/venue-categories.js and /js/music-genres.js.
            const expected = await page.evaluate(() => ({
                categories: VENUE_CATEGORIES.length,
                genres: MUSIC_GENRES.length
            }));
            expect(expected.categories).toBeGreaterThan(0);   // not vacuous
            expect(expected.genres).toBeGreaterThan(0);
            await expect(page.locator('#onboarding-categories .onboarding-chip'))
                .toHaveCount(expected.categories);
            await expect(page.locator('#onboarding-genres .onboarding-chip'))
                .toHaveCount(expected.genres);

            const firstChip = page.locator('#onboarding-categories .onboarding-chip').first();
            const slug = await firstChip.getAttribute('data-ob-slug');
            await firstChip.click();
            await expect(page.locator(`.onboarding-chip[data-ob-slug="${slug}"]`))
                .toHaveAttribute('aria-pressed', 'true');

            await page.click('#onboarding-skip');

            const stored = await page.evaluate(() => localStorage.getItem('viibeview_prefs_v1'));
            expect(JSON.parse(stored).categories).toContain(slug);
        });

        test('the intro never blocks the app permanently — the feed is behind it', async ({ page }) => {
            await page.goto(PRETTY_URL, { waitUntil: 'networkidle' });
            await page.click('#onboarding-skip');
            // The four tabs are reachable the moment it closes.
            await page.click('.nav-item[data-tab="map"]');
            await expect(page.locator('#tab-map')).toHaveClass(/active/);
        });
    });

    test('the distance chip leads the filter row and opens a sheet', async ({ page }) => {
        await loadApp(page);

        const chip = page.locator('#filter-pills .pill-distance');
        await expect(chip).toBeVisible();
        // It leads the row: distance is a SCOPE, not one of the mutually
        // exclusive options, and it opens a dialog rather than selecting.
        await expect(page.locator('#filter-pills > *').first()).toHaveClass(/pill-distance/);
        await expect(chip).toHaveAttribute('aria-haspopup', 'dialog');

        await chip.click();
        await expect(page.locator('#radius-sheet')).toHaveClass(/visible/);
        // Any / 1 / 5 / 25
        await expect(page.locator('#radius-body .radius-option')).toHaveCount(4);
    });

    test('⚠️ choosing a distance never CLEARS the active category', async ({ page }) => {
        await loadApp(page);

        const category = page.locator('#filter-pills .pill[data-filter-kind="category"]').first();
        const count = await page.locator('#filter-pills .pill[data-filter-kind="category"]').count();
        test.skip(count === 0, 'this tenant has no category chips to combine with');

        const slug = await category.getAttribute('data-filter-value');
        await category.click();
        await page.waitForTimeout(500);

        await page.click('#filter-pills .pill-distance');
        await page.click('#radius-body .radius-option[data-radius=""]');   // "Any"
        await page.waitForTimeout(800);

        // Still selected. A distance that reset the category would read as the
        // filter row being broken.
        expect(await page.evaluate(() => activeCategory)).toBe(slug);
    });

    test('⚠️ with no location fix the client sends NO radius', async ({ page, context }) => {
        // A denied location permission must NEVER produce an empty feed. This
        // is the client half of that guarantee; the RPC guards it as well.
        await context.clearPermissions();
        await loadApp(page);

        const sent = await page.evaluate(async () => {
            const calls = [];
            const original = supabaseClient.rpc.bind(supabaseClient);
            supabaseClient.rpc = (name, args) => { calls.push({ name, args }); return original(name, args); };
            await loadFeed(false);
            supabaseClient.rpc = original;
            return calls;
        });

        const feedCall = sent.find(c => c.name.startsWith('get_venue_feed')
                                     || c.name.startsWith('get_following_feed'));
        expect(feedCall, 'loadFeed made no feed RPC call at all').toBeTruthy();
        expect(feedCall.name).toMatch(/_v3$/);
        // Without userLocation both the coords AND the radius must be null.
        const noFix = await page.evaluate(() => !userLocation);
        if (noFix) {
            expect(feedCall.args.p_radius_miles).toBeNull();
            expect(feedCall.args.p_lat).toBeNull();
        }
    });

    test('🔴 the feed scrolls on #feed-container, not on window', async ({ page }) => {
        await loadApp(page);

        const shape = await page.evaluate(() => {
            const el = document.getElementById('feed-container');
            const style = getComputedStyle(el);
            return {
                overflowY: style.overflowY,
                snap: style.scrollSnapType,
                // The body must not be the scroller on this tab.
                bodyScrollable: document.documentElement.scrollHeight
                                > document.documentElement.clientHeight + 8
            };
        });

        expect(shape.overflowY).toBe('auto');
        expect(shape.snap).toContain('y');
        expect(shape.bodyScrollable).toBe(false);
    });

    test('the filter row stays pinned above the scroller', async ({ page }) => {
        await loadApp(page);

        // ⚠️ Measured against #tab-feed, not #feed-container: the scroller is
        // display:none while the feed is empty (so the empty state is not
        // pushed below the fold), and boundingBox() on a hidden element is
        // null — which would make this fail against perfectly correct code on
        // a tenant with no posts.
        const pills = await page.locator('#filter-pills').boundingBox();
        const tab = await page.locator('#tab-feed').boundingBox();
        expect(pills).toBeTruthy();
        expect(tab).toBeTruthy();

        // Chrome above content, by construction rather than by position:sticky.
        expect(pills.y + pills.height).toBeLessThanOrEqual(tab.y + 1);

        // And the tab ends at the nav rather than running under it — this is
        // what sizeFeedViewport() measures, and what a hardcoded calc() gets
        // wrong the moment a banner lands in flow above it.
        const nav = await page.locator('.bottom-nav').boundingBox();
        expect(Math.abs((tab.y + tab.height) - nav.y)).toBeLessThan(2);
    });

    test('panels are one viewport tall and carry every affordance', async ({ page }) => {
        await loadApp(page);

        const panels = page.locator('#feed-container .feed-panel');
        const n = await panels.count();
        // ⚠️ Not vacuous: zero panels would make every assertion below trivially
        // true. If prod has no video posts this must SAY so, not pass.
        test.skip(n === 0, 'this tenant has no video posts to render as panels');

        const first = panels.first();
        const box = await first.boundingBox();
        const containerBox = await page.locator('#feed-container').boundingBox();
        // One panel, one viewport — within a rounding pixel.
        expect(Math.abs(box.height - containerBox.height)).toBeLessThan(2);

        // Nothing was lost in the move to full screen.
        await expect(first.locator('.feed-media')).toBeVisible();
        await expect(first.locator('.feed-panel-more')).toBeVisible();
        await expect(first.locator('.feed-venue-info')).toHaveCount(1);
    });

    test('the load-more sentinel lives INSIDE the scroller', async ({ page }) => {
        await loadApp(page);
        const n = await page.locator('#feed-container .feed-panel').count();
        test.skip(n === 0, 'no panels rendered, so renderFeed() never emitted a sentinel');

        // An IntersectionObserver rooted on the container cannot see a sentinel
        // outside it, and the failure is silent: pagination just stops.
        await expect(page.locator('#feed-container > #load-more-trigger')).toHaveCount(1);
    });

    test('only the visible panel and its neighbours hold a video src', async ({ page }) => {
        await loadApp(page);
        const n = await page.locator('#feed-container .feed-panel video').count();
        test.skip(n < 4, 'needs at least four video panels to observe the hydration window');

        const hydrated = await page.evaluate(() =>
            Array.from(document.querySelectorAll('#feed-container .feed-panel video'))
                 .map(v => v.hasAttribute('src')));
        expect(hydrated.filter(Boolean).length).toBeLessThanOrEqual(3);   // index 0 ± 1
        expect(hydrated[0]).toBe(true);
    });

    test('the owner settings entry point is hidden from a signed-out visitor', async ({ page }) => {
        await loadApp(page);
        await page.click('.nav-item[data-tab="settings"]');
        await expect(page.locator('#app-settings-btn')).toBeHidden();
    });

    test('loads without console errors, with onboarding on screen', async ({ page }) => {
        // The overlay renders chips, dots and translations before init()'s
        // awaits resolve — the most likely place for a boot-time throw.
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

        await page.goto(PRETTY_URL, { waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);
        await page.click('#onboarding-skip');
        await page.waitForTimeout(500);

        expect(errors, errors.join('\n')).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The one test that still touches real production media.
//
// Everything above this line now gets a ~3 KB stub instead of the real venue
// videos (see e2e/fixtures/test.js). That is worth ~230 MB of Supabase cached
// egress per run, but it means those specs no longer prove that a
// `venue_media.url` actually resolves to bytes — a dead URL would render a
// black panel and every assertion would still pass.
//
// This buys that guarantee back for one byte. Deliberately ungated: it is the
// compensating control for the stub, so it must run on every plain
// `npx playwright test`.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('venue media integrity', () => {

    test('a feed post URL resolves to real video bytes in production storage', async ({ page, request }) => {
        await loadApp(page);

        // The stub fulfils requests; it does not rewrite the DOM, so data-src
        // still holds the genuine production URL.
        const url = await page.locator('.feed-panel video[data-src]').first()
            .getAttribute('data-src');

        expect(url, 'no feed video rendered — cannot verify media integrity')
            .toBeTruthy();
        expect(url).toContain('/storage/v1/object/public/venue-media/');

        // `request` is a standalone APIRequestContext, not the page's network
        // stack, so page.route() does not apply and this genuinely leaves the
        // machine. One byte.
        const res = await request.fetch(url, { headers: { Range: 'bytes=0-0' } });

        expect(res.status(), `HEAD-equivalent range request to ${url}`).toBe(206);
        expect(res.headers()['content-type']).toBe('video/mp4');
    });
});
