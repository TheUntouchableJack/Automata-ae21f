/**
 * Guards for Jay's 2026-10-14 ViibeView round, Phase 2:
 *
 *   SQL      20261014000001 hide a Viibe (social_hidden_posts + five readers)
 *            20261014000002 the report review queue
 *            20261014000003 get_social_post, for shared links
 *   Edge     report-content links the email to the Reports tab
 *   Client   Hide (signed in and out, Undo, merge at sign-in), report also
 *            hides, Share (sheet, links, copy), shared links (?post= ?venue=),
 *            the map preview's ⋯
 *   Admin    the Reports tab; Delete goes through delete-social-post
 *
 * ⚠️ The SQL assertions read the LIVE definition (the last CREATE of a function
 * across all migrations, comments stripped). Absence assertions run on
 * comment-stripped text. Slices are bounded at both ends.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const js = read('customer-app/social.js');
const html = read('customer-app/social.html');
const css = read('customer-app/social.css');
const admin = read('app/venues.html');
const reportFn = read('supabase/functions/report-content/index.ts');

const sql = name => fs.readFileSync(path.join(MIGRATIONS, name), 'utf8');
const HIDE_FILE = '20261014000001_hidden_posts.sql';
const REVIEW_FILE = '20261014000002_report_review.sql';
const POST_FILE = '20261014000003_get_social_post.sql';
const hideSql = sql(HIDE_FILE);
const reviewSql = sql(REVIEW_FILE);
const postSql = sql(POST_FILE);

/** SQL with `--` comment text removed. */
function sqlCode(text) {
    return text.split('\n').map(l => {
        const i = l.indexOf('--');
        return i < 0 ? l : l.slice(0, i);
    }).join('\n');
}

const migrationFiles = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort();

