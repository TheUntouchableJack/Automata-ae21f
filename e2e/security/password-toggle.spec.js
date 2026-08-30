/**
 * E2E: show/hide password toggle.
 *
 * Exists because a real login failure was indistinguishable from a typo — an
 * account's email and password differed by one easily-miscounted repeated
 * letter, and GoTrue answers a mistyped password and a wrong one with the same
 * "Invalid login credentials".
 *
 * app/password-toggle.js applies itself to every input[type="password"] on the
 * page, so these pin the three things that would silently break it:
 *
 *   - the button must be type="button". The default is "submit", which inside
 *     these forms fires a login attempt on every click.
 *   - wrapping must not re-parent the input away from its .password-strength
 *     sibling on signup.html / reset-password.html.
 *   - the typed value must survive both directions of the toggle.
 *
 * No credentials needed — nothing here signs in.
 */

import { test, expect } from '@playwright/test';

// Nothing here signs in, so this is an arbitrary fixture — but it keeps the
// apostrophe, which is the character most likely to break value round-tripping.
const TYPED = "Fixture'26!";

const PAGES = [
  ['/app/login.html',          ['#password']],
  ['/app/signup.html',         ['#password']],
  ['/app/reset-password.html', ['#password', '#confirm-password']],
];

for (const [url, ids] of PAGES) {
  test(`${url} toggles ${ids.join(' + ')}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    // reset-password.html keeps its form display:none until a recovery
    // token lands. The toggle is already attached; just make it typeable.
    await page.evaluate(() => {
      const f = document.getElementById('reset-form');
      if (f) f.style.display = '';
    });

    for (const id of ids) {
      const input = page.locator(id);
      const btn = page.locator(`${id} ~ .password-field-btn`);

      await expect(input).toHaveAttribute('type', 'password');
      await expect(btn).toHaveCount(1);
      await expect(btn).toHaveAttribute('aria-label', 'Show password');
      // Must not submit the form.
      await expect(btn).toHaveAttribute('type', 'button');

      await input.fill(TYPED);
      await btn.click();
      await expect(input).toHaveAttribute('type', 'text');
      await expect(btn).toHaveAttribute('aria-label', 'Hide password');
      await expect(btn).toHaveAttribute('aria-pressed', 'true');
      // The whole point: the value is readable.
      expect(await input.inputValue()).toBe(TYPED);

      await btn.click();
      await expect(input).toHaveAttribute('type', 'password');
      await expect(btn).toHaveAttribute('aria-pressed', 'false');
      expect(await input.inputValue()).toBe(TYPED);
    }

    // Clicking the eye must not have navigated / submitted.
    expect(page.url()).toContain(url);
    expect(errors, 'console errors').toEqual([]);
  });
}

test('login.html: siblings after the input are preserved, button sits inside the field', async ({ page }) => {
  await page.goto('/app/login.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const geo = await page.evaluate(() => {
    const i = document.getElementById('password');
    const b = document.querySelector('.password-field-btn');
    const ir = i.getBoundingClientRect(), br = b.getBoundingClientRect();
    return {
      wrapped: i.parentElement.className,
      btnInsideField: br.right <= ir.right + 1 && br.left > ir.left,
      verticallyCentered: Math.abs((br.top + br.bottom) / 2 - (ir.top + ir.bottom) / 2) < 2,
      paddingRight: getComputedStyle(i).paddingRight,
      btnWidth: Math.round(br.width),
    };
  });
  console.log('GEOMETRY:', JSON.stringify(geo));
  expect(geo.wrapped).toBe('password-field');
  expect(geo.btnInsideField).toBe(true);
  expect(geo.verticallyCentered).toBe(true);
  expect(parseFloat(geo.paddingRight)).toBeGreaterThanOrEqual(44);
});

test('signup.html: the strength meter still updates while revealed', async ({ page }) => {
  await page.goto('/app/signup.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.locator('#password').fill('abc');
  const weak = await page.locator('#strength-text').textContent();
  await page.locator('#password ~ .password-field-btn').click();
  await page.locator('#password').fill('Abcdef1!xyz');
  const strong = await page.locator('#strength-text').textContent();
  console.log('STRENGTH:', JSON.stringify({ weak, strong }));
  expect(await page.locator('#password').getAttribute('type')).toBe('text');
  expect(strong).not.toBe(weak);
});
