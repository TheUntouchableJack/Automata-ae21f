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
    // Bail-outs. Each returns a working no-op Analytics object so that call
    // sites never need to null-check.
    // ---------------------------------------------------------------------
    function noop() {}
    var disabled = {
        track: noop,
        identify: noop,
        reset: noop,
        isEnabled: function () { return false; }
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
    var queue = [];
    var ready = false;

    function flush() {
        ready = true;
        for (var i = 0; i < queue.length; i++) {
            try { window.posthog.capture(queue[i][0], queue[i][1]); } catch (e) { /* never break the page */ }
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
            try {
                if (!ready) { queue.push([name, props || {}]); return; }
                window.posthog.capture(name, props || {});
            } catch (e) { /* analytics must never break the app */ }
        },

        // Call once auth resolves in /app. Ties the session to a stable user id
        // so the post-signup funnel joins up across page loads.
        identify: function (userId, props) {
            try {
                if (!ready || !userId) return;
                window.posthog.identify(String(userId), props || {});
            } catch (e) { /* ignore */ }
        },

        // Call on sign-out, otherwise the next person on a shared machine
        // inherits the previous user's identity.
        reset: function () {
            try { if (ready) window.posthog.reset(); } catch (e) { /* ignore */ }
        },

        isEnabled: function () { return ready; }
    };
})();
