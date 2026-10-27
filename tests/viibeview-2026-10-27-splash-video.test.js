/**
 * Guards for ViibeView's splash video (Jay, 2026-10-27): the Backlog card
 * "Splash Screen with Video Background", which waited on a clip.
 *
 *   Loading      the clip loads only while the splash is on screen. It used
 *                to be the video's src from boot, which downloaded all 1.4 MB
 *                for every visitor (measured in Chromium and WebKit), for a
 *                screen most never open.
 *   Pausing      leaving the splash (Log In, Create Account, closing) pauses it.
 *   Motion       "Reduce motion" gets no video, just the backdrop.
 *   Worker       sw.js never handles video or range requests.
 *   Builder      saving in the App Builder keeps branding.splash_video_url.
 *   Data         migration 20261027000002 points ViibeView at the shipped file.
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
const sw = read('customer-app/sw.js');
const builder = read('app/app-builder.js');
const MIGRATION = 'supabase/migrations/20261027000002_viibeview_splash_video.sql';
const CLIP = '/customer-app/media/viibeview-splash-v1.mp4';

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

let w, d;

async function boot({ reduceMotion = false, playRejects = false } = {}) {
    const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://royaltyapp.ai/a/viibeview/social' });
    w = dom.window;
    d = w.document;
    w.localStorage.setItem('viibeview_onboarded_v1', '1');
    w.matchMedia = (q) => ({
        matches: reduceMotion && /prefers-reduced-motion: reduce/.test(q),
        addEventListener() {}, removeEventListener() {},
    });
    w.requestAnimationFrame = cb => setTimeout(cb, 0);
    w.HTMLElement.prototype.scrollTo = function () {};
    const thenable = { then: (r) => r({ data: null, error: new Error('stubbed') }) };
    const chain = new Proxy(thenable, { get: (t, k) => (k in t ? t[k] : () => chain) });
    w.supabase = {
        createClient: () => ({
            auth: { getSession: async () => ({ data: { session: null } }) },
            from: () => chain,
            rpc: () => Promise.resolve({ data: [], error: null }),
            storage: { from: () => ({ upload: async () => ({}), getPublicUrl: () => ({ data: { publicUrl: '' } }), remove: async () => ({}) }) },
        }),
    };
    // A media element that remembers whether it is playing, and counts calls.
    w.__plays = 0;
    w.__pauses = 0;
    const proto = w.HTMLMediaElement.prototype;
    Object.defineProperty(proto, 'paused', { get() { return !this.__playing; }, configurable: true });
    proto.play = function () {
        w.__plays++;
        if (playRejects) return Promise.reject(new Error('NotAllowedError'));
        this.__playing = true;
        return Promise.resolve();
    };
    proto.pause = function () { w.__pauses++; this.__playing = false; };
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
}

const video = () => d.getElementById('auth-splash-video');
const brand = (branding) => w.eval(`applyBranding(${JSON.stringify({ name: 'ViibeView', branding })})`);

describe('the splash video loads only while the splash is on screen', () => {
    beforeEach(() => boot());

    it('at boot: the URL is kept, nothing is loaded, nothing plays', () => {
        brand({ splash_video_url: CLIP });
        expect(video().dataset.src).toBe(CLIP);
        expect(video().getAttribute('src')).toBeNull();
        expect(video().style.display).not.toBe('none');
        expect(w.__plays).toBe(0);
    });

    it('Log In or Create Account opened directly: still nothing loaded', () => {
        brand({ splash_video_url: CLIP });
        w.eval("showAuth('login')");
        expect(video().getAttribute('src')).toBeNull();
        w.eval('hideAuth()');
        w.eval("showAuth('signup')");
        expect(video().getAttribute('src')).toBeNull();
        expect(w.__plays).toBe(0);
    });

    it('Back to the splash: loads and plays; Log In again pauses it; Back plays it again', () => {
        brand({ splash_video_url: CLIP });
        w.eval("showAuth('login')");
        w.eval('backFromAuth()');
        expect(w.eval('currentAuthView()')).toBe('splash');
        expect(video().getAttribute('src')).toBe(CLIP);
        expect(video().paused).toBe(false);
        expect(w.__plays).toBe(1);

        // The splash's own Log In button (its listener is wired by init(),
        // which cannot run here; it calls exactly this).
        w.eval("setAuthView('login')");
        expect(video().paused).toBe(true);

        w.eval('backFromAuth()');
        expect(video().paused).toBe(false);
        expect(w.__plays).toBe(2);
        // Same clip: the src is not re-assigned (that would restart the download).
        expect(video().getAttribute('src')).toBe(CLIP);
    });

    it('closing the overlay pauses it', () => {
        brand({ splash_video_url: CLIP });
        w.eval("showAuth('splash')");
        expect(video().paused).toBe(false);
        w.eval('hideAuth()');
        expect(video().paused).toBe(true);
    });

    it('no clip configured: hidden, and opening the splash plays nothing', () => {
        brand({});
        expect(video().style.display).toBe('none');
        w.eval("showAuth('splash')");
        expect(video().getAttribute('src')).toBeNull();
        expect(w.__plays).toBe(0);
    });
});

describe('when it cannot or should not play', () => {
    it('"Reduce motion": no video at all', async () => {
        await boot({ reduceMotion: true });
        brand({ splash_video_url: CLIP });
        w.eval("showAuth('splash')");
        expect(video().getAttribute('src')).toBeNull();
        expect(w.__plays).toBe(0);
    });

    it('a refused play() (Low Power Mode) is swallowed, not an unhandled rejection', async () => {
        await boot({ playRejects: true });
        const unhandled = [];
        const onUnhandled = e => unhandled.push(e);
        process.on('unhandledRejection', onUnhandled);
        try {
            brand({ splash_video_url: CLIP });
            w.eval("showAuth('splash')");
            await tick(); await tick();
            expect(w.__plays).toBe(1);
            expect(unhandled).toEqual([]);
        } finally {
            process.off('unhandledRejection', onUnhandled);
        }
    });
});

describe('markup, worker, builder and data', () => {
    it('the <video> has no src and no autoplay, and stays muted, looping, inline', () => {
        const tag = html.match(/<video[^>]*id="auth-splash-video"[^>]*>/)[0];
        expect(tag).not.toMatch(/\ssrc=/);
        expect(tag).not.toMatch(/\sautoplay/);
        for (const attr of ['muted', 'loop', 'playsinline']) expect(tag).toMatch(new RegExp(`\\s${attr}[\\s>]`));
    });

    it('applyBranding never assigns the video src', () => {
        const fn = js.slice(js.indexOf('function applyBranding(app)'), js.indexOf('// ===== Feature Flags ====='));
        expect(fn).toContain('splashVideo.dataset.src = branding.splash_video_url;');
        expect(fn).not.toMatch(/splashVideo\.src\s*=/);
    });

    it('the service worker hands video and range requests back to the browser, before any cache branch', () => {
        const handler = sw.slice(sw.indexOf("self.addEventListener('fetch'"));
        const skip = handler.indexOf("request.headers.has('range')");
        expect(skip).toBeGreaterThan(-1);
        expect(skip).toBeLessThan(handler.indexOf("if (request.mode === 'navigate')"));
        const re = /\.(mp4|webm|mov|m4v|mp3|m4a)$/i;
        expect(handler).toContain(String(re));
        expect(re.test(CLIP)).toBe(true);
    });

    it('the App Builder carries splash_video_url through a save, and its script version moved', () => {
        const start = builder.indexOf('function getAppData()');
        const body = builder.slice(start, builder.indexOf('\n}', start));
        expect(body).toMatch(/splash_video_url: currentApp\?\.branding\?\.splash_video_url \|\| null/);
        expect(read('app/app-builder.html')).toContain('<script src="app-builder.js?v=24"></script>');
    });

    it('the migration sets exactly this file on exactly the ViibeView row, merged', () => {
        const sql = read(MIGRATION);
        expect(sql).toContain(`jsonb_build_object('splash_video_url', '${CLIP}')`);
        expect(sql).toMatch(/SET branding = COALESCE\(branding, '\{\}'::jsonb\)\s*\|\|/);
        expect(sql).toContain("WHERE id = '6119865e-83f8-4731-b320-8ea705a2ac18'");
        expect(sql).toMatch(/IF v_updated <> 1 THEN\s*RAISE EXCEPTION/);
    });

    it('the clip ships with the site: a real MP4, small, metadata first (plays before it finishes loading)', () => {
        const buf = fs.readFileSync(path.join(ROOT, CLIP.slice(1)));
        expect(buf.length).toBeGreaterThan(200 * 1024);
        expect(buf.length).toBeLessThan(3 * 1024 * 1024);
        expect(buf.toString('latin1', 4, 8)).toBe('ftyp');
        const moov = buf.indexOf('moov', 0, 'latin1');
        const mdat = buf.indexOf('mdat', 0, 'latin1');
        expect(moov).toBeGreaterThan(-1);
        expect(moov).toBeLessThan(mdat);
    });
});