function latestDefinition(fn) {
    let found = null;
    const re = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION (?:public\\.)?${fn}\\(`, 'g');
    for (const file of migrationFiles) {
        const text = sqlCode(sql(file));
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text))) {
            const end = text.indexOf('\n$$;', m.index);
            if (end < 0) continue;
            found = { file, body: text.slice(m.index, end + 4) };
        }
    }
    return found;
}

/** The raw block (comments kept) of `fn` in one file — exactly one. */
function rawBlock(text, fn) {
    const re = new RegExp(`^CREATE (?:OR REPLACE )?FUNCTION ${fn}\\(`, 'gm');
    const starts = [...text.matchAll(re)].map(m => m.index);
    expect(starts.length, `${fn}: expected exactly one definition`).toBe(1);
    const end = text.indexOf('\n$$;', starts[0]);
    expect(end, `${fn}: unterminated`).toBeGreaterThan(starts[0]);
    return text.slice(starts[0], end + 4);
}

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

const HIDDEN = 'AND NOT EXISTS (SELECT 1 FROM social_hidden_posts h WHERE h.media_id = vm.id AND h.user_id = auth.uid())';
const HIDDEN_LINES = [
    '      -- Hidden by this viewer (20261014000001). auth.uid() is NULL for a',
    '      -- signed-out caller, so this matches nothing and filters nothing.',
    `      ${HIDDEN}`,
].join('\n') + '\n';

const READERS = [
    ['get_venue_feed_v3', '20261006000003_feed_morning_reset.sql'],
    ['get_following_feed_v3', '20261006000003_feed_morning_reset.sql'],
    ['get_venue_page_feed', '20261006000003_feed_morning_reset.sql'],
    ['get_recent_post_pins', '20261006000003_feed_morning_reset.sql'],
    ['get_member_posts', '20260903000002_member_profiles.sql'],
];
const OPEN_READERS = ['get_venue_feed_v3', 'get_venue_page_feed', 'get_recent_post_pins', 'get_member_posts'];

// ===========================================================================
// SQL — hide a Viibe
// ===========================================================================

describe('20261014000001 — hide a Viibe, in all five readers', () => {
    for (const [fn, source] of READERS) {
        it(`${fn}: the live definition carries the hidden line, once`, () => {
            const def = latestDefinition(fn);
            expect(def, `${fn} not found`).toBeTruthy();
            expect(def.file).toBe(HIDE_FILE);
            expect(def.body.split(HIDDEN).length - 1, `${fn}: hidden predicate count`).toBe(1);
            expect(def.body).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
        });

        it(`${fn}: carried forward VERBATIM from ${source}, plus that line`, () => {
            // Removing the three inserted lines must give back the source
            // block byte for byte (CREATE vs CREATE OR REPLACE aside — the page
            // feed was a bare CREATE after a DROP in 20261006000003).
            const now = rawBlock(hideSql, fn);
            const before = rawBlock(sql(source), fn)
                .replace(/^CREATE FUNCTION /, 'CREATE OR REPLACE FUNCTION ');
            expect(now.split(HIDDEN_LINES).length - 1, `${fn}: the inserted lines`).toBe(1);
            expect(now.replace(HIDDEN_LINES, '')).toBe(before);
        });
    }

    it('⚠️ NO grant footer on the open readers; the Following feed keeps its own', () => {
        const code = sqlCode(hideSql);
        for (const fn of OPEN_READERS) {
            expect(code, `${fn} got a REVOKE`).not.toMatch(new RegExp(`REVOKE[^;]*FUNCTION ${fn}\\(`));
            expect(code, `${fn} got a GRANT`).not.toMatch(new RegExp(`GRANT[^;]*FUNCTION ${fn}\\(`));
        }
        expect(code).toMatch(/REVOKE ALL ON FUNCTION get_following_feed_v3\([^)]*\) FROM PUBLIC;/);
        expect(code).toMatch(/REVOKE ALL ON FUNCTION get_following_feed_v3\([^)]*\) FROM anon;/);
        expect(code).toMatch(/GRANT EXECUTE ON FUNCTION get_following_feed_v3\([^)]*\) TO authenticated;/);
        // ...and the page feed is REPLACED, not dropped (a DROP would take the
        // default PUBLIC grant's continuity with it mid-migration).
        expect(code).not.toMatch(/DROP FUNCTION[^;]*get_venue_page_feed/);
    });

    it('the table: (user_id, media_id) key, RLS read-own, no client writes', () => {
        const code = sqlCode(hideSql);
        expect(code).toMatch(/CREATE TABLE IF NOT EXISTS social_hidden_posts \(/);
        expect(code).toMatch(/user_id\s+UUID NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
        expect(code).toMatch(/media_id\s+UUID NOT NULL REFERENCES venue_media\(id\) ON DELETE CASCADE/);
        expect(code).toMatch(/PRIMARY KEY \(user_id, media_id\)/);
        expect(code).toMatch(/ALTER TABLE social_hidden_posts ENABLE ROW LEVEL SECURITY;/);
        expect(code).toMatch(/ON social_hidden_posts FOR SELECT\s+TO authenticated\s+USING \(user_id = auth\.uid\(\)\);/);
        // ⚠️ FROM PUBLIC does not reach anon or authenticated in Supabase.
        expect(code).toContain('REVOKE ALL ON TABLE social_hidden_posts FROM anon;');
        expect(code).toContain('REVOKE ALL ON TABLE social_hidden_posts FROM authenticated;');
        expect(code).toContain('GRANT SELECT ON TABLE social_hidden_posts TO authenticated;');
        expect(code).not.toMatch(/GRANT (?:INSERT|UPDATE|DELETE|ALL)[^;]*social_hidden_posts/);
    });

    it('hide/unhide: signed-in only, footers, and your own post is refused', () => {
        const hide = latestDefinition('hide_social_post');
        const unhide = latestDefinition('unhide_social_post');
        expect(hide.file).toBe(HIDE_FILE);
        expect(unhide.file).toBe(HIDE_FILE);
        for (const def of [hide, unhide]) {
            expect(def.body).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
            expect(def.body).toMatch(/IF v_user_id IS NULL THEN\s+RETURN QUERY SELECT false/);
        }
        expect(hide.body).toMatch(/IF v_media\.uploaded_by_user_id = v_user_id THEN\s+RETURN QUERY SELECT false/);
        expect(hide.body).toContain('ON CONFLICT (user_id, media_id) DO NOTHING');
        // unhide deletes only the CALLER's row.
        expect(unhide.body).toMatch(/DELETE FROM social_hidden_posts\s+WHERE user_id = v_user_id\s+AND media_id = p_media_id;/);
        const code = sqlCode(hideSql);
        for (const fn of ['hide_social_post', 'unhide_social_post']) {
            expect(code).toContain(`REVOKE ALL ON FUNCTION ${fn}(UUID) FROM PUBLIC;`);
            expect(code).toContain(`REVOKE ALL ON FUNCTION ${fn}(UUID) FROM anon;`);
            expect(code).toContain(`GRANT EXECUTE ON FUNCTION ${fn}(UUID) TO authenticated;`);
        }
    });

    it('install checks run both directions', () => {
        const code = sqlCode(hideSql);
        const doBlock = code.slice(code.lastIndexOf('DO $$'), code.lastIndexOf('END $$;'));
        expect(doBlock.length).toBeGreaterThan(1000);
        for (const sig of ['get_venue_feed_v3(uuid,', 'get_venue_page_feed(uuid, uuid, integer, integer)',
            'get_recent_post_pins(uuid, integer)', 'get_member_posts(uuid, uuid, integer, integer)']) {
            expect(doBlock, sig).toContain(`'public.${sig}`);
        }
        expect(doBlock).toMatch(/IF NOT has_function_privilege\('anon', v_fn, 'EXECUTE'\) THEN/);
        expect(doBlock).toMatch(/'public\.hide_social_post\(uuid\)'/);
        expect(doBlock).toMatch(/IF has_function_privilege\('anon', v_fn, 'EXECUTE'\) THEN/);
    });
});

// ===========================================================================
// SQL — the report review queue
// ===========================================================================

