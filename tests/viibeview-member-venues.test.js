/**
 * ViibeView member profile: the venue chip, the "Been to" list, and the
 * private-profile stats fix.
 *
 * These exist because the live tenant cannot exercise any of it. ViibeView prod
 * has exactly TWO posts — one at the "General" venue with no author, one
 * unattached with an author — so there is no member with venue-attached posts
 * for an e2e assertion to find, and the interesting cases (a venue posted at
 * more than once, a name long enough to need the ellipsis, a private profile
 * viewed by a stranger) do not exist in the data at all.
 *
 * The lesson those skipped e2e assertions taught is recorded in
 * tests/viibeview-post-header.test.js: a skipped test cannot report a
 * regression. So the branches are pinned here instead, against fabricated rows
 * shaped exactly like get_member_posts / get_member_venues output. No network,
 * no session, no database.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

const ROOT = '/Users/jaywhitley/AI Projects/Automata';

let w, d;

beforeEach(() => {
    const html = fs.readFileSync(path.join(ROOT, 'customer-app/social.html'), 'utf8');
    // ⚠️ 'dangerously', and social.js appended as a real <script> — NOT
    // w.eval(source) as the post-header suite does.
    //
    // w.eval() is an INDIRECT eval, and top-level `let` in eval code lands in a
    // declarative scope belonging to that one eval call, not in the global
    // lexical environment. social.js's `let memberPagePosts` therefore becomes
    // unreachable from a second w.eval(), so `memberPagePosts = [...]` silently
    // creates an unrelated global and every renderer keeps reading its own
    // still-empty array. The tests then fail as "rendered 0 tiles" with correct
    // production code. Loading it as a classic script — the way the page does —
    // puts the binding where eval can actually reach it.
    //
    // The suite's own <script src> tags are external and JSDOM has no resource
    // loader here, so nothing else executes.
    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        url: 'https://royaltyapp.ai/customer-app/social.html?slug=viibeview',
    });
    w = dom.window;
    d = w.document;

    // social.js builds its client at parse time and init() runs on
    // DOMContentLoaded. Neither is under test; stub just enough that the module
    // evaluates and init() fails quietly.
    const thenable = { then: (r) => r({ data: null, error: new Error('stubbed') }) };
    const chain = new Proxy(thenable, { get: (t, k) => (k in t ? t[k] : () => chain) });
    w.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: {} }) }, from: () => chain, rpc: () => chain }) };

    const load = (rel) => {
        const el = d.createElement('script');
        el.textContent = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        d.body.appendChild(el);
    };
    load('js/venue-categories.js');
    load('js/music-genres.js');
    load('customer-app/social.js');

    // ⚠️ Do NOT drop this. social.js registers init() on DOMContentLoaded
    // (social.js:5800), JSDOM fires that AFTER this hook returns, and init()
    // cannot reach a database here — so it lands in showEmptyState(), which
    // does `document.body.innerHTML = ...` (social.js:4500) and REPLACES the
    // whole page with a "Something went wrong" panel.
    //
    // The failure is silent and looks nothing like its cause: every
    // getElementById below returns null, from a body that was fully populated
    // when this hook finished.
    w.showEmptyState = () => {};
});

/** One row of get_member_posts. */
function post(over = {}) {
    return {
        id: 'post-1',
        venue_id: null,
        venue_name: null,
        media_type: 'image',
        url: 'https://example.test/a.jpg',
        thumbnail_url: 'https://example.test/a-thumb.jpg',
        caption: null,
        duration_seconds: null,
        created_at: '2026-08-28T21:00:00Z',
        uploaded_by_user_id: 'user-1',
        ...over,
    };
}

/** One row of get_member_venues. */
function venue(over = {}) {
    return {
        target_type: 'venue',
        target_id: 'venue-1',
        name: 'Blue Room',
        avatar_url: null,
        subtitle: '3 Viibes · Aug 28',
        visit_count: 3,
        last_posted_at: '2026-08-28T21:00:00Z',
        ...over,
    };
}

// The source-slice trap this repo has been bitten by: a selector that matches
// nothing makes every not.toContain() below pass. Assert the grid is non-empty
// before asserting anything about what is in it.
function renderGrid(posts) {
    w.eval(`memberPagePosts = ${JSON.stringify(posts)}; renderMemberGrid();`);
    const grid = d.getElementById('member-page-grid');
    if (posts.length) expect(grid.querySelectorAll('.member-grid-tile').length).toBe(posts.length);
    return grid;
}

