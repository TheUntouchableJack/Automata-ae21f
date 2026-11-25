// ===== Royalty analytics (PostHog) =====
//
// One file, two behaviours, chosen by pathname:
//
//   Marketing pages  — cookieless. No cookies, no localStorage, therefore no
//                      consent banner. Gives funnels, click maps and scroll maps.
//   /app/* pages     — normal persistence + session replay, with everything
//                      masked. Users here are logged in and covered by the ToS,
//                      so no banner is needed on this surface either.
//
// WHY COOKIELESS MEANS NO REPLAY ON MARKETING PAGES: PostHog disables session
// replay and surveys whenever there is no cookie consent, because both need to
// persist a session id. That is a hard vendor limitation, not a config we can
// tune. We took the trade deliberately — the banner would sit fixed to the
// bottom of the viewport, overlapping the #discovery-card signup form on mobile,
// i.e. degrading the exact conversion we're trying to measure, in exchange for
// replay that only the ~40-70% who accept would ever produce.
//
// If you later need to know *why* someone dropped off a marketing step rather
// than just *where*, flip COOKIELESS_MODE to 'on_reject' and add a banner:
// consenters then produce replays, and — unlike a normal banner — those who
// reject are still counted via the privacy-preserving hash, so the funnel
// numbers stay whole.
//
// Known, expected quirks of cookieless mode (not bugs, don't chase them):
//   - Identity is hash(team_id, daily_salt, ip, user_agent, hostname) and the
//     salt rotates daily, so WEEKLY/MONTHLY unique-user counts read high.
//     Same-day funnels are fine, which is what we care about.
//   - No GeoIP and no bot detection: the IP is stripped before enrichment.
//   - Two people behind one IP on the same browser can merge into one person.
//
// Delivery is via the first-party /ingest/* proxy declared in netlify.toml (and
// mirrored in vite.config.js for dev), so ad blockers don't strip it and the CSP
// needs no third-party origins.
(function () {
    'use strict';

    // ---------------------------------------------------------------------
    // The key lives in js/analytics-config.js — edit that file, not this one.
    // It is loaded immediately before this script on every page.
    // ---------------------------------------------------------------------
    var POSTHOG_TOKEN = window.POSTHOG_TOKEN || 'phc_REPLACE_ME';

    var PROXY_PATH = '/ingest';                     // must match netlify.toml
    var UI_HOST = 'https://us.posthog.com';         // US cloud — where the UI lives
    var COOKIELESS_MODE = 'always';                 // 'always' | 'on_reject'

    var isApp = window.location.pathname.indexOf('/app/') === 0;

    // ---------------------------------------------------------------------
    // Attribution: where this visit came from, carried in ONE URL param.
    //
    // The arrival page reads its own utm_* / click-id params and the external
    // referring domain, plus its path, and packs them into a short string. A
    // delegated listener adds it as ?src= to same-origin links (and same-origin
    // GET forms) as they are clicked, so it rides along to /app/signup.html,
    // which stores it on the new account (auth metadata `signup_source`).
    //
    // NO STORAGE: nothing is written to cookies or localStorage, so the
    // marketing pages still need no consent banner and privacy.html stays
    // accurate ("referring URLs" are already listed as collected). The opt-outs
    // privacy.html promises (?notrack=1, Do Not Track, Global Privacy Control)
    // switch it off too.
    //
    // ?src= forms: "s=google&m=cpc&c=spring&r=google.com&l=%2Fpricing.html"
    // (s/m/c/t/n = utm source/medium/campaign/term/content, r = referring
    // domain, l = landing path, k = which click id was present), or a bare tag
    // such as "blog_widget", read as a utm_source.
    // ---------------------------------------------------------------------
    var SRC_PARAM = 'src';
    var SRC_KEYS = { s: 'utm_source', m: 'utm_medium', c: 'utm_campaign', t: 'utm_term', n: 'utm_content',
                     r: 'referrer', l: 'landing', k: 'click_id' };
    var UTM_SHORT = { utm_source: 's', utm_medium: 'm', utm_campaign: 'c', utm_term: 't', utm_content: 'n' };
    var CLICK_IDS = ['gclid', 'fbclid', 'msclkid', 'ttclid', 'li_fat_id'];
    var SITE_HOSTS = ['royaltyapp.ai', 'www.royaltyapp.ai'];

    function clip(v, n) {
        v = String(v == null ? '' : v).trim();
        return v.length > n ? v.slice(0, n) : v;
    }

    function optedOut() {
        try { if (window.RoyaltyNoTrack && window.RoyaltyNoTrack.isDisabled()) return true; } catch (e) { /* ignore */ }
        try {
            var dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
            if (dnt === '1' || dnt === 'yes') return true;
            if (navigator.globalPrivacyControl === true) return true;
        } catch (e) { /* ignore */ }
        return false;
    }

    function isOwnHost(host) {
        return host === window.location.hostname || SITE_HOSTS.indexOf(host) !== -1;
    }

    // This visit's attribution string, or '' when it is unknown (a page
    // reached from inside the site without ?src=).
    function computeVisitSrc() {
        try {
            var params = new URLSearchParams(window.location.search);
            var carried = params.get(SRC_PARAM);
            if (carried) return clip(carried, 600);

            var refHost = '';
            try { refHost = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) { refHost = ''; }
            if (refHost && isOwnHost(refHost)) return '';

            // The arrival page.
            var out = new URLSearchParams();
            Object.keys(UTM_SHORT).forEach(function (utm) {
                var v = clip(params.get(utm), 80);
                if (v) out.set(UTM_SHORT[utm], v);
            });
            for (var i = 0; i < CLICK_IDS.length; i++) {
                if (params.get(CLICK_IDS[i])) { out.set('k', CLICK_IDS[i]); break; }
            }
            if (refHost) out.set('r', clip(refHost.replace(/^www\./, ''), 80));
            out.set('l', clip(window.location.pathname, 120));
            return out.toString();
        } catch (e) {
            return '';
        }
    }

    function decodeSrc(src) {
        if (!src) return null;
        var out = {};
        if (src.indexOf('=') === -1) {
            out.utm_source = clip(src, 80);
            return out;
        }
        var p = new URLSearchParams(src);
        Object.keys(SRC_KEYS).forEach(function (k) {
            var v = clip(p.get(k), k === 'l' ? 120 : 80);
            if (v) out[SRC_KEYS[k]] = v;
        });
        return out;
    }

    var visitSrc = optedOut() ? '' : computeVisitSrc();

    // Adds ?src= to a same-origin URL. Returns the input unchanged otherwise.
    // For redirects done in code (location.href = …), where no link is clicked.
    function withAttribution(href) {
        try {
            if (!visitSrc || !href) return href;
            var url = new URL(href, window.location.href);
            if (url.origin !== window.location.origin || url.searchParams.has(SRC_PARAM)) return href;
            url.searchParams.set(SRC_PARAM, visitSrc);
            return url.pathname + url.search + url.hash;
        } catch (e) {
            return href;
        }
    }

    function attribution() { return decodeSrc(visitSrc); }

    // Marketing pages and the two pre-account pages. Inside the product a
    // visit's source no longer matters, so app links are left alone.
    var decorates = !isApp || /^\/app\/(signup|login)\.html$/.test(window.location.pathname);

    function decorateLink(a) {
        var url;
        try { url = new URL(a.getAttribute('href'), window.location.href); } catch (e) { return; }
        if (url.origin !== window.location.origin || url.searchParams.has(SRC_PARAM)) return;
        // A same-page anchor (#features) keeps its plain href.
        if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;
        url.searchParams.set(SRC_PARAM, visitSrc);
        a.setAttribute('href', url.pathname + url.search + url.hash);
    }

    function decorateForm(form) {
        var method = (form.getAttribute('method') || 'get').toLowerCase();
        if (method !== 'get') return;
        var action;
        try { action = new URL(form.getAttribute('action') || window.location.href, window.location.href); } catch (e) { return; }
        if (action.origin !== window.location.origin) return;
        if (form.querySelector('input[name="' + SRC_PARAM + '"]')) return;
        var input = document.createElement('input');
        input.type = 'hidden';
        input.name = SRC_PARAM;
        input.value = visitSrc;
        form.appendChild(input);
    }

    if (visitSrc && decorates) {
        var onLink = function (e) {
            try {
                var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
                if (a) decorateLink(a);
            } catch (err) { /* never block navigation */ }
        };
        // Capture phase: runs before the browser follows the link.
        document.addEventListener('click', onLink, true);
        document.addEventListener('auxclick', onLink, true);
        document.addEventListener('submit', function (e) {
            try { if (e.target && e.target.tagName === 'FORM') decorateForm(e.target); } catch (err) { /* ignore */ }
        }, true);
    }

    // ---------------------------------------------------------------------
    // Bail-outs. Each returns a working no-op Analytics object so that call
    // sites never need to null-check. Attribution keeps working in all of
    // them: it is how a sign-up records its source, not a PostHog feature.
    // ---------------------------------------------------------------------
    function noop() {}
    var disabled = {
        track: noop,
        identify: noop,
        group: noop,
        reset: noop,
        isEnabled: function () { return false; },
        attribution: attribution,
        withAttribution: withAttribution
    };

    if (POSTHOG_TOKEN.indexOf('phc_REPLACE') === 0) {
        // Not configured yet. Say so once, loudly, in dev only — a silent
        // no-op here is how you end up believing you have data when you don't.
        if (window.location.hostname === 'localhost') {
            console.warn('[analytics] No PostHog key set — paste one into js/analytics-config.js. No events are being sent.');
        }
        window.Analytics = disabled;
        return;
    }

    if (window.RoyaltyNoTrack && window.RoyaltyNoTrack.isDisabled()) {
        window.Analytics = disabled;
        return;
    }

    // ---------------------------------------------------------------------
    // Local queue. Events fired before the library finishes downloading are
    // buffered here and flushed on load, so callers can track() immediately on
    // page load without caring about script timing.
    // ---------------------------------------------------------------------
    // identify and group are queued too, in call order: an identify fired
    // before the library loaded used to be dropped silently, which split one
    // signed-in user into an anonymous person per page load.
    var queue = [];
    var ready = false;

    function run(method, args) {
        var ph = window.posthog;
        if (method === 'capture') ph.capture(args[0], args[1]);
        else if (method === 'identify') ph.identify(args[0], args[1]);
        else if (method === 'group') ph.group(args[0], args[1], args[2]);
        else if (method === 'reset') ph.reset();
    }

    function call(method, args) {
        try {
            if (!ready) { queue.push([method, args]); return; }
            run(method, args);
        } catch (e) { /* analytics must never break the app */ }
    }

    function flush() {
        ready = true;
        for (var i = 0; i < queue.length; i++) {
            try { run(queue[i][0], queue[i][1]); } catch (e) { /* never break the page */ }
        }
        queue = [];
    }

    function buildConfig() {
        var config = {
            // Absolute rather than relative: posthog-js documents api_host as a
            // full origin, and being explicit avoids any base-URL surprises on
            // the prerendered blog pages.
            api_host: window.location.origin + PROXY_PATH,
            ui_host: UI_HOST,
            autocapture: true,          // powers click maps
            capture_pageview: true,
            capture_pageleave: true,    // REQUIRED for scroll maps — without it scroll data is silently empty
            capture_heatmaps: true,     // note: the older key was enable_heatmaps
            persistence: 'localStorage+cookie',
            // privacy.html tells users we honour Do Not Track. That promise is
            // only true because of this line — do not remove it without
            // amending the policy.
            respect_dnt: true
        };

        if (isApp) {
            // Logged-in product. Replay on, but deny-by-default masking.
            //
            // maskTextSelector: '*' is doing the heavy lifting. Inputs are
            // masked by PostHog's defaults, but general TEXT is not — and
            // app/customers.html and app/outgoing.html render our customers'
            // customers' names, emails and phone numbers as ordinary text.
            // Recording those would export third-party PII we were trusted
            // with. If you ever relax this, relax it per-selector, never
            // globally.
            config.session_recording = {
                maskAllInputs: true,
                maskTextSelector: '*'
            };
        } else {
            // Public marketing pages: no storage at all, so no banner needed.
            config.cookieless_mode = COOKIELESS_MODE;
            config.persistence = 'memory';
            // Replay cannot work without a persisted session id. Set it
            // explicitly so nobody wastes an afternoon wondering where the
            // recordings went.
            config.disable_session_recording = true;
        }

        config.loaded = flush;
        return config;
    }

    // ---------------------------------------------------------------------
    // Loader. /ingest/static/array.js is the full posthog-js build, proxied
    // through our own domain by the netlify.toml redirects.
    // ---------------------------------------------------------------------
    var script = document.createElement('script');
    script.src = PROXY_PATH + '/static/array.js';
    script.async = true;

    script.onload = function () {
        try {
            window.posthog.init(POSTHOG_TOKEN, buildConfig());
        } catch (e) {
            window.Analytics = disabled;
        }
    };

    // Blocked by an extension, offline, or the proxy is misconfigured. Drop the
    // buffer rather than growing it forever on a long-lived dashboard tab.
    script.onerror = function () {
        queue = [];
        window.Analytics = disabled;
    };

    document.head.appendChild(script);

    // ---------------------------------------------------------------------
    // Public API. Fire-and-forget: never throws, never blocks the caller.
    // ---------------------------------------------------------------------
    window.Analytics = {
        track: function (name, props) {
            call('capture', [name, props || {}]);
        },

        // Ties the session to a stable user id so the post-signup funnel joins
        // up across page loads. Only ids and plan labels: no email, no name.
        identify: function (userId, props) {
            if (!userId) return;
            call('identify', [String(userId), props || {}]);
        },

        // Group analytics: one "organization" group per business.
        group: function (type, key, props) {
            if (!type || !key) return;
            call('group', [String(type), String(key), props || {}]);
        },

        // Call on sign-out, otherwise the next person on a shared machine
        // inherits the previous user's identity.
        reset: function () {
            call('reset', []);
        },

        isEnabled: function () { return ready; },

        attribution: attribution,
        withAttribution: withAttribution
    };
})();
