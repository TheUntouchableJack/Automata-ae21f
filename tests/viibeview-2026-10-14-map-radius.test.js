/**
 * Guards for Jay's 2026-10-14 ViibeView round, Phase 3:
 *
 *   One radius   a slider (1–50 mi, Any), 10 mi by default, applied to the
 *                feed (SQL) and — here, on the client — the map's pins, card
 *                strip, list and post pins, and the Search tab's venues.
 *   Map | List   the map's venues as a list, nearest first.
 *   Search       a Filters sheet (multi-select categories and genres).
 *   Interests    Settings → Your interests reopens the onboarding picks.
 *   GPS          a fix older than five minutes is refreshed; errors say why;
 *                center-on-me works in one tap; posts take a fresh fix.
 *   Data         20261014000004 retires the General venue (is_active = false).
 *                Clearing its coordinates was refused by prod's
 *                venues_active_requires_coordinates; Jay chose this instead.
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
const generalSql = read('supabase/migrations/20261014000004_general_venue_inactive.sql');

function fnBody(signature) {
    const start = js.indexOf(signature);
    if (start < 0) return null;
    const end = js.indexOf('\n}', start);
    return end < 0 ? null : js.slice(start, end);
}

const codeOnly = text => text
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .map(l => l.replace(/\s\/\/.*$/, ''))
    .join('\n');

// ===========================================================================
// jsdom harness
// ===========================================================================

let w, d;
const tick = () => new Promise(r => setTimeout(r, 0));

// Two LA venues and one in Paris. Laurel Hardware is ~0.2 mi from HERE.
const HERE = { lat: 34.0901, lng: -118.3617 };
const VENUES = [
    // Two genres: a filter on ONE of them must still match it ("any of", not "all of").
    { id: 'v-near', name: 'Laurel Hardware', category: 'restaurant', music_genres: ['house', 'soul'], latitude: 34.0915, longitude: -118.3640, city: 'West Hollywood', state: 'CA' },
    // Long Beach: ~24 mi from HERE — outside 10, inside 25. DECIMAL as strings.
    { id: 'v-mid', name: 'Blue Room', category: 'bar', music_genres: ['techno'], latitude: '33.7701', longitude: '-118.1937', city: 'Long Beach', state: 'CA' },
    { id: 'v-far', name: 'Le Bar', category: 'bar', music_genres: ['house'], latitude: 48.8566, longitude: 2.3522, city: 'Paris', state: '' },
];

async function boot({ settings = {}, stored } = {}) {
    const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://royaltyapp.ai/a/viibeview/social' });
    w = dom.window;
    d = w.document;
    w.localStorage.setItem('viibeview_onboarded_v1', '1');
    if (stored !== undefined) w.localStorage.setItem('viibe_feed_radius', stored);
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.requestAnimationFrame = cb => setTimeout(cb, 0);

    w.__rpcCalls = [];
    w.__rpc = () => ({ data: [], error: null });
    const thenable = { then: (r) => r({ data: null, error: new Error('stubbed') }) };
    const chain = new Proxy(thenable, { get: (t, k) => (k in t ? t[k] : () => chain) });
    w.supabase = {
        createClient: () => ({
            auth: { getSession: async () => ({ data: { session: null } }) },
            from: () => chain,
            rpc: (name, args) => { w.__rpcCalls.push({ name, args }); return Promise.resolve(w.__rpc(name, args)); },
            storage: { from: () => ({ upload: async () => ({}), getPublicUrl: () => ({ data: { publicUrl: '' } }), remove: async () => ({}) }) },
        }),
    };

    // A geolocation the tests drive: each call is recorded and answered later.
    w.__geo = [];
    Object.defineProperty(w.navigator, 'geolocation', {
        value: { getCurrentPosition: (ok, fail, opts) => w.__geo.push({ ok, fail, opts }) },
        configurable: true,
    });

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
    w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    // Leaflet, minimally: switchTab('map') builds the real map on a timer, and
    // an unhandled "L is not defined" there would outlive the test.
    const layer = { addTo: () => layer, on: () => layer, addAttribution: () => layer };
    const fakeMap = { setView: () => fakeMap, fitBounds() {}, removeLayer() {}, getZoom: () => 13,
        invalidateSize() {}, getCenter: () => ({ lat: 0, lng: 0 }) };
    w.L = { map: () => fakeMap, tileLayer: () => layer, control: { attribution: () => layer },
        divIcon: () => ({}), marker: () => layer, latLngBounds: () => ({}) };
    await tick();
    w.eval(`currentApp = { id: 'app-1', name: 'ViibeView' }; appSettings = ${JSON.stringify(settings)};
            venues = ${JSON.stringify(VENUES)};`);
    w.__toasts = [];
    w.showToast = m => w.__toasts.push(m);
}

const fix = (where = HERE) => w.eval(`userLocation = ${JSON.stringify(where)}; userLocationAt = Date.now();`);
const names = list => list.map(v => v.name);

// ===========================================================================
// The radius
// ===========================================================================

describe('the radius: stops, default and precedence', () => {
    it('the slider stops are 1, 2, 5, 10, 15, 25, 50 and Any', async () => {
        await boot();
        expect(w.eval('RADIUS_STOPS')).toEqual([1, 2, 5, 10, 15, 25, 50, null]);
        expect(w.eval('DEFAULT_RADIUS_MILES')).toBe(10);
    });

    it('no choice anywhere: 10 mi', async () => {
        await boot();
        w.eval('loadRadiusPreference()');
        expect(w.eval('feedRadiusMiles')).toBe(10);
    });

    it("the tenant's default next — and a PRESENT null is the owner choosing Any", async () => {
        await boot({ settings: { feed_radius_default: 25 } });
        w.eval('loadRadiusPreference()');
        expect(w.eval('feedRadiusMiles')).toBe(25);
        await boot({ settings: { feed_radius_default: null } });
        w.eval('loadRadiusPreference()');
        expect(w.eval('feedRadiusMiles')).toBeNull();
    });

    it("this device's choice first — and its stored '' is Any, not unset", async () => {
        await boot({ settings: { feed_radius_default: 25 }, stored: '5' });
        w.eval('loadRadiusPreference()');
        expect(w.eval('feedRadiusMiles')).toBe(5);
        await boot({ settings: { feed_radius_default: 25 }, stored: '' });
        w.eval('loadRadiusPreference()');
        expect(w.eval('feedRadiusMiles')).toBeNull();
    });

    it('withinRadius: no fix or Any applies nothing; no coordinates is outside', async () => {
        await boot();
        w.eval('feedRadiusMiles = 10; userLocation = null;');
        expect(w.eval('withinRadius(48.8566, 2.3522)'), 'no fix must never filter').toBe(true);
        fix();
        expect(w.eval('withinRadius(34.0915, -118.3640)')).toBe(true);
        expect(w.eval('withinRadius(48.8566, 2.3522)')).toBe(false);
        expect(w.eval('withinRadius(null, null)'), 'no coordinates has no distance').toBe(false);
        expect(w.eval("withinRadius('34.0950', '-118.3600')"), 'DECIMAL as a string').toBe(true);
        w.eval('feedRadiusMiles = null');
        expect(w.eval('withinRadius(48.8566, 2.3522)')).toBe(true);
    });

    it('byDistance: nearest first, unknown distance last', async () => {
        await boot();
        fix();
        const shuffled = [VENUES[2], { id: 'x', name: 'Nowhere', latitude: null, longitude: null }, VENUES[1], VENUES[0]];
        expect(names(w.eval(`byDistance(${JSON.stringify(shuffled)})`)))
            .toEqual(['Laurel Hardware', 'Blue Room', 'Le Bar', 'Nowhere']);
    });
});

describe('the slider sheet', () => {
    beforeEach(async () => { await boot(); w.eval('setupEventListeners()'); });

    it('opens on the current stop with a live label', () => {
        fix();
        w.eval('feedRadiusMiles = 10; openRadiusSheet();');
        const slider = d.getElementById('radius-slider');
        expect(slider.getAttribute('type')).toBe('range');
        expect(slider.value).toBe('3');
        expect(slider.max).toBe('7');
        expect(d.getElementById('radius-value').textContent).toBe('Within 10 mi');
        expect([...d.querySelectorAll('.radius-ticks span')].map(s => s.textContent))
            .toEqual(['1', '2', '5', '10', '15', '25', '50', 'Any']);
    });

    it('dragging moves the label; letting go applies it, keeps the sheet open, and reloads the feed', async () => {
        fix();
        w.eval('feedRadiusMiles = 10; openRadiusSheet();');
        const slider = d.getElementById('radius-slider');
        slider.value = '1';
        slider.dispatchEvent(new w.Event('input', { bubbles: true }));
        expect(d.getElementById('radius-value').textContent).toBe('Within 2 mi');
        expect(w.eval('feedRadiusMiles'), 'applied before letting go').toBe(10);

        slider.dispatchEvent(new w.Event('change', { bubbles: true }));
        await tick();
        expect(w.eval('feedRadiusMiles')).toBe(2);
        expect(w.localStorage.getItem('viibe_feed_radius')).toBe('2');
        expect(d.getElementById('radius-sheet').classList.contains('visible')).toBe(true);
        const feed = w.__rpcCalls.filter(c => c.name === 'get_venue_feed_v3').at(-1);
        expect(feed.args.p_radius_miles).toBe(2);

        slider.value = '7';
        slider.dispatchEvent(new w.Event('change', { bubbles: true }));
        expect(w.eval('feedRadiusMiles')).toBeNull();
        expect(w.localStorage.getItem('viibe_feed_radius')).toBe('');
    });

    it('a stored value between stops sits on the nearest one', () => {
        fix();
        w.eval('feedRadiusMiles = 3; openRadiusSheet();');
        expect(d.getElementById('radius-slider').value).toBe('1');   // 2 mi is nearer 3 than 5
        w.eval('feedRadiusMiles = 200; renderRadiusOptions();');
        expect(d.getElementById('radius-slider').value).toBe('6');   // 50 mi
    });

    it('no fix: the slider is disabled and the sheet offers location instead', () => {
        w.eval('userLocation = null; openRadiusSheet();');
        expect(d.getElementById('radius-slider').disabled).toBe(true);
        expect(d.getElementById('radius-enable-location')).toBeTruthy();
    });

    it("the owner's opening-distance select has the same stops, and unset reads 10", async () => {
        const opts = [...d.querySelectorAll('#setting-feed-radius option')].map(o => o.value);
        expect(opts).toEqual(['1', '2', '5', '10', '15', '25', '50', '']);
        w.eval("isOwner = true; openAppSettings();");
        expect(d.getElementById('setting-feed-radius').value).toBe('10');
        expect(d.querySelector('#setting-feed-radius option[value="50"]').textContent).toBe('50 miles');
    });
});

// ===========================================================================
// The map: pins, strip, list, post pins
// ===========================================================================

describe('the map follows the radius (it ignored the distance chip before)', () => {
    beforeEach(async () => { await boot(); fix(); w.eval('feedRadiusMiles = 10'); });

    it('venue pins, the strip and the list all get the radius', () => {
        expect(names(w.eval('filteredVenues()'))).toEqual(['Laurel Hardware']);
        w.eval('feedRadiusMiles = 25');
        expect(names(w.eval('filteredVenues()'))).toEqual(['Laurel Hardware', 'Blue Room']);
        w.eval('feedRadiusMiles = null');
        expect(names(w.eval('filteredVenues()')).length).toBe(3);
    });

    it("the Following chip shows only followed venues", () => {
        w.eval("feedRadiusMiles = null; feedMode = 'following'; followingKeys = new Set([followKey('venue', 'v-mid')]);");
        expect(names(w.eval('filteredVenues()'))).toEqual(['Blue Room']);
    });

    it('post pins: the radius by the pin\'s own position, and Following', () => {
        w.eval(`postPins = ${JSON.stringify([
            { id: 'p-near', has_own_coords: true, latitude: 34.09, longitude: -118.36, uploaded_by_user_id: 'u1', venue_id: null },
            { id: 'p-far', has_own_coords: true, latitude: 48.85, longitude: 2.35, uploaded_by_user_id: 'u2', venue_id: null },
        ])}`);
        expect(w.eval('visiblePostPins().map(p => p.id)')).toEqual(['p-near']);
        w.eval("feedRadiusMiles = null; feedMode = 'following'; followingKeys = new Set([followKey('user', 'u2')]);");
        expect(w.eval('visiblePostPins().map(p => p.id)')).toEqual(['p-far']);
    });

    it('Map | List: the same venues, nearest first; a tap opens the venue page', () => {
        // The venue array in FARTHEST-first order, so a list that merely kept
        // it would come out wrong.
        w.eval(`venues = ${JSON.stringify([VENUES[2], VENUES[1], VENUES[0]])}`);
        w.eval('feedRadiusMiles = 25; setMapView("list")');
        const list = d.getElementById('map-list');
        expect(list.style.display).toBe('');
        expect(d.getElementById('tab-map').classList.contains('map-list-open')).toBe(true);
        const cards = [...list.querySelectorAll('.search-result-card')];
        expect(cards.map(c => c.querySelector('.search-result-name').textContent)).toEqual(['Laurel Hardware', 'Blue Room']);
        expect(cards[0].querySelector('.search-result-distance').textContent).toMatch(/^0\.\d mi$/);
        expect(cards[0].getAttribute('onclick')).toBe("openVenuePage('v-near')");

        w.eval('setMapView("map")');
        expect(list.style.display).toBe('none');
        expect(d.querySelector('.map-view-btn[data-map-view="map"]').getAttribute('aria-selected')).toBe('true');
    });

    it('nothing within the radius: says so, and Show everywhere clears it', () => {
        fix({ lat: 0, lng: 0 });   // the Gulf of Guinea: nothing near
        w.eval('setMapView("list")');
        const list = d.getElementById('map-list');
        expect(list.querySelector('.radius-empty-title').textContent).toBe('Nothing within 10 mi right now');
        list.querySelector('.radius-empty-btn').click();
        expect(w.eval('feedRadiusMiles')).toBeNull();
        expect(list.querySelectorAll('.search-result-card').length).toBe(3);
    });

    it('the card strip says it too', () => {
        fix({ lat: 0, lng: 0 });
        w.eval('renderVenueSwimLane()');
        expect(d.getElementById('venue-swim-lane').textContent).toContain('Nothing within 10 mi right now');
    });

    it('the feed\'s empty state uses the same words', () => {
        w.eval('feedItems = []; renderFeedEmptyState();');
        expect(d.querySelector('#feed-empty h3').textContent).toBe('Nothing within 10 mi right now');
        expect(d.querySelector('#feed-empty h3').hasAttribute('data-i18n'), 'a static key would print {miles}').toBe(false);
        expect(d.getElementById('feed-empty-cta').textContent).toBe('Show everywhere');
    });
});

// ===========================================================================
// Search: radius on the browse list, Filters
// ===========================================================================

describe('the Search tab', () => {
    beforeEach(async () => { await boot(); fix(); w.eval("feedRadiusMiles = 25; searchScope = 'venues';"); });
    const cards = () => [...d.querySelectorAll('#search-results .search-result-card .search-result-name')].map(e => e.textContent);

    it('browsing: within the radius, nearest first', () => {
        w.eval("handleSearch('')");
        expect(cards()).toEqual(['Laurel Hardware', 'Blue Room']);
    });

    it('a typed search finds a place however far, nearest first', () => {
        w.eval("handleSearch('bar')");
        expect(cards()).toEqual(['Blue Room', 'Le Bar']);
    });

    it('Filters: multi-select, across both lists, with a count', () => {
        w.eval("toggleSearchFilter('genre', 'house')");
        expect(d.getElementById('search-filters-count').textContent).toBe('1');
        w.eval("handleSearch('')");
        expect(cards()).toEqual(['Laurel Hardware']);
        // One character browses (the list above); two search.
        w.eval("handleSearch('le')");
        expect(cards()).toEqual(['Le Bar']);
        // Within a kind any match counts.
        w.eval("toggleSearchFilter('genre', 'techno'); handleSearch('');");
        expect(cards()).toEqual(['Laurel Hardware', 'Blue Room']);
        // Across kinds both must.
        w.eval("toggleSearchFilter('category', 'bar'); handleSearch('');");
        expect(cards()).toEqual(['Blue Room']);
        expect(d.getElementById('search-filters-count').textContent).toBe('3');
        w.eval('clearSearchFilters()');
        expect(d.getElementById('search-filters-count').style.display).toBe('none');
    });

    it('the sheet offers what the venues actually have, and only on the Venues scope', () => {
        w.eval('openSearchFilters()');
        const chips = [...d.querySelectorAll('#search-filters-body .genre-chip-btn')].map(c => c.textContent.trim());
        expect(chips).toEqual(expect.arrayContaining(['Bars', 'Restaurants']));
        expect(chips).not.toContain('Rooftop');
        w.eval("closeSearchFilters(); setSearchScope('members');");
        expect(d.getElementById('search-filters-btn').style.display).toBe('none');
        w.eval("setSearchScope('venues')");
        expect(d.getElementById('search-filters-btn').style.display).toBe('');
    });
});

// ===========================================================================
// Your interests
// ===========================================================================

describe('Settings → Your interests', () => {
    beforeEach(async () => { await boot(); });

    it('opens on the current picks, in both the signed-out and signed-in menus', () => {
        expect(d.getElementById('interests-btn-out').getAttribute('onclick')).toBe('openInterests()');
        expect(d.getElementById('interests-btn').getAttribute('onclick')).toBe('openInterests()');
        w.eval("preferredCategories.splice(0, 99, 'bar'); openInterests();");
        expect(d.getElementById('interests-sheet').classList.contains('visible')).toBe(true);
        const pressed = [...d.querySelectorAll('#interests-categories .onboarding-chip[aria-pressed="true"]')].map(c => c.dataset.obSlug);
        expect(pressed).toEqual(['bar']);
    });

    it('a tap toggles; closing without Save puts the old picks back', () => {
        w.eval("preferredCategories.splice(0, 99, 'bar'); openInterests();");
        d.querySelector('#interests-categories .onboarding-chip[data-ob-slug="club"]').click();
        expect(w.eval('preferredCategories.slice()')).toEqual(['bar', 'club']);
        w.eval('closeInterests()');
        expect(w.eval('preferredCategories.slice()')).toEqual(['bar']);
    });

    it('Save keeps them, on this device and (signed in) on the account', async () => {
        w.SocialAuth.isSignedIn = async () => true;
        w.__rpc = () => ({ data: [{ success: true }], error: null });
        w.eval("preferredCategories.splice(0, 99); openInterests();");
        d.querySelector('#interests-categories .onboarding-chip[data-ob-slug="club"]').click();
        await w.eval('saveInterests()');
        expect(w.eval('preferredCategories.slice()')).toEqual(['club']);
        expect(JSON.parse(w.localStorage.getItem('viibeview_prefs_v1')).categories).toEqual(['club']);
        const call = w.__rpcCalls.find(c => c.name === 'set_member_preferences');
        expect(call, 'not saved to the account').toBeTruthy();
        expect(d.getElementById('interests-sheet').classList.contains('visible')).toBe(false);
    });
});

// ===========================================================================
// GPS
// ===========================================================================

describe('GPS: fresh fixes, real reasons, one-tap centre', () => {
    beforeEach(async () => { await boot(); });

    it('a fix older than five minutes is refreshed when Feed or Map opens, and on return', () => {
        w.eval(`userLocation = ${JSON.stringify(HERE)}; userLocationAt = Date.now() - 6 * 60 * 1000;`);
        w.eval("switchTab('map')");
        expect(w.__geo.length).toBe(1);
        w.__geo.length = 0;

        w.eval('userLocationAt = Date.now()');
        w.eval("switchTab('feed')");
        expect(w.__geo.length, 'a fresh fix is not re-asked').toBe(0);

        w.eval('userLocationAt = Date.now() - 6 * 60 * 1000; watchLocationFreshness();');
        Object.defineProperty(d, 'visibilityState', { value: 'visible', configurable: true });
        d.dispatchEvent(new w.Event('visibilitychange'));
        expect(w.__geo.length).toBe(1);
    });

    it('a visitor who blocked location is not asked again on every tab', () => {
        w.eval('userLocation = null; lastLocationError = 1;');
        w.eval("switchTab('map'); switchTab('feed');");
        expect(w.__geo.length).toBe(0);
    });

    it('each failure says what went wrong, in the banner and the toasts', () => {
        expect(w.eval('locationErrorMessage(1)')).toMatch(/blocked/);
        expect(w.eval('locationErrorMessage(2)')).toMatch(/could not find your location/);
        expect(w.eval('locationErrorMessage(3)')).toMatch(/took too long/);
        w.eval('requestLocation()');
        w.__geo[0].fail({ code: 3, message: 'timeout' });
        expect(d.getElementById('location-banner').textContent).toMatch(/took too long/);
    });

    it('center-on-me with no fix: asks, and recentres when it arrives (one tap)', () => {
        const views = [];
        w.eval('userLocation = null');
        w.map = { setView: (c, z) => views.push([c, z]), removeLayer() {}, getZoom: () => 13, fitBounds() {} };
        w.eval('map = window.map');
        w.eval('centerOnMe()');
        expect(views).toEqual([]);
        expect(w.__geo.length).toBe(1);
        w.__geo[0].ok({ coords: { latitude: 34.1, longitude: -118.3 } });
        expect(views.at(-1)).toEqual([[34.1, -118.3], 14]);

        // A failure gets a toast, not silence.
        w.eval('userLocation = null; centerOnMe()');
        w.__geo.at(-1).fail({ code: 1, message: 'denied' });
        expect(w.__toasts.at(-1)).toMatch(/blocked/);
    });

    it('a post takes a FRESH high-accuracy fix, falling back to the cached one', async () => {
        fix();
        const pending = w.eval('getPostCoords()');
        expect(w.__geo.at(-1).opts.enableHighAccuracy).toBe(true);
        w.__geo.at(-1).fail({ code: 3 });
        expect(await pending).toEqual(HERE);
        // Since 2026-10-27 the fix starts when the composer OPENS and Post
        // waits on it for at most 1.5 s (coordsForPost, which wraps
        // getPostCoords). Behaviour: viibeview-2026-10-27-fit-post-speed.test.js.
        expect(fnBody('async function submitPost()') || js.slice(js.indexOf('async function submitPost'), js.indexOf('async function submitPost') + 9000))
            .toContain('const coords = await coordsForPost();');
        expect(fnBody('async function coordsForPost(')).toContain(': getPostCoords();');
    });

    it('no truthiness coordinate checks remain — hasCoords everywhere', () => {
        const code = codeOnly(js);
        expect(code.length).toBeGreaterThan(100000);
        expect(code).not.toMatch(/\.latitude && [a-zA-Z]+\.longitude/);
        expect(code).not.toMatch(/!(?:venue|pin)\.latitude \|\|/);
        expect(code).not.toMatch(/userLocation && venue\.latitude\n/);
    });

    it("the map opens on the visitor's location first", () => {
        const init = fnBody('function initMap()');
        expect(init).toMatch(/const center = userLocation\s+\? \[userLocation\.lat, userLocation\.lng\]\s+: newestPost/);
    });
});

// ===========================================================================
// Data, markup, release
// ===========================================================================

describe('20261014000004 — the General venue is retired', () => {
    const code = generalSql.split('\n').map(l => (l.indexOf('--') < 0 ? l : l.slice(0, l.indexOf('--')))).join('\n');

    it('one row, matched by id AND name, only is_active changes', () => {
        expect(code).toMatch(/UPDATE venues\s+SET is_active = false\s+WHERE id = '81bdf625-0dbc-458c-bcee-be831a28adec'\s+AND name = 'General'\s+AND is_active = true;/);
        expect(code).toMatch(/IF v_updated > 1 THEN\s+RAISE EXCEPTION/);
        // ⚠️ Not the coordinates: venues_active_requires_coordinates refused that.
        expect(code).not.toMatch(/latitude|longitude/);
        expect(code).not.toMatch(/DELETE/);
    });

    it('the rollback is recorded', () => {
        expect(generalSql).toContain("UPDATE venues SET is_active = true");
    });

    it('one file for the stamp', () => {
        const files = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter(f => f.startsWith('20261014000004'));
        expect(files).toEqual(['20261014000004_general_venue_inactive.sql']);
    });
});

describe('markup and release (Phase 3)', () => {
    it('the map has Map | List over its own list; the search bar stays on top', () => {
        expect(html).toMatch(/<div class="map-view-toggle" role="tablist"/);
        expect(html).toMatch(/<div class="map-list" id="map-list" style="display:none;"><\/div>/);
        const z = sel => Number(new RegExp(`\\n${sel.replace('.', '\\.')} \\{[^}]*z-index: (\\d+);`).exec(css)?.[1]);
        expect(z('.map-search-bar')).toBeGreaterThan(z('.map-view-toggle'));
        expect(z('.map-view-toggle')).toBeGreaterThan(z('.map-list'));
    });

    it('the two new sheets are back surfaces', async () => {
        await boot();
        const order = w.eval('BACK_SURFACES.map(s => s.id)');
        expect(order).toContain('interests-sheet');
        expect(order).toContain('search-filters-sheet');
    });

    it('every new key exists in all 8 languages, with its placeholders', () => {
        const keys = ['nothingWithin', 'showEverywhere', 'withinMiles', 'radiusAnyShort', 'done', 'noVenuesMatchFilters',
            'noVenuesFound', 'mapViewMap', 'mapViewList', 'filters', 'clearFilters', 'categories', 'genres',
            'yourInterests', 'interestsHint', 'save', 'locationDenied', 'locationTimeout', 'locationUnavailable'];
        for (const lang of ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ar']) {
            const social = JSON.parse(read(`i18n/${lang}.json`)).social;
            for (const k of keys) expect(social[k], `${lang} social.${k}`).toBeTruthy();
            expect(social.nothingWithin, `${lang} nothingWithin`).toContain('{miles}');
            expect(social.withinMiles, `${lang} withinMiles`).toContain('{miles}');
        }
    });
});