describe('renderMemberGrid — the venue chip', () => {
    it('renders the venue name the grid used to throw away', () => {
        // venue_name has always been on the row. It went into aria-label only,
        // where no sighted visitor ever saw it.
        const grid = renderGrid([post({ venue_id: 'venue-1', venue_name: 'Blue Room' })]);
        const chip = grid.querySelector('.member-grid-venue');
        expect(chip).toBeTruthy();
        expect(chip.textContent.trim()).toBe('Blue Room');
    });

    it('an unattached Viibe gets no chip and stays untappable', () => {
        // A venue-less post has no venue page to open, so the tile must not be
        // made to look tappable — the rule the grid already had.
        const grid = renderGrid([post()]);
        expect(grid.querySelector('.member-grid-venue')).toBeNull();
        expect(grid.querySelector('.member-grid-tile').getAttribute('onclick')).toBeNull();
    });

    it('the chip is inert — the whole tile is the button', () => {
        // It sits inside the <button>. If it swallowed the tap, the top of
        // every tile would open the venue and the bottom would do nothing.
        const grid = renderGrid([post({ venue_id: 'venue-1', venue_name: 'Blue Room' })]);
        const css = fs.readFileSync(path.join(ROOT, 'customer-app/social.css'), 'utf8');
        const block = css.slice(css.indexOf('.member-grid-venue {'));
        expect(block.slice(0, block.indexOf('}'))).toContain('pointer-events: none');
        expect(grid.querySelector('.member-grid-venue').getAttribute('onclick')).toBeNull();
    });

    it('a video tile marks the chip .has-duration so the badge keeps its corner', () => {
        // .member-grid-tile .video-duration is pinned bottom-RIGHT and the chip
        // spans the full width. Without the class they overlap.
        const grid = renderGrid([post({
            venue_id: 'venue-1', venue_name: 'Blue Room',
            media_type: 'video', duration_seconds: 12,
        })]);
        const chip = grid.querySelector('.member-grid-venue');
        expect(chip.classList.contains('has-duration')).toBe(true);
        // And the chip comes FIRST, so its scrim cannot paint over the badge.
        const kids = [...grid.querySelector('.member-grid-tile').children].map(e => e.className);
        expect(kids.indexOf('member-grid-venue has-duration')).toBeLessThan(kids.indexOf('video-duration'));
    });

    it('an image tile does not', () => {
        const grid = renderGrid([post({ venue_id: 'venue-1', venue_name: 'Blue Room' })]);
        expect(grid.querySelector('.member-grid-venue').classList.contains('has-duration')).toBe(false);
    });

    it('escapes the venue name into the chip', () => {
        const grid = renderGrid([post({ venue_id: 'v1', venue_name: '<img src=x onerror=alert(1)>' })]);
        expect(grid.querySelector('.member-grid-venue img')).toBeNull();
        expect(grid.innerHTML).toContain('&lt;img');
    });
});

describe('venueVisitLabel', () => {
    // I18n is absent in this DOM, so t() is never reached and every case below
    // exercises the ENGLISH FALLBACK — which is the branch that actually ships
    // for any locale missing the key, since I18n.t() returns the key on a miss.
    it('pluralises, because I18n.t() has no plural support', () => {
        expect(w.venueVisitLabel(1, '2026-08-28T21:00:00Z')).toMatch(/^1 Viibe · /);
        expect(w.venueVisitLabel(3, '2026-08-28T21:00:00Z')).toMatch(/^3 Viibes · /);
    });

    it('drops the separator rather than trailing one when there is no date', () => {
        expect(w.venueVisitLabel(2, null)).toBe('2 Viibes');
    });

    it('survives a missing count', () => {
        expect(w.venueVisitLabel(undefined, null)).toBe('0 Viibes');
    });

    it('withVenueSubtitles replaces the server subtitle, keeping the rest of the row', () => {
        const [row] = w.withVenueSubtitles([venue({ subtitle: 'SERVER ENGLISH' })]);
        expect(row.subtitle).not.toBe('SERVER ENGLISH');
        expect(row.subtitle).toMatch(/^3 Viibes · /);
        expect(row.target_id).toBe('venue-1');
        expect(row.name).toBe('Blue Room');
    });
});

