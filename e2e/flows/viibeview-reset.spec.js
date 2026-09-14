/**
 * E2E: ViibeView — password recovery, the implicit flow prod actually uses
 *
 * The credential-free coverage in viibeview-auth.spec.js drives the two
 * landings that can be synthesised: a spent link (the literal error fragment
 * live GoTrue redirects to) and a form submitted with no session. Neither of
 * them proves the SUCCESS path, because the success path needs a real recovery
 * token, and a real recovery token needs a real user.
 *
 * This file closes that gap. It mints a genuine recovery link through the admin
 * API, follows it exactly as a mail client would, harvests the real
 * `#access_token=…&type=recovery` fragment GoTrue hands back, and replays it
 * against the local dev server.
 *
 * ⚠️ THIS CHANGES A REAL PASSWORD IN ROYALTY PRODUCTION. There is no staging
 * database. The password is restored in afterAll via the admin API, and a
 * failure to restore is shouted about rather than swallowed — a silent restore
 * failure leaves VIIBEVIEW_TEST_PASSWORD wrong in .env and breaks
 * viibeview-member.spec.js with a misleading "Email or password is incorrect".
 *
 * ⚠️ generate_link INVALIDATES any recovery token previously issued for this
 * user. If someone is mid-reset on this account, this run kills their link.
 *
 * ⚠️ The action_link is single-use and the fetch below CONSUMES it. It cannot
 * be replayed, printed for later, or retried — each attempt needs a fresh mint.
 *
 * Why redirect_to points at PRODUCTION and not localhost: localhost is not in
 * this project's Supabase redirect allow list (measured — GoTrue silently
 * rewrites an unlisted redirect_to to the Site URL, https://royaltyapp.ai). The
 * fragment is identical either way, so we ask for the prod URL, never follow
 * the redirect in a browser, and replay the fragment locally.
 *
 * For the record, `https://royaltyapp.ai/a/viibeview/social` IS allow-listed and
 * its path survives — verified with throwaway invalid tokens against
 * GET /auth/v1/verify. So a real user clicking a real reset email lands on the
 * app, not on the marketing homepage.
 *
 * Run it with:  npm run test:viibeview:reset:live
 */

// Stubs public venue-media GETs with a tiny decodable clip — see the header of
// e2e/fixtures/test.js. Do NOT import '@playwright/test' directly here; that
// silently reinstates ~230 MB of production egress per run.
import { test, expect } from '../fixtures/test.js';

const PRETTY_URL = '/a/viibeview/social';
const SUPABASE_URL = 'https://vhpmmfhfwnpmavytoomd.supabase.co';

const TEST_EMAIL = process.env.VIIBEVIEW_TEST_EMAIL;
const TEST_PASSWORD = process.env.VIIBEVIEW_TEST_PASSWORD;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Not a secret and not an env var: this is the same public anon key
// social.js:8 ships to every visitor. Copied rather than passed in so the
// runner script has one fewer thing to get wrong.
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZocG1tZmhmd25wbWF2eXRvb21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1OTgyMDYsImV4cCI6MjA4NTE3NDIwNn0.6JmfnTTR8onr3ZgFpzdZa4BbVBraUyePVEUHOJgxmuk';

const CAN_RUN = !!(TEST_EMAIL && TEST_PASSWORD && SERVICE_KEY);

// Serial and single-context: two runs racing for the same user would each
// invalidate the other's freshly minted token, and the restore in afterAll must
// not be able to land while another test is still driving the form.
test.describe.configure({ mode: 'serial' });

// The password this run sets. Distinct every run, because GoTrue rejects a
// password identical to the current one ("New password should be different from
// the old password") — which, if a previous run's restore had failed, would
// fail this run for entirely the wrong reason.
const NEW_PASSWORD = `Probe${Date.now()}a`;

let userId = null;
let passwordWasChanged = false;

function adminHeaders() {
    return {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
    };
}

/**
 * Mints a recovery link. generate_link does NOT send mail, so this costs no
 * deliverability and nobody receives a surprise "reset your password" email.
 */
async function mintRecoveryLink() {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
        method: 'POST',
        headers: adminHeaders(),
        // ⚠️ redirect_to is TOP-LEVEL here. Nesting it under `options` — which is
        // where supabase-js puts it, and the obvious guess — is SILENTLY IGNORED
        // by the admin endpoint: the action_link comes back carrying the project
        // Site URL (https://royaltyapp.ai) with the path dropped. Measured. It
        // does not fail, it just quietly sends you somewhere else, which reads
        // exactly like "/a/viibeview/social is not allow-listed" when it is.
        body: JSON.stringify({
            type: 'recovery',
            email: TEST_EMAIL,
            redirect_to: 'https://royaltyapp.ai/a/viibeview/social'
        })
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`generate_link failed (${res.status}): ${JSON.stringify(body)}`);

    const props = body.properties || body;
    userId = body.user?.id || body.id || userId;
    return props.action_link;
}

/**
 * Follows the link the way a mail client's browser would, but stops at the
 * redirect instead of loading the page — the whole payload is in the Location
 * header's fragment, and the prod origin it points at is not where we want it
 * applied.
 */
async function harvestFragment(actionLink) {
    const res = await fetch(actionLink, { redirect: 'manual' });
    const location = res.headers.get('location');
    if (!location) {
        throw new Error(`verify returned ${res.status} with no Location header — the token may already be spent`);
    }

    const hashIndex = location.indexOf('#');
    if (hashIndex === -1) {
        throw new Error(`verify redirected with no fragment: ${location}`);
    }
    return location.slice(hashIndex); // '#access_token=…&type=recovery'
}

