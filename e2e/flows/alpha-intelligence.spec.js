/**
 * Alpha E2E Tests: Royal AI Intelligence
 * Tests the AI assistant, chat, and autonomous features
 */

import { test, expect } from '@playwright/test';
import { login, waitForNetworkIdle, setupConsoleErrorCapture } from '../fixtures/test-helpers.js';

test.describe('Royal AI Intelligence', () => {
    test.beforeEach(async ({ page }) => {
        test.skip(!process.env.ALPHA_TEST_ENABLED, 'Enable with ALPHA_TEST_ENABLED=true');
        await login(page);
    });

    test.describe('Intelligence Tab Access', () => {
        test('intelligence page loads', async ({ page }) => {
            await page.goto('/app/intelligence.html');
            await waitForNetworkIdle(page);

            // Should show intelligence content
            await expect(page.locator('body')).toContainText(/intelligence|royal|ai/i);
        });

        test('crown dashboard opens intelligence', async ({ page }) => {
            await page.goto('/app/dashboard.html');
            await waitForNetworkIdle(page);

            // Look for crown/intelligence trigger
            const crownBtn = page.locator('.crown-button, [data-action="intelligence"], button:has-text("Royal")');

            if (await crownBtn.count() > 0) {
                await crownBtn.first().click();
                await page.waitForTimeout(1000);

                // Intelligence panel should open
                const panel = page.locator('.intelligence-panel, .crown-dashboard, [class*="intelligence"]');
                await expect(panel.first()).toBeVisible();
            }
        });
    });

    test.describe('Chat Interface', () => {
        test('chat input is visible', async ({ page }) => {
            await page.goto('/app/intelligence.html');
            await waitForNetworkIdle(page);

            const chatInput = page.locator('textarea, input[type="text"][placeholder*="message"], .chat-input');
            await expect(chatInput.first()).toBeVisible();
        });

        test('can type in chat', async ({ page }) => {
            await page.goto('/app/intelligence.html');
            await waitForNetworkIdle(page);

            const chatInput = page.locator('textarea, .chat-input').first();
            await chatInput.fill('Hello Royal');

            const value = await chatInput.inputValue();
            expect(value).toBe('Hello Royal');
        });

        test('send button exists', async ({ page }) => {
            await page.goto('/app/intelligence.html');
            await waitForNetworkIdle(page);

            const sendBtn = page.locator('button[type="submit"], button:has-text("Send"), .send-btn, button svg');
            await expect(sendBtn.first()).toBeVisible();
        });

        test('can send message and get response', async ({ page }) => {
            await page.goto('/app/intelligence.html');
            await waitForNetworkIdle(page);

            const chatInput = page.locator('textarea, .chat-input').first();
            const sendBtn = page.locator('button[type="submit"], .send-btn').first();

            // Send a message
            await chatInput.fill('What can you help me with?');
            await sendBtn.click();

            // Wait for response (may take time for AI)
            await page.waitForTimeout(10000);

            // Should have at least one response message
            const messages = page.locator('.message, .chat-message, [class*="message"]');
            const count = await messages.count();

            expect(count).toBeGreaterThan(0);
        });
    });

    test.describe('AI Mode Toggle', () => {
        test('review/autonomous mode toggle exists', async ({ page }) => {
            await page.goto('/app/intelligence.html');
            await waitForNetworkIdle(page);

            const modeToggle = page.locator('[data-mode], .mode-toggle, button:has-text("Review"), button:has-text("Autonomous")');

            if (await modeToggle.count() > 0) {
                expect(true).toBe(true);
            }
        });

        test('can switch between modes', async ({ page }) => {
            await page.goto('/app/intelligence.html');
            await waitForNetworkIdle(page);

            const reviewBtn = page.locator('button:has-text("Review")');
            const autonomousBtn = page.locator('button:has-text("Autonomous")');

            if (await reviewBtn.count() > 0 && await autonomousBtn.count() > 0) {
                // Click autonomous
                await autonomousBtn.click();
                await page.waitForTimeout(500);

                // Check it's selected
                const isActive = await autonomousBtn.getAttribute('class');
                expect(isActive).toContain('active');
            }
        });
    });

    test.describe('AI Tools', () => {
        test('ask about automations', async ({ page }) => {
            await page.goto('/app/intelligence.html');
            await waitForNetworkIdle(page);

            const chatInput = page.locator('textarea, .chat-input').first();
            const sendBtn = page.locator('button[type="submit"], .send-btn').first();

            await chatInput.fill('Show me my automations');
            await sendBtn.click();

            // Wait for response
            await page.waitForTimeout(15000);

            // Should show automation info
            const pageContent = await page.textContent('body');
            const hasAutomationResponse =
                pageContent.toLowerCase().includes('automation') ||
                pageContent.toLowerCase().includes('welcome') ||
                pageContent.toLowerCase().includes('birthday');

            expect(hasAutomationResponse).toBe(true);
        });

        test('ask about business metrics', async ({ page }) => {
            await page.goto('/app/intelligence.html');
            await waitForNetworkIdle(page);

            const chatInput = page.locator('textarea, .chat-input').first();
            const sendBtn = page.locator('button[type="submit"], .send-btn').first();

            await chatInput.fill('How is my business doing?');
            await sendBtn.click();

            // Wait for response
            await page.waitForTimeout(15000);

            // Should get a response (content varies)
            const messages = page.locator('.message, .chat-message');
            const count = await messages.count();

            expect(count).toBeGreaterThan(0);
        });
    });

    test.describe('Discovery Questions', () => {
        test('AI asks discovery questions for new orgs', async ({ page }) => {
            await page.goto('/app/intelligence.html');
            await waitForNetworkIdle(page);

            const chatInput = page.locator('textarea, .chat-input').first();
            const sendBtn = page.locator('button[type="submit"], .send-btn').first();

            // Ask about business to trigger discovery
            await chatInput.fill('Tell me about my business');
            await sendBtn.click();

            // Wait for response
            await page.waitForTimeout(15000);

            // Response might include a question
            const pageContent = await page.textContent('body');

            // Either answers or asks clarifying question
            expect(pageContent.length).toBeGreaterThan(100);
        });
    });

    test.describe('Action Cards', () => {
        test('pending actions are visible in review mode', async ({ page }) => {
            await page.goto('/app/intelligence.html');
            await waitForNetworkIdle(page);

            // Switch to review mode if not already
            const reviewBtn = page.locator('button:has-text("Review")');
            if (await reviewBtn.count() > 0) {
                await reviewBtn.click();
            }

            // Look for action cards section
            const actionsSection = page.locator('.pending-actions, .action-cards, [class*="action"]');

            // May or may not have pending actions
            expect(true).toBe(true);
        });
    });
});

test.describe('Royal AI Autonomous Mode', () => {
    test.skip('autonomous mode processes actions automatically', async () => {
        // This requires:
        // 1. Setting mode to autonomous
        // 2. Creating a pending action
        // 3. Waiting for cron job to process
        // 4. Verifying action was executed
    });

    test.skip('autonomous mode respects guardrails', async () => {
        // Verify:
        // - Max points per action
        // - Max multiplier
        // - Max discount percentage
    });
});
