/**
 * E2E: ViibeView — signed-in member writes
 *
 * Phase 2 shipped Edit Profile, avatar upload and follow-a-person as correct by
 * construction and by grant, but nothing had ever driven them with a real
 * session: no test in this repo had created or signed in as a ViibeView member.
 * This is that coverage.
 *
 * ⚠️ EVERY TEST HERE WRITES TO ROYALTY PRODUCTION. There is no staging database.
 * So the whole file is gated on credentials being supplied, and every test
 * snapshots the prior state and restores it in a `finally` — running this twice
 * in a row must leave the row exactly as it found it.
 *
 * Why one durable member rather than a signup per run:
 *   - social-signup caps signups at 5/hour/IP
 *     (supabase/functions/social-signup/index.ts:104-111).
 *   - delete_social_member_data only SOFT-deletes. Every throwaway member
 *     permanently adds a `customers` row carrying name/email/phone to a LIVE
 *     client's customer list — which Royal AI, the automations and the owner's
 *     Customers page all read — plus an orphan `profiles` row.
 *
 * Setup (once, by hand — see the plan):
 *   1. Open /a/viibeview/social -> Profile -> Create Account, with a throwaway
 *      address you control.
 *   2. Put the credentials in .env (gitignored):
 *        VIIBEVIEW_TEST_EMAIL=...
 *        VIIBEVIEW_TEST_PASSWORD=...
 *
 * ⚠️ playwright.config.js deliberately does NOT load .env — a spec that reads
 * secrets off disk is a surprise in CI (see e2e/security/client-workspace-live.spec.js:8-10).
 * So pass them explicitly:
 *     npm run test:viibeview:live
 * which sources .env for this one command.
 */

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AVATAR_FIXTURE = path.join(__dirname, '..', 'fixtures', 'avatar-test.jpg');

const PRETTY_URL = '/a/viibeview/social';
const TEST_EMAIL = process.env.VIIBEVIEW_TEST_EMAIL;
const TEST_PASSWORD = process.env.VIIBEVIEW_TEST_PASSWORD;
const CAN_SIGN_IN = !!(TEST_EMAIL && TEST_PASSWORD);

// Serial, sharing one signed-in page: the login form is driven ONCE rather than
// five times, and a restore that fails cannot be masked by a later test racing
// it in parallel against the same production row.
test.describe.configure({ mode: 'serial' });

let context;
let page;

/**
 * social.js is a CLASSIC script (social.html:1130, no type="module"), so its
 * top-level `let`s land in the global lexical environment: `window.currentApp`
 * is undefined, but a bare `currentApp` inside page.evaluate resolves fine.
 * Only the window.-prefixed form fails. Function DECLARATIONS do become window
 * properties, which is why window.openMemberProfile() works below.
 */
async function signedInUserId() {
    return page.evaluate(() => currentUserId);
}

