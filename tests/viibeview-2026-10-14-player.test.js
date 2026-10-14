/**
 * Guards for Jay's 2026-10-14 ViibeView round, Phase 1 (no database change):
 *
 *   The Viibe player   a tap on ANY profile grid (Me, a member, a venue) opens
 *                      the whole video full screen over the bottom nav, swipe
 *                      for the next, Back to return. Replaces the in-place 4:5
 *                      expansion that cut a third off every 9:16 clip.
 *   Video fit          the feed shows the whole video (object-fit: contain).
 *   Quick fixes        ⋯ is black, the grid's duration badge stops stretching,
 *                      map search results are visible, Navigate routes,
 *                      category names are translated, category bubbles are in
 *                      the app's blue, and the app asks to be held upright.
 *
 * Behaviour runs in jsdom with social.js loaded as a real classic <script>
 * (an indirect eval would hide its top-level `let`s — see
 * viibeview-member-venues.test.js). Static assertions run on comment-stripped
 * source and are bounded at both ends.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const js = read('customer-app/social.js');
const html = read('customer-app/social.html');
const css = read('customer-app/social.css');

/** The source of one top-level JS function, to its own closing brace. */
function fnBody(signature) {
    const start = js.indexOf(signature);
    if (start < 0) return null;
    const end = js.indexOf('\n}', start);
    return end < 0 ? null : js.slice(start, end);
}

/** fnBody with // and <!-- --> comments stripped — for absence assertions. */
function fnCode(signature) {
    const body = fnBody(signature);
    if (body === null) return null;
    return body
        .replace(/<!--[\s\S]*?-->/g, '')
        .split('\n')
        .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .map(l => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

/**
 * Every declaration block for an exact selector, comments stripped first (they
 * hold commas and braces). A selector list counts for each of its parts.
 */
function rulesFor(selector) {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const out = [];
    for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sels = m[1].split(',').map(s => s.trim().replace(/\s+/g, ' '));
        if (sels.includes(selector)) out.push(m[2]);
    }
    return out;
}
const declared = (selector, prop) => rulesFor(selector)
    .map(b => new RegExp(`(?:^|;|\\s)${prop}:\\s*([^;]+);`).exec(b)?.[1]?.trim())
    .filter(v => v !== undefined);

// ===========================================================================
// jsdom harness
// ===========================================================================

let w, d;
const tick = () => new Promise(r => setTimeout(r, 0));

const UA = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};

function setDevice({ ua = UA.mac, coarse = false, landscape = false } = {}) {
    Object.defineProperty(w.navigator, 'userAgent', { get: () => ua, configurable: true });
    Object.defineProperty(w.navigator, 'userAgentData', { get: () => undefined, configurable: true });
    w.matchMedia = q => ({
        matches: q.includes('pointer: coarse') ? coarse : false,
        addEventListener() {}, removeEventListener() {},
    });
    Object.defineProperty(w.screen, 'orientation', {
        get: () => ({ type: landscape ? 'landscape-primary' : 'portrait-primary', addEventListener() {} }),
        configurable: true,
    });
}

