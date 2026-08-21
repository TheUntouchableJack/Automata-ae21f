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