describe('20261014000002 — reviewing reports', () => {
    it('content_reports gains a constrained status, reviewer and time', () => {
        const code = sqlCode(reviewSql);
        expect(code).toMatch(/ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open'\s+CHECK \(status IN \('open', 'dismissed', 'removed'\)\)/);
        expect(code).toMatch(/ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES profiles\(id\) ON DELETE SET NULL/);
        expect(code).toMatch(/ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ/);
    });

    it('list_content_reports: the app team only, one row per post', () => {
        const def = latestDefinition('list_content_reports');
        expect(def.file).toBe(REVIEW_FILE);
        expect(def.body).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
        // The org-member gate comes BEFORE the query.
        const gate = def.body.indexOf('JOIN organization_members om ON om.organization_id = ca.organization_id');
        const query = def.body.indexOf('RETURN QUERY');
        expect(gate).toBeGreaterThan(0);
        expect(gate).toBeLessThan(query);
        expect(def.body).toMatch(/WHERE ca\.id = p_app_id\s+AND om\.user_id = v_user_id/);
        expect(def.body).toMatch(/GROUP BY s\.media_id\n/);
        expect(def.body).toContain('#variable_conflict use_column');
        expect(def.body).toMatch(/cr\.app_id = p_app_id/);
    });

    it("review_content_report: remove HIDES (status 'removed'), never deletes", () => {
        const def = latestDefinition('review_content_report');
        expect(def.file).toBe(REVIEW_FILE);
        expect(def.body).not.toMatch(/DELETE FROM/);
        const remove = def.body.slice(def.body.indexOf("IF p_action = 'remove' THEN"), def.body.indexOf("ELSIF p_action = 'dismiss' THEN"));
        expect(remove.length).toBeGreaterThan(100);
        expect(remove).toMatch(/UPDATE venue_media SET status = 'removed'\s+WHERE id = p_media_id AND status = 'approved';/);
        expect(remove).toMatch(/SET status = 'removed', reviewed_by = v_user_id, reviewed_at = v_now\s+WHERE media_id = p_media_id AND status = 'open';/);
        const restore = def.body.slice(def.body.indexOf('    ELSE\n'), def.body.indexOf('    END IF;\n\n    RETURN QUERY SELECT true'));
        expect(restore.length).toBeGreaterThan(100);
        expect(restore).toMatch(/UPDATE venue_media SET status = 'approved'\s+WHERE id = p_media_id AND status = 'removed';/);
        // Org members of the POST's app, checked before anything is written.
        expect(def.body.indexOf('JOIN organization_members')).toBeLessThan(def.body.indexOf('UPDATE venue_media'));
        expect(def.body).toMatch(/WHERE ca\.id = v_app_id\s+AND om\.user_id = v_user_id/);
    });

    it('both RPCs carry the footer; anon is refused at install', () => {
        const code = sqlCode(reviewSql);
        for (const sig of ['list_content_reports(UUID, TEXT)', 'review_content_report(UUID, TEXT)']) {
            expect(code).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;`);
            expect(code).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM anon;`);
            expect(code).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated;`);
        }
        expect(code).toMatch(/IF has_function_privilege\('anon', v_fn, 'EXECUTE'\) THEN/);
        // ⚠️ Not a has_table_privilege check on content_reports: Supabase's
        // default grants would fail it on a correct database.
        expect(code).not.toMatch(/has_table_privilege\('anon', 'public\.content_reports'/);
    });

    it("every surface a removed post could appear on filters status = 'approved'", () => {
        for (const fn of ['get_venue_feed_v3', 'get_following_feed_v3', 'get_venue_page_feed',
            'get_recent_post_pins', 'get_member_posts', 'get_social_post', 'get_member_venues',
            'get_venue_detail']) {
            const def = latestDefinition(fn);
            expect(def, `${fn} not found`).toBeTruthy();
            // get_venue_detail aliases its subquery vm2.
            expect(def.body, `${fn} would show a removed post`).toMatch(/vm2?\.status\s*=\s*'approved'/);
        }
    });
});

// ===========================================================================
// SQL — one post, for a shared link
// ===========================================================================

describe('20261014000003 — get_social_post', () => {
    const def = () => latestDefinition('get_social_post');

    it('returns the feed row shape, column for column', () => {
        const cols = body => body.slice(body.indexOf('RETURNS TABLE ('), body.indexOf(')\nLANGUAGE'));
        const mine = cols(def().body);
        expect(mine.length).toBeGreaterThan(500);
        expect(mine).toBe(cols(latestDefinition('get_venue_feed_v3').body));
    });

    it("opens exactly when the post's venue page — or its author's profile — would show it", () => {
        const body = def().body;
        expect(body).toMatch(/WHERE vm\.id = p_post_id\s+AND vm\.app_id = p_app_id\s+AND vm\.status = 'approved'/);
        // The venue page's lifetime predicate, verbatim.
        expect(body).toContain('(v_ttl_hours IS NULL\n                  OR vm.is_permanent\n                  OR vm.created_at > now() - make_interval(secs => (v_ttl_hours * 3600)::DOUBLE PRECISION))');
        expect(body).toMatch(/vm\.venue_id IS NOT NULL AND v\.id IS NOT NULL/);
        // No venue: the profile gate get_member_posts applies.
        expect(body).toMatch(/vm\.venue_id IS NULL\s+AND \(am\.profile_public IS TRUE\s+OR \(auth\.uid\(\) IS NOT NULL AND auth\.uid\(\) = vm\.uploaded_by_user_id\)\)/);
        expect(body).toContain(HIDDEN);
        expect(body).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
    });

    it('⚠️ readable signed out: no footer, asserted at install', () => {
        const code = sqlCode(postSql);
        expect(code).not.toMatch(/REVOKE[^;]*get_social_post/);
        expect(code).toMatch(/IF NOT has_function_privilege\('anon', 'public\.get_social_post\(uuid, uuid\)', 'EXECUTE'\) THEN/);
    });
});

describe('report-content (edge function)', () => {
    it('the email links straight to the Reports tab', () => {
        expect(reportFn).toContain('href="https://royaltyapp.ai/app/venues.html#reports"');
        expect(reportFn).not.toContain('href="https://royaltyapp.ai/app/venues.html"');
    });
});

// ===========================================================================
// jsdom harness
// ===========================================================================

let w, d;
const tick = () => new Promise(r => setTimeout(r, 0));
const UA = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
};
const setUA = ua => Object.defineProperty(w.navigator, 'userAgent', { get: () => ua, configurable: true });
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_V = '22222222-2222-4222-8222-222222222222';

async function boot(url = 'https://royaltyapp.ai/a/viibeview/social') {
    const dom = new JSDOM(html, { runScripts: 'dangerously', url });
    w = dom.window;
    d = w.document;
    w.localStorage.setItem('viibeview_onboarded_v1', '1');
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

    w.__rpcCalls = [];
    w.__rpc = () => ({ data: null, error: null });
    const thenable = { then: (r) => r({ data: null, error: new Error('stubbed') }) };
    const chain = new Proxy(thenable, { get: (t, k) => (k in t ? t[k] : () => chain) });
    w.supabase = {
        createClient: () => ({
            auth: { getSession: async () => ({ data: { session: null } }) },
            from: () => chain,
            rpc: (name, args) => {
                w.__rpcCalls.push({ name, args });
                return Promise.resolve(w.__rpc(name, args));
            },
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
    load('customer-app/social-auth.js');
    load('customer-app/social.js');
    w.showEmptyState = () => {};
    w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    // jsdom has no requestAnimationFrame; the Undo toast fades in with one.
    w.requestAnimationFrame = cb => setTimeout(cb, 0);
    await tick();
    w.eval("currentApp = { id: 'app-1', name: 'ViibeView', organization_id: 'org-1' }; appSlug = 'viibeview';");
    w.__toasts = [];
    w.showToast = m => w.__toasts.push(m);
}

const vid = (id, over = {}) => ({
    id, media_type: 'video', url: `https://cdn.test/${id}.mp4`, thumbnail_url: `https://cdn.test/${id}.jpg`,
    venue_id: null, uploaded_by_user_id: 'author-1', ...over,
});
const ids = expr => w.eval(`${expr}.map(p => p.id)`);
const stored = () => JSON.parse(w.localStorage.getItem('viibeview_hidden_v1') || '[]');

// ===========================================================================
// Client — Hide
// ===========================================================================

describe('Hide a Viibe (jsdom)', () => {
    beforeEach(async () => { await boot(); });

    it('the option is there for everyone but the author — signed out included', () => {
        w.eval(`feedItems = ${JSON.stringify([vid('a'), vid('mine', { uploaded_by_user_id: 'me-1' })])};`);
        w.eval("showPostOptions('a')");
        expect(d.getElementById('post-options-body').innerHTML).toContain('hidePost(optionsMediaId)');
        w.eval("closePostOptions(); currentUserId = 'me-1'; showPostOptions('mine')");
        expect(d.getElementById('post-options-body').innerHTML, 'the author was offered Hide').not.toContain('hidePost(');
        // Share is offered to everyone.
        expect(d.getElementById('post-options-body').innerHTML).toContain('sharePostFromOptions()');
    });

    it('signed out: stored on the device, gone from every list, the count untouched', async () => {
        w.eval(`feedItems = ${JSON.stringify([vid('a'), vid('b'), vid('c')])};
                memberPageUserId = 'author-1';
                memberPageProfile = { user_id: 'author-1', post_count: 3 };
                memberPagePosts = ${JSON.stringify([vid('a'), vid('b'), vid('c')])};
                postPins = ${JSON.stringify([vid('b')])};`);
        await w.eval("hidePost('b')");
        expect(stored()).toEqual(['b']);
        expect(ids('feedItems')).toEqual(['a', 'c']);
        expect(ids('memberPagePosts')).toEqual(['a', 'c']);
        expect(ids('postPins')).toEqual([]);
        expect(w.eval('memberPageProfile.post_count'), 'a hide is not a delete').toBe(3);
        expect(w.__rpcCalls.filter(c => c.name === 'hide_social_post')).toEqual([]);
    });

    it('Undo puts it back where it was, and forgets the hide', async () => {
        w.eval(`feedItems = ${JSON.stringify([vid('a'), vid('b'), vid('c')])};`);
        await w.eval("hidePost('b')");
        const toast = d.querySelector('.social-toast-action');
        expect(toast, 'no Undo toast').toBeTruthy();
        toast.querySelector('.social-toast-btn').click();
        await tick();
        expect(ids('feedItems')).toEqual(['a', 'b', 'c']);
        expect(stored()).toEqual([]);
    });

    it('signed in: the RPC, and a refusal leaves the post where it is', async () => {
        w.eval(`currentUserId = 'me-1'; feedItems = ${JSON.stringify([vid('a'), vid('b')])};`);
        w.__rpc = (name) => name === 'hide_social_post'
            ? { data: [{ success: false, error_message: 'You cannot hide your own post' }], error: null }
            : { data: null, error: null };
        await w.eval("hidePost('b')");
        expect(w.__rpcCalls.find(c => c.name === 'hide_social_post').args).toEqual({ p_media_id: 'b' });
        expect(ids('feedItems')).toEqual(['a', 'b']);
        expect(w.__toasts).toEqual(['You cannot hide your own post']);
        expect(stored(), 'a signed-in hide must not touch the device list').toEqual([]);

        w.__rpc = () => ({ data: [{ success: true, error_message: null }], error: null });
        await w.eval("hidePost('b')");
        expect(ids('feedItems')).toEqual(['a']);
        // Undo goes through unhide.
        d.querySelector('.social-toast-action .social-toast-btn').click();
        await tick(); await tick();
        expect(w.__rpcCalls.at(-1)).toEqual({ name: 'unhide_social_post', args: { p_media_id: 'b' } });
        expect(ids('feedItems')).toEqual(['a', 'b']);
    });

    it('every list load filters the device list (feed, pins, member posts)', async () => {
        w.localStorage.setItem('viibeview_hidden_v1', JSON.stringify(['b']));
        w.__rpc = (name) => ({ data: [vid('a'), vid('b'), vid('c')], error: null });
        await w.eval('loadFeed(false)');
        expect(ids('feedItems')).toEqual(['a', 'c']);
        await w.eval('loadPostPins()');
        expect(ids('postPins')).toEqual(['a', 'c']);
        w.eval("memberPageUserId = 'author-1'");
        await w.eval('loadMemberPosts()');
        expect(ids('memberPagePosts')).toEqual(['a', 'c']);
    });

    it('the venue page load filters it too (static: all four loaders)', () => {
        expect(js).toContain('feedItems = [...feedItems, ...withoutHidden(data)];');
        expect(js).toContain('feedItems = withoutHidden(data || []);');
        expect(js).toContain('postPins = withoutHidden(data || []);');
        expect(js).toContain('venuePageFeed = [...venuePageFeed, ...withoutHidden(data)];');
        expect(js).toContain('venuePageFeed = withoutHidden(data || []);');
        expect(js).toContain('memberPagePosts = withoutHidden(data || []);');
        // Paging still counts the RAW page.
        expect(js).toContain('feedOffset += (data || []).length;');
        expect(js).toContain('venuePageOffset += (data || []).length;');
    });

    it('at sign-in the device list moves onto the account; a network failure keeps an id', async () => {
        w.localStorage.setItem('viibeview_hidden_v1', JSON.stringify(['a', 'b']));
        w.eval("currentUserId = 'me-1'");
        w.__rpc = (name, args) => args.p_media_id === 'b'
            ? { data: null, error: { message: 'offline' } }
            : { data: [{ success: true }], error: null };
        await w.eval('mergeLocalHidden()');
        expect(w.__rpcCalls.filter(c => c.name === 'hide_social_post').map(c => c.args.p_media_id)).toEqual(['a', 'b']);
        expect(stored()).toEqual(['b']);
        expect(fnBody('async function onSignedIn()')).toContain('mergeLocalHidden()');
    });

    it('hiding the Viibe in the player moves it on; hiding the last closes it', async () => {
        w.eval(`mePosts = []; memberPageUserId = 'author-1';
                memberPagePosts = ${JSON.stringify([vid('a'), vid('b')])}; openMemberPost('a');`);
        expect(d.getElementById('viibe-viewer').classList.contains('visible')).toBe(true);
        await w.eval("hidePost('a')");
        expect([...d.querySelectorAll('#viibe-viewer .feed-panel')].map(p => p.dataset.mediaId)).toEqual(['b']);
        await w.eval("hidePost('b')");
        expect(d.getElementById('viibe-viewer').classList.contains('visible')).toBe(false);
    });
});

describe('Report also hides it for the reporter (jsdom)', () => {
    beforeEach(async () => { await boot(); });

    it('a successful report removes the post here, with the translated thanks', async () => {
        w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true }) });
        w.eval(`feedItems = ${JSON.stringify([vid('a'), vid('b')])}; optionsMediaId = 'b';`);
        await w.eval("submitReport('spam')");
        expect(ids('feedItems')).toEqual(['a']);
        expect(stored()).toEqual(['b']);
        expect(w.__toasts).toEqual(['Thanks, we will review this.']);
        expect(fnCode('async function submitReport(reason)'))
            .toContain("translateOr('social.reportThanks', null, 'Thanks, we will review this.')");
    });

    it('a failed report hides nothing', async () => {
        w.fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: 'Too many reports. Please try again later.' }) });
        w.eval(`feedItems = ${JSON.stringify([vid('a'), vid('b')])}; optionsMediaId = 'b';`);
        await w.eval("submitReport('spam')");
        expect(ids('feedItems')).toEqual(['a', 'b']);
        expect(stored()).toEqual([]);
        expect(w.__toasts).toEqual(['Too many reports. Please try again later.']);
    });
});