beforeEach(async () => {
    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        url: 'https://royaltyapp.ai/customer-app/social.html?slug=viibeview',
    });
    w = dom.window;
    d = w.document;
    w.localStorage.setItem('viibeview_onboarded_v1', '1');
    setDevice();

    const thenable = { then: (r) => r({ data: null, error: new Error('stubbed') }) };
    const chain = new Proxy(thenable, { get: (t, k) => (k in t ? t[k] : () => chain) });
    w.supabase = {
        createClient: () => ({
            auth: { getSession: async () => ({ data: { session: null } }) },
            from: () => chain,
            rpc: () => Promise.resolve({ data: null, error: null }),
            storage: { from: () => ({ upload: async () => ({}), getPublicUrl: () => ({ data: { publicUrl: '' } }), remove: async () => ({}) }) },
        }),
    };

    // jsdom implements no media playback. A record of what was played and
    // paused is what these tests assert on; `paused` follows the calls.
    w.__played = [];
    w.__paused = [];
    const proto = w.HTMLMediaElement.prototype;
    Object.defineProperty(proto, 'paused', {
        get() { return this.__isPaused !== false; }, configurable: true,
    });
    proto.play = function () { this.__isPaused = false; w.__played.push(this); return Promise.resolve(); };
    proto.pause = function () { this.__isPaused = true; w.__paused.push(this); };
    proto.load = function () {};

    const load = rel => {
        const el = d.createElement('script');
        el.textContent = read(rel);
        d.body.appendChild(el);
    };
    load('js/venue-categories.js');
    load('js/music-genres.js');
    load('customer-app/social-auth.js');
    load('customer-app/social.js');

    w.showEmptyState = () => {};
    // A recording observer: tests fire its callback by hand.
    w.__observers = [];
    w.IntersectionObserver = class {
        constructor(cb, opts) { this.cb = cb; this.opts = opts; this.targets = []; this.live = true; w.__observers.push(this); }
        observe(el) { this.targets.push(el); }
        unobserve() {}
        disconnect() { this.live = false; this.targets = []; }
    };

    await tick();
    w.eval("currentApp = { id: 'app-1', organization_id: 'org-1' };");
});

const visible = id => d.getElementById(id).classList.contains('visible');
const scroller = () => d.getElementById('viibe-viewer-scroller');
const panelIds = () => [...scroller().querySelectorAll('.feed-panel')].map(p => p.dataset.mediaId);

const vid = (id, over = {}) => ({
    id, media_type: 'video', url: `https://cdn.test/${id}.mp4`, thumbnail_url: `https://cdn.test/${id}.jpg`,
    venue_id: null, uploaded_by_user_id: 'me-1', duration_seconds: 12, ...over,
});

function setState(code) { w.eval(code); }

// ===========================================================================
// The Viibe player
// ===========================================================================

