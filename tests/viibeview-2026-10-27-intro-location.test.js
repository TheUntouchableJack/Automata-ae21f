/**
 * Guards for plan stateless-fluttering-cupcake (2026-10-27): two gaps the
 * client's board names on cards already in Client Review.
 *
 *   First-Time UX Tutorial   "can be re-accessed later from settings":
 *                            Settings → Replay the intro, in BOTH menus.
 *   Onboarding (1st-Time)    "permissions": a location screen in the intro.
 *                            The browser's prompt used to land OVER the intro
 *                            at boot; now the intro never gets a prompt it did
 *                            not ask for. Allow asks; closing the intro asks
 *                            once; a replay never asks again; a device that
 *                            already said yes still gets its fix at boot.
 *
 * Behaviour runs in jsdom with social.js loaded as a real classic <script>,
 * and a geolocation stub that records every call and answers when told to.
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
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };
const HERE = { coords: { latitude: 34.09, longitude: -118.37 } };

let w, d;

// `onboarded`: has this browser seen the intro before.
// `geo`: false = a browser with no navigator.geolocation at all.
// `perm`: what navigator.permissions answers; 'none' = no Permissions API,
//         'throws' = the query rejects (older Safari).
async function boot({ onboarded = false, geo = true, perm = 'prompt' } = {}) {
    const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://royaltyapp.ai/a/viibeview/social' });
    w = dom.window;
    d = w.document;
    if (onboarded) w.localStorage.setItem('viibeview_onboarded_v1', '1');
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.requestAnimationFrame = cb => setTimeout(cb, 0);
    w.HTMLElement.prototype.scrollTo = function () {};
    w.__rpc = () => ({ data: [], error: null });
    const thenable = { then: (r) => r({ data: null, error: new Error('stubbed') }) };
    const chain = new Proxy(thenable, { get: (t, k) => (k in t ? t[k] : () => chain) });
    w.supabase = {
        createClient: () => ({
            auth: { getSession: async () => ({ data: { session: null } }) },
            from: () => chain,
            rpc: (name, args) => Promise.resolve(w.__rpc(name, args)),
            storage: { from: () => ({ upload: async () => ({}), getPublicUrl: () => ({ data: { publicUrl: '' } }), remove: async () => ({}) }) },
        }),
    };
    const proto = w.HTMLMediaElement.prototype;
    proto.play = function () { return Promise.resolve(); };
    proto.pause = function () {};
    proto.load = function () {};

    // Every getCurrentPosition call is recorded and answered later by the test.
    w.__geo = [];
    if (geo) {
        Object.defineProperty(w.navigator, 'geolocation', {
            value: { getCurrentPosition: (ok, fail, opts) => w.__geo.push({ ok, fail, opts }) },
            configurable: true,
        });
    }
    w.__perm = perm;
    w.__permQueries = [];
    if (perm !== 'none') {
        Object.defineProperty(w.navigator, 'permissions', {
            value: {
                query: (desc) => {
                    w.__permQueries.push(desc && desc.name);
                    if (w.__perm === 'throws') return Promise.reject(new TypeError('not supported'));
                    if (typeof w.__perm === 'function') return w.__perm();
                    return Promise.resolve({ state: w.__perm });
                },
            },
            configurable: true,
        });
    }

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

// What init() does with location, in its order: show the intro if this browser
// has not seen it, then bootLocation().
async function firstOpen() {
    w.eval('maybeShowOnboarding()');
    await w.eval('bootLocation()');
    await settle();
}

const overlay = () => d.getElementById('onboarding-overlay');
const allowBtn = () => d.getElementById('onboarding-location-btn');
const status = () => d.getElementById('onboarding-location-status');
const introVisible = () => overlay().classList.contains('visible');
const allowShown = () => allowBtn().style.display !== 'none';

// ===========================================================================
// The screens
// ===========================================================================

describe('the intro: three screens, location, then the picker', () => {
    beforeEach(() => boot());

    it('5 panels, the location screen 4th and the picker last', () => {
        const panels = [...d.querySelectorAll('#onboarding-track [data-ob-panel]')];
        expect(panels.map(p => p.dataset.obPanel)).toEqual(['0', '1', '2', '3', '4']);
        expect(panels[3].classList.contains('onboarding-panel-location')).toBe(true);
        expect(panels[3].querySelector('#onboarding-location-btn')).not.toBeNull();
        expect(panels[3].querySelector('#onboarding-location-status')).not.toBeNull();
        // Never a photo: showOnboarding() only paints [data-ob-photo] panels.
        expect(panels[3].hasAttribute('data-ob-photo')).toBe(false);
        expect(panels[4].classList.contains('onboarding-panel-picker')).toBe(true);
        expect(w.eval('ONBOARDING_PANELS')).toBe(5);
    });

    it('"Show me" and the dark footer are on the picker, not the location screen', () => {
        w.eval('showOnboarding()');
        w.eval('setOnboardingIndex(3)');
        expect(overlay().classList.contains('on-picker')).toBe(false);
        expect(d.getElementById('onboarding-next').textContent).toBe('Continue');
        expect(d.querySelectorAll('.onboarding-dot').length).toBe(5);
        w.eval('setOnboardingIndex(4)');
        expect(overlay().classList.contains('on-picker')).toBe(true);
        expect(d.getElementById('onboarding-next').textContent).toBe('Show me');
    });

    it('the status line is announced and has no data-i18n (a later pass would blank it)', () => {
        expect(status().getAttribute('role')).toBe('status');
        expect(status().hasAttribute('data-i18n')).toBe(false);
        expect(allowBtn().getAttribute('data-i18n')).toBe('social.obLocAllow');
        expect(allowBtn().getAttribute('type')).toBe('button');
    });
});

// ===========================================================================
// When location is asked
// ===========================================================================

describe('location is never asked over the intro', () => {
    it('first run: no geolocation call while the intro is up', async () => {
        await boot();
        await firstOpen();
        expect(introVisible()).toBe(true);
        expect(w.__geo.length).toBe(0);
        // It did look at the permission, to know whether asking is silent.
        expect(w.__permQueries).toContain('geolocation');
    });

    it('a trip to another app and back, or a tab change, during the first intro asks nothing', async () => {
        await boot();
        await firstOpen();
        w.eval('watchLocationFreshness()');
        Object.defineProperty(d, 'visibilityState', { value: 'visible', configurable: true });
        d.dispatchEvent(new w.Event('visibilitychange'));
        // Feed only: the Map tab starts Leaflet, which jsdom does not have.
        // Both tabs go through the same refreshLocationIfStale() line.
        w.eval("switchTab('settings'); switchTab('feed');");
        expect(w.__geo.length).toBe(0);
    });

    it('refreshLocationIfStale does nothing before the first ask, and refreshes after it', async () => {
        await boot({ onboarded: true });
        w.eval('userLocation = { lat: 34.09, lng: -118.37 }; userLocationAt = Date.now() - 6 * 60 * 1000;');
        w.eval('refreshLocationIfStale()');
        expect(w.__geo.length).toBe(0);
        w.eval('locationAsked = true');
        w.eval('refreshLocationIfStale()');
        expect(w.__geo.length).toBe(1);
    });

    it('a browser that already said yes gets its fix at boot, even with the intro up', async () => {
        await boot({ perm: 'granted' });
        await firstOpen();
        expect(introVisible()).toBe(true);
        expect(w.__geo.length).toBe(1);
        w.__geo[0].ok(HERE);
        await settle();
        expect(status().textContent).toBe('Location is on');
        expect(allowShown()).toBe(false);
    });

    it('no intro (seen before): boot asks at once, as it always did', async () => {
        await boot({ onboarded: true });
        await firstOpen();
        expect(introVisible()).toBe(false);
        expect(w.__geo.length).toBe(1);
    });

    it('init() goes through bootLocation(), never straight to requestLocation()', () => {
        const init = js.slice(js.indexOf('async function init()'), js.indexOf('// ===== Branding ====='));
        expect(init).toMatch(/\n\s+bootLocation\(\);/);
        expect(init).not.toMatch(/\n\s+requestLocation\(/);
        // And after the intro has had its chance to show.
        expect(init.indexOf('maybeShowOnboarding()')).toBeLessThan(init.indexOf('bootLocation();'));
    });
});

describe('the location screen asks on a tap, and says how it went', () => {
    beforeEach(async () => { await boot(); await firstOpen(); });

    it('before any answer: Allow is offered and nothing is said', () => {
        expect(allowShown()).toBe(true);
        expect(allowBtn().disabled).toBe(false);
        expect(status().textContent).toBe('');
    });

    it('Allow: exactly one call; "Finding…" while it waits; "Location is on" after', async () => {
        allowBtn().click();
        expect(w.__geo.length).toBe(1);
        await settle();
        expect(status().textContent).toMatch(/Finding your location/);
        expect(allowBtn().disabled).toBe(true);
        w.__geo[0].ok(HERE);
        await settle();
        expect(status().textContent).toBe('Location is on');
        expect(allowShown()).toBe(false);
        expect(w.eval('userLocation')).toEqual({ lat: 34.09, lng: -118.37 });
    });

    it('Allow, then "no": the blocked message and no button (a browser never asks twice)', async () => {
        allowBtn().click();
        // The tap's own paint finishes first ("Finding…"), as it does in a
        // browser, where the permission check beats the person's answer. The
        // error must then be painted by the error callback itself.
        await settle();
        expect(status().textContent).toMatch(/Finding your location/);
        w.__geo[0].fail({ code: 1, message: 'denied' });
        await settle();
        expect(status().textContent).toBe(w.eval('locationErrorMessage(1)'));
        expect(status().textContent).toMatch(/blocked/);
        expect(allowShown()).toBe(false);
    });

    it('Allow, then a timeout: says so, and Allow stays for another try', async () => {
        allowBtn().click();
        await settle();
        w.__geo[0].fail({ code: 3, message: 'timeout' });
        await settle();
        expect(status().textContent).toMatch(/took too long/);
        expect(allowShown()).toBe(true);
        expect(allowBtn().disabled).toBe(false);
        allowBtn().click();
        expect(w.__geo.length).toBe(2);
        // The second try waits on a NEW answer, not the old "took too long".
        await settle();
        expect(status().textContent).toMatch(/Finding your location/);
        expect(allowBtn().disabled).toBe(true);
        w.__geo[1].ok(HERE);
        await settle();
        expect(status().textContent).toBe('Location is on');
    });
});

describe('closing the intro', () => {
    it('finishing without Allow asks once; finishing a replay asks zero times', async () => {
        await boot();
        await firstOpen();
        expect(w.__geo.length).toBe(0);
        d.getElementById('onboarding-skip').click();
        expect(introVisible()).toBe(false);
        expect(w.__geo.length).toBe(1);

        w.eval('replayIntro()');
        expect(introVisible()).toBe(true);
        d.getElementById('onboarding-skip').click();
        expect(w.__geo.length).toBe(1);
    });

    it('"Show me" on the picker asks once too', async () => {
        await boot();
        await firstOpen();
        w.eval('setOnboardingIndex(4)');
        d.getElementById('onboarding-next').click();
        expect(introVisible()).toBe(false);
        expect(w.__geo.length).toBe(1);
    });

    it('finishing after Allow does not ask a second time', async () => {
        await boot();
        await firstOpen();
        allowBtn().click();
        expect(w.__geo.length).toBe(1);
        d.getElementById('onboarding-skip').click();
        expect(w.__geo.length).toBe(1);
    });

    it('a granted browser asked at boot; closing the intro does not ask again', async () => {
        await boot({ perm: 'granted' });
        await firstOpen();
        expect(w.__geo.length).toBe(1);
        d.getElementById('onboarding-skip').click();
        expect(w.__geo.length).toBe(1);
    });
});

describe('what the browser already knows', () => {
    it('blocked before we ever asked: the blocked message, no button, no call', async () => {
        await boot({ perm: 'denied' });
        await firstOpen();
        expect(status().textContent).toMatch(/blocked/);
        expect(allowShown()).toBe(false);
        expect(w.__geo.length).toBe(0);
    });

    it('no geolocation at all: the unavailable text, no button; closing the intro is still fine', async () => {
        await boot({ geo: false });
        await firstOpen();
        expect(status().textContent).toBe(w.eval('locationErrorMessage(2)'));
        expect(allowShown()).toBe(false);
        d.getElementById('onboarding-skip').click();
        expect(introVisible()).toBe(false);
    });

    it('no Permissions API, or one that throws: treated as "not asked yet"', async () => {
        await boot({ perm: 'none' });
        await firstOpen();
        expect(w.__geo.length).toBe(0);
        expect(allowShown()).toBe(true);
        expect(status().textContent).toBe('');

        await boot({ perm: 'throws' });
        await firstOpen();
        expect(w.__geo.length).toBe(0);
        expect(allowShown()).toBe(true);
    });

    it('a late permission answer never paints over a newer one', async () => {
        await boot();
        const pending = [];
        w.__perm = () => new Promise(resolve => pending.push(resolve));
        w.eval('maybeShowOnboarding()');      // paint 1: query 1 out
        w.eval('renderOnboardingLocation()'); // paint 2: query 2 out
        expect(pending.length).toBe(2);
        pending[1]({ state: 'granted' });
        await settle();
        expect(status().textContent).toBe('Location is on');
        pending[0]({ state: 'prompt' });      // the older answer, last
        await settle();
        expect(status().textContent).toBe('Location is on');
        expect(allowShown()).toBe(false);
    });

    it('the screen is not painted while the intro is closed', async () => {
        await boot({ onboarded: true });
        await firstOpen();
        w.__geo[0].ok(HERE);
        await settle();
        expect(status().textContent).toBe('');
    });
});

// ===========================================================================
// Settings → Replay the intro
// ===========================================================================

describe('Settings → Replay the intro', () => {
    beforeEach(() => boot({ onboarded: true }));

    it('is in BOTH Settings menus, next to "Your interests"', () => {
        const out = d.querySelector('#profile-signed-out .profile-menu #replay-intro-btn-out');
        const inn = d.querySelector('#profile-signed-in .profile-menu #replay-intro-btn');
        for (const btn of [out, inn]) {
            expect(btn).not.toBeNull();
            expect(btn.getAttribute('onclick')).toBe('replayIntro()');
            expect(btn.querySelector('[data-i18n="social.replayIntro"]').textContent).toBe('Replay the intro');
            expect(btn.previousElementSibling.id).toMatch(/^interests-btn/);
        }
    });

    it('opens the intro at its first screen when this browser has already seen it', () => {
        expect(introVisible()).toBe(false);
        d.getElementById('replay-intro-btn').click();
        expect(introVisible()).toBe(true);
        expect(w.eval('onboardingIndex')).toBe(0);
        expect(d.querySelector('.onboarding-dot.active')).toBe(d.querySelectorAll('.onboarding-dot')[0]);
    });

    it('starts again from the first screen after a replay was left part-way', () => {
        d.getElementById('replay-intro-btn-out').click();
        w.eval('setOnboardingIndex(3)');
        d.getElementById('onboarding-skip').click();
        d.getElementById('replay-intro-btn-out').click();
        expect(w.eval('onboardingIndex')).toBe(0);
    });

    it('with location already on, the location screen says so', async () => {
        await firstOpen();
        w.__geo[0].ok(HERE);
        await settle();
        w.eval('replayIntro()');
        await settle();
        expect(status().textContent).toBe('Location is on');
        expect(allowShown()).toBe(false);
    });

    it('Back on the first screen closes it (the onboarding BACK_SURFACES entry)', () => {
        w.eval('replayIntro()');
        const entry = w.eval("BACK_SURFACES.find(s => s.id === 'onboarding-overlay')");
        entry.back();
        expect(introVisible()).toBe(false);
    });
});

// ===========================================================================
// Copy, styles, translations
// ===========================================================================

describe('copy, styles and translations', () => {
    const KEYS = ['replayIntro', 'obLocTitle', 'obLocBody', 'obLocAllow', 'obLocOn'];
    const LANGS = ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ar'];

    it('every new key exists in all 8 languages, translated', () => {
        const en = JSON.parse(read('i18n/en.json')).social;
        for (const lang of LANGS) {
            const s = JSON.parse(read(`i18n/${lang}.json`)).social;
            for (const k of KEYS) {
                expect(typeof s[k], `${lang}.social.${k}`).toBe('string');
                expect(s[k].trim().length, `${lang}.social.${k}`).toBeGreaterThan(0);
                if (lang !== 'en') expect(s[k], `${lang}.social.${k} is English`).not.toBe(en[k]);
            }
        }
        expect(en.obLocBody).toMatch(/only used while the app is open/);
    });

    it('the HTML fallbacks match en.json', () => {
        const en = JSON.parse(read('i18n/en.json')).social;
        for (const k of ['replayIntro', 'obLocTitle', 'obLocBody', 'obLocAllow']) {
            const el = d => d.querySelector(`[data-i18n="social.${k}"]`);
            const dom = new JSDOM(html);
            expect(el(dom.window.document).textContent.trim(), k).toBe(en[k]);
        }
    });

    it('the Allow button is sized to its label, and the body is not shouted', () => {
        // .auth-btn (width: 100%) comes later in the file; two class names win.
        expect(declared('.onboarding-panel-location .onboarding-location-btn', 'width')).toEqual(['auto']);
        expect(declared('.onboarding-panel-location p', 'text-transform')).toEqual(['none']);
        expect(css.indexOf('.onboarding-panel-location p {'))
            .toBeGreaterThan(css.indexOf('.onboarding-panel-photo p {'));
    });
});
