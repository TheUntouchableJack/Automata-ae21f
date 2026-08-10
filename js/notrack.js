// ===== Analytics self-exclusion =====
//
// Keeps our own traffic out of the funnel data. Visit any page with ?notrack=1
// once and this device stops being counted, permanently, until you clear it
// with ?notrack=0.
//
// This matters more here than on a bigger site: dev runs against the LIVE prod
// Supabase project, royaltyapp.ai is pre-launch, and analytics is cookieless —
// which means PostHog identifies visitors by a hash of IP + user agent. Every
// time you click through the signup flow to test it, you look like a real
// visitor completing the funnel. On low traffic that doesn't just add noise,
// it inverts the conversion rate you're trying to read.
//
// Loaded BEFORE analytics.js, which refuses to initialise if this returns true.
// Same idea as CardWallet's notrack.js.
(function () {
    'use strict';

    var FLAG_KEY = 'royalty_notrack';

    // localStorage throws in Safari private mode and when cookies are blocked
    // outright. Analytics must never break a page, so every access is guarded
    // and failure means "not excluded" rather than an exception.
    function read() {
        try { return localStorage.getItem(FLAG_KEY) === '1'; } catch (e) { return false; }
    }

    function write(on) {
        try {
            if (on) localStorage.setItem(FLAG_KEY, '1');
            else localStorage.removeItem(FLAG_KEY);
        } catch (e) { /* storage unavailable — nothing we can do */ }
    }

    // Apply ?notrack=1 / ?notrack=0 if present, so the flag can be toggled from
    // any page without a console.
    try {
        var param = new URLSearchParams(window.location.search).get('notrack');
        if (param === '1') write(true);
        else if (param === '0') write(false);
    } catch (e) { /* malformed URL — ignore */ }

    window.RoyaltyNoTrack = {
        isDisabled: read,
        exclude: function () { write(true); },
        include: function () { write(false); }
    };
})();