test.describe('ViibeView password recovery — live implicit flow', () => {
    test.skip(!CAN_RUN,
        'Changes a real password in Royalty PROD. Run via npm run test:viibeview:reset:live');

    test.afterAll(async () => {
        if (!passwordWasChanged) return;

        if (!userId) {
            console.error(
                '\n🔴 CANNOT RESTORE PASSWORD: the user id was never captured, but the password ' +
                `WAS changed to "${NEW_PASSWORD}". Update VIIBEVIEW_TEST_PASSWORD in .env by hand.\n`
            );
            throw new Error('Password changed with no way to restore it');
        }

        const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
            method: 'PUT',
            headers: adminHeaders(),
            body: JSON.stringify({ password: TEST_PASSWORD })
        });

        if (!res.ok) {
            const body = await res.text();
            // Loudly, never a silent catch. Left unrestored, .env is now wrong
            // and the member suite fails with "Email or password is incorrect",
            // pointing at the wrong thing entirely.
            console.error(
                `\n🔴 PASSWORD RESTORE FAILED (${res.status}): ${body}\n` +
                `   ${TEST_EMAIL} is now on "${NEW_PASSWORD}".\n` +
                `   Either set VIIBEVIEW_TEST_PASSWORD to that value in .env, or reset it by hand.\n`
            );
            throw new Error(`Failed to restore the test user's password: ${res.status}`);
        }

        // Prove it, rather than trusting a 200. An admin PUT that reports
        // success but leaves the old hash in place is exactly the failure this
        // whole block exists to prevent.
        const check = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD })
        });
        if (!check.ok) {
            console.error(
                `\n🔴 PASSWORD RESTORE REPORTED SUCCESS BUT THE ORIGINAL PASSWORD DOES NOT WORK.\n` +
                `   ${TEST_EMAIL} may be on "${NEW_PASSWORD}". Check .env before running the member suite.\n`
            );
            throw new Error('Restore verification failed');
        }
        console.log(`✓ ${TEST_EMAIL}'s password restored and verified`);
    });

    test('a real recovery link opens the form, and the new password works', async ({ page }) => {
        const actionLink = await mintRecoveryLink();
        const fragment = await harvestFragment(actionLink);

        // The payload prod actually emits. If this ever stops being the implicit
        // flow, this assertion is what says so — rather than the test failing
        // three steps later with something unrelated.
        expect(fragment, 'GoTrue no longer returns an implicit-flow fragment')
            .toContain('access_token=');
        expect(fragment, 'fragment is not marked as a recovery').toContain('type=recovery');

        await page.addInitScript(() => {
            try { localStorage.setItem('viibeview_onboarded_v1', '1'); } catch (e) { /* private mode */ }
        });

        await page.goto(PRETTY_URL + fragment, { waitUntil: 'networkidle' });
        await page.waitForSelector('#filter-pills .pill', { timeout: 20000 });

        // The whole point: a valid link lands on the form, deterministically,
        // and not on the feed — which is what happened whenever supabase-js's
        // own detector won the race for the fragment.
        await expect(page.locator('#auth-overlay')).toHaveClass(/visible/);
        await expect(page.locator('#reset-form')).toBeVisible();
        await expect(page.locator('#reset-expired')).toBeHidden();

        // A live session, not just a form. Without this the page would look
        // right and then fail on submit with "Auth session missing!".
        const sessionEmail = await page.evaluate(
            async () => (await window.SocialAuth.getSession())?.user?.email || null);
        expect(sessionEmail).toBe(TEST_EMAIL);

        // The one-shot payload must not survive in the address bar.
        expect(page.url()).not.toContain('access_token');
        expect(page.url()).not.toContain('type=recovery');

        // Set the new password through the real form.
        passwordWasChanged = true;
        await page.fill('#reset-password', NEW_PASSWORD);
        await page.fill('#reset-confirm', NEW_PASSWORD);
        await page.click('#reset-submit');

        await expect(page.locator('#auth-overlay')).not.toHaveClass(/visible/, { timeout: 15000 });
        await expect(page.locator('#reset-form-error')).toBeHidden();

        // Prove the change server-side, from Node. A closed overlay is the
        // app's opinion; a successful sign-in is GoTrue's.
        const signIn = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: TEST_EMAIL, password: NEW_PASSWORD })
        });
        expect(signIn.ok, `the new password does not work: ${signIn.status}`).toBe(true);
    });

    test('the same link cannot be used twice', async ({ page }) => {
        // Recovery tokens are single-use, and this is the branch real users hit
        // most often — mail scanners and link prefetchers burn the token before
        // the human clicks. Minting and immediately spending a link gives a
        // genuinely dead one to land on.
        const actionLink = await mintRecoveryLink();
        const fragment = await harvestFragment(actionLink);

        // Second visit to the same verify URL: now spent.
        const replay = await fetch(actionLink, { redirect: 'manual' });
        const replayLocation = replay.headers.get('location') || '';
        expect(replayLocation, 'a spent link no longer produces an error redirect')
            .toContain('error');

        const spentFragment = replayLocation.slice(replayLocation.indexOf('#'));

        await page.addInitScript(() => {
            try { localStorage.setItem('viibeview_onboarded_v1', '1'); } catch (e) { /* private mode */ }
        });
        await page.goto(PRETTY_URL + spentFragment, { waitUntil: 'networkidle' });
        await page.waitForSelector('#filter-pills .pill', { timeout: 20000 });

        await expect(page.locator('#reset-expired')).toBeVisible();
        await expect(page.locator('#reset-form')).toBeHidden();
        // The raw GoTrue wording must never reach the user.
        await expect(page.locator('#auth-view-reset')).not.toContainText(/otp_expired|access_denied/i);

        // `fragment` is deliberately unused beyond forcing the first consumption
        // above; naming it documents that the token was spent on purpose.
        expect(fragment).toContain('access_token=');
    });
});
