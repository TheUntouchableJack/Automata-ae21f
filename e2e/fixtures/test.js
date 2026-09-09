/**
 * Playwright fixture wrapper: stub ViibeView's public venue media.
 *
 * WHY THIS EXISTS
 * ---------------
 * `baseURL` is localhost, but the client hardcodes the production Supabase
 * origin (customer-app/social.js:7-10) — there is no `import.meta.env` and
 * vite.config.js has no proxy. So every feed-loading navigation in the e2e
 * suite downloads the real venue videos from production storage.
 *
 * Measured Aug 24 – Sep 7: ~67 unconditional feed loads per run x ~3.5 MB
 * ≈ 230 MB per `npx playwright test`, and the Supabase org's free-tier cached
 * egress went to 5.7 GB / 5 GB. Every Playwright context is fresh, so nothing
 * is ever cached, and `waitUntil: 'networkidle'` makes Playwright wait for the
 * *full* download rather than short-circuit it.
 *
 * This fixture answers every public venue-media GET with a tiny, genuinely
 * decodable file instead.
 *
 * TRADEOFF — STATED PLAINLY
 * -------------------------
 * Specs importing from here stop proving that a `venue_media.url` resolves to
 * real bytes. That coverage is not dropped, it is *moved*: see the
 * "public venue media resolves to real bytes" test in viibeview-social.spec.js,
 * which does a single 1-byte Range request against the real URL read out of
 * the DOM. One 1-byte request replaces ~230 MB.
 *
 * WHAT IS DELIBERATELY *NOT* MATCHED
 * ----------------------------------
 * The `/public/` path segment is load-bearing. Uploads go to
 * `/storage/v1/object/venue-media/...` (no `/public/`), so
 * viibeview-member.spec.js's avatar upload + `storage.remove()` teardown still
 * runs against real production and still proves itself.
 *
 * Non-GET is passed straight through for the same reason.
 *
 * DO NOT add `serviceWorkers: 'block'` to make this work — it already works.
 * customer-app/sw.js:134 returns early for Supabase hosts on purpose (:138-154
 * explains the CSP trap), so these requests never enter the SW and `page.route`
 * sees them normally.
 *
 * Escape hatch: `E2E_REAL_MEDIA=1` serves the real files, loudly.
 */

