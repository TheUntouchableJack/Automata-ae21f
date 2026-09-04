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

import { test, expect } from '@playwright/test';

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

        // Any chip other than "All" — the list is derived, so "rooftop" is not
        // guaranteed to exist for every tenant.
        await page.click('#filter-pills .pill:not([data-filter-kind="all"])');
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
        const chip = page.locator('#filter-pills .pill:not([data-filter-kind="all"])').first();
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

        const cards = page.locator('#feed-container .feed-card');
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
            const card = document.querySelector('#feed-container .feed-card');
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

        const cards = page.locator('#feed-container .feed-card');
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
        await page.click('.nav-item[data-tab="profile"]');
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

        // Only unattached Viibes route to their author — a venue post opens the
        // venue, which is covered elsewhere. An app whose every post has a
        // venue has nothing to assert here, and pretending otherwise is how a
        // test starts passing against a state it never reached.
        const authorCards = page.locator('#feed-container .feed-card[data-venue-id=""] .feed-venue-info');
        const count = await authorCards.count();
        test.skip(count === 0, 'no venue-less posts in this app yet');

        const clickable = await authorCards.first().getAttribute('onclick');
        test.skip(!clickable || !clickable.includes('openMemberProfile'),
            'the visible venue-less posts predate authorship being recorded');

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
        await page.click('.nav-item[data-tab="profile"]');
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
