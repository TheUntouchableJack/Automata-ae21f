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
        await loadApp(page);
        await page.click('.nav-item[data-tab="map"]');
        await page.waitForSelector('.map-pin-wrapper', { timeout: 15000 });

        await page.click('.map-pin-wrapper', { force: true });
        await page.waitForTimeout(1000);

        await expect(page.locator('#venue-page')).toHaveClass(/visible/);
        await expect(page.locator('#venue-page-title')).not.toBeEmpty();
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
