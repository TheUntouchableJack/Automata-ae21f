/**
 * Guards for Jay's 2026-10-27 ViibeView round, Phase 1 (no database change):
 *
 *   Video fit       each Viibe adapts to its own shape. A portrait clip fills
 *                   its box edge to edge; a switch at its bottom-right shows the
 *                   whole clip, for every Viibe, remembered on the device. Wide
 *                   clips and flyers are always whole, with no switch.
 *   Faster posting  the GPS fix starts when the composer opens; the poster is
 *                   made while the clip uploads; the new Viibe is at the top of
 *                   the feed as soon as create_social_post answers; a fresh
 *                   feed load asked for mid-load is queued, not dropped.
 *   Delete dialog   busy state, the error inside it, translated, focus in and
 *                   back out, one backdrop listener, Escape.
 *   Venue images    the cover and logo open a full-screen viewer.
 *   Post pins       a pin at a venue opens the venue page.
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

function fnBody(signature) {
    const start = js.indexOf(signature);
    if (start < 0) return null;
    const end = js.indexOf('\n}', start);
    return end < 0 ? null : js.slice(start, end);
}

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

function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}

let w, d;

async function boot({ storage = {} } = {}) {
    const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://royaltyapp.ai/a/viibeview/social' });
    w = dom.window;
    d = w.document;
    w.localStorage.setItem('viibeview_onboarded_v1', '1');
    for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.requestAnimationFrame = cb => setTimeout(cb, 0);

    w.__rpcCalls = [];
    w.__rpc = () => ({ data: [], error: null });
    const thenable = { then: (r) => r({ data: null, error: new Error('stubbed') }) };
    const chain = new Proxy(thenable, { get: (t, k) => (k in t ? t[k] : () => chain) });
    w.__uploads = [];
    w.supabase = {
        createClient: () => ({
            auth: { getSession: async () => ({ data: { session: null } }) },
            from: () => chain,
            rpc: (name, args) => { w.__rpcCalls.push({ name, args }); return Promise.resolve(w.__rpc(name, args)); },
            storage: {
                from: () => ({
                    upload: async (p) => { w.__uploads.push(p); return {}; },
                    getPublicUrl: (p) => ({ data: { publicUrl: `https://cdn.test/${p}` } }),
                    remove: async () => ({}),
                }),
            },
        }),
    };
    w.__geo = [];
    Object.defineProperty(w.navigator, 'geolocation', {
        value: { getCurrentPosition: (ok, fail, opts) => w.__geo.push({ ok, fail, opts }) },
        configurable: true,
    });
    const proto = w.HTMLMediaElement.prototype;
    proto.play = function () { return Promise.resolve(); };
    proto.pause = function () {};
    proto.load = function () {};
    // jsdom has no element scrolling; afterViibePublished scrolls the feed up.
    w.HTMLElement.prototype.scrollTo = function () {};

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
    await tick();
    w.eval("currentApp = { id: 'app-1', name: 'ViibeView', organization_id: 'org-1' }; appSlug = 'viibeview';");
    w.__toasts = [];
    w.showToast = m => w.__toasts.push(m);
}

const vid = (id, over = {}) => ({
    id, media_type: 'video', url: `https://cdn.test/${id}.mp4`, thumbnail_url: `https://cdn.test/${id}.jpg`,
    venue_id: null, uploaded_by_user_id: 'author-1', ...over,
});
const flyer = (id, over = {}) => ({ ...vid(id, over), media_type: 'image', url: `https://cdn.test/${id}.png`, thumbnail_url: null });

/** Renders rows into the feed and gives every .feed-media a real box size. */
function renderFeedWith(rows, box = { w: 390, h: 500 }) {
    w.eval(`feedItems = ${JSON.stringify(rows)}; renderFeed();`);
    const medias = d.querySelectorAll('#feed-container .feed-media');
    medias.forEach(m => sizeBox(m, box));
    return medias;
}

function sizeBox(media, { w: width, h: height }) {
    Object.defineProperty(media, 'clientWidth', { value: width, configurable: true });
    Object.defineProperty(media, 'clientHeight', { value: height, configurable: true });
}

const media = id => d.querySelector(`#feed-container .feed-panel[data-media-id="${id}"] .feed-media`);
const fitBtn = id => media(id)?.querySelector('.feed-panel-fit');

// ===========================================================================
// The fit decision — pure
// ===========================================================================

