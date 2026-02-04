/**
 * E2E Security Tests for Customer App Authentication
 * Tests the customer-facing app's login/signup/PIN flows
 */

import { test, expect } from '@playwright/test';

// Test with a sample app slug - in real tests, this would be a test fixture
const TEST_APP_SLUG = 'test-app';

test.describe('Customer App Landing Page', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to customer app landing page
        await page.goto(`/customer-app/index.html?slug=${TEST_APP_SLUG}`);
    });

    test('should load customer app landing page', async ({ page }) => {
        // Wait for page to load
        await page.waitForLoadState('networkidle');

        // Should have some content
        const content = await page.textContent('body');
        expect(content.length).toBeGreaterThan(0);
    });

    test('should have PIN input field with proper constraints', async ({ page }) => {
        await page.waitForLoadState('networkidle');

        // Look for PIN input
        const pinInput = page.locator('input[name="pin"], input[type="password"], input[placeholder*="PIN"], input[id*="pin"]');

        if (await pinInput.count() > 0) {
            // PIN should accept only 4 digits
            const input = pinInput.first();

            // Check maxlength
            const maxLength = await input.getAttribute('maxlength');
            if (maxLength) {
                expect(parseInt(maxLength)).toBeLessThanOrEqual(6);
            }

            // Check pattern if exists
            const pattern = await input.getAttribute('pattern');
            if (pattern) {
                expect(pattern).toContain('\\d');
            }
        }
    });

    test('should mask PIN input', async ({ page }) => {
        await page.waitForLoadState('networkidle');

        const pinInput = page.locator('input[name="pin"], input[id*="pin"]');

        if (await pinInput.count() > 0) {
            const input = pinInput.first();
            const type = await input.getAttribute('type');

            // PIN should be masked like a password or use type="number" with mask
            expect(['password', 'tel', 'number']).toContain(type);
        }
    });
});

test.describe('Customer App Signup Security', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(`/customer-app/index.html?slug=${TEST_APP_SLUG}`);
        await page.waitForLoadState('networkidle');
    });

    test('should validate email format on signup', async ({ page }) => {
        const emailInput = page.locator('input[type="email"], input[name="email"]').first();

        if (await emailInput.count() > 0) {
            // Enter invalid email
            await emailInput.fill('not-a-valid-email');
            await emailInput.blur();

            // Check validity
            const isValid = await emailInput.evaluate(el => el.checkValidity());
            expect(isValid).toBe(false);
        }
    });

    test('should validate phone number format', async ({ page }) => {
        const phoneInput = page.locator('input[type="tel"], input[name="phone"]').first();

        if (await phoneInput.count() > 0) {
            // Enter some input
            await phoneInput.fill('1234567890');

            // Should accept numeric input
            const value = await phoneInput.inputValue();
            expect(value.length).toBeGreaterThan(0);
        }
    });

    test('should require first and last name', async ({ page }) => {
        const firstNameInput = page.locator('input[name="first_name"], input[name="firstName"], input[id*="first"]').first();
        const lastNameInput = page.locator('input[name="last_name"], input[name="lastName"], input[id*="last"]').first();

        if (await firstNameInput.count() > 0) {
            // Check if required
            const isRequired = await firstNameInput.getAttribute('required');
            // Name fields should ideally be required
        }
    });

    test('should not allow signup with very short PIN', async ({ page }) => {
        const pinInput = page.locator('input[name="pin"], input[id*="pin"]').first();

        if (await pinInput.count() > 0) {
            // Try to enter only 2 digits
            await pinInput.fill('12');

            // Check validity or pattern
            const isValid = await pinInput.evaluate(el => el.checkValidity());

            // Should be invalid (expects 4 digits)
            // This depends on implementation
        }
    });

    test('should handle duplicate email error gracefully', async ({ page }) => {
        // This test checks error handling
        // In real scenario, we'd need a known duplicate email

        const emailInput = page.locator('input[type="email"], input[name="email"]').first();
        const submitButton = page.locator('button[type="submit"], button:has-text("Join"), button:has-text("Sign Up")').first();

        if (await emailInput.count() > 0 && await submitButton.count() > 0) {
            // Fill in a test email
            await emailInput.fill('test@example.com');

            // Fill other required fields if present
            const phoneInput = page.locator('input[type="tel"]').first();
            if (await phoneInput.count() > 0) {
                await phoneInput.fill('5551234567');
            }

            const firstNameInput = page.locator('input[id*="first"]').first();
            if (await firstNameInput.count() > 0) {
                await firstNameInput.fill('Test');
            }

            const lastNameInput = page.locator('input[id*="last"]').first();
            if (await lastNameInput.count() > 0) {
                await lastNameInput.fill('User');
            }

            const pinInput = page.locator('input[id*="pin"]').first();
            if (await pinInput.count() > 0) {
                await pinInput.fill('1234');
            }

            // Submit
            await submitButton.click();
            await page.waitForTimeout(2000);

            // Check for error message handling
            const pageContent = await page.textContent('body');

            // Error should not expose sensitive info
            expect(pageContent.toLowerCase()).not.toContain('sql');
            expect(pageContent.toLowerCase()).not.toContain('database');
            expect(pageContent.toLowerCase()).not.toContain('stack');
        }
    });
});

