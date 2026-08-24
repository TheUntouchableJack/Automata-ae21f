/**
 * Workspace mode — which /app pages a signed-in user belongs on.
 *
 * The regression this pins: /app had no role gate at all, so a client account
 * created inside Jay's org landed on get-started.html and could walk into
 * organization.html and the Intelligence Learnings tab. See app/workspace.js
 * for the full history.
 *
 * AppWorkspace is an IIFE over `window`, so a side-effect import populates
 * globalThis.AppWorkspace under jsdom.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../app/workspace.js';

const AppWorkspace = globalThis.AppWorkspace;

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');

// Guard against a vacuous pass: if the import ever stops populating the
// global, every assertion below would throw rather than silently succeed —
// but make the reason explicit.
describe('AppWorkspace module', () => {
    it('is exposed on the global after import', () => {
        expect(AppWorkspace).toBeDefined();
        expect(typeof AppWorkspace.modeForUser).toBe('function');
        expect(Object.keys(AppWorkspace.MODES).sort()).toEqual(['client', 'none', 'owner']);
    });
});

describe('modeForUser()', () => {
    it('treats an unset user_type as owner — every existing account', () => {
        expect(AppWorkspace.modeForUser(undefined, true)).toBe('owner');
        expect(AppWorkspace.modeForUser(undefined, false)).toBe('owner');
        expect(AppWorkspace.modeForUser(null, true)).toBe('owner');
        expect(AppWorkspace.modeForUser('', true)).toBe('owner');
    });

    it('an app_member with an org membership is a client', () => {
        expect(AppWorkspace.modeForUser('app_member', true)).toBe('client');
    });

    it('an app_member with no membership is not a dashboard user at all', () => {
        // A ViibeView consumer. customer-app/social.js shares the default
        // Supabase storage key on this origin, so /app accepts their session.
        expect(AppWorkspace.modeForUser('app_member', false)).toBe('none');
    });

    it('an unrecognized user_type still resolves to owner, not a lockout', () => {
        expect(AppWorkspace.modeForUser('staff', false)).toBe('owner');
    });
});

describe('pageIdForPath()', () => {
    it('maps the pages the sidebar knows about', () => {
        expect(AppWorkspace.pageIdForPath('/app/ceo.html')).toBe('ceo');
        expect(AppWorkspace.pageIdForPath('/app/intelligence.html')).toBe('intelligence');
        expect(AppWorkspace.pageIdForPath('/app/venues.html')).toBe('venues');
        expect(AppWorkspace.pageIdForPath('/app/my-app.html')).toBe('my-app');
        expect(AppWorkspace.pageIdForPath('/app/apps.html')).toBe('apps');
        expect(AppWorkspace.pageIdForPath('/app/app-builder.html')).toBe('apps');
        expect(AppWorkspace.pageIdForPath('/app/project.html')).toBe('dashboard');
        expect(AppWorkspace.pageIdForPath('/app/outgoing.html')).toBe('campaigns');
    });

    it('preserves the support/settings precedence for support-settings.html', () => {
        // 'support-settings.html' matches both; 'support' has always won.
        expect(AppWorkspace.pageIdForPath('/app/support-settings.html')).toBe('support');
        expect(AppWorkspace.pageIdForPath('/app/settings.html')).toBe('settings');
    });

    it('my-app.html does not collide with apps.html', () => {
        expect(AppWorkspace.pageIdForPath('/app/my-app.html')).not.toBe('apps');
    });

    it('ignores query strings and hashes', () => {
        expect(AppWorkspace.pageIdForPath('/app/venues.html?app_id=abc#x')).toBe('venues');
    });

    // THE deny-by-default pin. getCurrentPageId() used to return 'dashboard'
    // for these; if that fallback ever creeps back in, allowlisting
    // 'dashboard' would silently unlock all of them.
    it.each([
        '/app/organization.html',
        '/app/get-started.html',
        '/app/knowledgebase.html',
        '/app/feature-requests.html',
        '/app/mfa-setup.html',
        '/app/login.html',
        '/',
    ])('returns null for the unmapped path %s', (p) => {
        expect(AppWorkspace.pageIdForPath(p)).toBeNull();
    });
});

describe('isPageAllowed() — client', () => {
    it.each([
        '/app/venues.html',
        '/app/venues.html?app_id=abc',
        '/app/my-app.html',
    ])('allows %s', (p) => {
        expect(AppWorkspace.isPageAllowed('client', p)).toBe(true);
    });

    it.each([
        '/app/ceo.html',
        '/app/get-started.html',
        '/app/organization.html',
        '/app/apps.html',
        '/app/app-builder.html',
        '/app/intelligence.html',
        '/app/customers.html',
        '/app/settings.html',
        '/app/knowledgebase.html',
        '/app/admin.html',
    ])('denies %s', (p) => {
        expect(AppWorkspace.isPageAllowed('client', p)).toBe(false);
    });
});

describe('isPageAllowed() — owner is unaffected', () => {
    it.each([
        '/app/intelligence.html',
        '/app/dashboard.html',
        '/app/apps.html',
        '/app/app-builder.html',
        '/app/customers.html',
        '/app/settings.html',
        '/app/organization.html',
        '/app/get-started.html',
        '/app/ceo.html',
        '/app/venues.html',
        '/app/my-app.html',
        '/app/knowledgebase.html',
    ])('allows %s', (p) => {
        expect(AppWorkspace.isPageAllowed('owner', p)).toBe(true);
    });

    it('an unknown mode falls back to owner rather than locking anyone out', () => {
        expect(AppWorkspace.isPageAllowed('bogus', '/app/customers.html')).toBe(true);
        expect(AppWorkspace.landingFor('bogus')).toBe('/app/intelligence.html');
    });
});

describe('isPageAllowed() — none', () => {
    it('allows only the landing', () => {
        expect(AppWorkspace.isPageAllowed('none', '/')).toBe(true);
        expect(AppWorkspace.isPageAllowed('none', '/app/venues.html')).toBe(false);
        expect(AppWorkspace.isPageAllowed('none', '/app/intelligence.html')).toBe(false);
    });
});

// The redirect-loop pin. guard() sends a denied user to landingFor(mode); if
// that landing isn't itself allowed, they bounce forever.
describe('every mode can reach its own landing', () => {
    it.each(Object.keys(AppWorkspace.MODES))('%s', (m) => {
        expect(AppWorkspace.isPageAllowed(m, AppWorkspace.landingFor(m))).toBe(true);
    });
});

describe('allowedNavIds()', () => {
    it('is null for owner — meaning no filter at all', () => {
        expect(AppWorkspace.allowedNavIds('owner')).toBeNull();
    });

    it('is the exact set for client', () => {
        expect(AppWorkspace.allowedNavIds('client')).toEqual(['venues', 'my-app']);
    });
});

describe('resolve() / mode() / clear()', () => {
    beforeEach(() => {
        AppWorkspace.clear();
    });

    it('resolves an ordinary user to owner with zero queries', async () => {
        let queried = false;
        globalThis.supabase = { from() { queried = true; throw new Error('should not query'); } };

        const m = await AppWorkspace.resolve({ id: 'u1', user_metadata: {} });
        expect(m).toBe('owner');
        expect(queried).toBe(false);
        delete globalThis.supabase;
    });

    it('mode() reads the sessionStorage mirror synchronously', async () => {
        await AppWorkspace.resolve({ id: 'u1', user_metadata: {} });
        expect(AppWorkspace.mode()).toBe('owner');
    });

    it('clear() drops the mirror and falls back to owner', async () => {
        await AppWorkspace.resolve({ id: 'u1', user_metadata: {} });
        AppWorkspace.clear();
        expect(globalThis.sessionStorage.length).toBe(0);
        expect(AppWorkspace.mode()).toBe('owner');
    });

    it('an app_member with a membership resolves to client', async () => {
        globalThis.supabase = {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        limit: () => ({
                            maybeSingle: async () => ({ data: { organization_id: 'org1' }, error: null })
                        })
                    })
                })
            })
        };

        const m = await AppWorkspace.resolve({ id: 'pahkie', user_metadata: { user_type: 'app_member' } });
        expect(m).toBe('client');
        expect(AppWorkspace.mode()).toBe('client');
        delete globalThis.supabase;
    });

    it('an app_member with no membership resolves to none', async () => {
        globalThis.supabase = {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) })
                    })
                })
            })
        };

        const m = await AppWorkspace.resolve({ id: 'consumer', user_metadata: { user_type: 'app_member' } });
        expect(m).toBe('none');
        delete globalThis.supabase;
    });

    it('switching users does not inherit the previous mode', async () => {
        globalThis.supabase = {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        limit: () => ({
                            maybeSingle: async () => ({ data: { organization_id: 'org1' }, error: null })
                        })
                    })
                })
            })
        };
        expect(await AppWorkspace.resolve({ id: 'pahkie', user_metadata: { user_type: 'app_member' } })).toBe('client');
        delete globalThis.supabase;

        // Jay signs in in the same tab. No query is made for him, so a stale
        // mirror would be the only source of an answer.
        expect(await AppWorkspace.resolve({ id: 'jay', user_metadata: {} })).toBe('owner');
        expect(AppWorkspace.mode()).toBe('owner');
    });
});

// The mechanical pass over ~30 pages is only maintainable if something checks
// it. Every authenticated page must load workspace.js BEFORE auth.js (which
// calls guard()) and before sidebar.js (which calls mode()).
describe('script-tag invariant across app/*.html', () => {
    const files = fs.readdirSync(APP_DIR)
        .filter((f) => f.endsWith('.html'))
        .map((f) => ({ name: f, html: fs.readFileSync(path.join(APP_DIR, f), 'utf8') }))
        .filter((f) => f.html.includes('auth.js?v='));

    it('found the pages to check', () => {
        // Without this the suite below passes vacuously the day the glob or
        // the ?v= convention changes.
        expect(files.length).toBeGreaterThan(20);
    });

    it.each(files.map((f) => f.name))('%s loads workspace.js before auth.js and sidebar.js', (name) => {
        const html = files.find((f) => f.name === name).html;
        const ws = html.indexOf('workspace.js?v=');
        const auth = html.indexOf('auth.js?v=');

        expect(ws).toBeGreaterThan(-1);
        expect(ws).toBeLessThan(auth);

        const sidebar = html.indexOf('sidebar.js?v=');
        if (sidebar > -1) expect(ws).toBeLessThan(sidebar);
    });
});