describe('mediaFitFor: the one decision', () => {
    beforeEach(boot);
    const fitFor = (...args) => w.eval(`mediaFitFor(${args.map(a => JSON.stringify(a)).join(', ')})`);

    it('a flyer is always whole, with no switch, whatever the viewer chose', () => {
        expect(fitFor('image', 0.78, 0.7, 'fill')).toEqual({ fit: 'whole', switchable: false });
        expect(fitFor('image', 0.78, 0.7, 'whole')).toEqual({ fit: 'whole', switchable: false });
    });

    it('a wide or square clip is always whole, with no switch', () => {
        expect(fitFor('wide', 0.78, 16 / 9, 'fill')).toEqual({ fit: 'whole', switchable: false });
        expect(fitFor('wide', 0.78, 1, 'fill')).toEqual({ fit: 'whole', switchable: false });
    });

    it('a 9:16 clip in a 0.78 box FILLS by default and has the switch', () => {
        expect(fitFor('portrait', 0.78, 9 / 16, 'fill')).toEqual({ fit: 'fill', switchable: true });
    });

    it("the viewer's 'whole' shows it whole, switch still there", () => {
        expect(fitFor('portrait', 0.78, 9 / 16, 'whole')).toEqual({ fit: 'whole', switchable: true });
    });

    it('anything but "whole" reads as fill', () => {
        expect(fitFor('portrait', 0.78, 9 / 16, null).fit).toBe('fill');
        expect(fitFor('portrait', 0.78, 9 / 16, 'bogus').fit).toBe('fill');
    });

    it('until the box or the clip is known: follow the preference, keep the switch', () => {
        expect(fitFor('portrait', null, null, 'fill')).toEqual({ fit: 'fill', switchable: true });
        expect(fitFor('portrait', null, 9 / 16, 'whole')).toEqual({ fit: 'whole', switchable: true });
        expect(fitFor('portrait', 0.78, null, 'whole')).toEqual({ fit: 'whole', switchable: true });
    });

    it('filling would cut less than 4%: fill, no switch (and the edge, either side)', () => {
        // 9:16 = 0.5625. Box 0.58 cuts 3.0%; box 0.59 cuts 4.7%.
        expect(fitFor('portrait', 0.58, 0.5625, 'whole')).toEqual({ fit: 'fill', switchable: false });
        expect(fitFor('portrait', 0.59, 0.5625, 'whole')).toEqual({ fit: 'whole', switchable: true });
        expect(w.eval('FIT_SWITCH_MIN_CUT')).toBe(0.04);
    });

    it('a box TALLER than the clip cuts the sides, and still offers the switch', () => {
        // 0.46 box (a tall phone with the header hidden), 9:16 clip: 18% off.
        expect(fitFor('portrait', 0.46, 0.5625, 'fill')).toEqual({ fit: 'fill', switchable: true });
    });

    it('the shape: under 0.9 is portrait (9:16, 3:4, 4:5); square and wider are not', () => {
        const shape = r => w.eval(`mediaShapeFor(${r})`);
        expect(shape(0.5625)).toBe('portrait');
        expect(shape(0.75)).toBe('portrait');
        expect(shape(0.8)).toBe('portrait');
        expect(shape(1)).toBe('wide');
        expect(shape(16 / 9)).toBe('wide');
        expect(shape(0)).toBe('wide');
        expect(shape(NaN)).toBe('wide');
    });
});

// ===========================================================================
// The markup and the switch
// ===========================================================================