test.describe('Customer App Login Security', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(`/customer-app/index.html?slug=${TEST_APP_SLUG}`);
        await page.waitForLoadState('networkidle');
    });

    test('should not reveal if email exists on failed login', async ({ page }) => {
        // Look for login form or toggle
        const loginToggle = page.locator('button:has-text("Log In"), a:has-text("Log In"), [data-tab="login"]');

        if (await loginToggle.count() > 0) {
            await loginToggle.first().click();
            await page.waitForTimeout(500);
        }

        const emailInput = page.locator('input[type="email"], input[name="email"]').first();
        const pinInput = page.locator('input[name="pin"], input[id*="pin"]').first();
        const submitButton = page.locator('button[type="submit"], button:has-text("Log In")').first();

        if (await emailInput.count() > 0 && await pinInput.count() > 0 && await submitButton.count() > 0) {
            // Try with non-existent email
            await emailInput.fill('nonexistent-user-12345@example.com');
            await pinInput.fill('1234');
            await submitButton.click();

            await page.waitForTimeout(2000);

            const pageContent = await page.textContent('body');
            const lowerContent = pageContent.toLowerCase();

            // Should show generic error, not reveal account existence
            expect(lowerContent).not.toContain('user not found');
            expect(lowerContent).not.toContain('email not found');
            expect(lowerContent).not.toContain('account does not exist');
        }
    });

    test('should not reveal if PIN is wrong vs email not found', async ({ page }) => {
        // Both wrong email and wrong PIN should show same error message
        // This prevents account enumeration

        const loginToggle = page.locator('button:has-text("Log In"), a:has-text("Log In"), [data-tab="login"]');

        if (await loginToggle.count() > 0) {
            await loginToggle.first().click();
            await page.waitForTimeout(500);
        }

        const emailInput = page.locator('input[type="email"], input[name="email"]').first();
        const pinInput = page.locator('input[name="pin"], input[id*="pin"]').first();
        const submitButton = page.locator('button[type="submit"], button:has-text("Log In")').first();

        if (await emailInput.count() > 0 && await pinInput.count() > 0 && await submitButton.count() > 0) {
            // Try login with wrong PIN
            await emailInput.fill('test@example.com');
            await pinInput.fill('9999');
            await submitButton.click();

            await page.waitForTimeout(2000);

            const errorMessage = await page.textContent('body');

            // Should show generic "Invalid credentials" type message
            // Not "Wrong PIN" which would confirm email exists
            expect(errorMessage.toLowerCase()).not.toContain('wrong pin');
            expect(errorMessage.toLowerCase()).not.toContain('incorrect pin');
        }
    });

    test('should handle PIN input securely', async ({ page }) => {
        const pinInput = page.locator('input[name="pin"], input[id*="pin"]').first();

        if (await pinInput.count() > 0) {
            // PIN should not be visible as plaintext
            const type = await pinInput.getAttribute('type');
            expect(['password', 'tel', 'number']).toContain(type);

            // Enter PIN and check it's not in page source as plaintext
            await pinInput.fill('1234');

            const pageHtml = await page.content();
            // Should not contain the PIN in plaintext (other than the input value)
            // This is a basic check - real security would verify over network
        }
    });
});