describe('the Viibe player — opening it from each profile grid', () => {
    it('Me tab: a tile opens the player on THAT Viibe, with all of them in order', () => {
        setState(`meProfile = { user_id: 'me-1', display_name: 'Pahkie', post_count: 3 };
                  mePosts = ${JSON.stringify([vid('a'), vid('b'), vid('c')])};
                  renderMeGrid();`);
        const tiles = d.querySelectorAll('#me-grid .member-grid-tile');
        expect(tiles.length).toBe(3);

        tiles[1].click();
        expect(visible('viibe-viewer')).toBe(true);
        expect(panelIds()).toEqual(['a', 'b', 'c']);

        // The tapped Viibe is the one started — inside the tap, where iOS
        // allows play() — and it was given a real src first.
        const started = w.__played.at(-1);
        expect(started.closest('.feed-panel').dataset.mediaId).toBe('b');
        expect(started.getAttribute('src')).toBe('https://cdn.test/b.mp4');
    });

    it('another member: tiles open the player, and the grid itself has no <video>', () => {
        setState(`memberPageUserId = 'u-2'; memberPageProfile = { user_id: 'u-2', display_name: 'Kai' };
                  memberPagePosts = ${JSON.stringify([vid('m1', { uploaded_by_user_id: 'u-2' }), vid('m2', { uploaded_by_user_id: 'u-2' })])};
                  renderMemberList();`);
        const grid = d.getElementById('member-page-grid');
        expect(grid.querySelectorAll('.member-grid-tile').length).toBe(2);
        expect(grid.querySelectorAll('video').length, 'a poster grid holds no video elements').toBe(0);

        grid.querySelector('[data-media-id="m2"]').click();
        expect(visible('viibe-viewer')).toBe(true);
        expect(panelIds()).toEqual(['m1', 'm2']);
        // The author comes from the profile being viewed — get_member_posts
        // returns no author columns.
        expect(scroller().querySelector('.venue-handle').textContent.trim()).toBe('Kai');
    });

    it('venue page: tiles open the player, the venue named from the open page', () => {
        setState(`venuePageVenueId = 'v-9';
                  venuePageVenue = { id: 'v-9', name: 'Blue Room', handle: 'blueroom', city: 'Los Angeles', state: 'CA' };
                  venuePageFeed = ${JSON.stringify([vid('p1', { venue_id: 'v-9', uploaded_by_user_id: null })])};
                  renderVenuePageGrid();`);
        d.querySelector('#venue-page-feed .member-grid-tile').click();
        expect(visible('viibe-viewer')).toBe(true);
        const strip = scroller().querySelector('.feed-panel-venue');
        expect(strip.querySelector('.venue-handle').textContent.trim()).toBe('Blue Room');
        expect(strip.querySelector('.venue-location').textContent.trim()).toBe('Los Angeles, CA');
    });

    it("a Me-tab post at a venue takes the venue's name and city from the venue list", () => {
        setState(`venues = [{ id: 'v1', name: 'Laurel Hardware', city: 'West Hollywood', state: 'CA' }];
                  meProfile = { user_id: 'me-1', display_name: 'Pahkie' };
                  mePosts = ${JSON.stringify([vid('a', { venue_id: 'v1' })])};
                  renderMeGrid(); openMePost('a');`);
        const strip = scroller().querySelector('.feed-panel-venue');
        expect(strip.querySelector('.venue-handle').textContent.trim()).toBe('Laurel Hardware');
        expect(strip.querySelector('.venue-location').textContent.trim()).toBe('West Hollywood, CA');
    });

    it('the panels are the FEED\'s panels: options, sound, whole-video media', () => {
        setState(`meProfile = { user_id: 'me-1', display_name: 'Pahkie' };
                  mePosts = ${JSON.stringify([vid('a')])}; openMePost('a');`);
        const panel = scroller().querySelector('.feed-panel');
        expect(panel.querySelector('.feed-panel-more').getAttribute('onclick')).toBe("showPostOptions('a')");
        expect(panel.querySelector('.video-sound-btn')).toBeTruthy();
        expect(panel.querySelector('.feed-media video')).toBeTruthy();
    });

    it('playing a panel outside the hydration window gives it a src first', () => {
        // play() on a data-src-only <video> rejects and the panel stays a
        // poster. The open path is covered by the seed; resuming (after the
        // player closes, or the phone is turned upright) can land on a panel
        // the window has not reached yet.
        setState(`feedItems = ${JSON.stringify([vid('f1'), vid('f2'), vid('f3'), vid('f4')])}; renderFeed();`);
        const fourth = d.querySelectorAll('#feed-container .feed-panel video')[3];
        expect(fourth.hasAttribute('src'), 'the window already reached it — the test proves nothing').toBe(false);
        w.eval("playViibePanel(document.getElementById('feed-container'), 3)");
        expect(fourth.getAttribute('src')).toBe('https://cdn.test/f4.mp4');
        expect(w.__played).toContain(fourth);
    });

    it('an id that is not in the list opens nothing', () => {
        setState(`mePosts = ${JSON.stringify([vid('a')])}; openMePost('zzz');`);
        expect(visible('viibe-viewer')).toBe(false);
    });

    it('the player uses its OWN observer, rooted on its own scroller', () => {
        setState(`mePosts = ${JSON.stringify([vid('a'), vid('b')])}; openMePost('a');`);
        const obs = w.eval('viibeViewerObserver');
        expect(obs).toBeTruthy();
        expect(obs.opts.root).toBe(scroller());
        expect(obs.targets.length).toBe(2);
        expect(w.eval('feedVideoObserver'), 'the feed observer was replaced by the player\'s').not.toBe(obs);
    });
});