// ===========================================================================
// Client — Share
// ===========================================================================

describe('Share (jsdom)', () => {
    beforeEach(async () => { await boot(); });

    it('links: /a/{slug}/social?post=…&venue=…, or ?venue=…', () => {
        expect(w.eval(`shareUrl({ postId: '${UUID_A}', venueId: '${UUID_V}' })`))
            .toBe(`https://royaltyapp.ai/a/viibeview/social?post=${UUID_A}&venue=${UUID_V}`);
        expect(w.eval(`shareUrl({ venueId: '${UUID_V}' })`))
            .toBe(`https://royaltyapp.ai/a/viibeview/social?venue=${UUID_V}`);
    });

    it('Messages uses sms:&body= on iOS and sms:?body= elsewhere; Email is a mailto', () => {
        setUA(UA.iphone);
        const ios = w.eval(`shareLinks({ postId: '${UUID_A}' })`);
        expect(ios.sms.startsWith('sms:&body=')).toBe(true);
        expect(decodeURIComponent(ios.sms.slice('sms:&body='.length)))
            .toBe(`A Viibe on ViibeView https://royaltyapp.ai/a/viibeview/social?post=${UUID_A}`);
        setUA(UA.androidPhone);
        const android = w.eval(`shareLinks({ postId: '${UUID_A}' })`);
        expect(android.sms.startsWith('sms:?body=')).toBe(true);
        expect(android.email.startsWith('mailto:?subject=A%20Viibe%20on%20ViibeView&body=')).toBe(true);
    });

    it('a post at a known venue names it', () => {
        w.eval(`venues = [{ id: '${UUID_V}', name: 'Blue Room' }]`);
        expect(w.eval(`shareText({ postId: '${UUID_A}', venueId: '${UUID_V}' })`)).toBe('A Viibe from Blue Room on ViibeView');
        expect(w.eval(`shareText({ venueId: '${UUID_V}' })`)).toBe('Blue Room on ViibeView');
    });

    it('the sheet: Messages, Email, Copy link; More… only where the browser can share', () => {
        w.eval(`openShareSheet({ postId: '${UUID_A}' })`);
        expect(d.getElementById('share-sheet').classList.contains('visible')).toBe(true);
        const body = d.getElementById('share-options');
        const hrefs = [...body.querySelectorAll('a.post-option')].map(a => a.getAttribute('href'));
        expect(hrefs[0].startsWith('sms:')).toBe(true);
        expect(hrefs[1].startsWith('mailto:')).toBe(true);
        expect(body.innerHTML).toContain('copyShareLink()');
        expect(body.innerHTML, 'More… without navigator.share').not.toContain('nativeShare()');

        w.eval('closeShareSheet()');
        w.navigator.share = async () => {};
        w.eval(`openShareSheet({ postId: '${UUID_A}' })`);
        expect(d.getElementById('share-options').innerHTML).toContain('nativeShare()');
    });

    it('Copy link: the Clipboard API, then a textarea, then the link itself', async () => {
        const writes = [];
        Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async t => { writes.push(t); } }, configurable: true });
        w.eval(`openShareSheet({ venueId: '${UUID_V}' })`);
        await w.eval('copyShareLink()');
        expect(writes).toEqual([`https://royaltyapp.ai/a/viibeview/social?venue=${UUID_V}`]);
        expect(w.__toasts.at(-1)).toBe('Link copied');
        expect(d.getElementById('share-sheet').classList.contains('visible')).toBe(false);

        // No Clipboard API: the textarea fallback copies.
        Object.defineProperty(w.navigator, 'clipboard', { value: undefined, configurable: true });
        const copiedTexts = [];
        d.execCommand = cmd => { copiedTexts.push([cmd, d.activeElement?.value ?? null]); return cmd === 'copy'; };
        w.eval(`openShareSheet({ postId: '${UUID_A}' })`);
        await w.eval('copyShareLink()');
        expect(copiedTexts.map(c => c[0])).toEqual(['copy']);
        expect(w.__toasts.at(-1)).toBe('Link copied');
        expect(d.querySelectorAll('textarea[readonly]').length, 'the helper textarea was left behind').toBe(0);

        d.execCommand = () => false;
        w.eval(`openShareSheet({ venueId: '${UUID_V}' })`);
        await w.eval('copyShareLink()');
        expect(w.__toasts.at(-1), 'nothing could copy: show the link').toBe(`https://royaltyapp.ai/a/viibeview/social?venue=${UUID_V}`);
    });

    it('the buttons: every panel strip, the venue page, and post options', () => {
        const strip = fnCode('function venueStripMarkup(item, identity)');
        expect(strip).toContain(`onclick="sharePost('\${escapeHtml(item.id)}')"`);
        const page = fnCode('async function openVenuePage(venueId)');
        expect(page).toContain("onclick=\"openShareSheet({ venueId: '${escapeHtml(venue.id)}' })\"");
        w.eval(`feedItems = ${JSON.stringify([vid('a', { venue_id: UUID_V })])}; optionsMediaId = 'a'; renderPostOptionsMain();`);
        w.eval('sharePostFromOptions()');
        expect(d.getElementById('post-options-sheet').classList.contains('visible')).toBe(false);
        expect(w.eval('shareTarget')).toEqual({ postId: 'a', venueId: UUID_V });
    });

    it('the sheet sits on the post-options level and back closes it', () => {
        expect(css).toMatch(/#post-options-sheet,\n#edit-profile-sheet,\n#share-sheet \{\n    z-index: 2920;/);
        expect(css).toMatch(/#post-options-backdrop,\n#edit-profile-backdrop,\n#share-backdrop \{\n    z-index: 2910;/);
        const order = w.eval('BACK_SURFACES.map(s => s.id)');
        expect(order.indexOf('share-sheet')).toBe(order.indexOf('post-options-sheet') + 1);
    });
});

