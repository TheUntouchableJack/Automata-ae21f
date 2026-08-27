/**
 * E2E: ViibeView / social app type — Phase 1 member accounts
 *
 * Covers the client half of the auth flow: view routing, validation, error
 * copy, and the anonymous-browsing guarantee. Tests that would create real
 * users against the live Supabase project are skipped unless
 * SOCIAL_AUTH_LIVE=true, since this repo points at Royalty PRODUCTION.
 */

import { test, expect } from '@playwright/test';

const URL = '/a/viibeview/social';
const LIVE = process.env.SOCIAL_AUTH_LIVE === 'true';

async function loadApp(page) {
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('#category-pills .pill', { timeout: 15000 });
}

async function openProfileTab(page) {
    await page.click('.nav-item[data-tab="profile"]');
    await page.waitForTimeout(300);
}

test.describe('ViibeView member accounts', () => {

    test('browsing stays anonymous — no auth wall on load', async ({ page }) => {
        await loadApp(page);

        // The overlay exists but must not be showing: feed, map and search are
        // all usable without an account, by design.
        await expect(page.locator('#auth-overlay')).not.toHaveClass(/visible/);
        await expect(page.locator('#feed-container')).toBeAttached();

        await page.click('.nav-item[data-tab="map"]');
        await expect(page.locator('#auth-overlay')).not.toHaveClass(/visible/);
    });

    test('profile tab invites signup when signed out', async ({ page }) => {
        await loadApp(page);
        await openProfileTab(page);

        await expect(page.locator('#profile-signed-out')).toBeVisible();
        await expect(page.locator('#profile-signed-in')).toBeHidden();
        await expect(page.locator('#profile-signup-btn')).toBeVisible();
    });

    test('auth overlay opens and moves between views', async ({ page }) => {
        await loadApp(page);
        await openProfileTab(page);

        await page.click('#profile-login-btn');
        await expect(page.locator('#auth-overlay')).toHaveClass(/visible/);
        await expect(page.locator('#auth-view-login')).toBeVisible();

        // login -> signup -> back to login
        await page.click('#auth-view-login [data-auth-view="signup"]');
        await expect(page.locator('#auth-view-signup')).toBeVisible();
        await expect(page.locator('#auth-view-login')).toBeHidden();

        await page.click('#auth-view-signup [data-auth-view="login"]');
        await expect(page.locator('#auth-view-login')).toBeVisible();

        // login -> forgot
        await page.click('#auth-view-login [data-auth-view="forgot"]');
        await expect(page.locator('#auth-view-forgot')).toBeVisible();
    });

    test('"browse without an account" dismisses the overlay', async ({ page }) => {
        await loadApp(page);
        await openProfileTab(page);
        await page.click('#profile-signup-btn');

        await page.click('#auth-view-signup [data-auth-view="splash"]');
        await page.click('#auth-browse-btn');

        await expect(page.locator('#auth-overlay')).not.toHaveClass(/visible/);
    });

    test('signup validates each field and names the problem', async ({ page }) => {
        await loadApp(page);
        await openProfileTab(page);
        await page.click('#profile-signup-btn');

        // Empty submit — every required field should report its own error.
        // Phone joined that list when it became required.
        await page.click('#signup-submit');
        await expect(page.locator('#signup-first-name-error')).toBeVisible();
        await expect(page.locator('#signup-email-error')).toBeVisible();
        await expect(page.locator('#signup-phone-error')).toBeVisible();
        await expect(page.locator('#signup-password-error')).toBeVisible();
        await expect(page.locator('#signup-terms-error')).toBeVisible();

        // Bad email format (SOW calls this out by name)
        await page.fill('#signup-first-name', 'Sam');
        await page.fill('#signup-email', 'not-an-email');
        await page.click('#signup-submit');
        await expect(page.locator('#signup-email-error')).toContainText(/does not look right/i);

        // Weak password: each rule reported separately
        await page.fill('#signup-email', 'sam@example.com');
        await page.fill('#signup-password', 'short');
        await page.click('#signup-submit');
        await expect(page.locator('#signup-password-error')).toContainText(/at least 8/i);

        await page.fill('#signup-password', 'alllowercase1');
        await page.click('#signup-submit');
        await expect(page.locator('#signup-password-error')).toContainText(/uppercase/i);

        await page.fill('#signup-password', 'NoNumbersHere');
        await page.click('#signup-submit');
        await expect(page.locator('#signup-password-error')).toContainText(/number/i);

        // Mismatched confirmation
        await page.fill('#signup-password', 'ValidPass1');
        await page.fill('#signup-confirm', 'DifferentPass1');
        await page.click('#signup-submit');
        await expect(page.locator('#signup-confirm-error')).toContainText(/do not match/i);

        // Terms unchecked blocks submission even when everything else is valid.
        // "Everything else" now includes the phone number.
        await page.fill('#signup-confirm', 'ValidPass1');
        await page.fill('#signup-phone', '3105550101');
        await page.click('#signup-submit');
        await expect(page.locator('#signup-phone-error')).toBeHidden();
        await expect(page.locator('#signup-terms-error')).toContainText(/Terms/i);
    });

    test('the country selector defaults to a real dial code', async ({ page }) => {
        await loadApp(page);
        await openProfileTab(page);
        await page.click('#profile-signup-btn');

        const select = page.locator('#signup-country');
        await expect(select).toBeVisible();

        // The full ISO list, not a curated handful.
        const optionCount = await select.locator('option').count();
        expect(optionCount).toBeGreaterThan(200);

        // Whatever navigator.language resolves to, it has to carry a dial code —
        // a selected option with no data-dial would post a phone number with no
        // country and land in app_members.phone as a bare local number.
        const dial = await select.evaluate(el => el.selectedOptions[0]?.dataset.dial);
        expect(dial, 'selected country has no dial code').toMatch(/^\d+$/);
    });

    test('password strength meter responds to input', async ({ page }) => {
        await loadApp(page);
        await openProfileTab(page);
        await page.click('#profile-signup-btn');

        const filled = () => page.locator('#signup-strength span.filled').count();

        await page.fill('#signup-password', 'abc');
        expect(await filled()).toBe(0);

        await page.fill('#signup-password', 'Abcdefg1');
        expect(await filled()).toBeGreaterThanOrEqual(3);
    });

    test('phone input formats as you type', async ({ page }) => {
        await loadApp(page);
        await openProfileTab(page);
        await page.click('#profile-signup-btn');

        // The (310) 555-0101 mask is a North American convention and now
        // applies to +1 only, so this assertion is only meaningful once the
        // selected country is confirmed. Playwright runs en-US by default.
        await page.selectOption('#signup-country', 'US');

        await page.fill('#signup-phone', '3105550101');
        await expect(page.locator('#signup-phone')).toHaveValue('(310) 555-0101');

        // Outside +1 the mask has to get out of the way — a French number
        // rendered as (612) 345-678 is not recognisable as anyone's phone.
        await page.selectOption('#signup-country', 'FR');
        await page.fill('#signup-phone', '612345678');
        await expect(page.locator('#signup-phone')).toHaveValue('612345678');
    });

    test('login validates before hitting the network', async ({ page }) => {
        await loadApp(page);
        await openProfileTab(page);
        await page.click('#profile-login-btn');

        await page.fill('#login-email', 'nope');
        await page.fill('#login-password', 'x');
        await page.click('#login-submit');

        await expect(page.locator('#login-form-error')).toContainText(/does not look right/i);
    });

    test('password reset never reveals whether an account exists', async ({ page }) => {
        // Confirming the address would turn this form into an enumeration
        // oracle, so the copy is deliberately identical either way.
        await loadApp(page);
        await openProfileTab(page);
        await page.click('#profile-login-btn');
        await page.click('#auth-view-login [data-auth-view="forgot"]');

        await page.fill('#forgot-email', `definitely-not-a-user-${Date.now()}@example.com`);
        await page.click('#forgot-submit');

        await expect(page.locator('#forgot-form-success')).toContainText(/if that email has an account/i, {
            timeout: 15000,
        });
    });

    test('contact form validates email and message', async ({ page }) => {
        await loadApp(page);
        await openProfileTab(page);
        await page.click('#contact-us-btn-out');

        await expect(page.locator('#contact-sheet')).toHaveClass(/visible/);

        await page.fill('#contact-email', 'bad');
        await page.fill('#contact-message', 'hi');
        await page.click('#contact-submit');

        await expect(page.locator('#contact-email-error')).toBeVisible();
        await expect(page.locator('#contact-message-error')).toContainText(/at least 10/i);
    });

    test('signed-out visitors are prompted, not silently ignored, on post', async ({ page }) => {
        await loadApp(page);

        // The create button is visible to everyone now — posting is open to any
        // signed-in member, and hiding the button was what made a member think
        // the app had no way to post at all. Clicking the real button is the
        // path a visitor actually takes.
        await expect(page.locator('.post-btn')).toBeVisible();
        await page.click('.post-btn');
        await page.waitForTimeout(500);

        await expect(page.locator('#auth-overlay')).toHaveClass(/visible/);
        await expect(page.locator('#auth-view-signup')).toBeVisible();
    });

    test('loads without console errors', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

        await loadApp(page);
        await openProfileTab(page);
        await page.click('#profile-signup-btn');
        await page.waitForTimeout(1000);

        expect(errors, errors.join('\n')).toEqual([]);
    });

    // ===== Live tests — create real users. Opt in explicitly. =====
    test.describe('live signup', () => {
        test.skip(!LIVE, 'Creates real users in Royalty PROD. Enable with SOCIAL_AUTH_LIVE=true');

        test('rejects an already-registered email on the email field', async ({ page }) => {
            await loadApp(page);
            await openProfileTab(page);
            await page.click('#profile-signup-btn');

            await page.fill('#signup-first-name', 'Dupe');
            await page.fill('#signup-email', process.env.SOCIAL_AUTH_EXISTING_EMAIL || 'jay@24hour.design');
            await page.fill('#signup-password', 'ValidPass1');
            await page.fill('#signup-confirm', 'ValidPass1');
            await page.check('#signup-terms');
            await page.click('#signup-submit');

            await expect(page.locator('#signup-email-error')).toContainText(/already registered/i, {
                timeout: 15000,
            });
        });
    });
});