describe('the Viibe player — closing, Back, and what it leaves behind', () => {
    beforeEach(() => {
        setState(`meProfile = { user_id: 'me-1', display_name: 'Pahkie' };
                  mePosts = ${JSON.stringify([vid('a'), vid('b')])}; openMePost('a');`);
    });

    it('Back closes it, disconnects its observer and unloads its videos', () => {
        const obs = w.eval('viibeViewerObserver');
        const videos = [...scroller().querySelectorAll('video')];
        d.getElementById('viibe-viewer-back').click();

        expect(visible('viibe-viewer')).toBe(false);
        expect(obs.live, 'the observer outlived the player').toBe(false);
        expect(w.eval('viibeViewerObserver')).toBeNull();
        expect(scroller().innerHTML).toBe('');
        for (const v of videos) {
            expect(w.__paused).toContain(v);
            expect(v.hasAttribute('src')).toBe(false);
        }
    });

    it('the back BUTTON (history) closes the player before the page under it', async () => {
        d.getElementById('member-page').classList.add('visible');
        d.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
        await tick();
        w.dispatchEvent(new w.PopStateEvent('popstate', { state: null }));
        expect(visible('viibe-viewer')).toBe(false);
        expect(visible('member-page'), 'back closed the profile too').toBe(true);
    });
});

describe('the Viibe player — delete from inside it', () => {
    beforeEach(() => {
        setState(`meProfile = { user_id: 'me-1', display_name: 'Pahkie', post_count: 2 };
                  mePosts = ${JSON.stringify([vid('a'), vid('b')])}; openMePost('a');`);
    });

    it('removePostEverywhere drops the panel and shows the next one', () => {
        w.eval("removePostEverywhere('a')");
        expect(visible('viibe-viewer')).toBe(true);
        expect(panelIds()).toEqual(['b']);
        expect(w.eval('mePosts.map(p => p.id)')).toEqual(['b']);
    });

    it('deleting the last one closes the player', () => {
        w.eval("removePostEverywhere('a'); removePostEverywhere('b')");
        expect(visible('viibe-viewer')).toBe(false);
    });

    it('post options and the confirm dialog sit ABOVE the player', () => {
        const z = sel => Math.max(...declared(sel, 'z-index').map(Number));
        expect(z('.viibe-viewer')).toBe(2750);
        expect(z('#post-options-sheet')).toBeGreaterThan(z('.viibe-viewer'));
        expect(z('.auth-overlay')).toBeGreaterThan(z('.viibe-viewer'));
        expect(z('.confirm-dialog')).toBeGreaterThan(z('.viibe-viewer'));
        // ...and the player is above what opens it.
        expect(z('.viibe-viewer')).toBeGreaterThan(z('.member-page'));
        expect(z('.viibe-viewer')).toBeGreaterThan(z('.venue-page'));
    });
});

describe('the Viibe player — the feed underneath', () => {
    function feedWithPlayingVideo() {
        setState(`feedItems = ${JSON.stringify([vid('f1'), vid('f2')])}; renderFeed();`);
        const v = d.querySelector('#feed-container .feed-panel video');
        v.play();
        return v;
    }

    it('opening the player pauses a playing feed video; closing it resumes', () => {
        const feedVideo = feedWithPlayingVideo();
        setState(`mePosts = ${JSON.stringify([vid('a')])}; openMePost('a');`);
        expect(w.__paused).toContain(feedVideo);

        w.__played.length = 0;
        w.eval('closeViibeViewer()');
        expect(w.__played.map(v => v.closest('.feed-panel')?.dataset.mediaId)).toEqual(['f1']);
    });

    it('a feed video the visitor paused stays paused', () => {
        setState(`feedItems = ${JSON.stringify([vid('f1')])}; renderFeed();`);
        setState(`mePosts = ${JSON.stringify([vid('a')])}; openMePost('a');`);
        w.__played.length = 0;
        w.eval('closeViibeViewer()');
        expect(w.__played).toEqual([]);
    });

    it('closing the player onto a member page does not resume the feed until that closes too', () => {
        feedWithPlayingVideo();
        d.getElementById('member-page').classList.add('visible');
        setState(`memberPageUserId = 'u-2'; memberPagePosts = ${JSON.stringify([vid('m1', { uploaded_by_user_id: 'u-2' })])};
                  openMemberPost('m1');`);
        w.__played.length = 0;
        w.eval('closeViibeViewer()');
        expect(w.__played, 'resumed behind the member page').toEqual([]);
        w.eval('closeMemberProfile()');
        expect(w.__played.length).toBe(1);
    });

    it('⚠️ the feed observer will not start a video while the player is open', () => {
        // A delete from inside the player re-renders the feed, which rebuilds
        // its observer, which fires for the visible panel at once.
        setState(`mePosts = ${JSON.stringify([vid('a')])}; openMePost('a');`);
        setState(`feedItems = ${JSON.stringify([vid('f1')])}; renderFeed();`);
        const feedObs = w.eval('feedVideoObserver');
        const panel = feedObs.targets[0];
        w.__played.length = 0;
        feedObs.cb([{ target: panel, isIntersecting: true }]);
        expect(w.__played).toEqual([]);

        // ...while the player's own observer does.
        const viewerObs = w.eval('viibeViewerObserver');
        viewerObs.cb([{ target: viewerObs.targets[0], isIntersecting: true }]);
        expect(w.__played.length).toBe(1);
    });
});

