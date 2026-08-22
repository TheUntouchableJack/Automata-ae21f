/**
 * E2E: Admin nav gates — Phase B (advancedMode privilege-escalation close)
 *
 * Covers the client half without live credentials: sidebar rendering rules
 * for non-admin + Advanced Mode users, verified by driving AppSidebar
 * directly. Direct-nav redirect checks that require a real non-admin
 * session against Royalty PRODUCTION are gated behind ADMIN_GATES_LIVE=true,
 * following the SOCIAL_AUTH_LIVE convention in viibeview-auth.spec.js.
 */

import { test, expect } from '@playwright/test';

const LIVE = process.env.ADMIN_GATES_LIVE === 'true';
const NON_ADMIN_EMAIL = process.env.ADMIN_GATES_NON_ADMIN_EMAIL;
const NON_ADMIN_PASSWORD = process.env.ADMIN_GATES_NON_ADMIN_PASSWORD;

test.describe('Admin nav gates (rendering)', () => {
    test('non-admin + advancedMode=true shows no super-admin-only nav items', async ({ page }) => {
        // login.html doesn't load sidebar.js (no sidebar pre-auth) — inject it
        // directly so AppSidebar can be driven without a live session.
        await page.goto('/app/login.html', { waitUntil: 'domcontentloaded' });
        await page.addScriptTag({ url: '/app/sidebar.js' });

        const html = await page.evaluate(({ isAdmin, advancedMode }) => {
            AppSidebar.init({
                name: 'Test User',
                email: 'test@example.com',
                organization: { name: 'Test Org' },
                role: 'owner',
                isAdmin,
                advancedMode,
            });
            return document.querySelector('.sidebar-nav')?.innerHTML || document.body.innerHTML;
        }, { isAdmin: false, advancedMode: true });

        expect(html).not.toContain('ceo.html');
        expect(html).not.toContain('blog-review.html');
        expect(html).not.toContain('launch-plan.html');
        expect(html).not.toContain('admin.html');

        // The split from Phase B: Apps is advancedOnly, not adminOnly, so it
        // must still show with Advanced Mode on even though isAdmin=false.
        expect(html).toContain('apps.html');
    });

    // ===== Venues nav item =====
    //
    // Until this shipped there was no nav entry for venues.html at all:
    // getCurrentPageId() returned a 'venues' id that nothing matched, and the
    // only in-product link was apps.html → ⋯ → "Manage Venues", behind an
    // advancedOnly item that is off by default. A normal owner had zero
    // clickable path to their own venues.
    test('Venues is rendered but hidden until a social app is confirmed', async ({ page }) => {
        await page.goto('/app/login.html', { waitUntil: 'domcontentloaded' });
        await page.addScriptTag({ url: '/app/sidebar.js' });

        const venues = await page.evaluate(() => {
            AppSidebar.init({
                name: 'Test User',
                email: 'test@example.com',
                organization: { name: 'Test Org' },
                role: 'owner',
                isAdmin: false,
                advancedMode: false,
            });
            const el = document.querySelector('.sidebar-item[data-nav="venues"]');
            return el && { href: el.getAttribute('href'), display: el.style.display };
        });

        // Present in the DOM — so revealing it is a style change, not a re-render.
        expect(venues).not.toBeNull();
        expect(venues.href).toContain('venues.html');
        // Hidden by default: loyalty-only orgs must not see it.
        expect(venues.display).toBe('none');
    });

    test('Venues is not gated behind Advanced Mode or super admin', async ({ page }) => {
        await page.goto('/app/login.html', { waitUntil: 'domcontentloaded' });
        await page.addScriptTag({ url: '/app/sidebar.js' });

        const revealed = await page.evaluate(() => {
            AppSidebar.init({
                name: 'Test User',
                email: 'test@example.com',
                organization: { name: 'Test Org' },
                role: 'member',
                isAdmin: false,
                advancedMode: false,
            });
            // Stand in for updateVenuesNavVisibility() finding a social app;
            // the lookup itself needs a live session.
            const el = document.querySelector('.sidebar-item[data-nav="venues"]');
            el.style.display = '';
            return { display: el.style.display, text: el.textContent.trim() };
        });

        // A plain org member with Advanced Mode off must be able to see it.
        expect(revealed.display).toBe('');
        expect(revealed.text).toContain('Venues');
    });

    test('on venues.html the item renders visible and active', async ({ page }) => {
        await page.goto('/app/login.html', { waitUntil: 'domcontentloaded' });
        await page.addScriptTag({ url: '/app/sidebar.js' });

        const state = await page.evaluate(() => {
            // getCurrentPageId() reads window.location.pathname. venues.html
            // itself is behind requireAuth(), so rewrite the path with
            // pushState rather than navigating into the auth gate.
            const originalPathname = window.location.pathname;
            history.pushState({}, '', '/app/venues.html');

            const host = document.createElement('div');
            host.className = 'app-layout';
            document.body.appendChild(host);
            AppSidebar.render(host, {
                name: 'Test User',
                email: 'test@example.com',
                organization: { name: 'Test Org' },
                isAdmin: false,
                advancedMode: false,
            });

            const el = host.querySelector('.sidebar-item[data-nav="venues"]');
            const result = {
                display: el.style.display,
                active: el.classList.contains('active'),
                pathnameSeen: window.location.pathname,
            };
            history.pushState({}, '', originalPathname);
            return result;
        });

        // Guard: if pushState stopped taking effect, the assertions below would
        // be testing the login page's sidebar instead.
        expect(state.pathnameSeen).toBe('/app/venues.html');

        // The active page always has a matching, visible nav entry — the whole
        // point of retiring the dead getCurrentPageId() reference.
        expect(state.display).toBe('');
        expect(state.active).toBe(true);
    });
});