import { test as base, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Public venue media only. The `/public/` segment excludes uploads — see the
 * header. Exported so a spec can `page.unroute()` it when it deliberately wants
 * the real object.
 */
export const VENUE_MEDIA_GLOB = '**/storage/v1/object/public/venue-media/**';

const REAL_MEDIA = process.env.E2E_REAL_MEDIA === '1';

const TINY_MP4 = fs.readFileSync(path.join(__dirname, 'tiny-clip.mp4'));
const TINY_JPG = fs.readFileSync(path.join(__dirname, 'tiny-poster.jpg'));

// Average real payload per public venue-media GET, measured 2026-09-09 across
// the two objects `venue_media` actually references (3,193,954 B + 82,645 B
// video/poster pair, and a 1,202,122 B video). Used only to put a number on
// the log line — nothing branches on it.
const AVG_REAL_BYTES = 1_500_000;

// Per-worker totals. Playwright runs workers in separate processes, so each
// worker prints its own summary; they sum to the run total.
const hitsBySpec = new Map();
let summaryInstalled = false;

function installSummary() {
    if (summaryInstalled) return;
    summaryInstalled = true;
    process.on('exit', () => {
        if (REAL_MEDIA) return;
        let total = 0;
        let served = 0;
        for (const s of hitsBySpec.values()) { total += s.hits; served += s.bytes; }
        if (total === 0) {
            // The failure mode worth making loud: the stub silently stopped
            // matching (a route glob drifted, or a spec was rewritten to load
            // the feed some other way) and the suite quietly went back to
            // pulling production media.
            console.warn(
                '\n  [media-stub] ⚠️  ZERO public venue-media requests intercepted in this worker.\n' +
                '  [media-stub]     If this worker ran a feed-loading spec, the stub is no longer\n' +
                '  [media-stub]     matching and the suite is downloading production media again.\n'
            );
            return;
        }
        console.log(`\n  [media-stub] ${total} venue-media GET(s) stubbed, ${served} B served ` +
            `(~${(total * AVG_REAL_BYTES / 1e6).toFixed(0)} MB of production egress avoided)`);
        for (const [spec, s] of hitsBySpec) {
            console.log(`  [media-stub]   ${spec}: ${s.hits}`);
        }
    });
}

export const test = base.extend({
    stubVenueMedia: [async ({ page }, use, testInfo) => {
        if (REAL_MEDIA) {
            console.warn(`  [media-stub] ⚠️  E2E_REAL_MEDIA=1 — serving REAL production media ` +
                `for "${testInfo.title}". This costs Supabase cached egress.`);
            await use({ hits: () => 0 });
            return;
        }

        installSummary();
        const spec = path.basename(testInfo.file);
        if (!hitsBySpec.has(spec)) hitsBySpec.set(spec, { hits: 0, bytes: 0 });
        const stats = hitsBySpec.get(spec);
        let localHits = 0;

        // ⚠️ Leak detector FIRST. Playwright matches route handlers in REVERSE
        // registration order — last registered wins — so this must go in before
        // the stub, or it would intercept the very requests the stub exists to
        // answer and every one of them would report as a leak.
        //
        // `E2E_MEDIA_LEAK_CHECK=1` fails any test that lets a venue-media byte
        // reach production, and logs every other public-storage GET it sees so
        // the picture is complete rather than merely green. This asserts the
        // stub still WORKS; the vitest guard
        // (tests/e2e-media-stub-guard.test.js) only asserts it is still WIRED UP.
        if (process.env.E2E_MEDIA_LEAK_CHECK === '1') {
            await page.route('**://*.supabase.co/storage/v1/object/public/**', route => {
                const url = route.request().url();
                if (url.includes('/venue-media/') && route.request().method() === 'GET') {
                    throw new Error(`media-stub LEAK — this reached production storage: ${url}`);
                }
                console.log(`  [leak-check] passthrough (not venue-media): ${url}`);
                return route.continue();
            });
        }

        await page.route(VENUE_MEDIA_GLOB, async (route) => {
            // ⚠️ fallback(), not continue(), on every path this handler declines.
            // continue() sends the request straight to the network; fallback()
            // offers it to the next-registered handler — which is the leak
            // detector above. With the check off there is no next handler and
            // fallback() goes to the network anyway, so this is correct in both
            // modes and observable in one.
            //
            // Uploads/deletes must reach production untouched.
            if (route.request().method() !== 'GET') return route.fallback();

            const url = route.request().url().split('?')[0].toLowerCase();
            let body;
            let contentType;
            if (url.endsWith('.mp4') || url.endsWith('.m4v') || url.endsWith('.mov')) {
                body = TINY_MP4; contentType = 'video/mp4';
            } else if (url.endsWith('.jpg') || url.endsWith('.jpeg')) {
                body = TINY_JPG; contentType = 'image/jpeg';
            } else {
                // webm, png, anything unrecognised: let it through rather than
                // hand the decoder bytes it cannot read. viibeview-social.spec.js
                // asserts `expect(errors).toEqual([])` over every console error,
                // so an undecodable body would fail the suite, not just cost
                // coverage. Under the leak check this correctly reports as a
                // leak, because that is exactly what it is.
                return route.fallback();
            }

            localHits++; stats.hits++; stats.bytes += body.length;

            // 200 with the whole (tiny) body. Chrome opens a video with
            // `Range: bytes=0-`; answering 200 + `accept-ranges: none` is the
            // standard pattern and only disables seeking, which no spec uses.
            await route.fulfill({
                status: 200,
                contentType,
                headers: {
                    'accept-ranges': 'none',
                    'cache-control': 'no-store',
                    'access-control-allow-origin': '*',
                },
                body,
            });
        });

        await use({ hits: () => localHits });
    }, { auto: true }],
});

export { expect };