describe("the Viibe player — the venue strip goes to the venue, not under the player", () => {
    let calls;
    beforeEach(() => {
        calls = [];
        w.openVenuePage = id => calls.push(['venue', id]);
        w.openMemberProfile = id => calls.push(['member', id]);
    });

    it('from a venue page, on that venue: just closes the player', () => {
        d.getElementById('venue-page').classList.add('visible');
        setState(`venuePageVenueId = 'v-9'; venuePageVenue = { id: 'v-9', name: 'Blue Room' };
                  venuePageFeed = ${JSON.stringify([vid('p1', { venue_id: 'v-9' })])}; openVenuePost('p1');`);
        scroller().querySelector('.feed-panel-venue-id').click();
        expect(visible('viibe-viewer')).toBe(false);
        expect(calls, 'reopened the venue page it was already on').toEqual([]);
    });

    it('from the Me tab: closes the player and opens the venue page', () => {
        setState(`mePosts = ${JSON.stringify([vid('a', { venue_id: 'v1', venue_name: 'Blue Room' })])}; openMePost('a');`);
        scroller().querySelector('.feed-panel-venue-id').click();
        expect(visible('viibe-viewer')).toBe(false);
        expect(calls).toEqual([['venue', 'v1']]);
    });

    it('the options button in the strip is NOT taken over', () => {
        const opened = [];
        w.showPostOptions = id => opened.push(id);
        setState(`mePosts = ${JSON.stringify([vid('a', { venue_id: 'v1', venue_name: 'Blue Room' })])}; openMePost('a');`);
        scroller().querySelector('.feed-panel-more').click();
        expect(opened).toEqual(['a']);
        expect(visible('viibe-viewer')).toBe(true);
    });
});

describe('the player and the profiles cover the bottom nav', () => {
    it('#viibe-viewer: fixed, inset 0, above .bottom-nav', () => {
        expect(declared('.viibe-viewer', 'position')).toContain('fixed');
        expect(declared('.viibe-viewer', 'inset')).toContain('0');
        const nav = Math.max(...declared('.bottom-nav', 'z-index').map(Number));
        expect(Number(declared('.viibe-viewer', 'z-index')[0])).toBeGreaterThan(nav);
    });

    it("#member-page (another member's page): fixed, inset 0, above .bottom-nav", () => {
        // Jay asked for the nav hidden on another member's page; it already
        // was, and this keeps it that way.
        expect(declared('.member-page', 'position')).toContain('fixed');
        expect(declared('.member-page', 'inset')).toContain('0');
        const nav = Math.max(...declared('.bottom-nav', 'z-index').map(Number));
        expect(Math.max(...declared('.member-page', 'z-index').map(Number))).toBeGreaterThan(nav);
        expect(d.getElementById('member-page').classList.contains('member-page')).toBe(true);
    });

    it('the player scroller has no padding (a panel would be shorter than its snap step)', () => {
        expect(rulesFor('.viibe-viewer-scroller').length, 'no .viibe-viewer-scroller rule').toBeGreaterThan(0);
        expect(declared('.viibe-viewer-scroller', 'padding')).toEqual([]);
        expect(declared('.viibe-viewer-scroller', 'padding-bottom')).toEqual([]);
        expect(declared('.viibe-viewer-scroller', 'scroll-snap-type')).toContain('y mandatory');
    });
});

