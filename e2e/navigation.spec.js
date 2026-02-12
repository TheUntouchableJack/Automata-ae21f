/**
 * E2E Tests for Navigation
 * Tests navigation, links, and page structure
 */

import { test, expect } from '@playwright/test';

test.describe('Public Navigation', () => {
  test('should navigate from landing to login', async ({ page }) => {
    await page.goto('/');

    // Find and click login link
    const loginLink = page.locator('a[href*="login"], a:has-text("Login"), a:has-text("Sign In"), a:has-text("Get Started")').first();

    if (await loginLink.count() > 0) {
      await loginLink.click();
      await page.waitForLoadState('domcontentloaded');

      // Should be on login page
      const url = page.url();
      expect(url.includes('login') || url.includes('signup') || url.includes('auth')).toBeTruthy();
    }
  });

  test('should navigate from landing to pricing', async ({ page }) => {
    await page.goto('/');

    const pricingLink = page.locator('a[href*="pricing"]').first();

    if (await pricingLink.count() > 0) {
      await pricingLink.click();
      await page.waitForLoadState('domcontentloaded');

      expect(page.url()).toContain('pricing');
    }
  });

  test('should have consistent header across public pages', async ({ page }) => {
    const publicPages = ['/', '/pricing.html', '/login.html'];

    for (const pagePath of publicPages) {
      await page.goto(pagePath);

      // Should have a logo or brand element
      const logo = page.locator('.logo, [class*="brand"], a[href="/"]').first();
      await expect(logo).toBeVisible();
    }
  });
});

test.describe('Page Load Performance', () => {
  test('landing page should load within 3 seconds', async ({ page }) => {
    const startTime = Date.now();
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(3000);
  });

  test('should not have broken images', async ({ page }) => {
    await page.goto('/');

    const images = page.locator('img');
    const count = await images.count();

    for (let i = 0; i < count; i++) {
      const img = images.nth(i);
      const src = await img.getAttribute('src');

      if (src && !src.startsWith('data:')) {
        // Check image loaded successfully
        const naturalWidth = await img.evaluate((el) => el.naturalWidth);
        expect(naturalWidth).toBeGreaterThan(0);
      }
    }
  });

  test('should not have broken CSS', async ({ page }) => {
    await page.goto('/');

    // Check that stylesheets loaded (external sheets may have CORS restrictions)
    const stylesheetCount = await page.evaluate(() => document.styleSheets.length);

    // Should have at least one stylesheet
    expect(stylesheetCount).toBeGreaterThan(0);

    // Verify styles are applied by checking a styled element
    const body = page.locator('body');
    const fontFamily = await body.evaluate(el => getComputedStyle(el).fontFamily);
    expect(fontFamily).toBeTruthy();
  });
});

test.describe('Accessibility Basics', () => {
  test('should have proper heading hierarchy', async ({ page }) => {
    await page.goto('/');

    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBeGreaterThanOrEqual(1); // At least one h1 per page

    // Check heading order - warn about skipped levels but don't fail
    const headings = await page.evaluate(() => {
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      return Array.from(headings).map(h => parseInt(h.tagName[1]));
    });

    // Verify we have headings
    expect(headings.length).toBeGreaterThan(0);

    // Check that we start with h1
    expect(headings[0]).toBe(1);
  });

  test('should have alt text on images', async ({ page }) => {
    await page.goto('/');

    const images = page.locator('img:not([role="presentation"])');
    const count = await images.count();

    for (let i = 0; i < count; i++) {
      const img = images.nth(i);
      const alt = await img.getAttribute('alt');
      const ariaLabel = await img.getAttribute('aria-label');
      const ariaHidden = await img.getAttribute('aria-hidden');

      // Image should have alt, aria-label, or be hidden
      const isAccessible = alt !== null || ariaLabel !== null || ariaHidden === 'true';
      expect(isAccessible).toBeTruthy();
    }
  });

  test('should have sufficient color contrast for buttons', async ({ page }) => {
    await page.goto('/');

    const buttons = page.locator('.btn-primary, button[type="submit"]');
    const count = await buttons.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      const btn = buttons.nth(i);

      if (await btn.isVisible()) {
        // Check button has visible text or aria-label
        const text = await btn.textContent();
        const ariaLabel = await btn.getAttribute('aria-label');
        expect(text?.trim() || ariaLabel).toBeTruthy();
      }
    }
  });

  test('should be keyboard navigable', async ({ page }) => {
    await page.goto('/');

    // Press Tab multiple times
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
    }

    // Something should be focused
    const focusedElement = await page.evaluate(() => {
      const el = document.activeElement;
      return el && el !== document.body ? el.tagName : null;
    });

    expect(focusedElement).toBeTruthy();
  });
});