// ===========================================================================
// Client — shared links
// ===========================================================================

describe('Shared links (jsdom)', () => {
    it('?post= opens the player on that post and strips the parameters, keeping history.state', async () => {
        await boot(`https://royaltyapp.ai/a/viibeview/social?post=${UUID_A}&venue=${UUID_V}`);
        w.history.replaceState({ viibeBackGuard: true, keep: 1 }, '');
        w.__rpc = (name) => name === 'get_social_post'
            ? { data: [vid(UUID_A, { venue_id: UUID_V, venue_name: 'Blue Room' })], error: null }
            : { data: null, error: null };
        await w.eval('openDeepLink()');
        expect(w.__rpcCalls.find(c => c.name === 'get_social_post').args)
            .toEqual({ p_app_id: 'app-1', p_post_id: UUID_A });
        expect(d.getElementById('viibe-viewer').classList.contains('visible')).toBe(true);
        expect(d.querySelector('#viibe-viewer .feed-panel').dataset.mediaId).toBe(UUID_A);
        expect(w.location.search).toBe('');
        expect(w.location.pathname).toBe('/a/viibeview/social');
        expect(w.history.state).toEqual({ viibeBackGuard: true, keep: 1 });
        // Its options sheet finds it (it lives only in the player).
        expect(w.eval(`findPostById('${UUID_A}')?.id`)).toBe(UUID_A);
    });

    it('a post that is gone: says so, then opens its venue page', async () => {
        await boot(`https://royaltyapp.ai/a/viibeview/social?post=${UUID_A}&venue=${UUID_V}`);
        const opened = [];
        w.openVenuePage = id => opened.push(id);
        w.__rpc = () => ({ data: [], error: null });
        await w.eval('openDeepLink()');
        expect(w.__toasts).toEqual(['This Viibe is no longer available']);
        expect(opened).toEqual([UUID_V]);
        expect(d.getElementById('viibe-viewer').classList.contains('visible')).toBe(false);
    });

    it('?venue= alone opens the venue page; a non-UUID is ignored', async () => {
        await boot(`https://royaltyapp.ai/customer-app/social.html?slug=viibeview&venue=${UUID_V}`);
        const opened = [];
        w.openVenuePage = id => opened.push(id);
        await w.eval('openDeepLink()');
        expect(opened).toEqual([UUID_V]);
        // The slug parameter survives the strip.
        expect(w.location.search).toBe('?slug=viibeview');

        await boot('https://royaltyapp.ai/a/viibeview/social?venue=../../etc');
        w.openVenuePage = id => opened.push(id);
        await w.eval('openDeepLink()');
        expect(opened).toEqual([UUID_V]);
    });

    it('a first-time visitor sees the intro first; the link opens when it closes', async () => {
        await boot(`https://royaltyapp.ai/a/viibeview/social?venue=${UUID_V}`);
        const opened = [];
        w.openVenuePage = id => opened.push(id);
        d.getElementById('onboarding-overlay').classList.add('visible');
        await w.eval('openDeepLink()');
        expect(opened).toEqual([]);
        expect(w.location.search, 'stripped before it was opened').toContain('venue=');
        w.eval('finishOnboarding()');
        await tick(); await tick();
        expect(opened).toEqual([UUID_V]);
    });

    it('a post this device hid stays hidden through a link', async () => {
        await boot(`https://royaltyapp.ai/a/viibeview/social?post=${UUID_A}`);
        w.localStorage.setItem('viibeview_hidden_v1', JSON.stringify([UUID_A]));
        w.__rpc = () => ({ data: [vid(UUID_A)], error: null });
        await w.eval('openDeepLink()');
        expect(d.getElementById('viibe-viewer').classList.contains('visible')).toBe(false);
        expect(w.__toasts).toEqual(['This Viibe is no longer available']);
    });

    it('init opens the link after the first loadFeed()', () => {
        const init = js.slice(js.indexOf('async function init() {'), js.indexOf('\n}', js.indexOf('async function init() {')));
        expect(init.length).toBeGreaterThan(2000);
        const feed = init.indexOf('await loadFeed();');
        const link = init.indexOf('openDeepLink();');
        expect(feed).toBeGreaterThan(0);
        expect(link).toBeGreaterThan(feed);
    });
});