// ===========================================================================
// Video fit, the grid, the ⋯ colour
// ===========================================================================

describe('video fit and the small visual fixes', () => {
    it('the feed (and the player) show the WHOLE video: object-fit contain', () => {
        expect(declared('.feed-panel .feed-media video', 'object-fit')).toEqual(['contain']);
        expect(declared('.feed-panel .feed-media img', 'object-fit')).toEqual(['contain']);
        // ...and the panel behind the bars is black, not a gap.
        expect(declared('.feed-panel .feed-media', 'background')).toContain('#000');
    });

    it("the grid's duration badge does not stretch across the tile", () => {
        expect(declared('.member-grid-tile .video-duration', 'left')).toEqual(['auto']);
        // The base rule it overrides really does set a left edge.
        expect(declared('.video-duration', 'left').length).toBe(1);
    });

    it('⋯ is black, set on .feed-more-btn (which .feed-panel-more loses to)', () => {
        expect(declared('.feed-more-btn', 'color')).toEqual(['#000000']);
        expect(rulesFor('.feed-panel-more').length, 'no .feed-panel-more rule').toBeGreaterThan(0);
        expect(declared('.feed-panel-more', 'color'), 'a colour here would lose anyway, and confuse').toEqual([]);
    });

    it('the in-place expansion is gone from the CSS and the JS', () => {
        const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
        expect(bare).not.toContain('.is-expanded');
        expect(bare).not.toContain('.tile-more-btn');
        const code = js.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        expect(code.length).toBeGreaterThan(100000);
        expect(code).not.toMatch(/expandedMePostId|expandedVenuePostId|hydrateExpandedTileIn/);
    });
});

// ===========================================================================
// Portrait only, for watching
// ===========================================================================

describe('turn your phone upright', () => {
    const overlay = () => d.getElementById('app-rotate-overlay');

    it('a phone on its side: the overlay shows and every video pauses', () => {
        setState(`feedItems = ${JSON.stringify([vid('f1')])}; renderFeed();`);
        const v = d.querySelector('#feed-container video');
        v.play();
        setDevice({ ua: UA.iphone, landscape: true });
        w.eval('applyAppOrientation()');
        expect(overlay().style.display).toBe('flex');
        expect(w.__paused).toContain(v);
    });

    it('upright again: hidden, and the Viibe on screen plays', () => {
        setState(`feedItems = ${JSON.stringify([vid('f1')])}; renderFeed();`);
        setDevice({ ua: UA.iphone, landscape: true });
        w.eval('applyAppOrientation()');
        w.__played.length = 0;
        setDevice({ ua: UA.iphone, landscape: false });
        w.eval('applyAppOrientation()');
        expect(overlay().style.display).toBe('none');
        expect(w.__played.length).toBe(1);
    });

    it('while landscape, the feed observer does not start anything', () => {
        setState(`feedItems = ${JSON.stringify([vid('f1')])}; renderFeed();`);
        setDevice({ ua: UA.iphone, landscape: true });
        const obs = w.eval('feedVideoObserver');
        w.__played.length = 0;
        obs.cb([{ target: obs.targets[0], isIntersecting: true }]);
        expect(w.__played).toEqual([]);
    });

    it('the composer keeps its OWN overlay; this one stands down', () => {
        setDevice({ ua: UA.iphone, landscape: true });
        d.getElementById('create-post-modal').classList.add('visible');
        w.eval('applyAppOrientation()');
        expect(overlay().style.display).toBe('none');
    });

    it('never on a desktop, whatever the window shape', () => {
        setDevice({ ua: UA.mac, landscape: true });
        w.eval('applyAppOrientation()');
        expect(overlay().style.display).toBe('none');
    });

    it('sits over everything, including onboarding', () => {
        expect(Number(declared('.app-rotate-overlay', 'z-index')[0])).toBeGreaterThan(3500);
        expect(declared('.app-rotate-overlay', 'position')).toEqual(['fixed']);
    });
});

// ===========================================================================
// Map search, Navigate
// ===========================================================================

