/**
 * E2E: client workspace — LIVE pass against Royalty PRODUCTION.
 *
 * Skipped by default. Enable with:
 *   CLIENT_WORKSPACE_LIVE=true CLIENT_WORKSPACE_EMAIL=… CLIENT_WORKSPACE_PASSWORD=… \
 *     npx playwright test e2e/security/client-workspace-live.spec.js
 *
 * (The account's password is in .env as PAHKIE_PASSWORD. It is NOT read from
 * there here — playwright.config.js doesn't load .env, and a spec that quietly
 * reads secrets off disk is a surprise in CI.)
 *
 * These are READ-ONLY: no venue is created, no branding is saved.
 *
 * The login FORM is deliberately not driven. Cloudflare Turnstile never solves
 * under automation — the form just answers "Please complete the CAPTCHA
 * verification" and never navigates. So the session is minted through the auth
 * REST API and seeded into localStorage under the supabase-js v2 storage key.
 * Everything downstream of authentication — which is the entire surface this
 * change touches — then runs for real against prod.
 *
 * The rendering-only counterparts, which need no credentials, are in
 * admin-nav-gates.spec.js under "Client workspace nav".
 */

import { test, expect } from '@playwright/test';

const LIVE = process.env.CLIENT_WORKSPACE_LIVE === 'true';
const EMAIL = process.env.CLIENT_WORKSPACE_EMAIL;
const PASSWORD = process.env.CLIENT_WORKSPACE_PASSWORD;

const PROJECT_REF = 'vhpmmfhfwnpmavytoomd';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZocG1tZmhmd25wbWF2eXRvb21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1OTgyMDYsImV4cCI6MjA4NTE3NDIwNn0.6JmfnTTR8onr3ZgFpzdZa4BbVBraUyePVEUHOJgxmuk';

// Pages a client workspace denies. get-started.html is the one that mattered:
// the org has 0 `projects` rows, so before this change firstRunDestination()
// sent him there to describe "his" business — into the OWNER's
// business_knowledge.
const DENIED = [
    'ceo.html',
    'get-started.html',
    'organization.html',
    'intelligence.html',
    'apps.html',
    'settings.html',
    'customers.html',
    'knowledgebase.html',
];