describe('the map post preview has the ⋯ menu', () => {
    it('hiding the previewed post closes the preview', async () => {
        await boot();
        w.eval(`postPins = ${JSON.stringify([vid('p1')])}; openPostPreview('p1');`);
        expect(d.getElementById('post-preview-modal').classList.contains('visible')).toBe(true);
        await w.eval("hidePost('p1')");
        expect(d.getElementById('post-preview-modal').classList.contains('visible')).toBe(false);
        expect(w.eval('previewPostId')).toBeNull();
    });

    it('it opens post options for that pin', async () => {
        await boot();
        w.eval(`postPins = ${JSON.stringify([{ ...vid('p1'), author_display_name: 'Kai' }])}; openPostPreview('p1');`);
        const more = d.querySelector('#post-preview-info .post-preview-more');
        expect(more).toBeTruthy();
        more.click();
        expect(d.getElementById('post-options-sheet').classList.contains('visible')).toBe(true);
        expect(w.eval('optionsMediaId')).toBe('p1');
    });
});

// ===========================================================================
// Admin — the Reports tab, and Delete through the edge function
// ===========================================================================

describe('venues.html — Reports and Delete', () => {
    const fn = (sig) => {
        const start = admin.indexOf(sig);
        if (start < 0) return null;
        const end = admin.indexOf('\n    }\n', start);
        return end < 0 ? null : admin.slice(start, end);
    };

    it('a Reports tab next to Venues and Members, with Open / Resolved', () => {
        expect(admin).toMatch(/<button class="admin-tab" data-admin-tab="reports">/);
        expect(admin).toMatch(/<section class="projects-section" id="admin-panel-reports" style="display: none;">/);
        expect(admin).toMatch(/data-reports-filter="open"/);
        expect(admin).toMatch(/data-reports-filter="resolved"/);
        expect(fn('function switchAdminTab(tab)')).toContain("if (tab === 'reports') loadReports();");
    });

    it("the report email's #reports lands on the tab", () => {
        expect(fn('function applyAdminTabFromHash()')).toContain("if (location.hash === '#reports') switchAdminTab('reports');");
        expect(admin).toContain("window.addEventListener('hashchange', applyAdminTabFromHash);");
        const init = admin.slice(admin.indexOf('async function initVenues()'), admin.indexOf('async function loadApp(appId)'));
        expect(init).toContain('applyAdminTabFromHash();');
    });

    it('loads and reviews through the RPCs, checking success:false', () => {
        expect(fn('async function loadReports()')).toContain("supabase.rpc('list_content_reports', {");
        const review = fn('async function reviewReport(mediaId, action)');
        expect(review).toContain("supabase.rpc('review_content_report', {");
        expect(review).toContain('if (error || !row || row.success === false) {');
    });

    it('a card shows the media whole, the reasons with counts, author and venue', () => {
        const render = fn('function renderReports(rows)');
        expect(render.length).toBeGreaterThan(1500);
        expect(render).toContain('controls playsinline preload="metadata"');
        expect(render).toContain('Object.entries(r.reasons || {})');
        expect(render).toContain("onclick=\"reviewReport('${id}', 'remove')\"");
        expect(render).toContain("onclick=\"reviewReport('${id}', 'dismiss')\"");
        expect(render).toContain("onclick=\"reviewReport('${id}', 'restore')\"");
        expect(render).toContain('AppUtils.escapeHtml');
        expect(admin).toMatch(/\.report-media video,\s+\.report-media img \{[^}]*object-fit: contain;/);
    });

    it('Delete goes through delete-social-post, so files AND thumbnails go', () => {
        const del = fn('async function deleteMedia(mediaId, venueId)');
        expect(del, 'deleteMedia not found').toBeTruthy();
        expect(del).toContain("supabase.functions.invoke('delete-social-post', {");
        expect(del).toContain('body: { media_id: mediaId }');
        expect(del).toContain('if (error || data?.success === false) {');
        const code = del.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
        expect(code).not.toContain("storage.from('venue-media').remove");
        expect(code).not.toMatch(/\.from\('venue_media'\)\s*\.delete\(\)/);
    });
});