describe('map search results are visible, and say how far', () => {
    it('⚠️ no inline display:none on the dropdown — it beat the .visible class', () => {
        const tag = /<div class="map-search-results" id="map-search-results"[^>]*>/.exec(html)?.[0];
        expect(tag, 'the dropdown element is missing').toBeTruthy();
        expect(tag).not.toMatch(/style=/);
        // The stylesheet hides it until .visible.
        expect(declared('.map-search-results', 'display')).toEqual(['none']);
        expect(declared('.map-search-results.visible', 'display')).toEqual(['block']);
    });

    it('typing shows results; each carries its distance; a tap opens the venue', () => {
        setState(`venues = [{ id: 'v1', name: 'Blue Room', category: 'bar', latitude: 34.09, longitude: -118.36 }];
                  userLocation = { lat: 34.05, lng: -118.25 };
                  handleMapSearch('blue');`);
        const dropdown = d.getElementById('map-search-results');
        expect(dropdown.classList.contains('visible')).toBe(true);
        expect(dropdown.style.display).toBe('');
        expect(dropdown.querySelector('.map-search-distance').textContent).toMatch(/^\d+\.\d mi$/);
        expect(dropdown.querySelector('.map-search-result').getAttribute('onclick')).toContain("goToVenueOnMap('v1')");
    });

    it('no fix, no distance — and no "null mi"', () => {
        setState(`venues = [{ id: 'v1', name: 'Blue Room', category: 'bar', latitude: 34.09, longitude: -118.36 }];
                  userLocation = null; handleMapSearch('blue');`);
        expect(d.querySelector('.map-search-distance')).toBeNull();
        expect(d.getElementById('map-search-results').textContent).not.toContain('null');
    });
});

describe('Navigate routes in the phone\'s own maps app', () => {
    const url = venue => w.eval(`directionsUrl(${JSON.stringify(venue)})`);

    it('iPhone: Apple Maps directions to the coordinates', () => {
        setDevice({ ua: UA.iphone });
        expect(url({ latitude: 34.0901, longitude: -118.3617 }))
            .toBe('https://maps.apple.com/?daddr=34.0901,-118.3617');
    });

    it('Android and desktop: Google Maps directions', () => {
        setDevice({ ua: UA.androidPhone });
        expect(url({ latitude: '34.0901', longitude: '-118.3617' }))
            .toBe('https://www.google.com/maps/dir/?api=1&destination=34.0901,-118.3617');
    });

    it('no coordinates: the address; nothing at all: null', () => {
        setDevice({ ua: UA.androidPhone });
        expect(url({ latitude: null, longitude: null, address_line1: '1 Main St', city: 'LA', state: 'CA' }))
            .toBe('https://www.google.com/maps/dir/?api=1&destination=1%20Main%20St,%20LA,%20CA');
        expect(url({ latitude: '', longitude: '' })).toBeNull();
        expect(url(null)).toBeNull();
    });

    it('0 is a real coordinate; null is not the equator', () => {
        expect(w.eval('hasCoords(0, 0)')).toBe(true);
        expect(w.eval("hasCoords('51.5', '-0.12')")).toBe(true);
        for (const bad of ['null, 0', 'undefined, 1', "'', 1", '91, 0', '0, 181', "'x', 1"]) {
            expect(w.eval(`hasCoords(${bad})`), bad).toBe(false);
        }
    });

    it('the venue page has ONE routing control, and no "coming soon"', () => {
        const code = fnCode('async function openVenuePage(venueId)');
        expect(code, 'openVenuePage not found').toBeTruthy();
        expect(code.length).toBeGreaterThan(2000);
        expect(code).not.toContain('coming soon');
        expect(code).not.toMatch(/maps\.google\.com\/\?q=/);
        expect(code).toContain('const directions = directionsUrl(venue);');
        expect(code).toContain('data-i18n="social.navigate"');
        // "Open in Maps" in the distance section routes too.
        expect(fnCode('function renderVenueDistanceSection(venue)')).toContain('directionsUrl(venue)');
    });
});

// ===========================================================================
// Categories: translated names, the app's blue
// ===========================================================================

