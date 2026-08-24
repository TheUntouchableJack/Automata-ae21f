// ===== Workspace mode — which /app pages a signed-in user belongs on =====
//
// Royalty's /app is Jay's owner dashboard. requireAuth() only ever checked
// "is there a session", so any authenticated account landed in the middle of
// it: the full sidebar, organization.html's team roster, and the Intelligence
// Learnings tab with the org's revenue figures.
//
// That became a problem when a client (Pahkie, running the ViibeView social
// app) got an account inside Jay's own org so he could manage venues. He
// doesn't need — and shouldn't stumble into — the rest of the dashboard.
//
// THIS IS NAVIGATION, NOT A SECURITY BOUNDARY. A client shares the org, so
// the same rows are readable straight through the API with his own token. The
// guarantee here is "he won't stumble into it", not "he can't reach it".
//
// The discriminator is `user_metadata.user_type === 'app_member'`, already
// stamped at account creation by handle_new_user()
// (20260821000004_social_signup_trigger.sql). Every existing user has it
// unset, so they resolve to `owner` and nothing about their experience
// changes — and resolving `owner` issues ZERO queries.
//
// Loaded as an IIFE over `window` (the js/venue-hours.js pattern) so a
// side-effect import makes the pure half unit-testable under jsdom.
(function (global) {
    'use strict';

    // ===== The mode table =====
    //
    // The whole extensibility story lives here. `allow: null` means "every
    // page" — today's behaviour, unchanged. Adding 'rewards' to a client's
    // allow list makes Rewards appear in the sidebar AND become reachable:
    // one array element, both effects.
    var MODES = {
        owner:  { landing: '/app/intelligence.html', allow: null },
        client: { landing: '/app/venues.html',       allow: ['venues', 'my-app'] },
        // Signed in, but not a dashboard user at all — e.g. a ViibeView
        // consumer whose session /app happens to accept, because
        // customer-app/social.js uses the default storage key on the same
        // origin. Send them home; do NOT sign them out, that would sign them
        // out of ViibeView too.
        none:   { landing: '/',                      allow: [] }
    };

    var DEFAULT_MODE = 'owner';
    var STORAGE_PREFIX = 'royalty_workspace_mode:';

    // Memo is per-document; the sessionStorage mirror carries the answer
    // across the multi-page /app so the sidebar can read it synchronously
    // before requireAuth() has resolved.
    var memoUserId = null;
    var memoMode = null;

    // ===== Pure =====

    function modeForUser(userType, hasMembership) {
        // Unset / anything else → owner. This is what preserves today's
        // behaviour for every existing account.
        if (userType !== 'app_member') return DEFAULT_MODE;
        return hasMembership ? 'client' : 'none';
    }

    function stripPath(path) {
        if (typeof path !== 'string') return '';
        var s = path.split('#')[0].split('?')[0];
        return s;
    }

    // Moved verbatim from AppSidebar.getCurrentPageId(), with ONE behavioural
    // change: unmapped paths return null instead of falling back to
    // 'dashboard'.
    //
    // That fallback is load-bearing here. organization.html, get-started.html,
    // knowledgebase.html, feature-requests.html and mfa-setup.html are all
    // unmapped; with the old fallback they'd resolve to 'dashboard', and
    // deny-by-default would silently evaporate the day someone allowlists
    // 'dashboard'. The sidebar re-applies the fallback itself so its
    // active-highlight behaviour stays byte-identical.
    //
    // Order is significant — 'support-settings.html' matches both 'support'
    // and 'settings', and 'support' has always won.
    function pageIdForPath(path) {
        var p = stripPath(path);
        if (!p) return null;
        if (p.includes('ceo')) return 'ceo';
        if (p.includes('blog-review')) return 'blog-review';
        // Dashboard page - always highlight 'dashboard' nav item
        if (p.includes('dashboard')) return 'dashboard';
        if (p.includes('project.html')) return 'dashboard'; // Individual project pages
        if (p.includes('intelligence')) return 'intelligence';
        if (p.includes('automations.html')) return 'automations';
        if (p.includes('automation.html')) return 'automations';
        if (p.includes('my-app.html')) return 'my-app';
        if (p.includes('apps.html')) return 'apps';
        if (p.includes('app-builder.html')) return 'apps';
        if (p.includes('customers')) return 'customers';
        if (p.includes('rewards')) return 'rewards';
        if (p.includes('outgoing')) return 'campaigns';
        if (p.includes('roadmap')) return 'roadmap';
        if (p.includes('support')) return 'support';
        if (p.includes('faqs')) return 'support';
        if (p.includes('settings')) return 'settings';
        if (p.includes('launch-plan')) return 'launch-plan';
        if (p.includes('content-generator')) return 'content-generator';
        if (p.includes('admin.html')) return 'admin-panel';
        if (p.includes('upgrade')) return 'upgrade';
        if (p.includes('venues')) return 'venues';
        return null;
    }

    function modeConfig(mode) {
        return MODES[mode] || MODES[DEFAULT_MODE];
    }

    function landingFor(mode) {
        return modeConfig(mode).landing;
    }

    // null = "no filter, render everything" (owner). An array = the exact set.
    function allowedNavIds(mode) {
        return modeConfig(mode).allow;
    }

    function isPageAllowed(mode, path) {
        // A mode's own landing is reachable by definition. Without this, a
        // mode whose landing has no nav id (`none` → '/') would bounce
        // forever. Pinned by a test.
        if (stripPath(path) === stripPath(landingFor(mode))) return true;

        var allow = allowedNavIds(mode);
        if (allow === null) return true;

        var id = pageIdForPath(path);
        if (!id) return false;                 // deny by default
        return allow.indexOf(id) !== -1;
    }

    // ===== Stateful =====

    function storageKey(userId) {
        return STORAGE_PREFIX + userId;
    }

    function prefixedKeys() {
        var out = [];
        try {
            for (var i = 0; i < global.sessionStorage.length; i++) {
                var k = global.sessionStorage.key(i);
                if (k && k.indexOf(STORAGE_PREFIX) === 0) out.push(k);
            }
        } catch (e) {
            // Storage disabled (private mode, sandboxed iframe) — the memo
            // still works within a document.
        }
        return out;
    }

    function readStored(userId) {
        try {
            var v = global.sessionStorage.getItem(storageKey(userId));
            return (v && MODES[v]) ? v : null;
        } catch (e) {
            return null;
        }
    }

    function remember(userId, mode) {
        memoUserId = userId;
        memoMode = mode;
        try {
            // Drop any other user's mirror first: signing out and back in as
            // someone else must not inherit a stale mode, and it keeps mode()
            // able to find "the" key without knowing the user id.
            prefixedKeys().forEach(function (k) {
                if (k !== storageKey(userId)) global.sessionStorage.removeItem(k);
            });
            global.sessionStorage.setItem(storageKey(userId), mode);
        } catch (e) { /* non-fatal */ }
        return mode;
    }

    /**
     * Resolve the workspace mode for a signed-in user.
     *
     * Memoised by user id and mirrored to sessionStorage. For an owner — i.e.
     * every existing account — this makes ZERO queries, which is what makes it
     * safe to put in front of every /app page.
     *
     * @param {object} user Supabase user object the caller already holds
     * @returns {Promise<string>} one of the MODES keys
     */
    async function resolve(user) {
        if (!user || !user.id) return DEFAULT_MODE;
        if (memoUserId === user.id && memoMode) return memoMode;

        var stored = readStored(user.id);
        if (stored) {
            memoUserId = user.id;
            memoMode = stored;
            return stored;
        }

        var meta = user.user_metadata || {};
        if (meta.user_type !== 'app_member') {
            return remember(user.id, DEFAULT_MODE);
        }

        // Only app_members pay for a lookup. Indexed on user_id.
        var hasMembership = false;
        try {
            if (global.supabase && typeof global.supabase.from === 'function') {
                var res = await global.supabase
                    .from('organization_members')
                    .select('organization_id')
                    .eq('user_id', user.id)
                    .limit(1)
                    .maybeSingle();
                hasMembership = !res.error && !!res.data;
            }
        } catch (e) {
            console.warn('AppWorkspace.resolve: membership lookup failed', e);
        }

        return remember(user.id, modeForUser(meta.user_type, hasMembership));
    }

    /**
     * Synchronous accessor. Used by sidebar.js, which runs after
     * requireAuth() has awaited resolve(). Falls back to 'owner' so a page
     * that renders before resolution looks exactly like it does today.
     */
    function mode() {
        if (memoMode) return memoMode;
        var keys = prefixedKeys();
        if (keys.length === 1) {
            try {
                var v = global.sessionStorage.getItem(keys[0]);
                if (v && MODES[v]) return v;
            } catch (e) { /* fall through */ }
        }
        return DEFAULT_MODE;
    }

    /**
     * Bounce a user off a page their mode doesn't include.
     *
     * Uses location.replace() rather than .href so a bounced client can't trap
     * themselves by hitting Back.
     *
     * @returns {Promise<string|null>} the mode, or null when redirecting.
     */
    async function guard(user) {
        var m = await resolve(user);
        if (isPageAllowed(m, global.location.pathname)) return m;
        global.location.replace(landingFor(m));
        return null;
    }

    function clear() {
        memoUserId = null;
        memoMode = null;
        try {
            prefixedKeys().forEach(function (k) {
                global.sessionStorage.removeItem(k);
            });
        } catch (e) { /* non-fatal */ }
    }

    global.AppWorkspace = {
        MODES: MODES,
        DEFAULT_MODE: DEFAULT_MODE,
        modeForUser: modeForUser,
        pageIdForPath: pageIdForPath,
        isPageAllowed: isPageAllowed,
        landingFor: landingFor,
        allowedNavIds: allowedNavIds,
        resolve: resolve,
        mode: mode,
        guard: guard,
        clear: clear
    };
})(typeof window !== 'undefined' ? window : globalThis);