test.describe('Client workspace (live)', () => {
    test.skip(!LIVE || !EMAIL || !PASSWORD,
        'Requires a live client account on Royalty PROD. Enable with CLIENT_WORKSPACE_LIVE=true, ' +
        'CLIENT_WORKSPACE_EMAIL and CLIENT_WORKSPACE_PASSWORD.');

    let session;

    test.beforeAll(async () => {
        const res = await fetch(`https://${PROJECT_REF}.supabase.co/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
        });
        expect(res.ok, 'auth REST sign-in').toBe(true);
        session = await res.json();

        // Guard against a vacuous suite: if this account ever stops carrying
        // the discriminator it resolves to 'owner', every assertion below
        // inverts, and the failure should name the reason.
        expect(session.user?.user_metadata?.user_type,
            'the account under test must carry user_type=app_member').toBe('app_member');
    });

    async function asClient(page, path) {
        await page.addInitScript(({ key, value }) => {
            localStorage.setItem(key, JSON.stringify(value));
        }, { key: `sb-${PROJECT_REF}-auth-token`, value: session });
        await page.goto(path);
    }

    test('login.html with a live session lands on venues.html, never get-started.html', async ({ page }) => {
        await asClient(page, '/app/login.html');
        await page.waitForURL(/\/app\/venues\.html/, { timeout: 20000 });
        expect(page.url()).toContain('/app/venues.html');
        expect(page.url()).not.toContain('get-started');
    });

    test('the sidebar is Venues + My App only, with no empty section labels', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));

        await asClient(page, '/app/venues.html');
        await page.waitForSelector('.sidebar-nav .sidebar-item', { timeout: 20000 });
        // updateVenuesNavVisibility() and the badge pollers are fire-and-forget;
        // give any async nav mutation a chance to land before asserting.
        await page.waitForTimeout(2500);

        const hrefs = await page.$$eval('.sidebar-nav .sidebar-item',
            (els) => els.map((e) => e.getAttribute('href')));
        const visible = await page.$$eval('.sidebar-nav .sidebar-item',
            (els) => els.filter((e) => e.offsetParent !== null).map((e) => e.getAttribute('href')));
        const labels = await page.$$eval('.sidebar-nav .sidebar-section-label',
            (els) => els.map((e) => e.textContent.trim()));

        expect(hrefs).toEqual(['/app/venues.html', '/app/my-app.html']);
        // Venues carries socialOnly:true — in the owner workspace it renders
        // display:none pending a lookup. A client must never see that.
        expect(visible).toEqual(['/app/venues.html', '/app/my-app.html']);
        expect(labels).toEqual([]);
        expect(errors, 'console errors on venues.html').toEqual([]);

        // The real page, not the in-place unavailable state.
        expect(await page.$eval('#venues-unavailable', (e) => e.style.display)).toBe('none');
    });

    for (const denied of DENIED) {
        test(`direct nav to /app/${denied} replaces to venues.html`, async ({ page }) => {
            await asClient(page, `/app/${denied}`);
            await page.waitForURL(/\/app\/venues\.html/, { timeout: 20000 });
            expect(page.url()).toContain('/app/venues.html');

            // guard() uses location.replace(), not .href, so Back must not put
            // them back on the denied page.
            await page.goBack().catch(() => {});
            await page.waitForTimeout(1500);
            expect(page.url()).not.toContain(denied);
        });
    }

    test('my-app.html renders the app with both live links', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));

        await asClient(page, '/app/my-app.html');
        await page.waitForSelector('#my-app-content', { state: 'visible', timeout: 20000 });

        const state = await page.evaluate(() => ({
            name: document.getElementById('field-name').value,
            primary: document.getElementById('field-primary').value,
            secondary: document.getElementById('field-secondary').value,
            status: document.getElementById('publish-status').textContent,
            live: document.getElementById('link-live').getAttribute('href'),
            join: document.getElementById('link-join').getAttribute('href'),
            linksShown: document.getElementById('links-block').style.display !== 'none',
        }));

        expect(state.name).toBeTruthy();
        // /a/:slug is a 200 rewrite to the JOIN page; the app itself is
        // /a/:slug/social. Both are shown, each labelled for what it is.
        expect(state.live).toMatch(/^\/a\/[^/]+\/social$/);
        expect(state.join).toMatch(/^\/a\/[^/]+$/);
        expect(`${state.join}/social`).toBe(state.live);
        expect(state.linksShown).toBe(true);
        expect(state.status).toBe('Live');
        expect(state.primary).toMatch(/^#[0-9a-f]{6}$/);
        expect(state.secondary).toMatch(/^#[0-9a-f]{6}$/);
        expect(errors, 'console errors on my-app.html').toEqual([]);
    });

    test('the preview panel paints the stored branding, not a loyalty splash', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));

        await asClient(page, '/app/my-app.html');
        await page.waitForSelector('#my-app-content', { state: 'visible', timeout: 20000 });
        await expect(page.locator('#preview-splash')).toBeVisible();

        const state = await page.evaluate(() => {
            const splash = document.getElementById('preview-splash');
            const logo = document.getElementById('preview-splash-logo');
            return {
                storedPrimary: document.getElementById('field-primary').value,
                storedSecondary: document.getElementById('field-secondary').value,
                // The real auth splash (customer-app/social.css:2016) paints
                // secondary_color as the backdrop and primary_color on the logo
                // tile — NOT the dashboard's primary-as-background.
                splashBg: getComputedStyle(splash).backgroundColor,
                splashPrimaryVar: splash.style.getPropertyValue('--splash-primary'),
                logoBg: getComputedStyle(logo).backgroundColor,
                name: document.getElementById('preview-splash-name').textContent,
                fieldName: document.getElementById('field-name').value,
                launch: document.getElementById('preview-launch-btn').getAttribute('href'),
                urlText: document.getElementById('preview-url-display').textContent,
                footerShown: document.getElementById('preview-footer').style.display !== 'none',
            };
        });

        const rgb = (hex) => {
            const n = parseInt(hex.slice(1), 16);
            return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
        };

        expect(state.splashBg).toBe(rgb(state.storedSecondary));
        expect(state.logoBg).toBe(rgb(state.storedPrimary));
        expect(state.splashPrimaryVar).toBe(state.storedPrimary);
        expect(state.name).toBe(state.fieldName);

        // The dashboard's launch button points at /a/{slug} — the JOIN page —
        // and its QR at /a/{slug}/checkin, a loyalty-only route. Neither is
        // right here.
        expect(state.launch).toMatch(/^\/a\/[^/]+\/social$/);
        expect(state.launch).not.toContain('checkin');
        expect(state.urlText).toMatch(/\/a\/[^/]+\/social$/);
        expect(state.footerShown).toBe(true);

        expect(errors, 'console errors on my-app.html').toEqual([]);
    });

    test('the QR encodes the social app URL, not the loyalty check-in route', async ({ page }) => {
        await asClient(page, '/app/my-app.html');
        await page.waitForSelector('#my-app-content', { state: 'visible', timeout: 20000 });

        // The encoder comes off a CDN and generateQR() hides the block rather
        // than throwing if it never arrived. Assert it DID arrive, so this
        // can't pass by finding nothing.
        await expect(page.locator('#preview-qr-section')).toBeVisible();
        await expect(page.locator('#preview-qr-code canvas')).toHaveCount(1);

        // Read the modules back off the rendered canvas by sampling each
        // module's centre pixel, and compare against the matrix the encoder
        // produces for a candidate payload. Scale- and colour-independent.
        const probe = await page.evaluate(() => {
            const canvas = document.querySelector('#preview-qr-code canvas');
            const ctx = canvas.getContext('2d');
            const slug = document.getElementById('preview-launch-btn')
                .getAttribute('href').split('/')[2];

            const matches = (text) => {
                const qr = qrcode(0, 'M');
                qr.addData(text);
                qr.make();
                const count = qr.getModuleCount();
                const quiet = 4;
                const total = count + quiet * 2;
                // A different QR version means a different payload outright.
                if (canvas.width % total !== 0) return false;
                const scale = canvas.width / total;
                for (let r = 0; r < count; r++) {
                    for (let c = 0; c < count; c++) {
                        const x = (c + quiet) * scale + Math.floor(scale / 2);
                        const y = (r + quiet) * scale + Math.floor(scale / 2);
                        const [red] = ctx.getImageData(x, y, 1, 1).data;
                        if ((red < 128) !== qr.isDark(r, c)) return false;
                    }
                }
                return true;
            };

            const at = (path) => `${window.location.origin}/a/${slug}${path}`;
            return {
                slug,
                social: matches(at('/social')),
                // dashboard.js:717 encodes /checkin — a loyalty-only Netlify
                // route with no social equivalent. /a/{slug} is the join page.
                checkin: matches(at('/checkin')),
                join: matches(at('')),
            };
        });

        expect(probe.slug).toBeTruthy();
        expect(probe.social, 'QR payload must be the /social URL').toBe(true);
        expect(probe.checkin, 'QR must not be the loyalty check-in URL').toBe(false);
        expect(probe.join, 'QR must not be the join page').toBe(false);
    });

    test('typing repaints the splash before anything is saved', async ({ page }) => {
        await asClient(page, '/app/my-app.html');
        await page.waitForSelector('#my-app-content', { state: 'visible', timeout: 20000 });

        const before = await page.evaluate(() => ({
            name: document.getElementById('field-name').value,
            primary: document.getElementById('field-primary').value,
            secondary: document.getElementById('field-secondary').value,
        }));

        // Name — via the hex text field's sibling path, i.e. real typing.
        await page.fill('#field-name', 'Preview Probe');
        await expect(page.locator('#preview-splash-name')).toHaveText('Preview Probe');
        await expect(page.locator('#preview-splash-logo span')).toHaveText('P');

        // Colours — <input type="color"> can't be typed into, so drive the hex
        // text field, which is the same repaint path a picker drag takes.
        await page.fill('#field-secondary-text', '#123456');
        await page.dispatchEvent('#field-secondary-text', 'change');
        await expect(page.locator('#preview-splash')).toHaveCSS('background-color', 'rgb(18, 52, 86)');

        await page.fill('#field-primary-text', '#abcdef');
        await page.dispatchEvent('#field-primary-text', 'change');
        await expect(page.locator('#preview-splash-logo')).toHaveCSS('background-color', 'rgb(171, 205, 239)');

        // Nothing was saved: a reload must come back to the stored values.
        // (This spec is READ-ONLY — the Save button is never clicked.)
        await page.reload();
        await page.waitForSelector('#my-app-content', { state: 'visible', timeout: 20000 });
        const after = await page.evaluate(() => ({
            name: document.getElementById('field-name').value,
            primary: document.getElementById('field-primary').value,
            secondary: document.getElementById('field-secondary').value,
        }));
        expect(after).toEqual(before);
    });

    test('venues.html Members tab loads without the app_members.created_at 42703', async ({ page }) => {
        const errors = [];
        const consoleErrors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

        await asClient(page, '/app/venues.html');
        // The tab buttons are in the static HTML but setupEventListeners()
        // binds them only after the venue load resolves — clicking on sight
        // races the binding and silently does nothing. Wait for the spinner to
        // clear first, then assert the tab actually switched.
        await page.waitForSelector('.admin-tab[data-admin-tab="members"]', { timeout: 20000 });
        await expect(page.locator('#loading')).toBeHidden({ timeout: 20000 });
        await page.click('.admin-tab[data-admin-tab="members"]');
        await expect(page.locator('.admin-tab[data-admin-tab="members"]')).toHaveClass(/active/);

        // app_members has 0 rows, so asserting on rows would pass vacuously
        // whether or not the query 42703'd. Assert the ERROR is absent instead:
        // the loader resolving into a real state, with no error toast.
        await expect(page.locator('#members-loading')).toBeHidden({ timeout: 20000 });
        const settled = page.locator('#members-empty:visible, #members-table-wrap:visible');
        await expect(settled).toHaveCount(1);
        await expect(page.locator('.app-toast.error')).toHaveCount(0);

        const all = errors.concat(consoleErrors).join('\n');
        expect(all).not.toContain('42703');
        expect(all).not.toContain('created_at does not exist');
        expect(errors, 'uncaught errors on venues.html Members').toEqual([]);
    });
});
