/**
 * ViibeView contract tests.
 *
 * These are deliberately structural rather than behavioural: they assert the
 * things that have ACTUALLY broken this app before and broke it silently —
 * markup the JS reaches for by id and does not find, a manifest naming an icon
 * that is not on disk, a service-worker precache list with a 404 in it (which
 * rejects the whole install), and admin affordances shipping visible.
 *
 * None of it needs a network, a session or a database.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

const ROOT = '/Users/jaywhitley/AI Projects/Automata';
const html = fs.readFileSync(path.join(ROOT, 'customer-app/social.html'), 'utf8');

function boot() {
    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://royaltyapp.ai/customer-app/social.html?slug=viibeview' });
    const w = dom.window;
    // Load the shared vocabularies exactly as the page does.
    w.eval(fs.readFileSync(path.join(ROOT, 'js/venue-categories.js'), 'utf8'));
    w.eval(fs.readFileSync(path.join(ROOT, 'js/music-genres.js'), 'utf8'));
    return dom;
}

describe('ViibeView markup + vocabularies', () => {
    let dom, d, w;
    beforeEach(() => { dom = boot(); w = dom.window; d = w.document; });

    it('has exactly ONE filter row', () => {
        expect(d.getElementById('filter-pills')).toBeTruthy();
        // The two-row version cost ~90px of a phone screen before any content.
        expect(d.getElementById('category-pills')).toBeNull();
        expect(d.getElementById('genre-pills')).toBeNull();
    });

    it('ships the filter row empty — the chips are derived from the venue set', () => {
        // Rendering all 8 categories and all 19 genres unconditionally meant
        // 25 of 27 chips returned an empty feed for a one-venue tenant.
        expect(d.getElementById('filter-pills').children.length).toBe(0);
    });

    it('the composer venue row is a real button, not a hidden label', () => {
        const el = d.getElementById('create-post-venue');
        expect(el.tagName).toBe('BUTTON');
        expect(el.getAttribute('type')).toBe('button');
        // The old markup shipped style="display:none" that only a venue-page
        // open would clear. That is the bug; assert it is gone.
        expect(el.getAttribute('style')).toBeNull();
    });

    it('every sheet the new code opens exists, with its backdrop', () => {
        for (const id of [
            'venue-picker-sheet', 'venue-picker-backdrop',
            'add-venue-sheet', 'add-venue-backdrop',
            'ios-install-sheet', 'ios-install-backdrop',
            'install-banner',
        ]) {
            expect(d.getElementById(id), id).toBeTruthy();
        }
    });

    it('every element the new JS reaches for by id is present', () => {
        const ids = [
            'venue-picker-filter', 'venue-picker-list', 'venue-picker-close',
            'place-search-input', 'place-results',
            'add-venue-step-search', 'add-venue-step-confirm', 'add-venue-back',
            'add-venue-name', 'add-venue-address', 'add-venue-city', 'add-venue-state',
            'add-venue-postal', 'add-venue-country', 'add-venue-coords',
            'add-venue-category', 'add-venue-genres', 'add-venue-save', 'add-venue-error',
            'add-venue-btn', 'search-add-venue-btn',
            'install-banner-icon', 'install-banner-btn', 'install-banner-dismiss',
            'ios-install-close',
        ];
        const missing = ids.filter(id => !d.getElementById(id));
        expect(missing).toEqual([]);
    });

    it('setFormMessage/setSubmitting id conventions are satisfied by the add-venue form', () => {
        // setFormMessage('add-venue', msg) resolves `${formId}-error`.
        expect(d.getElementById('add-venue-error')).toBeTruthy();
        // setSubmitting('add-venue-save', ...) resolves the id directly.
        expect(d.getElementById('add-venue-save')).toBeTruthy();
    });

    it('admin entry points ship hidden — an anonymous visitor must not see them', () => {
        expect(d.getElementById('add-venue-btn').style.display).toBe('none');
        expect(d.getElementById('search-add-venue-btn').style.display).toBe('none');
    });

    it('points at the ViibeView manifest and apple-touch-icon, not Royalty\'s', () => {
        expect(d.querySelector('link[rel="manifest"]').getAttribute('href'))
            .toBe('/customer-app/viibeview-manifest.json');
        expect(d.querySelector('link[rel="apple-touch-icon"]').getAttribute('href'))
            .toBe('/icons/viibeview/apple-touch-icon.png');
    });

    it('loads music-genres.js and venue-places.js before social.js', () => {
        const srcs = [...d.querySelectorAll('script[src]')].map(s => s.getAttribute('src'));
        const iOf = (frag) => srcs.findIndex(s => s.includes(frag));
        expect(iOf('music-genres.js')).toBeGreaterThan(-1);
        expect(iOf('venue-places.js')).toBeGreaterThan(-1);
        expect(iOf('music-genres.js')).toBeLessThan(iOf('social.js'));
        expect(iOf('venue-places.js')).toBeLessThan(iOf('social.js'));
    });

    // ===== Phase 2: profiles, follows, discovery =====

    it('the bottom nav has exactly FOUR items', () => {
        // The member profile is an OVERLAY on purpose. Every "add a screen"
        // change is one line from becoming a fifth tab, and a fifth tab breaks
        // the layout the whole stylesheet is built around — plus it would have
        // nothing to show the signed-out visitors who are most of this app's
        // traffic. Assert the invariant, not the intention.
        expect(d.querySelectorAll('.bottom-nav .nav-item').length).toBe(4);
        expect(d.getElementById('member-page').tagName).toBe('SECTION');
    });

    it('the member profile overlay and its backdrop exist', () => {
        for (const id of ['member-page', 'member-page-backdrop']) {
            expect(d.getElementById(id), id).toBeTruthy();
        }
    });

    it('every Phase 2 element the JS reaches for by id is present', () => {
        const ids = [
            // member profile overlay
            'member-page-back', 'member-page-title', 'member-page-scroll',
            'member-page-avatar', 'member-page-name', 'member-page-bio',
            'member-page-stats', 'member-page-follow-btn', 'member-page-grid',
            'member-page-loading', 'member-page-empty', 'member-page-private',
            // people sheet (followers / following / discover)
            'people-sheet', 'people-backdrop', 'people-sheet-title',
            'people-sheet-search', 'people-sheet-search-wrap',
            'people-list', 'people-empty', 'people-sheet-close',
            // edit profile
            'edit-profile-sheet', 'edit-profile-backdrop', 'edit-profile-close',
            'edit-profile-form', 'edit-profile-name', 'edit-profile-bio',
            'edit-profile-bio-count', 'edit-profile-public',
            'edit-profile-avatar-preview', 'edit-profile-avatar-input',
            'edit-profile-avatar-remove',
            // profile tab entry points
            'profile-stats', 'profile-followers-btn', 'profile-followers-count',
            'profile-following-btn', 'profile-following-count',
            'edit-profile-btn', 'view-my-profile-btn', 'discover-members-btn',
        ];
        const missing = ids.filter(id => !d.getElementById(id));
        expect(missing).toEqual([]);
    });

    it('setFormMessage/setSubmitting id conventions are satisfied by the edit-profile form', () => {
        // These two ids are NOT cosmetic. setFormMessage('edit-profile', …)
        // resolves `${formId}-error` / `${formId}-success`, and
        // setSubmitting('edit-profile-save', …) resolves the id directly
        // (social.js:591-609). Rename either and the form silently loses its
        // error reporting and its busy state — no exception, no console line.
        expect(d.getElementById('edit-profile-error')).toBeTruthy();
        expect(d.getElementById('edit-profile-success')).toBeTruthy();
        expect(d.getElementById('edit-profile-save')).toBeTruthy();
        // setFieldError('edit-profile-name', …) uses the same convention.
        expect(d.getElementById('edit-profile-name-error')).toBeTruthy();
    });

    it('the follow button ships with no hardcoded label', () => {
        // paintFollowButton() is the single writer of Follow/Following text, so
        // the venue page's button and the member page's button cannot disagree
        // about the same edge. A label in the markup would show through for one
        // frame and, worse, would survive if the repaint never ran.
        expect(d.getElementById('member-page-follow-btn').textContent.trim()).toBe('');
    });

    it('keeps a cache buster on social.js and social.css', () => {
        // sw.js serves cache-first keyed on the FULL url, so dropping the ?v=
        // would strand every returning PWA user on the cached renderer. The
        // VALUE is not asserted — that would fail on every future release —
        // only that the mechanism is still there.
        const srcs = [...d.querySelectorAll('script[src], link[rel="stylesheet"]')]
            .map(s => s.getAttribute('src') || s.getAttribute('href'));
        expect(srcs.some(s => /social\.js\?v=\d+/.test(s))).toBe(true);
        expect(srcs.some(s => /social\.css\?v=\d+/.test(s))).toBe(true);
    });
});

describe('manifest', () => {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'customer-app/viibeview-manifest.json'), 'utf8'));

    it('start_url carries the tenant slug — the whole point of the fix', () => {
        expect(m.start_url).toContain('slug=viibeview');
    });

    it('start_url is inside scope, and scope is inside the service worker scope', () => {
        // Chrome will not offer an install prompt otherwise.
        expect(m.start_url.startsWith(m.scope)).toBe(true);
        expect(m.scope).toBe('/customer-app/');   // social.js registers sw.js with this scope
    });

    it('every icon file it names actually exists on disk', () => {
        for (const icon of m.icons) {
            expect(fs.existsSync(path.join(ROOT, icon.src.replace(/^\//, ''))), icon.src).toBe(true);
        }
    });

    it('is branded ViibeView, not Discover/Royalty', () => {
        expect(m.name).toBe('ViibeView');
        expect(m.icons.every(i => i.src.includes('viibeview'))).toBe(true);
    });
});

describe('service worker precache', () => {
    const sw = fs.readFileSync(path.join(ROOT, 'customer-app/sw.js'), 'utf8');
    const assets = [...sw.matchAll(/'(\/customer-app\/[^']+)'/g)].map(m => m[1]);

    it('precaches the ViibeView manifest', () => {
        expect(assets).toContain('/customer-app/viibeview-manifest.json');
    });

    it('every precached asset exists — cache.addAll() is all-or-nothing', () => {
        const missing = [...new Set(assets)]
            .filter(a => !fs.existsSync(path.join(ROOT, a.replace(/^\//, ''))));
        expect(missing).toEqual([]);
    });

    it('keeps the three cache names on the same generation', () => {
        // They are bumped together on every release; a mismatch leaves one
        // stale cache alive and evicts the other two.
        const gens = [...sw.matchAll(/'royalty-(?:rewards|static|dynamic)-v(\d+)'/g)].map(m => m[1]);
        expect(gens.length).toBe(3);
        expect(new Set(gens).size).toBe(1);
    });
});

describe('desktop venue admin (app/venues.html)', () => {
    const v = fs.readFileSync(path.join(ROOT, 'app/venues.html'), 'utf8');

    it('has the genre multi-select in the modal', () => {
        expect(v).toContain('id="venue-genres"');
    });

    it('loads the shared modules', () => {
        expect(v).toContain('/js/music-genres.js');
        expect(v).toContain('/js/venue-places.js');
    });

    it('no longer carries its own Nominatim client', () => {
        // Assert against CODE, not prose. The replacement comment explains that
        // countrycodes=us was dropped, so a naive substring check flags the
        // explanation as the very thing it warns about. Strip comments first.
        const code = v
            .replace(/^\s*\/\/.*$/gm, '')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/<!--[\s\S]*?-->/g, '');

        // Guard against the strip silently eating everything — an empty
        // haystack makes every not.toContain below pass vacuously.
        expect(code.length).toBeGreaterThan(v.length * 0.5);
        expect(code).toContain('window.VenuePlaces.geocodeAddress');

        expect(code).not.toContain('nominatim.openstreetmap.org');
        expect(code).not.toContain('countrycodes=us');
        expect(code).not.toMatch(/let\s+geocodeQueue/);
    });

    it('writes music_genres on save', () => {
        expect(v).toMatch(/music_genres:\s*window\.sanitizeGenres\(editingVenueGenres\)/);
    });
});
