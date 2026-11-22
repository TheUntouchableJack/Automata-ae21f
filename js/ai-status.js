/**
 * AiStatus: is Royal AI on right now?
 *
 * Royal AI can be in "early access": Anthropic credits ran out, or Jay switched it off to hold
 * spend (platform_status row 'ai', migration 20261122000001). Signup and the loyalty app never
 * wait on it; only the AI features do, and they show an early-access card instead of an error.
 *
 *   await AiStatus.get()        → { enabled, onWaitlist }   (cached 5 min per tab; fails OPEN)
 *   AiStatus.peek()             → the cached state or null, synchronously
 *   AiStatus.isUnavailable(x)   → true for an edge-function answer with code 'ai_unavailable'
 *   AiStatus.markUnavailable()  → remember "off" after a server said so
 *   await AiStatus.ensureWaitlisted(source) → adds the signed-in owner's org to the list (while off)
 *   AiStatus.cardHtml(opts) / AiStatus.renderCard(el, opts) → the inline early-access card
 *
 * Fails open: if the status can't be read, Royal AI counts as on (the behaviour before this
 * file existed), and the server still answers 503 'ai_unavailable' if it is really off.
 * IIFE with no top-level bindings, so it can't collide with auth.js / script.js globals.
 */
(function () {
    'use strict';

    var URL_BASE = 'https://vhpmmfhfwnpmavytoomd.supabase.co';
    var ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZocG1tZmhmd25wbWF2eXRvb21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1OTgyMDYsImV4cCI6MjA4NTE3NDIwNn0.6JmfnTTR8onr3ZgFpzdZa4BbVBraUyePVEUHOJgxmuk';
    var STORAGE_KEY = 'royalty_ai_status_v2';
    var TTL_MS = 5 * 60 * 1000;
    var TIMEOUT_MS = 2500;

    // The cache belongs to one identity (the signed-in user's id, or 'anon'): on_waitlist is
    // per user, so another account signing in on this tab must not inherit it.
    var memo = null;       // { enabled, onWaitlist, who, at }
    var inflight = null;
    var inflightWho = null;

    function now() { return Date.now(); }

    function fresh(entry, who) {
        return !!entry && typeof entry.at === 'number' && now() - entry.at < TTL_MS &&
            (who === undefined || entry.who === who);
    }

    function readCache(who) {
        if (fresh(memo, who)) return memo;
        try {
            var raw = sessionStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            if (!fresh(parsed, who)) return null;
            memo = parsed;
            return memo;
        } catch (e) {
            return null;
        }
    }

    function writeCache(state, who) {
        memo = { enabled: state.enabled !== false, onWaitlist: state.onWaitlist === true, who: who || 'anon', at: now() };
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(memo)); } catch (e) { /* private mode */ }
        return memo;
    }

    // The signed-in client on /app pages (auth.js `db`), else none. Resolved lazily: auth.js
    // may load after this file.
    function appClient() {
        try {
            // eslint-disable-next-line no-undef
            if (typeof db !== 'undefined' && db && typeof db.rpc === 'function') return db;
        } catch (e) { /* not on an /app page */ }
        return null;
    }

    function identity() {
        var client = appClient();
        if (!client || !client.auth || typeof client.auth.getSession !== 'function') return Promise.resolve('anon');
        return withTimeout(client.auth.getSession()).then(function (r) {
            var user = r && r.data && r.data.session && r.data.session.user;
            return user && user.id ? user.id : 'anon';
        }).catch(function () { return 'anon'; });
    }

    function withTimeout(promise) {
        return Promise.race([
            promise,
            new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, TIMEOUT_MS); })
        ]);
    }

    function fetchStatus(who) {
        var client = appClient();
        var call = client
            ? client.rpc('get_ai_status').then(function (res) {
                if (res.error) throw res.error;
                return res.data;
            })
            : fetch(URL_BASE + '/rest/v1/rpc/get_ai_status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY },
                body: '{}'
            }).then(function (r) {
                if (!r.ok) throw new Error('status ' + r.status);
                return r.json();
            });
        return withTimeout(call).then(function (data) {
            return writeCache({ enabled: data ? data.enabled !== false : true, onWaitlist: !!(data && data.on_waitlist) }, who);
        });
    }

    var lastWho = 'anon';   // identity of the last get(), for writes that follow it

    function get(opts) {
        var force = opts && opts.fresh;
        return identity().then(function (who) {
            lastWho = who;
            var cached = force ? null : readCache(who);
            if (cached) return { enabled: cached.enabled, onWaitlist: cached.onWaitlist };
            if (!inflight || inflightWho !== who) {
                inflightWho = who;
                inflight = fetchStatus(who)
                    .catch(function () {
                        // Fail open, and don't cache the failure: the next call tries again.
                        return { enabled: true, onWaitlist: false };
                    })
                    .then(function (s) { inflight = null; return { enabled: s.enabled, onWaitlist: s.onWaitlist }; });
            }
            return inflight;
        });
    }

    function peek() {
        var c = readCache();
        return c ? { enabled: c.enabled, onWaitlist: c.onWaitlist } : null;
    }

    function isUnavailable(x) {
        if (!x) return false;
        if (x.code === 'ai_unavailable') return true;
        // supabase-js FunctionsHttpError keeps the parsed body on .context in some versions.
        if (x.context && x.context.code === 'ai_unavailable') return true;
        return false;
    }

    // supabase-js functions.invoke() error → the JSON body it carried, or null.
    function errorBody(err) {
        try {
            if (err && err.context && typeof err.context.json === 'function') {
                return err.context.clone ? err.context.clone().json() : err.context.json();
            }
        } catch (e) { /* not an HTTP error */ }
        return Promise.resolve(null);
    }

    function markUnavailable() {
        var c = readCache();
        writeCache({ enabled: false, onWaitlist: c ? c.onWaitlist : false }, c ? c.who : lastWho);
    }

    function ensureWaitlisted(source) {
        return get().then(function (s) {
            if (s.enabled) return false;
            if (s.onWaitlist) return true;
            var client = appClient();
            if (!client) return false;
            var who = lastWho;
            return withTimeout(client.rpc('join_ai_waitlist')).then(function (res) {
                var joined = !res.error && res.data && res.data.joined === true;
                if (joined) {
                    writeCache({ enabled: false, onWaitlist: true }, who);
                    if (window.Analytics && typeof window.Analytics.track === 'function') {
                        window.Analytics.track('ai_waitlist_joined', { source: source || 'app' });
                    }
                }
                return joined;
            }).catch(function () { return false; });
        });
    }

    function tr(key, fallback, repl) {
        var v = null;
        try { v = window.t ? window.t(key, repl || {}) : null; } catch (e) { v = null; }
        if (!v || v === key) {
            v = fallback;
            if (repl) v = v.replace(/\{(\w+)\}/g, function (m, k) { return repl[k] !== undefined ? repl[k] : m; });
        }
        return v;
    }

    function escapeText(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    var STYLE_ID = 'ai-early-access-style';
    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var css = '' +
            '.ai-early-access{display:flex;gap:12px;align-items:flex-start;padding:16px 18px;margin:12px 0;' +
            'border:1px solid var(--color-border,#e4e4e7);border-radius:var(--radius-lg,12px);' +
            'background:var(--color-bg-secondary,#faf5ff);color:var(--color-text,#18181b);text-align:left;}' +
            '.ai-early-access__icon{flex:0 0 auto;width:32px;height:32px;border-radius:50%;display:flex;' +
            'align-items:center;justify-content:center;background:var(--color-primary,#7c3aed);color:#fff;font-size:16px;}' +
            '.ai-early-access__title{font-weight:600;font-size:15px;margin:0 0 4px;}' +
            '.ai-early-access__body{font-size:14px;line-height:1.5;margin:0;color:var(--color-text-secondary,#52525b);}' +
            '.ai-early-access--compact{padding:12px 14px;}' +
            '.ai-early-access--compact .ai-early-access__icon{width:26px;height:26px;font-size:13px;}' +
            '.ai-early-access-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;' +
            'padding:10px 16px;margin:0 0 16px;border-radius:var(--radius-md,8px);background:var(--color-primary,#7c3aed);' +
            'color:#fff;font-size:14px;line-height:1.45;}' +
            '.ai-early-access-banner__close{flex:0 0 auto;background:none;border:0;color:inherit;font-size:20px;' +
            'line-height:1;cursor:pointer;padding:2px 6px;opacity:.85;}' +
            '.ai-early-access-banner__close:hover{opacity:1;}';
        var el = document.createElement('style');
        el.id = STYLE_ID;
        el.textContent = css;
        document.head.appendChild(el);
    }

    /**
     * The early-access card. opts.feature names what's waiting, e.g. "Analyze" (optional).
     * opts.compact for tight spots (chat bubbles, modals).
     */
    function cardHtml(opts) {
        opts = opts || {};
        var title = tr('aiEarlyAccess.cardTitle', 'Royal AI is in early access');
        var body = tr('aiEarlyAccess.cardBody',
            'You’re on the list, and we’ll email you the moment it’s on for your business. Your loyalty app and rewards work as normal.');
        return '<div class="ai-early-access' + (opts.compact ? ' ai-early-access--compact' : '') + '" role="status">' +
            '<div class="ai-early-access__icon" aria-hidden="true">✨</div>' +
            '<div><p class="ai-early-access__title">' + escapeText(title) + '</p>' +
            '<p class="ai-early-access__body">' + escapeText(body) + '</p></div></div>';
    }

    function renderCard(container, opts) {
        if (!container) return null;
        injectStyle();
        container.innerHTML = cardHtml(opts);
        return container.firstElementChild;
    }

    function cardElement(opts) {
        injectStyle();
        var wrap = document.createElement('div');
        wrap.innerHTML = cardHtml(opts);
        return wrap.firstElementChild;
    }

    /** The early-access answer as plain text, for chat bubbles that escape their content. */
    function message() {
        return tr('aiEarlyAccess.chatReply',
            'Royal AI is in early access, so I can’t answer yet. You’re on the list, and we’ll email you the moment it’s on for your business. Your loyalty app and rewards work as normal.');
    }

    /** Put one card directly before `anchor` (an empty-state block, a chat log…). Idempotent. */
    function showCardBefore(anchor, opts) {
        if (!anchor || !anchor.parentNode) return null;
        var prev = anchor.previousElementSibling;
        if (prev && prev.hasAttribute('data-ai-early-access')) return prev;
        var card = cardElement(opts);
        card.setAttribute('data-ai-early-access', '');
        anchor.parentNode.insertBefore(card, anchor);
        return card;
    }

    var BANNER_DISMISSED_KEY = 'royalty_ai_banner_dismissed_v1';
    /**
     * Dashboard / Intelligence: while Royal AI is off, a dismissible strip at the top of the
     * page, and the owner's org goes on the list. Dismissal lasts for the browser session.
     */
    function showBannerIfOff() {
        return get().then(function (s) {
            if (s.enabled) return false;
            ensureWaitlisted('app');
            try { if (sessionStorage.getItem(BANNER_DISMISSED_KEY) === '1') return false; } catch (e) { /* ignore */ }
            if (document.querySelector('.ai-early-access-banner')) return true;
            injectStyle();
            var banner = document.createElement('div');
            banner.className = 'ai-early-access-banner';
            banner.setAttribute('role', 'status');
            banner.innerHTML = '<span class="ai-early-access-banner__msg"><strong>' +
                escapeText(tr('aiEarlyAccess.bannerTitle', 'Royal AI is in early access.')) + '</strong> ' +
                escapeText(tr('aiEarlyAccess.bannerBody', 'You’re on the list, and we’ll email you when it’s on for your business. Everything else works as normal.')) +
                '</span><button type="button" class="ai-early-access-banner__close" aria-label="' +
                escapeText(tr('aiEarlyAccess.dismiss', 'Dismiss')) + '">&times;</button>';
            banner.querySelector('button').addEventListener('click', function () {
                try { sessionStorage.setItem(BANNER_DISMISSED_KEY, '1'); } catch (e) { /* ignore */ }
                banner.remove();
            });
            var main = document.querySelector('main, .main-content, .app-content');
            if (main) main.insertBefore(banner, main.firstChild);
            else document.body.insertBefore(banner, document.body.firstChild);
            return true;
        });
    }

    window.AiStatus = {
        get: get,
        peek: peek,
        isUnavailable: isUnavailable,
        errorBody: errorBody,
        markUnavailable: markUnavailable,
        ensureWaitlisted: ensureWaitlisted,
        cardHtml: cardHtml,
        renderCard: renderCard,
        cardElement: cardElement,
        showCardBefore: showCardBefore,
        message: message,
        showBannerIfOff: showBannerIfOff,
        injectStyle: injectStyle,
        _tr: tr
    };
})();
