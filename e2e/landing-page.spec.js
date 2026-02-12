/**
 * E2E Tests for Landing Page
 * Tests the public landing page functionality
 */

import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display the main heading', async ({ page }) => {
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
  });

  test('should have navigation links', async ({ page }) => {
    // Check for key navigation elements
    const nav = page.locator('nav').first();
    await expect(nav).toBeVisible();
  });

  test('should have a CTA button', async ({ page }) => {
    // Look for primary action buttons
    const ctaButtons = page.locator('.btn-primary, [class*="cta"]');
    await expect(ctaButtons.first()).toBeVisible();
  });

  test('should have working login link', async ({ page }) => {
    const loginLink = page.locator('a[href*="login"], a:has-text("Login"), a:has-text("Sign In")');
    if (await loginLink.count() > 0) {
      await expect(loginLink.first()).toBeVisible();
    }
  });

  test('should load without JavaScript errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    expect(errors).toHaveLength(0);
  });

  test('should have proper meta tags', async ({ page }) => {
    const title = await page.title();
    expect(title).toBeTruthy();
    expect(title.length).toBeGreaterThan(0);

    const viewport = page.locator('meta[name="viewport"]');
    await expect(viewport).toHaveAttribute('content', /width=device-width/);
  });

  test('should be responsive on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    // Page should still be functional
    const body = page.locator('body');
    await expect(body).toBeVisible();

    // Check no horizontal overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
  });
});

test.describe('Landing Page - Internationalization', () => {
  test('should have i18n data attributes', async ({ page }) => {
    await page.goto('/');

    // Check for i18n elements
    const i18nElements = page.locator('[data-i18n]');
    const count = await i18nElements.count();

    // Should have some translatable content
    expect(count).toBeGreaterThan(0);
  });

  test('should load i18n script', async ({ page }) => {
    await page.goto('/');

    // Check i18n is available
    const hasI18n = await page.evaluate(() => {
      return typeof window.I18n !== 'undefined' || document.querySelector('script[src*="i18n"]') !== null;
    });

    expect(hasI18n).toBeTruthy();
  });
});