describe('renderMemberVenues — "Been to"', () => {
    function render(rows) {
        w.eval(`memberPageUserId = 'user-1'; memberPageVenues = ${JSON.stringify(rows)}; renderMemberVenues();`);
        return {
            section: d.getElementById('member-page-venues'),
            list: d.getElementById('member-page-venues-list'),
            more: d.getElementById('member-page-venues-more'),
        };
    }

    it('stays hidden when the member has posted at no venue', () => {
        // "Been to (nothing)" reads as a failure. A member who only posts
        // unattached Viibes simply has no venue history.
        const { section, list, more } = render([]);
        expect(section.style.display).toBe('none');
        expect(list.innerHTML).toBe('');
        expect(more.style.display).toBe('none');
    });

    it('renders one row per venue, reusing the people-sheet row markup', () => {
        const { section, list } = render([venue(), venue({ target_id: 'venue-2', name: 'The Cave' })]);
        expect(section.style.display).not.toBe('none');
        // .people-row is the shared class — the inline list and the sheet must
        // not drift into looking like two different components.
        expect(list.querySelectorAll('.people-row').length).toBe(2);
        expect(list.querySelectorAll('.people-row-avatar.venue').length).toBe(2);
        expect([...list.querySelectorAll('.people-row-name')].map(e => e.textContent))
            .toEqual(['Blue Room', 'The Cave']);
    });

    it('a row CLOSES THE PROFILE before opening the venue page', () => {
        // ⚠️ Not closePeopleSheet() — these rows are on #member-page itself,
        // which sits ABOVE #venue-page in the z-index ladder. Leaving it open
        // means the tap appears to do nothing.
        const { list } = render([venue()]);
        const onclick = list.querySelector('.people-row').getAttribute('onclick');
        expect(onclick).toContain('closeMemberProfile()');
        expect(onclick).toContain(`openVenuePage('venue-1')`);
        expect(onclick).not.toContain('closePeopleSheet');
    });

    it('shows at most six inline, and only then offers "See all"', () => {
        const six = Array.from({ length: 6 }, (_, i) => venue({ target_id: `v${i}` }));
        const { list, more } = render(six);
        expect(list.querySelectorAll('.people-row').length).toBe(6);
        expect(more.style.display).toBe('none');

        const seven = [...six, venue({ target_id: 'v6' })];
        const r = render(seven);
        expect(r.list.querySelectorAll('.people-row').length).toBe(6);
        expect(r.more.style.display).not.toBe('none');
        expect(typeof r.more.onclick).toBe('function');
    });

    it('escapes the venue name into the row', () => {
        const { list } = render([venue({ name: '<img src=x onerror=alert(1)>' })]);
        expect(list.querySelector('img')).toBeNull();
        expect(list.innerHTML).toContain('&lt;img');
    });
});