async function loadApp() {
    await page.goto(PRETTY_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('#filter-pills .pill', { timeout: 15000 });
}

/**
 * Dismisses whatever overlay is open.
 *
 * The `finally` blocks below have to reach controls on the page UNDERNEATH, and
 * a test that threw mid-flow can leave the edit sheet or a member page covering
 * them — at which point the restore fails on "intercepts pointer events" and
 * the production row is left mutated. Closing first makes the restore
 * independent of where the failure happened.
 */
async function closeOverlays() {
    await page.evaluate(() => {
        document.getElementById('edit-profile-close')?.click();
        document.getElementById('member-page-back')?.click();
    });
    await page.waitForTimeout(500);
}

async function openEditProfileSheet() {
    await closeOverlays();
    await page.click('.nav-item[data-tab="profile"]');
    await page.click('#edit-profile-btn');
    await expect(page.locator('#edit-profile-sheet')).toHaveClass(/visible/);
    // openEditProfile() refetches the member with force:true before populating.
    await page.waitForTimeout(800);
}

/** Reads the sheet's current values — the snapshot every restore is built on. */
async function readProfileForm() {
    return page.evaluate(() => ({
        name: document.getElementById('edit-profile-name').value,
        bio: document.getElementById('edit-profile-bio').value,
        // ⚠️ Location MUST be in the snapshot. update_social_profile is a full
        // write, so any restore that omits it clears the member's location
        // rather than restoring it — and the restore is what makes this file
        // safe to run twice against production.
        location: document.getElementById('edit-profile-location').value,
        isPublic: document.getElementById('edit-profile-public').checked,
    }));
}

/**
 * Submits the sheet and waits for it to close.
 *
 * ⚠️ Family A RPC: update_social_profile is SECURITY DEFINER and returns
 * success:false WITHOUT setting PostgREST's `error` (20260828000002:29-32). The
 * client surfaces that as an inline form error rather than a throw, so a failed
 * save leaves the sheet OPEN — which is exactly what this asserts against.
 */
async function saveProfileSheet() {
    await page.click('#edit-profile-save');
    await page.waitForTimeout(2500);

    const err = (await page.locator('#edit-profile-error').textContent() || '').trim();
    expect(err, `the profile save was rejected: "${err}"`).toBe('');
    await expect(page.locator('#edit-profile-sheet')).not.toHaveClass(/visible/);
}

/** Restores name/bio/location/public in one write. Used from `finally` blocks. */
async function restoreProfile(snapshot) {
    await openEditProfileSheet();
    await page.fill('#edit-profile-name', snapshot.name);
    await page.fill('#edit-profile-bio', snapshot.bio);
    await page.fill('#edit-profile-location', snapshot.location);
    const nowPublic = await page.isChecked('#edit-profile-public');
    if (nowPublic !== snapshot.isPublic) await page.click('#edit-profile-public');
    await saveProfileSheet();
}

/**
 * Finds another member to follow: the author of any feed card.
 *
 * Deliberately the author of a REAL POST rather than any row from the discover
 * sheet — the Following-feed test needs the followed person to actually have a
 * post, and picking someone at random would make that test pass or fail on who
 * happens to be listed first.
 *
 * Headers are author-first regardless of whether the post has a venue, so the
 * onclick is the whole test: a card that opens a member profile has an author,
 * and one that opens a venue page (or nothing) does not. This used to filter on
 * data-venue-id="" as a proxy for "has an author", which was true only while
 * venue posts hid their author entirely.
 *
 * Returns null when nobody else has posted in this app.
 */
async function findAnotherAuthor() {
    const me = await signedInUserId();
    return page.evaluate(myId => {
        const cards = [...document.querySelectorAll('#feed-container .feed-card')];
        for (const card of cards) {
            const info = card.querySelector('.feed-venue-info');
            const onclick = info?.getAttribute('onclick') || '';
            const m = onclick.match(/openMemberProfile\('([^']+)'\)/);
            if (m && m[1] !== myId) {
                return { userId: m[1], name: card.querySelector('.venue-handle')?.textContent.trim() || '' };
            }
        }
        return null;
    }, me);
}

test.beforeAll(async ({ browser }) => {
    if (!CAN_SIGN_IN) return;

    context = await browser.newContext();
    page = await context.newPage();

    await loadApp();
    await page.click('.nav-item[data-tab="profile"]');
    await page.click('#profile-login-btn');
    await page.fill('#login-email', TEST_EMAIL);
    await page.fill('#login-password', TEST_PASSWORD);
    await page.click('#login-submit');
    await page.waitForTimeout(3000);

    // Fail here rather than letting five tests each fail confusingly on a
    // missing control.
    await expect(
        page.locator('#profile-signed-in'),
        'sign-in did not complete — check VIIBEVIEW_TEST_EMAIL / VIIBEVIEW_TEST_PASSWORD'
    ).toBeVisible();
});

test.afterAll(async () => {
    await context?.close();
});

test.describe('ViibeView signed-in member', () => {
    test('editing the display name and bio persists and repaints the profile', async () => {
        test.skip(!CAN_SIGN_IN, 'needs VIIBEVIEW_TEST_EMAIL / VIIBEVIEW_TEST_PASSWORD — writes to Royalty PROD');

        await loadApp();
        await openEditProfileSheet();
        const before = await readProfileForm();

        const newName = `E2E Name ${Date.now()}`;
        const newBio = `E2E bio ${Date.now()}`;

        try {
            await page.fill('#edit-profile-name', newName);
            await page.fill('#edit-profile-bio', newBio);
            await saveProfileSheet();

            // The Profile tab repaints from renderProfileIdentity().
            await expect(page.locator('#profile-name')).toHaveText(newName);

            // Reload proves it was WRITTEN, not just repainted optimistically.
            await loadApp();
            await page.click('.nav-item[data-tab="profile"]');
            await expect(page.locator('#profile-name')).toHaveText(newName);

            // The byline on a feed card comes from the feed RPC, so it only
            // moves after a refetch. Only assertable if this member has posted;
            // a brand-new test account has not, and asserting anyway is how a
            // test starts passing against a state it never reached.
            const myId = await signedInUserId();
            // .venue-handle sits INSIDE .feed-venue-info (see
            // postHeaderMarkup), so this descends rather than hopping up.
            const myByline = page.locator(
                `#feed-container .feed-venue-info[onclick*="${myId}"] .venue-handle`);
            if (await myByline.count() > 0) {
                await expect(myByline.first()).toHaveText(newName);
            }
        } finally {
            await restoreProfile(before);
        }
    });

    test('turning off the public profile hides it from others but not from yourself', async () => {
        test.skip(!CAN_SIGN_IN, 'needs VIIBEVIEW_TEST_EMAIL / VIIBEVIEW_TEST_PASSWORD — writes to Royalty PROD');

        await loadApp();
        const myId = await signedInUserId();
        expect(myId, 'no signed-in user id').toBeTruthy();

        await openEditProfileSheet();
        const before = await readProfileForm();

        try {
            if (before.isPublic) await page.click('#edit-profile-public');
            expect(await page.isChecked('#edit-profile-public')).toBe(false);
            await saveProfileSheet();

            // Self-branch: get_member_profile returns the full row when
            // auth.uid() = p_user_id regardless of profile_public
            // (20260903000002:341). Your own profile must stay fully visible.
            await page.evaluate(id => window.openMemberProfile(id), myId);
            await page.waitForTimeout(1500);
            await expect(page.locator('#member-page')).toHaveClass(/visible/);
            await expect(page.locator('#member-page-private')).toBeHidden();
            await expect(page.locator('#member-page-name')).not.toBeEmpty();
            await page.click('#member-page-back');

            // A SEPARATE anonymous context is the only honest test of "hidden
            // from other people" — same browser, no session.
            const anonCtx = await context.browser().newContext();
            try {
                const anon = await anonCtx.newPage();
                await anon.goto(PRETTY_URL, { waitUntil: 'networkidle' });
                await anon.waitForSelector('#filter-pills .pill', { timeout: 15000 });
                await anon.evaluate(id => window.openMemberProfile(id), myId);
                await anon.waitForTimeout(1500);

                await expect(anon.locator('#member-page')).toHaveClass(/visible/);
                await expect(anon.locator('#member-page-private')).toBeVisible();
            } finally {
                await anonCtx.close();
            }
        } finally {
            await restoreProfile(before);
        }
    });

    test('a location persists across a reload and shows on the profile overlay', async () => {
        test.skip(!CAN_SIGN_IN, 'needs VIIBEVIEW_TEST_EMAIL / VIIBEVIEW_TEST_PASSWORD — writes to Royalty PROD');

        await loadApp();
        const myId = await signedInUserId();
        await openEditProfileSheet();
        const before = await readProfileForm();

        const newLocation = `Perpignan ${Date.now()}`;

        try {
            await page.fill('#edit-profile-location', newLocation);
            await saveProfileSheet();

            // Reload proves it was WRITTEN. An optimistic repaint would pass a
            // same-session assertion and fail this one.
            await loadApp();
            await page.evaluate(id => window.openMemberProfile(id), myId);
            await page.waitForTimeout(1500);
            const loc = page.locator('#member-page-location');
            await expect(loc).toBeVisible();
            await expect(loc).toHaveText(newLocation);
            await page.click('#member-page-back');

            // ⚠️ The full-write trap, driven end to end: reopen the sheet, change
            // ONLY the bio, save. If the sheet failed to prefill location — or
            // failed to send it — update_social_profile's DEFAULT NULL clears it
            // and the member silently loses their location for editing something
            // else. get_social_member gained the column in 20260904000003 purely
            // so this passes.
            await openEditProfileSheet();
            expect(
                await page.inputValue('#edit-profile-location'),
                'the edit sheet did not prefill location — the next save would erase it'
            ).toBe(newLocation);
            await page.fill('#edit-profile-bio', `E2E bio ${Date.now()}`);
            await saveProfileSheet();

            await loadApp();
            await page.evaluate(id => window.openMemberProfile(id), myId);
            await page.waitForTimeout(1500);
            await expect(
                page.locator('#member-page-location'),
                'editing the bio wiped the location — update_social_profile is a FULL write'
            ).toHaveText(newLocation);
            await page.click('#member-page-back');
        } finally {
            await restoreProfile(before);
        }
    });

    test('a private profile shows a stranger NO tappable stat buttons', async () => {
        test.skip(!CAN_SIGN_IN, 'needs VIIBEVIEW_TEST_EMAIL / VIIBEVIEW_TEST_PASSWORD — writes to Royalty PROD');

        await loadApp();
        const myId = await signedInUserId();
        await openEditProfileSheet();
        const before = await readProfileForm();

        try {
            if (before.isPublic) await page.click('#edit-profile-public');
            await saveProfileSheet();

            const anonCtx = await context.browser().newContext();
            try {
                const anon = await anonCtx.newPage();
                await anon.goto(PRETTY_URL, { waitUntil: 'networkidle' });
                await anon.waitForSelector('#filter-pills .pill', { timeout: 15000 });
                await anon.evaluate(id => window.openMemberProfile(id), myId);
                await anon.waitForTimeout(1500);

                await expect(anon.locator('#member-page-private')).toBeVisible();

                // ⚠️ Assert the buttons are ABSENT, not merely invisible. The
                // bug this replaced hid them after painting, which still wrote
                // three openPeopleSheet('followers','<uid>') handlers into the
                // DOM under a panel saying the profile is private.
                await expect(anon.locator('#member-page-stats .member-stat')).toHaveCount(0);
                expect(
                    await anon.locator('#member-page-stats').innerHTML(),
                    'the stats block still carries this member\'s uid'
                ).not.toContain(myId);

                // And the derived surfaces are empty too — 20260904000002 gates
                // the list RPCs themselves, not just what the client draws.
                const leaked = await anon.evaluate(async id => {
                    const call = async (fn) => {
                        const { data } = await supabaseClient.rpc(fn, {
                            p_app_id: currentApp.id, p_user_id: id, p_limit: 50, p_offset: 0,
                        });
                        return (data || []).length;
                    };
                    return {
                        venues: await call('get_member_venues'),
                        followers: await call('get_member_followers'),
                        following: await call('get_member_following'),
                    };
                }, myId);
                expect(leaked, 'a private member\'s lists are readable with the anon key')
                    .toEqual({ venues: 0, followers: 0, following: 0 });
            } finally {
                await anonCtx.close();
            }

            // The same three calls, as the member themselves, must NOT be
            // empty-by-permission. Without this half, the block above passes
            // just as well against a function that returns nothing to anyone.
            await page.evaluate(id => window.openMemberProfile(id), myId);
            await page.waitForTimeout(1500);
            await expect(page.locator('#member-page-stats .member-stat')).toHaveCount(3);
            await page.click('#member-page-back');
        } finally {
            await restoreProfile(before);
        }
    });

    test('the grid chips each tile with its venue and "Been to" dedupes them', async () => {
        test.skip(!CAN_SIGN_IN, 'needs VIIBEVIEW_TEST_EMAIL / VIIBEVIEW_TEST_PASSWORD');

        await loadApp();
        const myId = await signedInUserId();
        await page.evaluate(id => window.openMemberProfile(id), myId);
        await page.waitForTimeout(2000);

        // ⚠️ ViibeView prod has two posts, neither of them a venue-attached post
        // by this member, so this normally skips. That skip is honest but it is
        // NOT coverage — the markup, the dedup, the six-row cap and the
        // ellipsis rule are pinned in tests/viibeview-member-venues.test.js
        // against fabricated rows, precisely because this cannot run.
        const tiles = await page.locator('#member-page-grid .member-grid-tile').count();
        const chips = await page.locator('#member-page-grid .member-grid-venue').count();
        test.skip(chips === 0,
            `this member has no venue-attached posts (${tiles} tiles, 0 with a venue) — ` +
            'covered by tests/viibeview-member-venues.test.js instead');

        // Every chip names something.
        for (const text of await page.locator('.member-grid-venue').allTextContents()) {
            expect(text.trim()).not.toBe('');
        }

        // "Been to" appears, and holds no more rows than there are chipped
        // tiles — the whole claim of deduping by venue.
        await expect(page.locator('#member-page-venues')).toBeVisible();
        const rows = await page.locator('#member-page-venues-list .people-row').count();
        expect(rows).toBeGreaterThan(0);
        expect(rows, 'the venue list is not deduped').toBeLessThanOrEqual(chips);

        // Each row says how many and when.
        const meta = await page.locator('#member-page-venues-list .people-row-meta').first().textContent();
        expect(meta).toMatch(/\d+\s+Viibes?/);
    });

    test('uploading an avatar stores it under members/{uid}/ and renders it', async () => {
        test.skip(!CAN_SIGN_IN, 'needs VIIBEVIEW_TEST_EMAIL / VIIBEVIEW_TEST_PASSWORD — writes to Royalty PROD');

        await loadApp();
        const myId = await signedInUserId();

        await openEditProfileSheet();
        const before = await readProfileForm();
        let uploadedPath = null;

        try {
            // The input is `hidden` and driven by a <label for>. setInputFiles
            // does not need it visible.
            await page.setInputFiles('#edit-profile-avatar-input', AVATAR_FIXTURE);
            await page.waitForTimeout(1500);   // downscaleImage() re-encodes via canvas
            await saveProfileSheet();

            // update_social_profile REJECTS any avatar_url that is not under
            // .../public/venue-media/members/ (20260903000002:274), so a save
            // that succeeded proves a genuine upload happened — but assert the
            // rendered URL anyway, because that is what members actually see.
            const img = page.locator('#profile-avatar img');
            await expect(img).toHaveCount(1);
            const src = await img.getAttribute('src');
            expect(src, `avatar src is not under members/${myId}/: ${src}`)
                .toContain(`/storage/v1/object/public/venue-media/members/${myId}/`);

            uploadedPath = src.split('/venue-media/')[1].split('?')[0];

            // It must survive a reload — a preview blob would not.
            await loadApp();
            await page.click('.nav-item[data-tab="profile"]');
            await expect(page.locator('#profile-avatar img')).toHaveAttribute(
                'src', new RegExp(`/venue-media/members/${myId}/`));
        } finally {
            // Restore in two parts: clear the column, AND delete the object, so
            // repeated runs do not accrue orphan images in a live bucket. The
            // members/{uid}/ DELETE policy (20260828000002:277-285) is what
            // permits the second half.
            await openEditProfileSheet();
            await page.click('#edit-profile-avatar-remove');
            await page.fill('#edit-profile-name', before.name);
            await page.fill('#edit-profile-bio', before.bio);
            // Full write — omitting this field clears it, it does not skip it.
            await page.fill('#edit-profile-location', before.location);
            await saveProfileSheet();

            if (uploadedPath) {
                const removed = await page.evaluate(async p => {
                    const { data, error } = await supabaseClient.storage.from('venue-media').remove([p]);
                    return { removed: data?.length ?? 0, error: error?.message || null };
                }, uploadedPath);
                expect(removed.error, `could not delete the uploaded avatar ${uploadedPath}`).toBeNull();
                expect(removed.removed, `avatar ${uploadedPath} was not deleted — it will accrue in prod`).toBe(1);
            }
        }
    });

    test('following a person moves the follower count and survives a reload', async () => {
        test.skip(!CAN_SIGN_IN, 'needs VIIBEVIEW_TEST_EMAIL / VIIBEVIEW_TEST_PASSWORD — writes to Royalty PROD');

        await loadApp();
        await page.waitForTimeout(2500);

        const other = await findAnotherAuthor();
        // Only follow-a-VENUE was covered before (viibeview-social.spec.js).
        // A tenant whose every post is this member's own has nobody to follow,
        // and saying so is better than a green vacuous test.
        test.skip(!other, 'no post by another member in this app yet');

        await page.evaluate(id => window.openMemberProfile(id), other.userId);
        await page.waitForTimeout(1500);
        await expect(page.locator('#member-page')).toHaveClass(/visible/);

        const btn = page.locator('#member-page-follow-btn');
        await expect(btn).toBeVisible();

        // Followers specifically — NOT .first(). renderMemberStats() renders
        // Posts / Followers / Following in that order (social.js:2831-2834), so
        // .first() is the POST count, which following someone never moves.
        // Matched on the onclick so a reorder cannot silently retarget this.
        const followerCount = page.locator(
            '#member-page-stats .member-stat[onclick*="followers"] .member-stat-value');
        await expect(followerCount, 'no followers stat rendered').toHaveCount(1);

        const labelBefore = (await btn.textContent()).trim();
        const countBefore = (await followerCount.innerText()).trim();
        let followed = false;

        try {
            await btn.click();
            await page.waitForTimeout(1800);
            followed = true;

            const labelAfter = (await btn.textContent()).trim();
            expect(labelAfter, 'the follow button did not change state').not.toBe(labelBefore);

            // The server count is authoritative — it excludes soft-deleted
            // members, which the client cannot compute. An optimistic repaint
            // that never landed would pass the label check and fail this.
            const countAfter = (await followerCount.innerText()).trim();
            expect(countAfter, 'the follower count did not move').not.toBe(countBefore);

            // Persistence: a write that never landed repaints fine and reloads wrong.
            await loadApp();
            await page.evaluate(id => window.openMemberProfile(id), other.userId);
            await page.waitForTimeout(1500);
            expect((await page.locator('#member-page-follow-btn').textContent()).trim()).toBe(labelAfter);
        } finally {
            if (followed) {
                await closeOverlays();
                await page.evaluate(id => window.openMemberProfile(id), other.userId);
                await page.waitForTimeout(1200);
                const b = page.locator('#member-page-follow-btn');
                if ((await b.textContent()).trim() !== labelBefore) {
                    await b.click();
                    await page.waitForTimeout(1500);
                }
                expect((await b.textContent()).trim(), 'unfollow did not restore the prior state')
                    .toBe(labelBefore);
            }
        }
    });

    test('the Following chip appears signed in and its feed carries the followed member\'s post', async () => {
        test.skip(!CAN_SIGN_IN, 'needs VIIBEVIEW_TEST_EMAIL / VIIBEVIEW_TEST_PASSWORD — writes to Royalty PROD');

        await loadApp();
        await page.waitForTimeout(2500);

        // get_following_feed is authenticated-only, so the chip only exists for
        // a signed-in visitor. viibeview-social.spec.js asserts its ABSENCE
        // signed out; this is the other half.
        const chip = page.locator('#filter-pills .pill[data-filter-kind="following"]');
        await expect(chip).toHaveCount(1);

        const other = await findAnotherAuthor();
        test.skip(!other, 'no post by another member to populate a Following feed');

        let followed = false;
        try {
            await page.evaluate(id => window.openMemberProfile(id), other.userId);
            await page.waitForTimeout(1500);
            const followBtn = page.locator('#member-page-follow-btn');
            const wasFollowing = (await followBtn.textContent()).trim().toLowerCase().includes('following');
            if (!wasFollowing) {
                await followBtn.click();
                await page.waitForTimeout(1800);
                followed = true;
            }
            await page.click('#member-page-back');
            await page.waitForTimeout(400);

            await chip.click();
            await page.waitForTimeout(2500);

            // The whole point of the chip: their post is in this feed.
            const authored = page.locator(
                `#feed-container .feed-card .feed-venue-info[onclick*="${other.userId}"]`);
            await expect(
                authored.first(),
                'the Following feed did not contain a post by the member just followed'
            ).toBeVisible();
        } finally {
            // Back to All, then undo the follow if this test created it.
            await closeOverlays();
            await page.click('#filter-pills .pill[data-filter-kind="all"]');
            await page.waitForTimeout(800);

            if (followed) {
                await page.evaluate(id => window.openMemberProfile(id), other.userId);
                await page.waitForTimeout(1200);
                const b = page.locator('#member-page-follow-btn');
                if ((await b.textContent()).trim().toLowerCase().includes('following')) {
                    await b.click();
                    await page.waitForTimeout(1500);
                }
            }
        }
    });

    test('signing in swaps the signup banner for the install banner immediately', async ({ browser }) => {
        test.skip(!CAN_SIGN_IN, 'needs VIIBEVIEW_TEST_EMAIL / VIIBEVIEW_TEST_PASSWORD');

        // ⚠️ Its own context, NOT the shared signed-in `page` — the whole point
        // is to start signed OUT and watch the slot change under a page that is
        // already painted. Writes nothing; no restore needed.
        const ctx = await browser.newContext();
        const p = await ctx.newPage();

        try {
            await p.addInitScript(() => {
                // Qualify for the second-visit rule, and clear both dismissals.
                localStorage.setItem('viibe_visits_viibeview', '3');
                localStorage.removeItem('viibe_install_dismissed_viibeview');
                localStorage.removeItem('viibe_signup_banner_dismissed_viibeview');
            });
            await p.goto(PRETTY_URL, { waitUntil: 'networkidle' });
            await p.waitForSelector('#filter-pills .pill', { timeout: 15000 });

            await expect(p.locator('#signup-banner')).toHaveClass(/visible/);
            await expect(p.locator('#install-banner')).not.toHaveClass(/visible/);

            // Chromium does not fire beforeinstallprompt under automation, so
            // canOfferInstall() would veto the install banner for reasons that
            // have nothing to do with what this test is about. Stand one in.
            // (Classic script — the bare identifier is the top-level binding.)
            await p.evaluate(() => {
                deferredInstallPrompt = {
                    prompt() {},
                    userChoice: Promise.resolve({ outcome: 'accepted' })
                };
            });

            await p.click('.nav-item[data-tab="profile"]');
            await p.click('#profile-login-btn');
            await p.fill('#login-email', TEST_EMAIL);
            await p.fill('#login-password', TEST_PASSWORD);
            await p.click('#login-submit');

            await expect(p.locator('#profile-signed-in')).toBeVisible({ timeout: 20000 });

            // ⚠️ No p.reload() anywhere in this test. That absence IS the
            // assertion: onSignedIn() has to swap the slot in place, and it has
            // to ignore the visit count for someone who just joined.
            await expect(p.locator('#install-banner')).toHaveClass(/visible/);
            await expect(p.locator('#signup-banner')).not.toHaveClass(/visible/);
        } finally {
            await ctx.close();
        }
    });
});
