/**
 * Anti-drift guard for the e2e venue-media stub.
 *
 * e2e/fixtures/test.js exists because the Playwright suite was downloading the
 * real production venue videos on every feed-loading navigation — ~230 MB per
 * run, which put the Supabase org over its free-tier cached egress (5.7 GB / 5 GB).
 *
 * That fix is one import line per spec, which makes it exactly the kind of thing
 * a new spec silently bypasses: `import { test } from '@playwright/test'` still
 * works, still passes, and quietly reinstates the whole bill. Nothing in the
 * e2e run itself would report it — a spec that pulls real media is a *slower
 * green*, not a red.
 *
 * So: assert the import, here, where it costs nothing to check.
 *
 * viibeview-admin.spec.js is exempt. It is skipped in its entirety at :35
 * (VENUE_ADMIN_LIVE + credentials), so it loads no media and adding the fixture
 * would be dead weight. If it is ever ungated, this test's own list must change
 * with it — which is the point of naming the exemption explicitly rather than
 * pattern-matching around it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Derived, never hard-coded. An absolute path to one checkout makes every
// file-reading test in here silently read THAT tree — so a `git worktree`
// baseline at an older commit reads the CURRENT files and reports them as
// passing. That cost a wrong "these failures are pre-existing" conclusion once.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLOWS = path.join(ROOT, 'e2e/flows');

/** Skipped outright — see the header. */
const EXEMPT = new Set(['viibeview-admin.spec.js']);

const specs = fs.readdirSync(FLOWS).filter(f => /^viibeview-.*\.spec\.js$/.test(f));

describe('e2e venue-media stub is not bypassed', () => {

    // Fails open otherwise: an empty list makes every it.each below vacuous.
    it('finds the viibeview e2e specs', () => {
        expect(specs.length).toBeGreaterThanOrEqual(4);
        expect(specs).toContain('viibeview-social.spec.js');
    });

    it('the admin spec named as exempt is still fully skipped', () => {
        const src = fs.readFileSync(path.join(FLOWS, 'viibeview-admin.spec.js'), 'utf8');
        // If this ever stops being true the exemption is no longer free and the
        // spec needs the fixture like the others.
        expect(src).toMatch(/test\.skip\(\s*!LIVE/);
    });

    for (const spec of specs) {
        if (EXEMPT.has(spec)) continue;

        it(`${spec} imports test/expect from the fixture wrapper, not @playwright/test`, () => {
            const src = fs.readFileSync(path.join(FLOWS, spec), 'utf8');

            // Comments mention '@playwright/test' by name (the import line is
            // preceded by a warning not to use it), and an absence test that
            // matches the file's own warning about the thing can only be made
            // to pass by deleting the warning. Strip comments first.
            const code = src
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/^\s*\/\/.*$/gm, '');

            expect(code, `${spec} still imports @playwright/test directly — it will pull real production media`)
                .not.toMatch(/from\s+['"]@playwright\/test['"]/);
            expect(code, `${spec} does not import the media-stub fixture`)
                .toMatch(/import\s*\{[^}]*\btest\b[^}]*\}\s*from\s+['"]\.\.\/fixtures\/test\.js['"]/);
        });
    }

    it('the comment-stripper actually strips (proves the assertion above is not vacuous)', () => {
        const code = `/* import { test } from '@playwright/test'; */\n// from '@playwright/test'\nconst x = 1;`
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
        expect(code).not.toMatch(/@playwright\/test/);
        expect(code).toMatch(/const x = 1/);
    });

    it('the fixture stubs only PUBLIC venue media, and only GETs', () => {
        const src = fs.readFileSync(path.join(ROOT, 'e2e/fixtures/test.js'), 'utf8');

        // The /public/ segment is what keeps viibeview-member.spec.js's avatar
        // upload + storage.remove() teardown running against real production.
        expect(src).toMatch(/object\/public\/venue-media/);
        expect(src).toMatch(/method\(\)\s*!==\s*'GET'/);
    });

    it('the fixture declines with fallback(), never continue()', () => {
        // Playwright matches route handlers in REVERSE registration order, and
        // continue() goes straight to the network instead of offering the
        // request to the next handler. A single continue() here would make the
        // E2E_MEDIA_LEAK_CHECK route unreachable — the leak check would report
        // clean while media leaked past it, which is worse than not having it.
        const src = fs.readFileSync(path.join(ROOT, 'e2e/fixtures/test.js'), 'utf8');
        const fn = src.slice(src.indexOf('await page.route(VENUE_MEDIA_GLOB'));
        expect(fn.length, 'stub handler not found').toBeGreaterThan(200);

        // ⚠️ Strip comments FIRST. The handler documents *why* it does not use
        // continue(), so an absence test over the raw text matches the warning
        // rather than the code, and the only way to make it pass is to delete
        // the explanation.
        const body = fn.slice(0, fn.indexOf('await use('))
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');

        expect(body).toMatch(/return route\.fallback\(\)/);
        expect(body).not.toMatch(/route\.continue\(\)/);
        // Prove the stripper left the code behind, or the line above is vacuous.
        expect(body).toMatch(/route\.fulfill\(\{/);
    });

    it('the committed tiny fixtures exist and are actually tiny', () => {
        const mp4 = fs.statSync(path.join(ROOT, 'e2e/fixtures/tiny-clip.mp4'));
        const jpg = fs.statSync(path.join(ROOT, 'e2e/fixtures/tiny-poster.jpg'));
        // Non-zero: an empty body is undecodable, and viibeview-social.spec.js
        // asserts expect(errors).toEqual([]) over every console error.
        expect(mp4.size).toBeGreaterThan(500);
        expect(mp4.size).toBeLessThan(50_000);
        expect(jpg.size).toBeGreaterThan(100);
        expect(jpg.size).toBeLessThan(5_000);
    });

    it('tiny-clip.mp4 is a real faststart MP4 (ftyp before moov before mdat)', () => {
        const buf = fs.readFileSync(path.join(ROOT, 'e2e/fixtures/tiny-clip.mp4'));
        const atoms = [];
        let o = 0;
        while (o + 8 <= buf.length) {
            const size = buf.readUInt32BE(o);
            atoms.push(buf.toString('latin1', o + 4, o + 8));
            if (size < 8) break;
            o += size;
        }
        expect(atoms[0]).toBe('ftyp');
        // moov before mdat, or Chrome cannot start decoding from a single
        // non-seekable 200 response.
        expect(atoms.indexOf('moov')).toBeGreaterThan(-1);
        expect(atoms.indexOf('moov')).toBeLessThan(atoms.indexOf('mdat'));
    });
});
