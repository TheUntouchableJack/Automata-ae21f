/**
 * Alpha E2E Tests: Payment Flows
 * Tests subscription checkout, bundles, and billing management
 */

import { test, expect } from '@playwright/test';
import { login, goToSettingsTab, waitForStripeCheckout, TEST_OWNER } from '../fixtures/test-helpers.js';

test.describe('Payment Flows', () => {
    test.beforeEach(async ({ page }) => {
        // These tests require authentication
        test.skip(!process.env.ALPHA_TEST_ENABLED, 'Enable with ALPHA_TEST_ENABLED=true');
    });

    test.describe('Plan Display', () => {
        test('settings plan tab shows current plan', async ({ page }) => {
            await login(page);
            await goToSettingsTab(page, 'plan');

            // Should show plan name
            const planName = page.locator('#plan-name, .plan-name');
            await expect(planName).toBeVisible();

            // Should show plan status
            const planStatus = page.locator('#plan-status, .plan-status');
            await expect(planStatus).toBeVisible();
        });

        test('free plan shows upgrade options', async ({ page }) => {
            await login(page);
            await goToSettingsTab(page, 'plan');

            // Should show upgrade section
            const upgradeSection = page.locator('#upgrade-section, .upgrade-plans');
            await expect(upgradeSection).toBeVisible();

            // Should show Pro and Max tiers
            await expect(page.locator('[data-plan="pro"]')).toBeVisible();
            await expect(page.locator('[data-plan="max"]')).toBeVisible();
        });

        test('billing toggle switches prices', async ({ page }) => {
            await login(page);
            await goToSettingsTab(page, 'plan');

            // Get initial price
            const priceAmount = page.locator('.price-amount').first();
            const monthlyPrice = await priceAmount.textContent();

            // Toggle to annual
            const billingToggle = page.locator('#billing-toggle');
            await billingToggle.click();

            // Price should change
            const annualPrice = await priceAmount.textContent();
            expect(annualPrice).not.toBe(monthlyPrice);
        });
    });

    test.describe('Checkout Flow', () => {
        test('Pro checkout button opens Stripe', async ({ page }) => {
            await login(page);
            await goToSettingsTab(page, 'plan');

            // Click Pro checkout
            const checkoutBtn = page.locator('[data-plan="pro"] .checkout-btn, .checkout-btn[data-plan="pro"]');
            await checkoutBtn.click();

            // Wait for checkout modal
            await waitForStripeCheckout(page);

            // Stripe checkout should be visible
            await expect(page.locator('#checkout-modal, iframe[name*="stripe"]')).toBeVisible({ timeout: 15000 });
        });

        test('checkout modal can be closed', async ({ page }) => {
            await login(page);
            await goToSettingsTab(page, 'plan');

            // Open checkout
            const checkoutBtn = page.locator('.checkout-btn[data-plan="pro"]');
            await checkoutBtn.click();
            await waitForStripeCheckout(page);

            // Close modal
            const closeBtn = page.locator('#checkout-close-btn, .modal-close');
            await closeBtn.click();

            // Modal should be hidden
            await expect(page.locator('#checkout-modal')).not.toBeVisible();
        });
    });

    test.describe('Bundle Purchases', () => {
        test('bundle section is visible', async ({ page }) => {
            await login(page);
            await goToSettingsTab(page, 'plan');

            // Bundles section should exist
            const bundlesSection = page.locator('#bundles-section, .bundles-grid');
            await expect(bundlesSection).toBeVisible();
        });

        test('SMS bundle shows correct price', async ({ page }) => {
            await login(page);
            await goToSettingsTab(page, 'plan');

            // Find SMS bundle
            const smsBundle = page.locator('[data-bundle="sms_bundle_100"]').locator('..');

            // Should show $15
            await expect(smsBundle.locator('.bundle-price')).toContainText('$15');
        });

        test('Email bundle shows correct price', async ({ page }) => {
            await login(page);
            await goToSettingsTab(page, 'plan');

            // Find Email bundle
            const emailBundle = page.locator('[data-bundle="email_bundle_5000"]').locator('..');

            // Should show $10
            await expect(emailBundle.locator('.bundle-price')).toContainText('$10');
        });

        test('SMS bundle buy button triggers checkout', async ({ page }) => {
            await login(page);
            await goToSettingsTab(page, 'plan');

            // Click SMS bundle buy
            await page.click('[data-bundle="sms_bundle_100"]');

            // Should open checkout (or show loading)
            await page.waitForTimeout(1000);

            // Either modal opens or button shows loading
            const modalVisible = await page.locator('#checkout-modal').isVisible();
            const buttonLoading = await page.locator('[data-bundle="sms_bundle_100"]').textContent();

            expect(modalVisible || buttonLoading.includes('Loading')).toBe(true);
        });
    });

    test.describe('Payment Warning Banner', () => {
        test('past_due status shows warning banner', async ({ page }) => {
            // This test requires simulating past_due status
            // Would need to update org status directly in DB for real test

            await login(page);
            await goToSettingsTab(page, 'plan');

            // Check if banner element exists (may be hidden)
            const banner = page.locator('#payment-warning-banner');
            await expect(banner).toBeAttached();
        });

        test('warning banner has update payment button', async ({ page }) => {
            await login(page);
            await goToSettingsTab(page, 'plan');

            const updateBtn = page.locator('#update-payment-btn');
            await expect(updateBtn).toBeAttached();
        });
    });

    test.describe('Subscription Management', () => {
        test('manage billing button exists for subscribers', async ({ page }) => {
            await login(page);
            await goToSettingsTab(page, 'plan');

            // Button should exist (may be hidden for free users)
            const manageBillingBtn = page.locator('#manage-billing-btn');
            await expect(manageBillingBtn).toBeAttached();
        });

        test('cancel subscription button exists', async ({ page }) => {
            await login(page);
            await goToSettingsTab(page, 'plan');

            const cancelBtn = page.locator('#cancel-subscription-btn');
            await expect(cancelBtn).toBeAttached();
        });
    });
});

test.describe('Stripe Webhook Handling (requires Stripe CLI)', () => {
    test.skip('payment_succeeded updates org status', async () => {
        // Run: stripe trigger invoice.payment_succeeded
        // Verify org subscription_status = 'active'
    });

    test.skip('payment_failed sets past_due status', async () => {
        // Run: stripe trigger invoice.payment_failed
        // Verify org subscription_status = 'past_due'
        // Verify dunning email sent
    });

    test.skip('checkout.session.completed upgrades org', async () => {
        // Run: stripe trigger checkout.session.completed
        // Verify org subscription_tier updated
    });
});
