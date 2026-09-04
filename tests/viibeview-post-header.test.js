/**
 * ViibeView post header: who a card says it is by, and what tapping it opens.
 *
 * These exist because the live tenant cannot exercise the interesting case.
 * ViibeView prod has exactly two posts — one unattached with an author, one at
 * the "General" venue with NO author — so the e2e assertions for a
 * venue-attached post BY a member skip themselves for want of data. That skip
 * is honest, but a skipped test cannot report a regression, and the
 * venue-attached branch is precisely the one that was broken: postIdentity()
 * used to check venue_id FIRST, so a post made at a venue rendered the venue
 * and opened the venue page while the author's id, name and avatar sat unused
 * in the same row.
 *
 * So the branch is pinned here instead, against fabricated rows shaped exactly
 * like get_venue_feed's output. No network, no session, no database.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

const ROOT = '/Users/jaywhitley/AI Projects/Automata';

let w;

beforeAll(() => {
    const html = fs.readFileSync(path.join(ROOT, 'customer-app/social.html'), 'utf8');
    const dom = new JSDOM(html, {
        runScripts: 'outside-only',
        url: 'https://royaltyapp.ai/customer-app/social.html?slug=viibeview',
    });
    w = dom.window;

    // social.js builds its client at parse time and init() runs on
    // DOMContentLoaded. Neither is under test; stub just enough that the module
    // evaluates and init() fails quietly instead of throwing into the console.
    const thenable = { then: (r) => r({ data: null, error: new Error('stubbed') }) };
    const chain = new Proxy(thenable, { get: (t, k) => (k in t ? t[k] : () => chain) });
    w.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: {} }) }, from: () => chain, rpc: () => chain }) };

    w.eval(fs.readFileSync(path.join(ROOT, 'js/venue-categories.js'), 'utf8'));
    w.eval(fs.readFileSync(path.join(ROOT, 'js/music-genres.js'), 'utf8'));
    w.eval(fs.readFileSync(path.join(ROOT, 'customer-app/social.js'), 'utf8'));
});

// Shaped like one row of get_venue_feed / get_following_feed.
function row(over = {}) {
    return {
        id: 'post-1',
        venue_id: null,
        venue_name: null,
        venue_handle: null,
        venue_city: null,
        venue_profile_image_url: null,
        venue_music_genres: null,
        uploaded_by_user_id: null,
        author_display_name: null,
        author_first_name: null,
        author_last_name: null,
        author_avatar_url: null,
        media_type: 'image',
        url: 'https://example.test/a.jpg',
        ...over,
    };
}

describe('postIdentity', () => {
    it('a post made AT a venue is attributed to its AUTHOR, not the venue', () => {
        // The regression this file exists for.
        const id = w.postIdentity(row({
            venue_id: 'venue-1',
            venue_name: 'Blue Room',
            venue_handle: 'blueroom',
            uploaded_by_user_id: 'user-1',
            author_display_name: 'Pahkie A',
        }));

        expect(id.primary).toBe('author');
        expect(id.title).toBe('Pahkie A');
        expect(id.userId).toBe('user-1');
        // The venue is not discarded — it becomes the subtitle's link target.
        expect(id.venueId).toBe('venue-1');
        // The DISPLAY name, not the handle: the subtitle reads "at Blue Room",
        // and "at @blueroom" is not a sentence. The handle is still the right
        // headline for a venue-primary card, asserted separately below.
        expect(id.venueName).toBe('Blue Room');
    });

    it('falls back to the signup first/last name when no display name is set', () => {
        // Nothing wrote app_members.display_name until update_social_profile
        // shipped, so this is the majority case for existing members.
        const id = w.postIdentity(row({
            uploaded_by_user_id: 'user-1',
            author_first_name: 'Pahkie',
            author_last_name: 'A',
        }));
        expect(id.title).toBe('Pahkie A');
        expect(id.letter).toBe('P');
    });

    it('an unattached Viibe is attributed to its author', () => {
        const id = w.postIdentity(row({
            uploaded_by_user_id: 'user-1',
            author_display_name: 'Pahkie A',
        }));
        expect(id.primary).toBe('author');
        expect(id.venueId).toBeNull();
    });

    it('a venue post with no recorded author still reads as the venue', () => {
        // Pre-UGC posts at a venue, and anything genuinely venue-authored.
        const id = w.postIdentity(row({
            venue_id: 'venue-1',
            venue_name: 'Blue Room',
            venue_handle: 'blueroom',
            venue_city: 'Perpignan',
        }));
        expect(id.primary).toBe('venue');
        expect(id.title).toBe('@blueroom');
        expect(id.subtitle).toBe('Blue Room, Perpignan');
        expect(id.userId).toBeNull();
    });

    it('a pre-UGC post with neither is inert, not blank', () => {
        const id = w.postIdentity(row());
        expect(id.primary).toBe('none');
        expect(id.title).toBe('Someone');
        expect(id.userId).toBeNull();
        expect(id.venueId).toBeNull();
    });
});

describe('postHeaderMarkup', () => {
    function headerFor(over, opts) {
        return w.postHeaderMarkup(w.postIdentity(row(over)), opts);
    }

    it('an author header opens the profile, and its venue line opens the venue', () => {
        const html = headerFor({
            venue_id: 'venue-1',
            venue_name: 'Blue Room',
            venue_handle: 'blueroom',
            uploaded_by_user_id: 'user-1',
            author_display_name: 'Pahkie A',
        });

        expect(html).toContain(`openMemberProfile('user-1')`);
        expect(html).toContain('venue-location-link');
        expect(html).toContain('at Blue Room');
        // ⚠️ openVenueFromPost, NOT openVenuePage — the subtitle is a
        // descendant of the clickable identity block, and only the wrapper
        // stops propagation. Bare openVenuePage here means one tap opens the
        // venue AND the author's profile.
        expect(html).toContain(`openVenueFromPost(event, 'venue-1')`);
        expect(html).not.toContain('feed-venue-info-inert');
    });

    it('drops the venue line when the page is already that venue', () => {
        const html = headerFor({
            venue_id: 'venue-1',
            venue_name: 'Blue Room',
            venue_handle: 'blueroom',
            uploaded_by_user_id: 'user-1',
            author_display_name: 'Pahkie A',
        }, { showVenue: false });

        expect(html).toContain(`openMemberProfile('user-1')`);
        expect(html).not.toContain('venue-location-link');
        expect(html).not.toContain('openVenueFromPost');
    });

    it('a venue header opens the venue page', () => {
        const html = headerFor({ venue_id: 'venue-1', venue_name: 'Blue Room', venue_handle: 'blueroom' });
        expect(html).toContain(`openVenuePage('venue-1')`);
        expect(html).not.toContain('openMemberProfile');
    });

    it('an inert header carries no handler AND does not look tappable', () => {
        // .feed-venue-info sets cursor:pointer unconditionally, so the class is
        // the only thing stopping a header that opens nothing from inviting a
        // tap. Both halves matter.
        const html = headerFor({});
        expect(html).not.toContain('onclick');
        expect(html).toContain('feed-venue-info-inert');
    });

    it('escapes the author name into the byline', () => {
        const html = headerFor({
            uploaded_by_user_id: 'user-1',
            author_display_name: '<img src=x onerror=alert(1)>',
        });
        expect(html).not.toContain('<img src=x');
        expect(html).toContain('&lt;img');
    });
});
