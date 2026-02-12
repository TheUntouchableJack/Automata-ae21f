/**
 * Alpha E2E Tests: Business Owner Signup & Onboarding
 * Tests the complete signup flow for a new business owner
 */

import { test, expect } from '@playwright/test';
import { generateTestEmail, waitForNetworkIdle, setupConsoleErrorCapture } from '../fixtures/test-helpers.js';

test.describe('Business Owner Signup', () => {
    test.beforeEach(async ({ page }) => {
        // Clear any existing session
        await page.context().clearCookies();
    });

    test('signup page loads without errors', async ({ page }) => {
        const errors = setupConsoleErrorCapture(page);

        await page.goto('/app/signup.html');
        await page.waitForLoadState('domcontentloaded');

        // Page should load
        await expect(page.locator('form, .signup-form, [data-testid="signup-form"]')).toBeVisible();

        // No critical JS errors
        expect(errors.length).toBe(0);
    });

    test('signup form has required fields', async ({ page }) => {
        await page.goto('/app/signup.html');
        await page.waitForLoadState('domcontentloaded');

        // Check for essential fields
        await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible();
        await expect(page.locator('input[type="password"]').first()).toBeVisible();

        // Check for submit button
        await expect(page.locator('button[type="submit"], button:has-text("Sign Up"), button:has-text("Create")').first()).toBeVisible();
    });

    test('signup validates email format', async ({ page }) => {
        await page.goto('/app/signup.html');
        await page.waitForLoadState('domcontentloaded');

        const emailInput = page.locator('input[type="email"]').first();
        await emailInput.fill('invalid-email');
        await emailInput.blur();

        // Browser validation should mark as invalid
        const isValid = await emailInput.evaluate(el => el.checkValidity());
        expect(isValid).toBe(false);
    });

    test('signup requires password confirmation match', async ({ page }) => {
        await page.goto('/app/signup.html');
        await page.waitForLoadState('domcontentloaded');

        const passwordInputs = page.locator('input[type="password"]');
        const count = await passwordInputs.count();

        if (count >= 2) {
            await passwordInputs.nth(0).fill('SecurePassword123!');
            await passwordInputs.nth(1).fill('DifferentPassword!');

            const submitBtn = page.locator('button[type="submit"]').first();
            await submitBtn.click();

            // Should show error or prevent submission
            await page.waitForTimeout(500);
            const url = page.url();
            expect(url).toContain('signup'); // Still on signup page
        }
    });

    test('successful signup creates organization', async ({ page }) => {
        // Skip in CI without test account setup
        test.skip(process.env.CI === 'true', 'Requires test account setup');

        await page.goto('/app/signup.html');
        await page.waitForLoadState('domcontentloaded');

        const testEmail = generateTestEmail();

        // Fill signup form
        await page.fill('input[type="email"]', testEmail);

        const passwordInputs = page.locator('input[type="password"]');
        const count = await passwordInputs.count();
        for (let i = 0; i < count; i++) {
            await passwordInputs.nth(i).fill('AlphaTest2026!');
        }

        // Fill name fields if present
        const firstNameInput = page.locator('input[name="firstName"], input[name="first_name"]');
        if (await firstNameInput.count() > 0) {
            await firstNameInput.fill('Alpha');
        }

        const lastNameInput = page.locator('input[name="lastName"], input[name="last_name"]');
        if (await lastNameInput.count() > 0) {
            await lastNameInput.fill('Tester');
        }

        // Submit
        await page.click('button[type="submit"]');

        // Should redirect to dashboard or verification page
        await page.waitForURL(/dashboard|verify|confirm/, { timeout: 15000 });
    });
});

test.describe('Post-Signup Onboarding', () => {
    test.skip('new user sees onboarding flow', async ({ page }) => {
        // This would require authenticated state
        // Implementation depends on onboarding design
    });

    test.skip('organization is created with correct defaults', async ({ page }) => {
        // Verify organization defaults after signup
    });
});
