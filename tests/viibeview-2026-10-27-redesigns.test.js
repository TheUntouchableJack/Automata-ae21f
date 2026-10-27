/**
 * Guards for Jay's 2026-10-27 ViibeView round, Phase 2 (no database change):
 * the best-judgment redesigns of four surfaces from the client's board.
 *
 *   Share sheet     a card naming what is shared, one row of round buttons,
 *                   "Link copied" inside the sheet; profiles can be shared
 *                   (?member= links).
 *   Post composer   translated labels; the venue as a card; a progress card
 *                   with the poster, the clip's REAL upload percentage (XHR
 *                   upload.onprogress) and a check mark at "Posted!".
 *   Profile (Me)    avatar beside the name; one divided row of counts; Edit
 *                   Profile and Share profile side by side; "Been to".
 *   Location        city suggestions as you type and "Use my current
 *                   location", still saved as typed.
 *
 * Behaviour runs in jsdom with social.js loaded as a real classic <script>.
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
const places = read('js/venue-places.js');

function fnBody(signature) {
    const start = js.indexOf(signature);
    if (start < 0) return null;
    const end = js.indexOf('\n}', start);
    return end < 0 ? null : js.slice(start, end);
}

function rulesFor(selector) {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const out = [];
    for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sels = m[1].split(',').map(s => s.trim().replace(/\s+/g, ' '));
        if (sels.includes(selector)) out.push(m[2]);
    }
    return out;
}

function declared(selector, prop) {
    return rulesFor(selector).flatMap(block => block.split(';')
        .map(d => d.trim())
        .filter(d => d.startsWith(prop + ':'))
        .map(d => d.slice(prop.length + 1).trim()));
}

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_V = '22222222-2222-4222-8222-222222222222';
const UUID_M = '33333333-3333-4333-8333-333333333333';

let w, d;

async function boot({ url = 'https://royaltyapp.ai/a/viibeview/social' } = {}) {
    const dom = new JSDOM(html, { runScripts: 'dangerously', url });
    w = dom.window;
    d = w.document;
    w.localStorage.setItem('viibeview_onboarded_v1', '1');
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.requestAnimationFrame = cb => setTimeout(cb, 0);
    w.HTMLElement.prototype.scrollTo = function () {};
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
    const proto = w.HTMLMediaElement.prototype;
    proto.play = function () { return Promise.resolve(); };
    proto.pause = function () {};
    proto.load = function () {};
    const load = rel => {
        const el = d.createElement('script');
        el.textContent = read(rel);
        d.body.appendChild(el);
    };
    load('js/venue-categories.js');
    load('js/music-genres.js');
    load('js/venue-places.js');
    load('customer-app/social-auth.js');
    load('customer-app/social.js');
    w.showEmptyState = () => {};
    w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    await tick();
    w.eval("currentApp = { id: 'app-1', name: 'ViibeView', organization_id: 'org-1' }; appSlug = 'viibeview';");
    w.__toasts = [];
    w.showToast = m => w.__toasts.push(m);
}

// ===========================================================================
// The share sheet
// ===========================================================================

describe('the share sheet: a card, round buttons, the answer inside', () => {
    beforeEach(boot);
    const body = () => d.getElementById('share-options');

    it("a Viibe's card: its poster, its venue, the city", () => {
        w.eval(`feedItems = [{ id: '${UUID_A}', media_type: 'video', url: 'https://cdn.test/a.mp4', thumbnail_url: 'https://cdn.test/a.jpg',
                venue_id: '${UUID_V}', venue_name: 'Laurel Hardware', venue_city: 'West Hollywood', venue_state: 'California' }];
                openShareSheet({ postId: '${UUID_A}', venueId: '${UUID_V}' });`);
        const card = body().querySelector('.share-card');
        expect(card.classList.contains('share-card-post')).toBe(true);
        expect(card.querySelector('img').getAttribute('src')).toBe('https://cdn.test/a.jpg');
        expect(card.querySelector('.share-card-title').textContent).toBe('Laurel Hardware');
        expect(card.querySelector('.share-card-sub').textContent).toBe('West Hollywood, California');
    });

    it("a venue's card and a member's card", () => {
        w.eval(`venues = [{ id: '${UUID_V}', name: 'Blue Room', city: 'Austin', state: 'TX', profile_image_url: 'https://cdn.test/v.jpg' }];
                openShareSheet({ venueId: '${UUID_V}' });`);
        expect(body().querySelector('.share-card-venue .share-card-title').textContent).toBe('Blue Room');
        expect(body().querySelector('.share-card-venue img').getAttribute('src')).toBe('https://cdn.test/v.jpg');
        w.eval(`closeShareSheet(); currentUserId = '${UUID_M}';
                meProfile = { user_id: '${UUID_M}', display_name: 'Kai', location: 'Paris, France', avatar_url: null };
                openShareSheet({ memberId: '${UUID_M}' });`);
        const card = body().querySelector('.share-card-member');
        expect(card.querySelector('.share-card-title').textContent).toBe('Kai');
        expect(card.querySelector('.share-card-sub').textContent).toBe('Paris, France');
        expect(card.querySelector('.share-card-letter').textContent).toBe('K');
    });

    it('a post nobody loaded still gets a sheet, with a plain card', () => {
        w.eval(`openShareSheet({ postId: '${UUID_A}' })`);
        expect(body().querySelector('.share-card-title').textContent).toBe('A Viibe');
        expect(body().querySelectorAll('.share-action').length).toBe(3);
    });

    it('four round buttons with labels; Messages and Email are links; More… only with navigator.share', () => {
        w.navigator.share = async () => {};
        w.eval(`openShareSheet({ postId: '${UUID_A}' })`);
        const actions = [...body().querySelectorAll('.share-action')];
        expect(actions.map(a => a.querySelector('.share-action-label').getAttribute('data-i18n')))
            .toEqual(['social.shareMessages', 'social.shareEmail', 'social.shareCopyLink', 'social.shareMore']);
        expect(actions[0].tagName).toBe('A');
        expect(actions[0].getAttribute('href').startsWith('sms:')).toBe(true);
        expect(actions[1].getAttribute('href').startsWith('mailto:')).toBe(true);
        expect(actions.every(a => a.querySelector('.share-action-icon svg'))).toBe(true);
        // Spread evenly whether there are three buttons or four.
        expect(declared('.share-actions', 'display')).toEqual(['flex']);
        expect(declared('.share-actions > .share-action', 'flex')).toEqual(['1 1 0']);
    });

    it('Copy link: inside the sheet, which stays open, and the button says Copied', async () => {
        Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true });
        w.eval(`openShareSheet({ venueId: '${UUID_V}' })`);
        await w.eval('copyShareLink()');
        expect(d.getElementById('share-copy').classList.contains('is-done')).toBe(true);
        expect(d.getElementById('share-copy').querySelector('polyline')).toBeTruthy();
        expect(d.getElementById('share-sheet').classList.contains('visible')).toBe(true);
        // Reopening starts clean.
        w.eval(`closeShareSheet(); openShareSheet({ venueId: '${UUID_V}' })`);
        expect(d.getElementById('share-copied').hidden).toBe(true);
        expect(d.getElementById('share-copy').classList.contains('is-done')).toBe(false);
    });
});

describe('sharing a profile: ?member= links', () => {
    it('the URL and the words', async () => {
        await boot();
        w.eval(`currentUserId = '${UUID_M}'; meProfile = { user_id: '${UUID_M}', display_name: 'Kai' };`);
        expect(w.eval(`shareUrl({ memberId: '${UUID_M}' })`)).toBe(`https://royaltyapp.ai/a/viibeview/social?member=${UUID_M}`);
        expect(w.eval(`shareText({ memberId: '${UUID_M}' })`)).toBe('Kai on ViibeView');
        expect(w.eval(`shareText({ memberId: 'someone-unloaded' })`)).toBe('A profile on ViibeView');
        // A post or venue link never carries a member too.
        expect(w.eval(`shareUrl({ postId: '${UUID_A}', memberId: '${UUID_M}' })`)).not.toContain('member=');
    });

    it('Share profile on the Me tab opens the sheet for you', async () => {
        await boot();
        w.eval(`currentUserId = '${UUID_M}'; meProfile = { user_id: '${UUID_M}', display_name: 'Kai' }; shareMyProfile();`);
        expect(w.eval('shareTarget')).toEqual({ memberId: UUID_M });
        expect(d.getElementById('me-share-btn').getAttribute('onclick')).toBe('shareMyProfile()');
    });

    it('a ?member= link opens that profile, and is stripped from the address', async () => {
        await boot({ url: `https://royaltyapp.ai/a/viibeview/social?member=${UUID_M}` });
        const opened = [];
        w.openMemberProfile = id => opened.push(id);
        expect(w.eval('readDeepLink()')).toEqual({ post: null, venue: null, member: UUID_M });
        await w.eval('openDeepLink()');
        expect(opened).toEqual([UUID_M]);
        expect(w.location.search).toBe('');
    });

    it('a malformed ?member= is ignored', async () => {
        await boot({ url: 'https://royaltyapp.ai/a/viibeview/social?member=not-a-uuid' });
        expect(w.eval('readDeepLink()')).toBeNull();
    });
});

// ===========================================================================
// The Me tab
// ===========================================================================

describe('the profile page (Me tab): cleaner, with "Been to"', () => {
    beforeEach(boot);

    it('the order: avatar beside the text, the counts, the two buttons, Been to, the grid', () => {
        const row = d.querySelector('.me-identity-row');
        expect(row.querySelector('#me-avatar')).toBeTruthy();
        const text = row.querySelector('.me-identity-text');
        expect([...text.children].map(e => e.id)).toEqual(['me-name', 'me-location', 'me-bio']);
        const pos = id => html.indexOf(`id="${id}"`);
        expect(pos('me-stats')).toBeGreaterThan(pos('me-bio'));
        expect(pos('me-edit-profile-btn')).toBeGreaterThan(pos('me-stats'));
        expect(pos('me-share-btn')).toBeGreaterThan(pos('me-edit-profile-btn'));
        expect(pos('me-venues')).toBeGreaterThan(pos('me-share-btn'));
        expect(pos('me-grid')).toBeGreaterThan(pos('me-venues'));
        expect(d.getElementById('me-share-btn').getAttribute('data-i18n')).toBe('social.shareProfileBtn');
    });

    it('the two buttons line up (no leftover margin on Edit Profile), and the letter has a circle', () => {
        expect(rulesFor('#me-edit-profile-btn')).toEqual([]);
        expect(declared('.me-avatar', 'background')).toEqual(['var(--app-primary-soft)']);
    });

    it('the counts are one divided row; the buttons share the width', () => {
        expect(declared('.me-stats', 'grid-template-columns')).toEqual(['repeat(3, minmax(0, 1fr))']);
        expect(declared('.me-stats .member-stat + .member-stat', 'border-left')[0]).toContain('var(--color-border)');
        expect(declared('.me-actions', 'grid-template-columns')).toEqual(['repeat(2, minmax(0, 1fr))']);
        expect(declared('.me-identity-text', 'text-align')).toEqual(['left']);
    });

    it('loadMeTab asks for your own venue history and draws it', async () => {
        w.eval(`SocialAuth.getSession = async () => ({ user: { id: 'me-1' } });`);
        w.__rpc = (name) => {
            if (name === 'get_member_profile') return { data: [{ user_id: 'me-1', display_name: 'Kai', post_count: 1, follower_count: 0, following_count: 0 }], error: null };
            if (name === 'get_member_venues') return { data: [{ target_id: 'v1', target_type: 'venue', name: 'Blue Room', visit_count: 2, last_posted_at: null, subtitle: 'SERVER ENGLISH' }], error: null };
            return { data: [], error: null };
        };
        await w.eval('loadMeTab()');
        const call = w.__rpcCalls.find(c => c.name === 'get_member_venues');
        expect(call.args).toMatchObject({ p_app_id: 'app-1', p_user_id: 'me-1' });
        expect(d.getElementById('me-venues').style.display).not.toBe('none');
        const rowEl = d.querySelector('#me-venues-list .people-row');
        expect(rowEl.querySelector('.people-row-name').textContent).toBe('Blue Room');
        // The subtitle is the app's own, translated (withVenueSubtitles), not the server's English.
        expect(rowEl.querySelector('.people-row-meta').textContent).toMatch(/^2 /);
        expect(rowEl.querySelector('.people-row-meta').textContent).not.toBe('SERVER ENGLISH');
        // A tab, not an overlay: no closeMemberProfile() before the venue page.
        expect(rowEl.getAttribute('onclick')).toBe("openVenuePage('v1')");
    });

    it('no history: no section; a failed load is not fatal', async () => {
        w.eval(`SocialAuth.getSession = async () => ({ user: { id: 'me-1' } });`);
        w.__rpc = (name) => name === 'get_member_venues' ? { data: null, error: { message: 'boom' } } : { data: [], error: null };
        await w.eval('loadMeTab()');
        expect(d.getElementById('me-venues').style.display).toBe('none');
    });

    it('one renderer for both pages (the member page keeps its close-first rows)', () => {
        expect(fnBody('function renderMemberVenues()')).toContain('renderVenueHistory({');
        expect(fnBody('function renderMeVenues()')).toContain('renderVenueHistory({');
        w.eval(`memberPageUserId = 'u'; memberPageVenues = [{ target_id: 'v9', target_type: 'venue', name: 'X' }]; renderMemberVenues();`);
        expect(d.querySelector('#member-page-venues-list .people-row').getAttribute('onclick'))
            .toBe("closeMemberProfile(); openVenuePage('v9')");
    });
});

// ===========================================================================
// The composer
// ===========================================================================

describe('the composer: labels, the venue card, the progress card', () => {
    beforeEach(boot);

    it('every label is translated', () => {
        const key = sel => d.querySelector(sel).getAttribute('data-i18n');
        expect(key('#create-post-cancel')).toBe('social.cancel');
        expect(key('.create-post-header h3')).toBe('social.composerTitle');
        expect(key('#create-post-submit')).toBe('social.composerPost');
        expect(key('#upload-placeholder span')).toBe('social.tapToOpenCamera');
        expect(key('#retake-btn')).toBe('social.retake');
        expect(d.getElementById('post-caption').getAttribute('data-i18n-placeholder')).toBe('social.writeCaption');
        // The live status line is NOT keyed: applyTranslations() would reset
        // "Saving…" to "Uploading…" mid-post.
        expect(d.getElementById('post-progress-text').hasAttribute('data-i18n')).toBe(false);
    });

    it('the venue card: picture, "Posting to", the name, Change', () => {
        w.eval(`venues = [{ id: 'v1', name: 'Laurel Hardware', profile_image_url: 'https://cdn.test/l.jpg' }];
                composerVenueId = 'v1'; renderComposerVenueRow();`);
        const row = d.getElementById('create-post-venue');
        expect(row.classList.contains('is-empty')).toBe(false);
        expect(row.querySelector('.create-post-venue-icon img').getAttribute('src')).toBe('https://cdn.test/l.jpg');
        expect(row.querySelector('.create-post-venue-kicker').getAttribute('data-i18n')).toBe('social.postingTo');
        expect(row.querySelector('.create-post-venue-name').textContent).toBe('Laurel Hardware');
        expect(row.querySelector('.create-post-venue-change').getAttribute('data-i18n')).toBe('social.change');
    });

    it('no venue: the same card says so', () => {
        w.eval(`composerVenueId = null; renderComposerVenueRow();`);
        const row = d.getElementById('create-post-venue');
        expect(row.classList.contains('is-empty')).toBe(true);
        expect(row.querySelector('.create-post-venue-name').getAttribute('data-i18n')).toBe('social.noVenueSelected');
        expect(row.querySelector('svg')).toBeTruthy();
    });

    it('posting: the real percentage, the poster, then the check mark, then it closes', async () => {
        w.URL.createObjectURL = () => 'blob:poster';
        w.URL.revokeObjectURL = () => {};
        w.eval(`SocialAuth.getSession = async () => ({ user: { id: 'me-1' }, access_token: 't' });`);
        w.requireAccount = async () => true;
        w.saveDraft = async () => {};
        w.clearDraft = async () => {};
        w.coordsForPost = async () => null;
        const shown = [];
        w.afterViibePublished = async row => { shown.push(row.id); };
        let release;
        const seen = {};
        w.publishViibe = async (payload, opts) => {
            opts.onUploadProgress(0.43);
            seen.pct = d.getElementById('post-progress-pct').textContent;
            seen.bar = d.getElementById('post-progress-fill').style.width;
            opts.onPoster(new w.Blob(['x']));
            seen.thumb = d.querySelector('#post-progress-thumb img')?.getAttribute('src');
            opts.onStatus('Saving…');
            seen.pctAfterStage = d.getElementById('post-progress-pct').textContent;
            await new Promise(r => { release = r; });
            return { success: true, media_id: 'new-1', url: 'u', thumbnail_url: 't' };
        };
        await w.eval(`openCreatePost(null)`);
        expect(d.getElementById('create-post-modal').classList.contains('visible')).toBe(true);
        w.eval(`selectedPostFile = new File(['x'], 'clip.mp4', { type: 'video/mp4' }); recordedDurationSeconds = 5;`);
        const posting = w.eval('submitPost()');
        await tick(); await tick();
        expect(seen.pct).toBe('43%');
        expect(seen.bar).toBe(`${5 + Math.round(0.43 * 80)}%`);
        expect(seen.thumb).toBe('blob:poster');
        expect(seen.pctAfterStage, 'a named stage keeps a stale percentage').toBe('');
        release();
        await posting;
        expect(d.getElementById('post-progress-text').textContent).toBe('Posted!');
        expect(d.getElementById('post-progress-done').hidden).toBe(false);
        expect(d.getElementById('post-progress-fill').style.width).toBe('100%');
        expect(shown, 'the feed waited for the check mark').toEqual(['new-1']);
        expect(d.getElementById('create-post-modal').classList.contains('visible')).toBe(true);
        await tick(w.eval('POSTED_BEAT_MS') + 50);
        expect(d.getElementById('create-post-modal').classList.contains('visible')).toBe(false);
        expect(w.__toasts.at(-1)).toBe('Post published!');
        // Next open starts clean.
        await w.eval(`openCreatePost(null)`);
        expect(d.getElementById('post-progress-done').hidden).toBe(true);
        expect(d.getElementById('post-progress-thumb').innerHTML).toBe('');
    });
});

describe('the clip upload with progress (XHR)', () => {
    beforeEach(boot);

    function fakeXhr({ status = 200, body = '', fail = false, events = [0.25, 0.75] } = {}) {
        const sent = [];
        w.XMLHttpRequest = class {
            constructor() { this.headers = {}; this.upload = {}; sent.push(this); }
            open(method, url) { this.method = method; this.url = url; }
            setRequestHeader(k, v) { this.headers[k] = v; }
            send(form) {
                this.form = form;
                setTimeout(() => {
                    for (const f of events) this.upload.onprogress?.({ lengthComputable: true, loaded: f * 100, total: 100 });
                    if (fail) { this.onerror?.(); return; }
                    this.status = status;
                    this.responseText = body;
                    this.onload?.();
                }, 0);
            }
        };
        return sent;
    }

    it('reports each fraction, then 1, and answers like supabase-js', async () => {
        const sent = fakeXhr();
        const fractions = [];
        w.__f = fractions;
        w.__file = new w.File(['x'], 'clip.mp4', { type: 'video/mp4' });
        const res = await w.eval(`uploadWithProgress('members/me-1/1-clip.mp4', __file, 'tok', f => __f.push(f))`);
        expect(res).toEqual({ error: null });
        expect(fractions).toEqual([0.25, 0.75, 1]);
        const x = sent[0];
        expect(x.method).toBe('POST');
        expect(x.url).toBe('https://vhpmmfhfwnpmavytoomd.supabase.co/storage/v1/object/venue-media/members/me-1/1-clip.mp4');
        expect(x.headers.Authorization).toBe('Bearer tok');
        expect(x.headers['x-upsert']).toBe('false');
        expect(x.headers.apikey).toBeTruthy();
        expect(x.form.get('cacheControl')).toBe('31536000');
    });

    it('a duplicate (the bytes already landed) reads as already uploaded', async () => {
        fakeXhr({ status: 400, body: JSON.stringify({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }) });
        w.__file = new w.File(['x'], 'clip.mp4');
        const res = await w.eval(`uploadWithProgress('p.mp4', __file, 'tok', () => {})`);
        w.__err = res.error;
        expect(w.eval('isAlreadyUploaded(__err)')).toBe(true);
    });

    it('a network failure has no status, so it is retried; a 403 is not', async () => {
        fakeXhr({ fail: true });
        w.__file = new w.File(['x'], 'clip.mp4');
        w.__err = (await w.eval(`uploadWithProgress('p.mp4', __file, 'tok', () => {})`)).error;
        expect(w.eval('isRetriableUploadError(__err)')).toBe(true);
        fakeXhr({ status: 403, body: JSON.stringify({ statusCode: '403', message: 'new row violates row-level security policy' }) });
        w.__err = (await w.eval(`uploadWithProgress('p.mp4', __file, 'tok', () => {})`)).error;
        expect(w.eval('isRetriableUploadError(__err)')).toBe(false);
        expect(w.eval('isAlreadyUploaded(__err)')).toBe(false);
    });

    it('uploadWithRetry takes the XHR path only with onProgress and a session', async () => {
        const sent = fakeXhr();
        w.eval(`SocialAuth.getSession = async () => ({ access_token: 'tok' })`);
        w.__file = new w.File(['x'], 'clip.mp4');
        expect(await w.eval(`uploadWithRetry('p.mp4', __file, () => {}, () => {})`)).toEqual({ ok: true });
        expect(sent.length).toBe(1);
        expect(await w.eval(`uploadWithRetry('p.mp4', __file, () => {})`)).toEqual({ ok: true });
        expect(sent.length, 'no onProgress went through XHR').toBe(1);
    });
});

// ===========================================================================
// The location switcher
// ===========================================================================

describe('the location switcher', () => {
    beforeEach(boot);
    const input = () => d.getElementById('edit-profile-location');
    const list = () => d.getElementById('edit-profile-location-results');
    const type = (value) => {
        input().value = value;
        input().dispatchEvent(new w.Event('input', { bubbles: true }));
    };

    it('typing suggests cities, "City, Country", once each', async () => {
        const calls = [];
        w.VenuePlaces.searchCities = async (q, opts) => {
            calls.push([q, opts]);
            return [{ city: 'Austin', country: 'United States' }, { city: 'Austin', country: 'United States' }, { city: 'Austinville', country: 'United States' }];
        };
        type('Aus');
        await tick(w.eval('LOCATION_SEARCH_DEBOUNCE_MS') + 20);
        expect(calls.map(c => c[0])).toEqual(['Aus']);
        expect([...list().querySelectorAll('.location-result')].map(li => li.dataset.value))
            .toEqual(['Austin, United States', 'Austinville, United States']);
        expect(list().hidden).toBe(false);
        expect(input().getAttribute('aria-expanded')).toBe('true');
    });

    it('fewer than 2 letters: no search, no list', async () => {
        let calls = 0;
        w.VenuePlaces.searchCities = async () => { calls++; return []; };
        type('A');
        await tick(w.eval('LOCATION_SEARCH_DEBOUNCE_MS') + 20);
        expect(calls).toBe(0);
        expect(list().hidden).toBe(true);
    });

    it('typing fast searches once, for the last text; a late answer for old text is dropped', async () => {
        const calls = [];
        let resolveFirst;
        w.VenuePlaces.searchCities = (q) => {
            calls.push(q);
            if (calls.length === 1) return new Promise(r => { resolveFirst = () => r([{ city: 'Stale', country: 'X' }]); });
            return Promise.resolve([{ city: 'Paris', country: 'France' }]);
        };
        type('Pa'); type('Par'); type('Pari');
        await tick(w.eval('LOCATION_SEARCH_DEBOUNCE_MS') + 20);
        expect(calls).toEqual(['Pari']);
        type('Paris');
        await tick(w.eval('LOCATION_SEARCH_DEBOUNCE_MS') + 20);
        resolveFirst();
        await tick();
        expect([...list().querySelectorAll('.location-result')].map(li => li.dataset.value)).toEqual(['Paris, France']);
    });

    it("Nominatim's whole-word answers are kept only when they contain what was typed", async () => {
        // Measured 2026-10-27: "Los Ang" returns "Ang, Ecuador" and "Los, Spain".
        w.VenuePlaces.searchCities = async () => [{ city: 'Ang', country: 'Ecuador' }, { city: 'Los', country: 'España' }];
        type('Los Ang');
        await tick(w.eval('LOCATION_SEARCH_DEBOUNCE_MS') + 20);
        expect(list().hidden).toBe(true);
        expect(d.getElementById('edit-profile-location-status').hidden).toBe(false);
        const m = (city, q) => w.eval(`cityMatchesQuery(${JSON.stringify({ city })}, ${JSON.stringify(q)})`);
        expect(m('Perpignan', 'perpig')).toBe(true);
        expect(m('Évry', 'evry')).toBe(true);           // accents folded
        expect(m('Paris', 'Paris, France')).toBe(true);   // typed in full
        expect(m('Ang', 'Los Ang')).toBe(false);
        expect(m('Los', 'Los Ang')).toBe(false);
        expect(m('', 'x')).toBe(false);
    });

    it('a pick fills the field and closes the list — on click, not on mousedown', async () => {
        w.VenuePlaces.searchCities = async () => [{ city: 'Lyon', country: 'France' }];
        type('Ly');
        await tick(w.eval('LOCATION_SEARCH_DEBOUNCE_MS') + 20);
        const item = list().querySelector('.location-result');
        const down = new w.MouseEvent('mousedown', { bubbles: true, cancelable: true });
        item.dispatchEvent(down);
        expect(down.defaultPrevented, 'the field would lose focus (and the keyboard)').toBe(true);
        expect(list().hidden, 'picked on mousedown').toBe(false);
        item.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
        expect(input().value).toBe('Lyon, France');
        expect(list().hidden).toBe(true);
    });

    it('nothing found says so, and keeps what was typed', async () => {
        w.VenuePlaces.searchCities = async () => [];
        type('Zzzz');
        await tick(w.eval('LOCATION_SEARCH_DEBOUNCE_MS') + 20);
        expect(d.getElementById('edit-profile-location-status').textContent).toContain('Keep typing the full city name');
        expect(input().value).toBe('Zzzz');
    });

    it('Escape closes the list, not the sheet', async () => {
        w.eval(`document.getElementById('edit-profile-sheet').classList.add('visible')`);
        w.VenuePlaces.searchCities = async () => [{ city: 'Lyon', country: 'France' }];
        type('Ly');
        await tick(w.eval('LOCATION_SEARCH_DEBOUNCE_MS') + 20);
        input().dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        expect(list().hidden).toBe(true);
        expect(d.getElementById('edit-profile-sheet').classList.contains('visible')).toBe(true);
    });

    it('Use my current location: the city the phone is in', async () => {
        w.getCurrentCoords = async () => ({ lat: 34.09, lng: -118.36 });
        const asked = [];
        w.VenuePlaces.reverseCity = async (lat, lng) => { asked.push([lat, lng]); return { city: 'West Hollywood', country: 'United States' }; };
        d.getElementById('edit-profile-use-location').click();
        await tick(); await tick();
        expect(asked).toEqual([[34.09, -118.36]]);
        expect(input().value).toBe('West Hollywood, United States');
        expect(d.getElementById('edit-profile-use-location').disabled).toBe(false);
    });

    it('no fix, or no city: it says why and changes nothing', async () => {
        input().value = 'Old Town, Spain';
        w.getCurrentCoords = async () => null;
        w.eval('lastLocationError = 1');
        await w.eval('useCurrentLocation()');
        expect(d.getElementById('edit-profile-location-status').textContent).toContain('Location is blocked');
        w.getCurrentCoords = async () => ({ lat: 0, lng: 0 });
        w.VenuePlaces.reverseCity = async () => null;
        await w.eval('useCurrentLocation()');
        expect(d.getElementById('edit-profile-location-status').textContent).toContain('could not tell which city');
        expect(input().value).toBe('Old Town, Spain');
    });

    it('cityLabel: "City, Country", at most 80 characters', () => {
        expect(w.eval(`cityLabel({ city: 'Lyon', country: 'France' })`)).toBe('Lyon, France');
        expect(w.eval(`cityLabel({ city: 'Lyon', country: null })`)).toBe('Lyon');
        expect(w.eval(`cityLabel({ city: '${'x'.repeat(100)}', country: 'Y' })`).length).toBe(80);
        expect(w.eval(`cityLabel(null)`)).toBe('');
    });

    it('the save is unchanged, and opening the sheet clears old suggestions', () => {
        expect(input().getAttribute('maxlength')).toBe('80');
        expect(fnBody('async function openEditProfile()')).toContain('resetLocationSwitcher();');
        expect(js).toContain("const location = document.getElementById('edit-profile-location')?.value || '';");
    });
});

describe('VenuePlaces: cities and the reverse lookup', () => {
    beforeEach(boot);

    it('searchCities asks for settlements only, and maps the answer', async () => {
        const urls = [];
        w.fetch = async (url) => { urls.push(url); return { json: async () => [
            { name: 'Austin', lat: '30.27', lon: '-97.74', address: { city: 'Austin', state: 'Texas', country: 'United States', country_code: 'us' } },
            { name: 'Nowhere', lat: 'x', lon: 'y', address: {} },
        ] }; };
        const out = await w.VenuePlaces.searchCities('Austin', { near: { lat: 30, lng: -97 } });
        expect(urls[0]).toContain('featuretype=settlement');
        expect(urls[0]).toContain('q=Austin');
        expect(urls[0]).toContain('bounded=0');
        expect(out[0]).toMatchObject({ city: 'Austin', state: 'Texas', country: 'United States', country_code: 'US' });
    });

    it('reverseCity asks at city level', async () => {
        const urls = [];
        w.fetch = async (url) => { urls.push(url); return { json: async () => ({ address: { town: 'Perpignan', state: 'Occitanie', country: 'France' } }) }; };
        const out = await w.VenuePlaces.reverseCity(42.6886, 2.8948);
        expect(urls[0]).toMatch(/^https:\/\/nominatim\.openstreetmap\.org\/reverse\?lat=42\.68860&lon=2\.89480&format=json&zoom=10/);
        expect(out).toEqual({ city: 'Perpignan', state: 'Occitanie', country: 'France' });
    });

    it("reverseCity: Nominatim's error answer (the sea, say) is no city", async () => {
        w.fetch = async () => ({ json: async () => ({ error: 'Unable to geocode', address: { state: 'Nowhere' } }) });
        expect(await w.VenuePlaces.reverseCity(0, 0)).toBeNull();
    });

    it('both are exported and share the one queue', () => {
        expect(places).toMatch(/searchCities: searchCities,\n\s+reverseCity: reverseCity,/);
        const body = places.slice(places.indexOf('function searchCities('), places.indexOf('function reverseCity('));
        expect(body).toContain('return runQueued(function () {');
        const rev = places.slice(places.indexOf('function reverseCity('), places.indexOf('var OSM_CATEGORY_MAP'));
        expect(rev).toContain('return runQueued(function () {');
        expect(html).toContain('/js/venue-places.js?v=2');
    });
});

describe('translations for the redesigns', () => {
    const KEYS = ['composerTitle', 'composerPost', 'tapToOpenCamera', 'writeCaption', 'retake', 'shareProfileBtn',
        'shareProfile', 'shareProfileOf', 'aViibe', 'copied', 'useMyLocation', 'findingLocation', 'noCitiesFound', 'cityNotFound'];
    for (const lang of ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ar']) {
        it(`${lang}: present, translated, placeholders kept`, () => {
            const soc = JSON.parse(read(`i18n/${lang}.json`)).social;
            const en = JSON.parse(read('i18n/en.json')).social;
            for (const k of KEYS) {
                expect(soc[k], `${lang}.social.${k}`).toBeTruthy();
                for (const ph of (en[k].match(/\{\w+\}/g) || [])) expect(soc[k], `${lang}.${k} lost ${ph}`).toContain(ph);
                if (lang !== 'en' && !['shareProfileOf'].includes(k) && !(k === 'aViibe' && ['es', 'fr', 'it'].includes(lang))) {
                    expect(soc[k], `${lang}.social.${k} is English`).not.toBe(en[k]);
                }
            }
            expect(soc.locationPlaceholder).not.toBe('City, Country');
        });
    }
});
