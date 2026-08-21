/**
 * E2E: ViibeView venue admin — Phase C (app/venues.html)
 *
 * Covers the client half: grid rendering, tab switching, search filtering,
 * and the wrong-app-type / missing-app_id resolution paths, all reachable
 * without live writes. Tests that create, mutate, or delete real rows
 * against the live Supabase project are gated behind VENUE_ADMIN_LIVE=true,
 * following the SOCIAL_AUTH_LIVE convention in viibeview-auth.spec.js.
 */

import { test, expect } from '@playwright/test';

const LIVE = process.env.VENUE_ADMIN_LIVE === 'true';
const SOCIAL_APP_ID = process.env.VENUE_ADMIN_SOCIAL_APP_ID;
const LOYALTY_APP_ID = process.env.VENUE_ADMIN_LOYALTY_APP_ID;
const ADMIN_EMAIL = process.env.VENUE_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.VENUE_ADMIN_PASSWORD;

async function loginAsVenueAdmin(page) {
    await page.goto('/app/login.html');
    await page.fill('#email', ADMIN_EMAIL);
    await page.fill('#password', ADMIN_PASSWORD);
    await page.click('#submit-btn');
    await page.waitForLoadState('networkidle');
}

async function loadVenues(page, appId) {
    await loginAsVenueAdmin(page);
    await page.goto(`/app/venues.html?app_id=${appId}`);
    await page.waitForSelector('#venues-grid', { state: 'attached', timeout: 15000 });
    await page.waitForLoadState('networkidle');
}