describe('the feed panel: drawn with the fit, a switch, a backdrop', () => {
    beforeEach(boot);

    it('a video renders portrait + fill, with the switch and its backdrop AFTER the video', () => {
        renderFeedWith([vid('a')]);
        // renderFeed() ends with refreshSoundButtons(), which repaints every
        // .video-sound-btn: the switch must not be one, or it turns into a
        // second speaker.
        expect(fitBtn('a').classList.contains('video-sound-btn')).toBe(false);
        expect(fitBtn('a').innerHTML).toContain('polyline');
        const m = media('a');
        expect(m.dataset.shape).toBe('portrait');
        expect(m.dataset.fit).toBe('fill');
        expect(fitBtn('a')).toBeTruthy();
        expect(fitBtn('a').getAttribute('aria-label')).toBe('Show the whole video');
        const backdrop = m.querySelector('.feed-media-backdrop');
        expect(backdrop.getAttribute('src')).toBe('https://cdn.test/a.jpg');
        expect(backdrop.getAttribute('aria-hidden')).toBe('true');
        // querySelector('video, img') must find the Viibe, not its backdrop.
        expect(m.querySelector('video, img').tagName).toBe('VIDEO');
    });

    it('a flyer renders image + whole, with NO switch; its backdrop is the flyer', () => {
        renderFeedWith([flyer('f')]);
        const m = media('f');
        expect(m.dataset.shape).toBe('image');
        expect(m.dataset.fit).toBe('whole');
        expect(m.querySelector('.feed-panel-fit')).toBeNull();
        expect(m.querySelector('.feed-media-backdrop').getAttribute('src')).toBe('https://cdn.test/f.png');
        expect(m.querySelector('video, img').classList.contains('feed-media-backdrop')).toBe(false);
    });

    it('no poster: no backdrop (and no empty src)', () => {
        renderFeedWith([vid('n', { thumbnail_url: null })]);
        expect(media('n').querySelector('.feed-media-backdrop')).toBeNull();
    });

    it('a clip confirmed WIDE goes whole and its switch hides', () => {
        renderFeedWith([vid('a')]);
        w.eval(`setMediaClip(document.querySelector('.feed-media'), 1920, 1080, true)`);
        expect(media('a').dataset.shape).toBe('wide');
        expect(media('a').dataset.fit).toBe('whole');
        expect(fitBtn('a').hidden).toBe(true);
    });

    it('a 9:16 clip in a 390×500 box fills, switch shown', () => {
        renderFeedWith([vid('a')]);
        w.eval(`setMediaClip(document.querySelector('.feed-media'), 1080, 1920, true)`);
        expect(media('a').dataset.fit).toBe('fill');
        expect(fitBtn('a').hidden).toBe(false);
    });

    it('a 9:16 clip in a box that cuts under 4% hides the switch', () => {
        renderFeedWith([vid('a')], { w: 390, h: 680 });   // 0.5735: cuts 1.9%
        w.eval(`setMediaClip(document.querySelector('.feed-media'), 1080, 1920, true)`);
        expect(fitBtn('a').hidden).toBe(true);
    });

    it("the video's own size wins over its poster's", () => {
        renderFeedWith([vid('a')]);
        const set = (wd, ht, fromVideo) =>
            w.eval(`setMediaClip(document.querySelector('.feed-media'), ${wd}, ${ht}, ${fromVideo})`);
        set(1080, 1920, true);
        set(1920, 1080, false);   // a poster arriving late must not overrule it
        expect(media('a').dataset.shape).toBe('portrait');
        expect(media('a').dataset.clipFrom).toBe('video');
    });

    it('loadedmetadata (which does not bubble) is caught for any video, rendered any time', () => {
        renderFeedWith([vid('a')]);
        const video = media('a').querySelector('video');
        Object.defineProperty(video, 'videoWidth', { value: 1920, configurable: true });
        Object.defineProperty(video, 'videoHeight', { value: 1080, configurable: true });
        video.dispatchEvent(new w.Event('loadedmetadata'));
        expect(media('a').dataset.shape).toBe('wide');
        expect(media('a').dataset.fit).toBe('whole');
    });

    it("the poster's size is read first, from the same URL", () => {
        const probes = [];
        w.Image = class {
            constructor() { probes.push(this); this.naturalWidth = 1080; this.naturalHeight = 1920; }
            set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
            get src() { return this._src; }
        };
        renderFeedWith([vid('a')]);
        expect(probes.map(p => p.src)).toEqual(['https://cdn.test/a.jpg']);
        return tick(5).then(() => {
            expect(media('a').dataset.clipFrom).toBe('poster');
            expect(media('a').dataset.clip).toBe((1080 / 1920).toFixed(4));
        });
    });

    it('the switch flips EVERY portrait Viibe, leaves wide ones whole, and remembers', () => {
        renderFeedWith([vid('a'), vid('b'), vid('c')]);
        w.eval(`setMediaClip(document.querySelectorAll('.feed-media')[2], 1920, 1080, true)`);
        const ev = { stopped: false, stopPropagation() { this.stopped = true; } };
        w.__ev = ev;
        w.eval(`toggleMediaFit(__ev, document.querySelector('.feed-panel-fit'))`);
        expect(ev.stopped, 'the tap would pause the video').toBe(true);
        expect(media('a').dataset.fit).toBe('whole');
        expect(media('b').dataset.fit).toBe('whole');
        expect(media('c').dataset.fit).toBe('whole');
        expect(fitBtn('a').getAttribute('aria-label')).toBe('Fill the screen');
        expect(w.localStorage.getItem('viibeview_fit_v1')).toBe('whole');
        // ...and back.
        w.eval(`toggleMediaFit(__ev, document.querySelector('.feed-panel-fit'))`);
        expect(media('a').dataset.fit).toBe('fill');
        expect(media('c').dataset.fit, 'a wide clip was filled').toBe('whole');
        expect(w.localStorage.getItem('viibeview_fit_v1')).toBe('fill');
    });

    it('the choice survives a reload: a saved "whole" draws whole from the first paint', async () => {
        await boot({ storage: { viibeview_fit_v1: 'whole' } });
        w.eval('loadFitPreference()');
        // The MARKUP, before applyMediaFit() ever runs: that is the first
        // paint, and a wrong value there is a visible jump on every load.
        w.__row = vid('a');
        expect(w.eval('renderFeedCard(__row)')).toContain('data-fit="whole"');
        w.__flyer = flyer('f');
        expect(w.eval('renderFeedCard(__flyer)')).toContain('data-shape="image" data-fit="whole"');
        renderFeedWith([vid('a')]);
        expect(media('a').dataset.fit).toBe('whole');
    });

    it('init() loads the preference, next to the sound one', () => {
        const init = js.slice(js.indexOf('loadSoundPreference();\n'), js.indexOf('loadSoundPreference();\n') + 80);
        expect(init).toContain('loadFitPreference();');
    });

    it('the player gets the same treatment, and drops its observer on close', () => {
        expect(fnCode('function renderViibeViewer(startIndex)')).toContain('setupMediaFit(scroller);');
        expect(fnCode('function renderFeed()')).toContain('setupMediaFit(container);');
        expect(fnCode('function closeViibeViewer()')).toContain('viewerFitObserver.disconnect();');
    });
});