describe('renderMemberProfile — location and the private-profile stats', () => {
    function render(profile, { asUser = null } = {}) {
        w.eval(`currentUserId = ${JSON.stringify(asUser)};`);
        w.eval(`memberPageProfile = ${JSON.stringify(profile)}; renderMemberProfile();`);
        return {
            location: d.getElementById('member-page-location'),
            stats: d.getElementById('member-page-stats'),
        };
    }

    const PUBLIC = {
        user_id: 'user-1', display_name: 'Pahkie A', avatar_url: null,
        bio: 'hello', location: 'Perpignan, FR', is_private: false,
        follower_count: 12, following_count: 3, post_count: 7,
    };

    it('paints the location when there is one', () => {
        const { location } = render(PUBLIC);
        expect(location.style.display).not.toBe('none');
        expect(location.textContent).toBe('Perpignan, FR');
    });

    it('hides the element when there is none, rather than leaving a bare pin', () => {
        // The ::before pin is CSS, so an empty-but-visible element renders as a
        // lone 📍 with nothing after it.
        const { location } = render({ ...PUBLIC, location: null });
        expect(location.style.display).toBe('none');
        expect(location.textContent).toBe('');
    });

    it('a PRIVATE profile viewed by a stranger paints NO stat buttons at all', () => {
        // ⚠️ The bug. Hiding the stats after painting them still writes three
        // buttons carrying this member's uid into inline
        // openPeopleSheet('followers','<uid>') handlers — readable from the DOM
        // and, until 20260904000002 gated the list RPCs, a working route into a
        // private member's follower graph. Assert the MARKUP is absent, not
        // merely invisible.
        const { stats } = render({ ...PUBLIC, is_private: true }, { asUser: 'someone-else' });
        expect(stats.querySelectorAll('.member-stat').length).toBe(0);
        expect(stats.innerHTML).toBe('');
        expect(stats.innerHTML).not.toContain('user-1');
        expect(stats.style.display).toBe('none');
    });

    it('but the member still sees their own stats on their own private profile', () => {
        // Turning your profile off hides it from other people; it does not hide
        // your own counts from you (20260903000002:396-402).
        const { stats } = render({ ...PUBLIC, is_private: true }, { asUser: 'user-1' });
        expect(stats.querySelectorAll('.member-stat').length).toBe(3);
        expect(stats.style.display).not.toBe('none');
    });

    it('a public profile paints all three, and the hide is undone on reuse', () => {
        // #member-page is a reused singleton: open a private profile, then a
        // public one, and a display:none left behind would blank the stats of
        // an entirely different member.
        render({ ...PUBLIC, is_private: true }, { asUser: 'someone-else' });
        const { stats } = render(PUBLIC, { asUser: 'someone-else' });
        expect(stats.querySelectorAll('.member-stat').length).toBe(3);
        expect(stats.style.display).not.toBe('none');
    });
});

describe('the people sheet grew a fourth mode', () => {
    it('venues mode calls get_member_venues', () => {
        const src = fs.readFileSync(path.join(ROOT, 'customer-app/social.js'), 'utf8');
        const slice = src.slice(src.indexOf('async function loadPeople()'));
        const body = slice.slice(0, slice.indexOf('\nfunction renderPeopleList'));
        // Guard against the slice failing to match — an empty haystack makes
        // every assertion below pass vacuously.
        expect(body.length).toBeGreaterThan(200);
        expect(body).toContain(`mode === 'venues' ? 'get_member_venues'`);
        // The subtitle is generated, not stored, so it must be localised before
        // the shared renderer sees it.
        expect(body).toContain('withVenueSubtitles');
    });

    it('its empty state uses noVenuesVISITED, not the app-level noVenuesYet', () => {
        // social.noVenuesYet already existed and says "No venues have been added
        // yet" — the tenant-level empty state. Reusing it here would put the
        // wrong sentence on a member profile in all eight locales.
        const src = fs.readFileSync(path.join(ROOT, 'customer-app/social.js'), 'utf8');
        expect(src).toContain('social.noVenuesVisited');

        const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/en.json'), 'utf8')).social;
        expect(en.noVenuesVisited).toBeTruthy();
        expect(en.noVenuesYet).toBeTruthy();
        expect(en.noVenuesVisited).not.toBe(en.noVenuesYet);
    });
});

describe('every new i18n key exists in all eight locales', () => {
    const LANGS = ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ar'];
    const KEYS = [
        'about', 'location', 'locationPlaceholder', 'beenTo', 'seeAll',
        'noVenuesVisited', 'noMembersFound', 'notFollowingAnyone', 'noFollowersYet',
        'viibeAtVenue', 'viibesAtVenue',
    ];

    for (const lang of LANGS) {
        it(`${lang}.json has all ${KEYS.length}`, () => {
            const social = JSON.parse(fs.readFileSync(path.join(ROOT, `i18n/${lang}.json`), 'utf8')).social;
            const missing = KEYS.filter(k => !social[k]);
            expect(missing).toEqual([]);
        });
    }

    it('both Viibe-count strings keep their {count} and {date} placeholders', () => {
        // t() does plain {param} substitution — a translation that dropped one
        // renders a sentence with a hole in it, silently.
        for (const lang of LANGS) {
            const social = JSON.parse(fs.readFileSync(path.join(ROOT, `i18n/${lang}.json`), 'utf8')).social;
            for (const k of ['viibeAtVenue', 'viibesAtVenue']) {
                expect(social[k], `${lang}.${k}`).toContain('{count}');
                expect(social[k], `${lang}.${k}`).toContain('{date}');
            }
        }
    });
});