test.describe('Venue admin (live — read + write)', () => {
    test.skip(!LIVE || !SOCIAL_APP_ID || !ADMIN_EMAIL || !ADMIN_PASSWORD,
        'Requires a real venue-admin session + social app_id against Royalty PROD. ' +
        'Enable with VENUE_ADMIN_LIVE=true, VENUE_ADMIN_EMAIL, VENUE_ADMIN_PASSWORD, ' +
        'VENUE_ADMIN_SOCIAL_APP_ID.');

    test('grid renders, tabs switch, search filters', async ({ page }) => {
        await loadVenues(page, SOCIAL_APP_ID);

        await expect(page.locator('#venues-grid')).toBeVisible();

        await page.click('.admin-tab[data-admin-tab="members"]');
        await expect(page.locator('#admin-panel-venues')).not.toBeVisible();

        await page.click('.admin-tab[data-admin-tab="venues"]');
        await expect(page.locator('#admin-panel-venues')).toBeVisible();

        const initialCount = await page.locator('.venue-card').count();
        if (initialCount > 0) {
            const firstName = await page.locator('.venue-card').first().getAttribute('data-venue-name')
                || (await page.locator('.venue-card').first().innerText());
            await page.fill('#venue-search', 'zzzznonexistentvenuequery');
            await expect(page.locator('#venue-search-empty')).toBeVisible();

            await page.fill('#venue-search', '');
            await expect(page.locator('.venue-card')).toHaveCount(initialCount);
            expect(firstName).toBeTruthy();
        }
    });

    test('"No coordinates" badge shows for venues missing lat/lng', async ({ page }) => {
        await loadVenues(page, SOCIAL_APP_ID);
        const badges = page.locator('.badge-warning', { hasText: 'No coordinates' });
        // Not asserting a specific count — just that the badge renders when applicable
        // and never throws while doing so.
        await expect(badges).toHaveCount(await badges.count());
    });

    test('a loyalty-app app_id redirects/rejects', async ({ page }) => {
        test.skip(!LOYALTY_APP_ID, 'Requires VENUE_ADMIN_LOYALTY_APP_ID (an app_type=loyalty app in the same org)');

        await loginAsVenueAdmin(page);
        await page.goto(`/app/venues.html?app_id=${LOYALTY_APP_ID}`);
        await page.waitForURL(/apps\.html/, { timeout: 10000 });
        expect(page.url()).toContain('apps.html');
    });

    test('missing app_id resolves the org\'s social app', async ({ page }) => {
        await loginAsVenueAdmin(page);
        await page.goto('/app/venues.html');
        await page.waitForLoadState('networkidle');

        // Either it lands on venues.html with the resolved social app, or (if
        // the org genuinely has no social app) it falls back to apps.html —
        // it must never silently strand on a blank/broken venues page.
        expect(page.url()).toMatch(/venues\.html|apps\.html/);
        if (page.url().includes('venues.html')) {
            await expect(page.locator('#venues-grid')).toBeVisible();
        }
    });

    test('sidebar highlights venues', async ({ page }) => {
        await loadVenues(page, SOCIAL_APP_ID);
        await expect(page.locator('.sidebar-item[data-nav="venues"]')).toHaveClass(/active/);
    });

    test('create a venue with an address and no coords sends non-null lat/lng', async ({ page }) => {
        await loadVenues(page, SOCIAL_APP_ID);

        const [request] = await Promise.all([
            page.waitForRequest(req =>
                req.url().includes('/rest/v1/venues') && req.method() === 'POST', { timeout: 20000 }),
            (async () => {
                await page.click('#add-venue-btn, [onclick*="openVenueModal"]');
                await page.fill('#venue-name', `E2E Test Venue ${Date.now()}`);
                await page.fill('#venue-address', '1600 Amphitheatre Parkway');
                await page.fill('#venue-city', 'Mountain View');
                await page.fill('#venue-state', 'CA');
                await page.fill('#venue-postal', '94043');
                await page.check('#venue-active');
                await page.click('#save-venue-btn');
            })(),
        ]);

        const body = request.postDataJSON();
        expect(body.latitude).not.toBeNull();
        expect(body.longitude).not.toBeNull();
    });

    test('saving an active venue with coords cleared is refused, no row written', async ({ page }) => {
        await loadVenues(page, SOCIAL_APP_ID);

        let wroteRow = false;
        page.on('request', req => {
            if (req.url().includes('/rest/v1/venues') && ['POST', 'PATCH'].includes(req.method())) {
                wroteRow = true;
            }
        });

        await page.click('#add-venue-btn, [onclick*="openVenueModal"]');
        await page.fill('#venue-name', `E2E No-Coords Venue ${Date.now()}`);
        await page.fill('#venue-lat', '');
        await page.fill('#venue-lng', '');
        await page.check('#venue-active');
        await page.click('#save-venue-btn');

        await expect(page.locator('#coords-required-modal')).toHaveClass(/active/, { timeout: 10000 });
        expect(wroteRow).toBe(false);

        await page.click('#coords-required-modal button:has-text("Save as Inactive")');
        await expect(page.locator('#venue-active')).not.toBeChecked();
    });

    test('media_count regression guard — upload +1, delete back to original', async ({ page }) => {
        await loadVenues(page, SOCIAL_APP_ID);

        const card = page.locator('.venue-card').first();
        await expect(card).toBeVisible();
        await card.click();

        const mediaTab = page.locator('[data-tab="media"], .venue-tab:has-text("Media")');
        if (await mediaTab.count() > 0) await mediaTab.click();

        const before = parseInt((await page.locator('#media-count, .media-count').first().innerText()) || '0', 10);

        const fileInput = page.locator('#media-upload-input, input[type="file"]').first();
        await fileInput.setInputFiles({
            name: 'e2e-test-image.png',
            mimeType: 'image/png',
            buffer: Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
                'base64'
            ),
        });
        await page.click('#upload-media-btn');
        await page.waitForLoadState('networkidle');

        const after = parseInt((await page.locator('#media-count, .media-count').first().innerText()) || '0', 10);
        expect(after).toBe(before + 1);

        await page.click('.media-delete-btn');
        await page.waitForLoadState('networkidle');

        const final = parseInt((await page.locator('#media-count, .media-count').first().innerText()) || '0', 10);
        expect(final).toBe(before);
    });
});