describe('the fit CSS', () => {
    it('fill = cover for a video only; whole = contain over a blurred backdrop', () => {
        expect(declared('.feed-panel .feed-media[data-fit="fill"] video', 'object-fit')).toEqual(['cover']);
        expect(declared('.feed-panel .feed-media video', 'object-fit')).toEqual(['contain']);
        expect(declared('.feed-panel .feed-media .feed-media-backdrop', 'display')).toEqual(['none']);
        expect(declared('.feed-panel .feed-media[data-fit="whole"] .feed-media-backdrop', 'display')).toEqual(['block']);
        expect(declared('.feed-panel .feed-media .feed-media-backdrop', 'filter')[0]).toMatch(/blur\(/);
        // Under the Viibe.
        expect(declared('.feed-panel .feed-media .feed-media-backdrop', 'z-index')).toEqual(['0']);
        expect(declared('.feed-panel .feed-media video', 'z-index')).toEqual(['1']);
        // The blur stays inside the box.
        expect(declared('.feed-panel .feed-media', 'overflow')).toEqual(['hidden']);
    });

    it('the switch sits ABOVE the sound toggle, and [hidden] really hides it', () => {
        expect(declared('.feed-panel .feed-panel-fit', 'bottom')[0]).toContain('34px');
        expect(declared('.feed-panel .feed-panel-fit', 'z-index')).toEqual(['2']);
        expect(declared('.feed-panel .feed-panel-fit[hidden]', 'display')).toEqual(['none']);
    });
});

// ===========================================================================
// Faster posting
// ===========================================================================

describe('the feed load queue', () => {
    beforeEach(boot);

    it('a fresh load asked for mid-load is QUEUED: the stale answer is dropped, the new one drawn', async () => {
        const first = deferred();
        const second = deferred();
        const answers = [first, second];
        w.__rpc = (name) => name === 'get_venue_feed_v3' ? answers.shift().promise : { data: [], error: null };
        const running = w.eval('loadFeed(false)');
        await tick();
        await w.eval('loadFeed(false)');   // returns at once
        expect(w.eval('feedReloadQueued')).toBe(true);
        first.resolve({ data: [vid('stale')], error: null });
        await running;
        await tick();
        expect(w.__rpcCalls.filter(c => c.name === 'get_venue_feed_v3').length).toBe(2);
        expect(w.eval('feedItems.map(i => i.id)'), 'the stale answer was drawn').toEqual([]);
        second.resolve({ data: [vid('fresh')], error: null });
        await tick(); await tick();
        expect(w.eval('feedItems.map(i => i.id)')).toEqual(['fresh']);
        expect(w.eval('feedReloadQueued')).toBe(false);
    });

    it('a page (append) asked for mid-load is still just skipped', async () => {
        const first = deferred();
        w.__rpc = (name) => name === 'get_venue_feed_v3' ? first.promise : { data: [], error: null };
        const running = w.eval('loadFeed(false)');
        await tick();
        await w.eval('loadFeed(true)');
        expect(w.eval('feedReloadQueued')).toBe(false);
        first.resolve({ data: [vid('a')], error: null });
        await running;
        expect(w.__rpcCalls.filter(c => c.name === 'get_venue_feed_v3').length).toBe(1);
    });
});

describe('the GPS fix: started with the composer, waited on for 1.5 s at most', () => {
    beforeEach(boot);
    const HERE = { lat: 34.05, lng: -118.25 };
    const cached = () => w.eval(`userLocation = ${JSON.stringify(HERE)}; userLocationAt = Date.now();`);

    it('openCreatePost starts it; submitPost no longer awaits a fresh fix of its own', () => {
        expect(fnCode('async function openCreatePost(venueId)')).toContain('startComposerFix();');
        const submit = fnCode('async function submitPost()');
        expect(submit).toContain('const coords = await coordsForPost();');
        expect(submit).not.toContain('await getPostCoords()');
        expect(w.eval('POST_FIX_GRACE_MS')).toBe(1500);
    });

    it('the fix the composer started is the one Post uses, when it arrives in time', async () => {
        cached();
        w.eval('startComposerFix()');
        expect(w.__geo.length).toBe(1);
        expect(w.__geo[0].opts.enableHighAccuracy).toBe(true);
        const coords = w.eval('coordsForPost(1000)');
        expect(w.__geo.length, 'Post asked for a second fix').toBe(1);
        w.__geo[0].ok({ coords: { latitude: 40.7, longitude: -74, accuracy: 5 } });
        expect((await coords).lat).toBeCloseTo(40.7);
    });

    it('a fix still on its way after the grace: the cached fix, without waiting longer', async () => {
        cached();
        w.eval('startComposerFix()');
        const started = Date.now();
        const coords = await w.eval('coordsForPost(40)');
        expect(Date.now() - started).toBeLessThan(1000);
        expect(coords).toEqual(HERE);
    });

    it('no fix ever, and none coming: null, quickly', async () => {
        const coords = await w.eval('coordsForPost(20)');
        expect(coords).toBeNull();
    });

    it('a composer fix over 2 minutes old is not used: a new one is asked for', async () => {
        cached();
        w.eval('startComposerFix(); composerFix.startedAt = Date.now() - 3 * 60 * 1000;');
        const coords = w.eval('coordsForPost(20)');
        expect(w.__geo.length).toBe(2);
        expect(await coords).toEqual(HERE);
        expect(w.eval('composerFix'), 'the fix is used once').toBeNull();
    });
});

describe('publishing: the poster while the clip uploads, the Viibe on screen at once', () => {
    beforeEach(async () => {
        await boot();
        w.eval(`SocialAuth.getSession = async () => ({ user: { id: 'me-1' }, access_token: 't' });`);
    });

    const payload = { appId: 'app-1', path: 'members/me-1/1-clip.mp4', file: { size: 10, name: 'clip.mp4' },
        caption: null, venueId: null, durationSeconds: 9, latitude: 1, longitude: 2, savedAt: 1 };

    it('the poster is being made while the clip is still uploading', async () => {
        const upload = deferred();
        let thumbCalls = 0;
        w.generateThumbnail = async () => { thumbCalls++; return new w.Blob(['x']); };
        w.uploadWithRetry = () => upload.promise;
        w.__rpc = (name) => name === 'create_social_post'
            ? { data: [{ success: true, media_id: 'new-1', error_message: null }], error: null } : { data: [], error: null };
        w.__payload = payload;
        const times = {};
        w.__times = times;
        const done = w.eval('publishViibe(__payload, { timings: __times })');
        await tick(); await tick();
        expect(thumbCalls, 'the poster waited for the upload').toBe(1);
        upload.resolve({ ok: true });
        const out = await done;
        expect(out.media_id).toBe('new-1');
        expect(out.url).toBe('https://cdn.test/members/me-1/1-clip.mp4');
        expect(out.thumbnail_url).toBe('https://cdn.test/members/me-1/1-clip-thumb.jpg');
        expect(w.__rpcCalls.find(c => c.name === 'create_social_post').args.p_thumbnail_url)
            .toBe('https://cdn.test/members/me-1/1-clip-thumb.jpg');
        for (const k of ['upload', 'poster', 'save']) expect(typeof times[k], k).toBe('number');
    });

    it('the poster reaches the progress card as soon as it is made (onPoster)', async () => {
        const blob = new w.Blob(['jpeg']);
        w.generateThumbnail = async () => blob;
        w.uploadWithRetry = async () => ({ ok: true });
        w.__rpc = (name) => name === 'create_social_post'
            ? { data: [{ success: true, media_id: 'new-1', error_message: null }], error: null } : { data: [], error: null };
        w.__payload = payload;
        const seen = [];
        w.__onPoster = b => seen.push(b);
        await w.eval('publishViibe(__payload, { onPoster: __onPoster })');
        expect(seen).toEqual([blob]);
    });

    it('a failed poster never fails the post', async () => {
        w.generateThumbnail = async () => { throw new Error('decode'); };
        w.uploadWithRetry = async () => ({ ok: true });
        w.__rpc = (name) => name === 'create_social_post'
            ? { data: [{ success: true, media_id: 'new-1', error_message: null }], error: null } : { data: [], error: null };
        w.__payload = payload;
        const out = await w.eval('publishViibe(__payload, {})');
        expect(out.thumbnail_url).toBeNull();
    });

    it('the new row has every column get_venue_feed_v3 returns', () => {
        const sql = read('supabase/migrations/20261014000003_get_social_post.sql');
        const table = sql.slice(sql.indexOf('RETURNS TABLE ('), sql.indexOf(')\nLANGUAGE'));
        const cols = [...table.matchAll(/^\s+([a-z_]+) [A-Z]/gm)].map(m => m[1]);
        expect(cols.length).toBeGreaterThan(20);
        w.__payload = payload;
        const row = w.eval(`newViibeRow(__payload, { media_id: 'new-1', url: 'u', thumbnail_url: 't' }, 'me-1')`);
        const missing = cols.filter(c => !(c in row) && !['author_first_name', 'author_last_name'].includes(c));
        expect(missing).toEqual([]);
        expect(row.id).toBe('new-1');
        expect(row.uploaded_by_user_id).toBe('me-1');
    });

    it('the new Viibe is at the top of the feed BEFORE the reload answers', async () => {
        const reload = deferred();
        w.__rpc = (name) => name === 'get_venue_feed_v3' ? reload.promise : { data: [], error: null };
        w.eval(`feedItems = ${JSON.stringify([vid('old')])}; renderFeed();`);
        w.eval(`afterViibePublished(${JSON.stringify(vid('new-1', { uploaded_by_user_id: 'me-1' }))})`);
        expect(w.eval('feedItems.map(i => i.id)')).toEqual(['new-1', 'old']);
        expect(d.querySelector('#feed-container .feed-panel').dataset.mediaId).toBe('new-1');
        reload.resolve({ data: [vid('new-1'), vid('old')], error: null });
        await tick(); await tick();
        expect(w.eval('feedItems.map(i => i.id)')).toEqual(['new-1', 'old']);
    });

    it('the Following feed and a category it is not in do not get it', () => {
        w.__rpc = () => new Promise(() => {});
        w.eval(`feedMode = 'following'; feedItems = []; afterViibePublished(${JSON.stringify(vid('x'))});`);
        expect(w.eval('feedItems.length')).toBe(0);
        w.eval(`feedLoading = false; feedMode = 'all'; activeCategory = 'bar';
                afterViibePublished(${JSON.stringify(vid('y'))});`);
        expect(w.eval('feedItems.length'), 'a no-venue post shows under All only').toBe(0);
    });

    it('no sleeps between "posted" and the feed', () => {
        expect(fnCode('async function afterViibePublished(newRow = null)')).not.toContain('setTimeout');
        const submit = fnCode('async function submitPost()');
        // The feed is updated BEFORE the only timer, which closes the composer
        // after its check mark (Phase 2) and waits on nothing.
        const feedAt = submit.indexOf('afterViibePublished(newViibeRow(payload, published, userId))');
        expect(feedAt).toBeGreaterThan(-1);
        expect(submit.split('setTimeout(').length - 1).toBe(1);
        expect(submit.indexOf('setTimeout(')).toBeGreaterThan(feedAt);
        expect(submit).toMatch(/setTimeout\(\(\) => \{\n\s+closeCreatePost\(\);/);
        expect(w.eval('POSTED_BEAT_MS')).toBeLessThanOrEqual(500);
        expect(submit).toContain("console.info(`[viibe post] gps");
        // A refresh that fails AFTER the post landed is not an upload failure.
        expect(submit).toContain("shown.catch(err => console.warn(");
        expect(submit).not.toContain('await shown');
    });
});

// ===========================================================================
// The delete dialog
// ===========================================================================

describe('the delete dialog', () => {
    beforeEach(boot);
    const dialog = () => d.getElementById('confirm-dialog');
    const accept = () => d.getElementById('confirm-accept');
    const cancel = () => d.getElementById('confirm-cancel');

    function open(onAccept, extra = '') {
        w.__onAccept = onAccept;
        w.eval(`showConfirm({ title: 'T', body: 'B', acceptLabel: 'Delete', busyLabel: 'Deleting…', onAccept: () => __onAccept() ${extra} })`);
    }

    it('busy: it stays open, says "Deleting…", and nothing closes it until the answer', async () => {
        const answer = deferred();
        open(() => answer.promise);
        accept().click();
        await tick();
        expect(dialog().classList.contains('visible')).toBe(true);
        expect(accept().textContent).toBe('Deleting…');
        expect(accept().disabled).toBe(true);
        expect(cancel().disabled).toBe(true);
        expect(dialog().getAttribute('aria-busy')).toBe('true');
        // Cancel, the backdrop and Escape all wait.
        cancel().click();
        d.getElementById('confirm-backdrop').click();
        d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(dialog().classList.contains('visible')).toBe(true);
        answer.resolve(null);
        await tick();
        expect(dialog().classList.contains('visible')).toBe(false);
    });

    it('an error is shown INSIDE it, and it can be tried again', async () => {
        open(async () => ({ error: 'You can only delete your own posts' }));
        accept().click();
        await tick(); await tick();
        expect(dialog().classList.contains('visible')).toBe(true);
        const err = d.getElementById('confirm-error');
        expect(err.hidden).toBe(false);
        expect(err.textContent).toBe('You can only delete your own posts');
        expect(accept().disabled).toBe(false);
        expect(accept().textContent).toBe('Delete');
        // Reopening clears it.
        cancel().click();
        open(async () => null);
        expect(d.getElementById('confirm-error').hidden).toBe(true);
    });

    it('focus: Cancel on open, kept inside, back to the ⋮ on close', () => {
        const opener = d.createElement('button');
        d.body.appendChild(opener);
        w.__opener = opener;
        open(async () => null, ', returnFocus: __opener');
        expect(d.activeElement).toBe(cancel());
        // Tab from the last button wraps to the first; Shift+Tab the other way.
        accept().focus();
        accept().dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
        expect(d.activeElement).toBe(cancel());
        cancel().dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
        expect(d.activeElement).toBe(accept());
        cancel().click();
        expect(d.activeElement).toBe(opener);
    });

    it('the backdrop listener is bound ONCE: four opens, one close each', () => {
        // Counted at the source: a shared close() would hide duplicates.
        const backdrop = d.getElementById('confirm-backdrop');
        const realAdd = backdrop.addEventListener.bind(backdrop);
        let clickBinds = 0;
        backdrop.addEventListener = (type, ...rest) => { if (type === 'click') clickBinds++; return realAdd(type, ...rest); };
        let unlocks = 0;
        const real = w.unlockBodyScroll;
        w.unlockBodyScroll = (k) => { if (k === 'confirm') unlocks++; return real(k); };
        for (let i = 0; i < 3; i++) { open(async () => null); cancel().click(); }
        unlocks = 0;
        open(async () => null);
        d.getElementById('confirm-backdrop').click();
        expect(unlocks).toBe(1);
        expect(clickBinds, 'a backdrop listener per open').toBe(1);
        expect(dialog().classList.contains('visible')).toBe(false);
    });

    it('without busyLabel (delete account) it closes first, as before', async () => {
        let ran = false;
        w.__run = () => { ran = true; };
        w.eval(`showConfirm({ title: 'T', body: 'B', acceptLabel: 'Go', onAccept: async () => __run() })`);
        accept().click();
        expect(dialog().classList.contains('visible')).toBe(false);
        await tick();
        expect(ran).toBe(true);
    });

    it('Delete post: translated, busy, and it returns the result to the dialog', () => {
        const body = fnCode('function confirmDeletePost()');
        for (const key of ['social.deletePostTitle', 'social.deletePostBody', 'social.delete', 'social.deleting']) {
            expect(body).toContain(`'${key}'`);
        }
        expect(body).toContain('busyLabel:');
        expect(body).toContain('returnFocus: opener');
        expect(fnCode('async function deletePost(mediaId)')).toContain("translateOr('social.postDeleted'");
    });

    it('a closed dialog is out of the Tab order', () => {
        expect(declared('.confirm-dialog', 'visibility')).toEqual(['hidden']);
        expect(declared('.confirm-dialog.visible', 'visibility')).toEqual(['visible']);
        expect(dialog().getAttribute('tabindex')).toBe('-1');
    });
});

describe('Escape closes the top-most surface, through the Back table', () => {
    beforeEach(boot);

    it('the confirm dialog over the post options: Escape closes the dialog first', () => {
        w.eval(`feedItems = ${JSON.stringify([vid('a', { uploaded_by_user_id: 'me' })])}; currentUserId = 'me'; showPostOptions('a');`);
        w.eval(`showConfirm({ title: 'T', body: 'B', acceptLabel: 'X', onAccept: async () => {} })`);
        const esc = () => d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        esc();
        expect(d.getElementById('confirm-dialog').classList.contains('visible')).toBe(false);
        expect(d.getElementById('post-options-sheet').classList.contains('visible')).toBe(true);
        esc();
        expect(d.getElementById('post-options-sheet').classList.contains('visible')).toBe(false);
    });

    it('a key a handler already used (preventDefault) is left alone', () => {
        w.eval(`showPostOptions('a')`);
        const ev = new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        ev.preventDefault();
        d.dispatchEvent(ev);
        expect(d.getElementById('post-options-sheet').classList.contains('visible')).toBe(true);
    });

    it('other keys do nothing', () => {
        w.eval(`showPostOptions('a')`);
        d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(d.getElementById('post-options-sheet').classList.contains('visible')).toBe(true);
    });
});

// ===========================================================================
// Venue images
// ===========================================================================

describe('expanding venue images', () => {
    beforeEach(boot);
    const viewer = () => d.getElementById('image-viewer');
    const both = { id: 'v1', name: 'Laurel', cover_image_url: 'https://cdn.test/cover.jpg', profile_image_url: 'https://cdn.test/logo.jpg' };

    it('the cover and the logo are tappable on the venue page', () => {
        expect(js).toContain(`onclick="openVenueImage('cover')"`);
        expect(js).toContain(`onclick="openVenueImage('logo')"`);
        expect(rulesFor('.venue-page-image-tap').join('')).toContain('zoom-in');
    });

    it('opens on the tapped photo, whole, with arrows and a count when there are two', () => {
        w.eval(`venuePageVenue = ${JSON.stringify(both)}; openVenueImage('logo');`);
        expect(viewer().classList.contains('visible')).toBe(true);
        expect(d.getElementById('image-viewer-img').getAttribute('src')).toBe('https://cdn.test/logo.jpg');
        expect(d.getElementById('image-viewer-next').hidden).toBe(false);
        expect(d.getElementById('image-viewer-count').textContent).toBe('2 / 2');
        d.getElementById('image-viewer-next').click();
        expect(d.getElementById('image-viewer-img').getAttribute('src')).toBe('https://cdn.test/cover.jpg');
        viewer().dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        expect(d.getElementById('image-viewer-img').getAttribute('src')).toBe('https://cdn.test/logo.jpg');
    });

    it('a swipe moves between them, the right way round', () => {
        // Three photos: with two, a swipe either way lands on the same one,
        // and a reversed swipe would pass.
        w.eval(`openImageViewer([{ url: 'https://cdn.test/1.jpg' }, { url: 'https://cdn.test/2.jpg' }, { url: 'https://cdn.test/3.jpg' }], 0);`);
        const touch = (type, x) => {
            const ev = new w.Event(type, { bubbles: true });
            ev.touches = type === 'touchstart' ? [{ clientX: x }] : [];
            ev.changedTouches = [{ clientX: x }];
            viewer().dispatchEvent(ev);
        };
        // Finger moves LEFT: the next photo.
        touch('touchstart', 300);
        touch('touchend', 200);
        expect(d.getElementById('image-viewer-img').getAttribute('src')).toBe('https://cdn.test/2.jpg');
        // RIGHT: back.
        touch('touchstart', 100);
        touch('touchend', 250);
        expect(d.getElementById('image-viewer-img').getAttribute('src')).toBe('https://cdn.test/1.jpg');
        // A small move is a tap, not a swipe.
        touch('touchstart', 100);
        touch('touchend', 120);
        expect(d.getElementById('image-viewer-img').getAttribute('src')).toBe('https://cdn.test/1.jpg');
    });

    it('one photo: no arrows, no count', () => {
        w.eval(`venuePageVenue = ${JSON.stringify({ ...both, profile_image_url: null })}; openVenueImage('cover');`);
        expect(d.getElementById('image-viewer-prev').hidden).toBe(true);
        expect(d.getElementById('image-viewer-next').hidden).toBe(true);
        expect(d.getElementById('image-viewer-count').hidden).toBe(true);
        w.eval(`openVenueImage('logo')`);   // no logo: nothing new opens
        expect(d.getElementById('image-viewer-img').getAttribute('src')).toBe('https://cdn.test/cover.jpg');
    });

    it('closes on X, on the black around the photo, on Escape and on Back — not on the photo', () => {
        const openIt = () => w.eval(`venuePageVenue = ${JSON.stringify(both)}; openVenueImage('cover');`);
        openIt();
        d.getElementById('image-viewer-img').click();
        expect(viewer().classList.contains('visible'), 'a tap on the photo closed it').toBe(true);
        viewer().click();
        expect(viewer().classList.contains('visible')).toBe(false);
        openIt();
        d.getElementById('image-viewer-close').click();
        expect(viewer().classList.contains('visible')).toBe(false);
        openIt();
        d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        expect(viewer().classList.contains('visible')).toBe(false);
        openIt();
        expect(w.eval('topOpenSurface().id')).toBe('image-viewer');
        w.eval('topOpenSurface().back()');
        expect(viewer().classList.contains('visible')).toBe(false);
    });

    it('it is above the venue page in the Back table and in the z-index ladder', () => {
        const ids = w.eval('BACK_SURFACES.map(s => s.id)');
        expect(ids.indexOf('image-viewer')).toBeGreaterThan(-1);
        expect(ids.indexOf('image-viewer')).toBeLessThan(ids.indexOf('venue-page'));
        expect(ids.indexOf('image-viewer')).toBeLessThan(ids.indexOf('viibe-viewer'));
        const z = Number(declared('.image-viewer', 'z-index')[0]);
        expect(z).toBeGreaterThan(2920);   // the share sheet and everything a venue page opens
        expect(z).toBeLessThan(2950);      // the auth overlay
        expect(css).toMatch(/\.image-viewer\s+2930/);
    });
});

// ===========================================================================
// Post pins go straight to the venue
// ===========================================================================

describe('a map post pin at a venue opens the venue page', () => {
    beforeEach(boot);

    it('venue → venue page; no venue → the preview', () => {
        const calls = [];
        w.openVenuePage = id => calls.push(['venue', id]);
        w.openPostPreview = id => calls.push(['preview', id]);
        w.eval(`openPostPin({ id: 'p1', venue_id: 'v1' }); openPostPin({ id: 'p2', venue_id: null });`);
        expect(calls).toEqual([['venue', 'v1'], ['preview', 'p2']]);
    });

    it('renderPostPins routes through it and says where it goes', () => {
        const code = fnCode('function renderPostPins()');
        expect(code).toContain(".on('click', () => openPostPin(pin))");
        expect(code).not.toContain('openPostPreview(');
        expect(code).toContain('data-post-venue=');
    });
});

describe('translations for this round', () => {
    const KEYS = ['fitWhole', 'fitFill', 'deletePostTitle', 'deletePostBody', 'delete', 'deleting', 'deleteFailed',
        'postDeleted', 'postPublished', 'somethingWentWrong', 'photo', 'previousPhoto', 'nextPhoto'];
    for (const lang of ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ar']) {
        it(`${lang}: every new key is there and translated`, () => {
            const soc = JSON.parse(read(`i18n/${lang}.json`)).social;
            const en = JSON.parse(read('i18n/en.json')).social;
            for (const k of KEYS) {
                expect(soc[k], `${lang}.social.${k}`).toBeTruthy();
                if (lang !== 'en' && !['photo'].includes(k)) {
                    expect(soc[k], `${lang}.social.${k} is English`).not.toBe(en[k]);
                }
            }
        });
    }
});
