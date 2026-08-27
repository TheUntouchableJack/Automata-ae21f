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

async function loadApp(page, url = PRETTY_URL) {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('#category-pills .pill', { timeout: 15000 });
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
        const pills = await page.$$('#category-pills .pill');
        expect(pills.length).toBe(VALID.length + 1); // + "All"

        for (const pill of pills) {
            const slug = await pill.getAttribute('data-category');
            sent.length = 0;
            await pill.click();
            await page.waitForTimeout(600);

            expect(sent.length, `"${slug}" triggered no feed reload`).toBeGreaterThan(0);
            const category = sent[sent.length - 1];

            if (slug === 'all') {
                // Must be SQL NULL so `p_category IS NULL OR ...` short-circuits
                expect(category, '"All" must clear the filter, not filter on "all"').toBeNull();
            } else {
                expect(VALID, `pill "${slug}" is not a real venues.category value`).toContain(category);
            }
        }
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

        await page.click('#category-pills .pill[data-category="rooftop"]');
        await page.waitForTimeout(800);

        expect(sent.length, 'category change did not refetch the feed').toBeGreaterThan(before);
    });

    test('category pills stay pinned below the header', async ({ page }) => {
        await loadApp(page);
        const pills = page.locator('#category-pills');
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
        await page.click('#category-pills .pill[data-category="bar"]', { timeout: 5000 });
        await expect(page.locator('#category-pills .pill[data-category="bar"]')).toHaveClass(/active/);
    });

    test('tapping a map pin opens the venue page', async ({ page }) => {
        // Post pins share the map but NOT this class — see the sibling test.
        // If they ever did, this would click a post pin and fail on a change
        // that is perfectly correct.
        await loadApp(page);
        await page.click('.nav-item[data-tab="map"]');
        await page.waitForSelector('.map-pin-wrapper', { timeout: 15000 });

        await page.click('.map-pin-wrapper', { force: true });
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
        // Typing "Bars" has to find a venue whose category column reads "bar".
        await loadApp(page);
        await page.click('.nav-item[data-tab="search"]');
        await page.fill('#search-input', 'Bars');
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

    test('loads without console errors', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

        await loadApp(page);
        await page.waitForTimeout(2000);

        expect(errors, errors.join('\n')).toEqual([]);
    });
});