describe('category names in the reader\'s language', () => {
    it('translated when i18n has the key', () => {
        w.I18n = { t: k => (k === 'social.catBars' ? 'Bares' : k) };
        expect(w.categoryLabel('bar')).toBe('Bares');
    });

    it('English when the key is missing (t returns the key) or i18n is absent', () => {
        w.I18n = { t: k => k };
        expect(w.categoryLabel('club')).toBe('Clubs');
        delete w.I18n;
        expect(w.categoryLabel('restaurant')).toBe('Restaurants');
        expect(w.categoryLabel('not_a_category')).toBe('not_a_category');
    });

    it('the names themselves did not change (Jay: names stay)', () => {
        expect(w.eval('VENUE_CATEGORIES.map(c => c.label)')).toEqual(
            ['Nightlife', 'Bars', 'Clubs', 'Restaurants', 'Lounges', 'Rooftop', 'Event Space']);
        const locales = ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ar'];
        for (const lang of locales) {
            const social = JSON.parse(read(`i18n/${lang}.json`)).social;
            for (const key of w.eval('VENUE_CATEGORIES.map(c => c.labelKey)')) {
                expect(social[key.split('.')[1]], `${lang} ${key}`).toBeTruthy();
            }
            expect(social.navigate, `${lang} social.navigate`).toBeTruthy();
        }
    });
});

describe("category bubbles in the app's blue", () => {
    it('applyBranding derives --app-primary-soft from the tenant primary', () => {
        expect(w.eval("hexToRgba('#6366f1', 0.12)")).toBe('rgba(99, 102, 241, 0.12)');
        expect(w.eval("hexToRgba('#0af', 0.5)")).toBe('rgba(0, 170, 255, 0.5)');
        expect(w.eval("hexToRgba('rebeccapurple', 0.1)")).toBeNull();

        w.eval("applyBranding({ name: 'ViibeView', branding: { primary_color: '#2563eb' } })");
        expect(d.documentElement.style.getPropertyValue('--app-primary-soft')).toBe('rgba(37, 99, 235, 0.12)');
        expect(css).toMatch(/--app-primary-soft: rgba\(99, 102, 241, 0\.12\);/);
    });

    it('unselected pill: tint + primary text; selected: solid primary', () => {
        expect(declared('.pill', 'background')).toEqual(['var(--app-primary-soft)']);
        expect(declared('.pill', 'color')).toEqual(['var(--app-primary)']);
        expect(declared('.pill.active', 'background')).toEqual(['var(--app-primary)']);
        expect(declared('.pill.active', 'color')).toEqual(['#ffffff']);
    });

    it('the venue page badge, the result text and the genre chips follow it', () => {
        expect(declared('.venue-page-category', 'background')).toEqual(['var(--app-primary-soft)']);
        expect(declared('.venue-page-category', 'color')).toEqual(['var(--app-primary)']);
        expect(declared('.genre-chip', 'background')).toEqual(['var(--app-primary-soft)']);
        for (const sel of ['.search-result-category', '.map-search-category', '.recent-search-category']) {
            expect(declared(sel, 'color'), sel).toEqual(['var(--app-primary)']);
        }
    });
});

// ===========================================================================
// Release plumbing
// ===========================================================================

describe('release plumbing (Phase 1)', () => {
    it('the player is in BACK_SURFACES between people-sheet and member-page', () => {
        const order = w.eval('BACK_SURFACES.map(s => s.id)');
        const i = order.indexOf('viibe-viewer');
        expect(i).toBeGreaterThan(0);
        expect(order[i - 1]).toBe('people-sheet');
        expect(order[i + 1]).toBe('member-page');
    });

    it('the ladder comment names the player and the upright overlay', () => {
        expect(css).toMatch(/\.viibe-viewer\s+2750/);
        expect(css).toMatch(/\.app-rotate-overlay\s+3600/);
    });

    it('venues.html loads the same venue-categories.js version as the app', () => {
        expect(read('app/venues.html')).toContain('/js/venue-categories.js?v=2');
        expect(html).toContain('/js/venue-categories.js?v=2');
    });
});
