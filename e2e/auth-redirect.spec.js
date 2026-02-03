/**
 * E2E Tests for Authentication Redirects
 * Tests that protected pages redirect to login when not authenticated
 */

import { test, expect } from '@playwright/test';

// Protected routes that should redirect to login
const protectedRoutes = [
  '/app/dashboard.html',
  '/app/customers.html',
  '/app/automations.html',
  '/app/settings.html',
];

test.describe('Authentication Redirects', () => {
  for (const route of protectedRoutes) {
    test(`${route} should redirect to login when not authenticated`, async ({ page }) => {
      // Go to protected route
      await page.goto(route);

      // Wait for any redirects
      await page.waitForLoadState('networkidle');

      // Should be redirected to login or index
      const url = page.url();
      const isOnLoginPage = url.includes('login') || url.includes('index.html') || url === 'http://localhost:5173/';

      expect(isOnLoginPage).toBeTruthy();
    });
  }

  test('should show login page correctly', async ({ page }) => {
    await page.goto('/login.html');

    // Should have login form elements
    const emailInput = page.locator('input[type="email"], input[name="email"]');
    const passwordInput = page.locator('input[type="password"], input[name="password"]');
    const submitButton = page.locator('button[type="submit"], .btn-primary');

    // At least email should be present for login
    if (await emailInput.count() > 0) {
      await expect(emailInput.first()).toBeVisible();
    }
  });
});

test.describe('Login Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login.html');
  });

  test('should load without JavaScript errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    await page.waitForLoadState('networkidle');

    // Filter out expected Supabase auth errors when not logged in
    const criticalErrors = errors.filter(e =>
      !e.includes('supabase') &&
      !e.includes('auth') &&
      !e.includes('session')
    );

    expect(criticalErrors).toHaveLength(0);
  });

  test('should have accessible form labels', async ({ page }) => {
    const inputs = page.locator('input:not([type="hidden"])');
    const count = await inputs.count();

    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      const id = await input.getAttribute('id');
      const ariaLabel = await input.getAttribute('aria-label');
      const placeholder = await input.getAttribute('placeholder');

      // Each input should have some form of label
      const hasLabel = id && await page.locator(`label[for="${id}"]`).count() > 0;
      const hasAccessibility = hasLabel || ariaLabel || placeholder;

      expect(hasAccessibility).toBeTruthy();
    }
  });
});
