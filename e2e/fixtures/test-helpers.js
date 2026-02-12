/**
 * E2E Test Helpers and Fixtures
 * Common utilities for alpha testing
 */

// Test user credentials (create these in Supabase for testing)
export const TEST_OWNER = {
    email: 'alpha-test@royaltyapp.ai',
    password: 'AlphaTest2026!',
    firstName: 'Alpha',
    lastName: 'Tester'
};

// Supabase project URL
export const SUPABASE_URL = 'https://vhpmmfhfwnpmavytoomd.supabase.co';

/**
 * Login helper - authenticates and returns to specified page
 */
export async function login(page, credentials = TEST_OWNER) {
    await page.goto('/app/login.html');
    await page.waitForLoadState('domcontentloaded');

    await page.fill('input[type="email"]', credentials.email);
    await page.fill('input[type="password"]', credentials.password);
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await page.waitForURL(/dashboard|app/, { timeout: 10000 });
    await page.waitForLoadState('domcontentloaded');
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(page) {
    const hasSession = await page.evaluate(() => {
        const keys = Object.keys(localStorage);
        return keys.some(k => k.includes('supabase.auth'));
    });
    return hasSession;
}

/**
 * Logout helper
 */
export async function logout(page) {
    const logoutBtn = page.locator('#logout-btn, button:has-text("Logout"), button:has-text("Sign Out")');
    if (await logoutBtn.count() > 0) {
        await logoutBtn.first().click();
        await page.waitForURL(/login|index/, { timeout: 5000 });
    }
}

/**
 * Wait for toast notification
 */
export async function waitForToast(page, text = null, type = null) {
    const toastSelector = '.toast, .notification, [role="alert"]';
    await page.waitForSelector(toastSelector, { timeout: 5000 });

    if (text) {
        await page.waitForSelector(`${toastSelector}:has-text("${text}")`, { timeout: 5000 });
    }

    return page.locator(toastSelector).first();
}

/**
 * Navigate to settings tab
 */
export async function goToSettingsTab(page, tab) {
    await page.goto('/app/settings.html');
    await page.waitForLoadState('domcontentloaded');

    const tabButton = page.locator(`[data-tab="${tab}"], button:has-text("${tab}")`);
    if (await tabButton.count() > 0) {
        await tabButton.first().click();
        await page.waitForTimeout(300);
    }
}

/**
 * Wait for Stripe checkout modal
 */
export async function waitForStripeCheckout(page) {
    await page.waitForSelector('#checkout-modal, [class*="checkout"]', { timeout: 10000 });
    await page.waitForTimeout(1000); // Wait for Stripe to mount
}

/**
 * Fill Stripe test card
 */
export async function fillStripeTestCard(page, cardNumber = '4242424242424242') {
    // Stripe uses iframes, so we need to switch context
    const stripeFrame = page.frameLocator('iframe[name*="stripe"]').first();

    await stripeFrame.locator('[placeholder*="number"], [name="cardnumber"]').fill(cardNumber);
    await stripeFrame.locator('[placeholder*="MM"], [name="exp-date"]').fill('12/30');
    await stripeFrame.locator('[placeholder*="CVC"], [name="cvc"]').fill('123');
    await stripeFrame.locator('[placeholder*="ZIP"], [name="postal"]').fill('12345');
}

/**
 * Generate unique test email
 */
export function generateTestEmail() {
    const timestamp = Date.now();
    return `alpha-test-${timestamp}@royaltyapp.ai`;
}

/**
 * Wait for page to be ready (using domcontentloaded to avoid WebSocket hangs)
 */
export async function waitForNetworkIdle(page, timeout = 5000) {
    try {
        await page.waitForLoadState('domcontentloaded', { timeout });
        // Give a brief moment for JS to initialize
        await page.waitForTimeout(500);
    } catch (e) {
        // Continue even if timeout
    }
}

/**
 * Check for console errors (excluding expected ones)
 */
export function setupConsoleErrorCapture(page) {
    const errors = [];
    const ignoredPatterns = [
        /supabase/i,
        /auth/i,
        /401/,
        /403/,
        /network/i,
        /Failed to load resource/i
    ];

    page.on('pageerror', (error) => {
        const shouldIgnore = ignoredPatterns.some(p => p.test(error.message));
        if (!shouldIgnore) {
            errors.push(error.message);
        }
    });

    return errors;
}

/**
 * Take screenshot with context
 */
export async function screenshotOnFailure(page, testInfo, name) {
    if (testInfo.status !== testInfo.expectedStatus) {
        await page.screenshot({
            path: `test-results/failures/${name}-${Date.now()}.png`,
            fullPage: true
        });
    }
}