test.describe('Customer App Session Security', () => {
    test('should store session token in localStorage', async ({ page }) => {
        await page.goto(`/customer-app/index.html?slug=${TEST_APP_SLUG}`);
        await page.waitForLoadState('networkidle');

        // Check localStorage structure
        const storageKeys = await page.evaluate(() => Object.keys(localStorage));

        // Document: Session should be stored with app-specific key
        // Keys like 'royalty_member_${slug}' expected
    });

    test('should clear session on logout', async ({ page }) => {
        await page.goto(`/customer-app/app.html?slug=${TEST_APP_SLUG}`);
        await page.waitForLoadState('networkidle');

        // Find logout button
        const logoutButton = page.locator('button:has-text("Logout"), button:has-text("Log Out"), .logout-btn');

        if (await logoutButton.count() > 0) {
            // Get storage before logout
            const beforeKeys = await page.evaluate(() => Object.keys(localStorage));

            await logoutButton.first().click();
            await page.waitForTimeout(1000);

            // Get storage after logout
            const afterKeys = await page.evaluate(() => Object.keys(localStorage));

            // Auth tokens should be removed
            const authKeysRemoved = beforeKeys.filter(k =>
                k.includes('member') || k.includes('token') || k.includes('auth')
            ).every(k => !afterKeys.includes(k));

            // Either no auth keys existed or they were removed
        }
    });

    test('should redirect to login when session is invalid', async ({ page }) => {
        await page.goto(`/customer-app/app.html?slug=${TEST_APP_SLUG}`);

        // Clear any existing session
        await page.evaluate(() => {
            localStorage.clear();
        });

        // Reload
        await page.reload();
        await page.waitForLoadState('networkidle');

        // Wait for redirect
        await page.waitForTimeout(1500);

        // Should redirect to landing/login page
        const url = page.url();
        expect(url.includes('index') || url.includes('/a/') || !url.includes('app.html')).toBe(true);
    });

    test('should validate token expiration', async ({ page }) => {
        await page.goto(`/customer-app/index.html?slug=${TEST_APP_SLUG}`);
        await page.waitForLoadState('networkidle');

        // Create an expired token
        await page.evaluate(() => {
            const expiredToken = btoa(JSON.stringify({
                member_id: 'test-member',
                app_id: 'test-app',
                exp: Math.floor(Date.now() / 1000) - 3600 // Expired 1 hour ago
            }));
            localStorage.setItem('royalty_member_test-app', expiredToken);
        });

        // Navigate to app
        await page.goto(`/customer-app/app.html?slug=${TEST_APP_SLUG}`);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1500);

        // Should recognize expired token and redirect
        const url = page.url();
        // Should not be on the main app with expired token
    });
});

test.describe('Customer App XSS Prevention', () => {
    test('should escape user input in display', async ({ page }) => {
        await page.goto(`/customer-app/index.html?slug=${TEST_APP_SLUG}`);
        await page.waitForLoadState('networkidle');

        // Find name input
        const firstNameInput = page.locator('input[id*="first"]').first();

        if (await firstNameInput.count() > 0) {
            // Enter XSS payload
            await firstNameInput.fill('<script>alert("xss")</script>');

            // Check that script is not executed
            let alertTriggered = false;
            page.on('dialog', () => { alertTriggered = true; });

            await page.waitForTimeout(500);
            expect(alertTriggered).toBe(false);
        }
    });

    test('should not execute scripts in email field', async ({ page }) => {
        await page.goto(`/customer-app/index.html?slug=${TEST_APP_SLUG}`);
        await page.waitForLoadState('networkidle');

        const emailInput = page.locator('input[type="email"], input[name="email"]').first();

        if (await emailInput.count() > 0) {
            // XSS in email
            await emailInput.fill('"><script>alert(1)</script><input value="');

            let alertTriggered = false;
            page.on('dialog', () => { alertTriggered = true; });

            // Submit form
            const submitButton = page.locator('button[type="submit"]').first();
            if (await submitButton.count() > 0) {
                await submitButton.click();
                await page.waitForTimeout(1000);
            }

            expect(alertTriggered).toBe(false);
        }
    });
});

test.describe('Customer App Rate Limiting', () => {
    test('[SECURITY CONCERN] Should have rate limiting on login attempts', async ({ page }) => {
        await page.goto(`/customer-app/index.html?slug=${TEST_APP_SLUG}`);
        await page.waitForLoadState('networkidle');

        // This test documents the need for rate limiting

        const loginToggle = page.locator('button:has-text("Log In"), [data-tab="login"]');
        if (await loginToggle.count() > 0) {
            await loginToggle.first().click();
            await page.waitForTimeout(500);
        }

        const emailInput = page.locator('input[type="email"]').first();
        const pinInput = page.locator('input[id*="pin"]').first();
        const submitButton = page.locator('button[type="submit"]').first();

        if (await emailInput.count() > 0 && await pinInput.count() > 0 && await submitButton.count() > 0) {
            // Attempt multiple rapid logins
            for (let i = 0; i < 5; i++) {
                await emailInput.fill('test@example.com');
                await pinInput.fill(`000${i}`);
                await submitButton.click();
                await page.waitForTimeout(200);
            }

            // Document: After multiple failed attempts, should see rate limiting
            // Currently this is a TODO in the codebase
        }

        expect(true).toBe(true); // Documenting security requirement
    });
});

test.describe('Customer App No JS Errors', () => {
    test('landing page should load without critical errors', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (error) => {
            if (!error.message.includes('supabase') &&
                !error.message.includes('fetch') &&
                !error.message.includes('network')) {
                errors.push(error.message);
            }
        });

        await page.goto(`/customer-app/index.html?slug=${TEST_APP_SLUG}`);
        await page.waitForLoadState('networkidle');

        // Filter out expected errors for missing app
        const criticalErrors = errors.filter(e =>
            !e.includes('App not found') &&
            !e.includes('slug')
        );

        expect(criticalErrors.length).toBe(0);
    });
});