describe('release plumbing (Phase 2)', () => {
    it('every new key exists in all 8 languages', () => {
        const social = ['share', 'hidePost', 'postHidden', 'undo', 'hideFailed', 'undoFailed', 'reportThanks',
            'reportFailed', 'shareMessages', 'shareEmail', 'shareCopyLink', 'shareMore', 'linkCopied',
            'shareViibe', 'shareViibeAt', 'shareVenue', 'postUnavailable'];
        const venues = ['reportsTab', 'reportsOpen', 'reportsResolved', 'reportsEmptyOpen', 'reportsEmptyResolved',
            'reportsRemove', 'reportsDismiss', 'reportsRestore', 'reportsRemoveConfirm', 'reportsManyReports'];
        for (const lang of ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ar']) {
            const j = JSON.parse(read(`i18n/${lang}.json`));
            for (const k of social) expect(j.social[k], `${lang} social.${k}`).toBeTruthy();
            for (const k of venues) expect(j.venues[k], `${lang} venues.${k}`).toBeTruthy();
            expect(j.social.shareViibeAt, `${lang} lost a placeholder`).toMatch(/\{venue\}[\s\S]*\{app\}|\{app\}[\s\S]*\{venue\}/);
            expect(j.venues.reportsManyReports).toContain('{n}');
        }
    });

    it('one file per migration stamp, applied in order', () => {
        for (const stamp of ['20261014000001', '20261014000002', '20261014000003']) {
            expect(migrationFiles.filter(f => f.startsWith(stamp)).length, stamp).toBe(1);
        }
    });
});