// ===== Live tests — require a real non-admin Royalty PROD session =====
test.describe('Admin nav gates (live redirects)', () => {
    test.skip(!LIVE || !NON_ADMIN_EMAIL || !NON_ADMIN_PASSWORD,
        'Requires a non-admin Royalty PROD account. Enable with ADMIN_GATES_LIVE=true, ' +
        'ADMIN_GATES_NON_ADMIN_EMAIL and ADMIN_GATES_NON_ADMIN_PASSWORD.');

    async function loginAsNonAdmin(page) {
        await page.goto('/app/login.html');
        await page.fill('#email', NON_ADMIN_EMAIL);
        await page.fill('#password', NON_ADMIN_PASSWORD);
        await page.click('#submit-btn');
        await page.waitForLoadState('networkidle');
    }

    test('direct nav to /app/ceo.html as non-admin redirects to dashboard', async ({ page }) => {
        await loginAsNonAdmin(page);
        await page.goto('/app/ceo.html');
        await page.waitForURL(/dashboard\.html/, { timeout: 10000 });
        expect(page.url()).toContain('dashboard.html');
    });

    test('direct nav to /app/launch-plan.html as non-admin redirects to dashboard', async ({ page }) => {
        await loginAsNonAdmin(page);
        await page.goto('/app/launch-plan.html');
        await page.waitForURL(/dashboard\.html/, { timeout: 10000 });
        expect(page.url()).toContain('dashboard.html');
    });

    test('sidebar on a real session shows no admin-only items for a non-admin user', async ({ page }) => {
        await loginAsNonAdmin(page);
        await page.goto('/app/dashboard.html');
        await page.waitForLoadState('networkidle');

        await expect(page.locator('a[href*="ceo.html"]')).toHaveCount(0);
        await expect(page.locator('a[href*="blog-review.html"]')).toHaveCount(0);
        await expect(page.locator('a[href*="launch-plan.html"]')).toHaveCount(0);
        await expect(page.locator('a[href*="admin.html"]')).toHaveCount(0);
    });
});
