/**
 * Guards for Jay's 2026-10-27 ViibeView round, Phase 3: admin tools.
 *
 *   20261027000001   suspend / unsuspend a member; create_social_post refuses
 *                    a suspended member with a clear message.
 *   purge-venue      "Delete forever" for a venue already in Recently deleted.
 *   app/venues.html  Recently deleted (Restore, Delete forever), Suspend /
 *                    Unsuspend on Members, an Activity tab, and audit rows for
 *                    venue delete/restore, member remove, report review and
 *                    media delete.
 *   social.js        the suspended answer from create_social_post, translated.
 *
 * SQL and the edge function are checked as text (no database here); the
 * dashboard and the member app also run in jsdom.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sql = name => fs.readFileSync(path.join(MIGRATIONS, name), 'utf8');

const FILE = '20261027000001_viibeview_admin_tools.sql';
const SOURCE = '20260922000003_post_permanence.sql';
const text = sql(FILE);
const fn = read('supabase/functions/purge-venue/index.ts');

/** SQL with `--` comment text removed. */
function sqlCode(t) {
    return t.split('\n').map(l => {
        const i = l.indexOf('--');
        return i < 0 ? l : l.slice(0, i);
    }).join('\n');
}
const code = sqlCode(text);

const migrationFiles = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort();

function latestDefinition(name) {
    let found = null;
    const re = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION (?:public\\.)?${name}\\(`, 'g');
    for (const file of migrationFiles) {
        const t = sqlCode(sql(file));
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(t))) {
            const end = t.indexOf('\n$$;', m.index);
            if (end < 0) continue;
            found = { file, body: t.slice(m.index, end + 4) };
        }
    }
    return found;
}

function rawBlock(t, name) {
    const re = new RegExp(`^CREATE (?:OR REPLACE )?FUNCTION ${name}\\(`, 'gm');
    const starts = [...t.matchAll(re)].map(m => m.index);
    expect(starts.length, `${name}: expected exactly one definition`).toBe(1);
    const end = t.indexOf('\n$$;', starts[0]);
    expect(end).toBeGreaterThan(starts[0]);
    return t.slice(starts[0], end + 4);
}

/** The body of one function in this file, comments stripped. */
const body = name => sqlCode(rawBlock(text, name));

// ===========================================================================
// The migration
// ===========================================================================

describe('20261027000001 — the columns', () => {
    it('suspended_at and suspended_reason, with NO default (NULL is the truth for every row)', () => {
        expect(code).toMatch(/ALTER TABLE app_members ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;/);
        expect(code).toMatch(/ALTER TABLE app_members ADD COLUMN IF NOT EXISTS suspended_reason TEXT;/);
        expect(code).not.toMatch(/suspended_\w+ [A-Z]+ DEFAULT/);
    });

    it('asserts members still cannot write the new columns themselves', () => {
        expect(code).toContain("has_column_privilege('authenticated', 'public.app_members', 'suspended_at', 'UPDATE')");
        expect(code).toContain("has_column_privilege('authenticated', 'public.app_members', 'suspended_reason', 'UPDATE')");
        // ...and grants nothing new to anyone on the table.
        expect(code).not.toMatch(/GRANT[^;]*ON (?:TABLE )?(?:public\.)?app_members/);
    });
});

describe('20261027000001 — suspend_app_member', () => {
    const b = () => body('suspend_app_member');

    it('SECURITY DEFINER with a pinned search_path', () => {
        expect(b()).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
    });

    it('only an org member of the member\'s app, checked before anything changes', () => {
        const s = b();
        const check = s.indexOf('FROM organization_members om\n        WHERE om.organization_id = v_org_id\n          AND om.user_id = v_user_id');
        expect(check).toBeGreaterThan(-1);
        expect(check).toBeLessThan(s.indexOf('UPDATE app_members'));
        expect(s).toContain("'Only the app team can suspend a member'");
    });

    it('refuses: signed out, no such member, no account, yourself, a team member, already suspended', () => {
        const s = b();
        for (const msg of ['You must be signed in', 'That member no longer exists', 'This member has no account to suspend',
            'You cannot suspend yourself', 'This person is on the app team. Remove them from the team first.',
            'This member is already suspended']) {
            expect(s, msg).toContain(`'${msg}'`);
        }
        expect(s).toContain('AND om.user_id = v_member.user_id');
    });

    it('hides only their APPROVED posts in THIS app, and logs exactly those ids', () => {
        const s = b();
        expect(s).toMatch(/UPDATE venue_media vm\s+SET status = 'removed'\s+WHERE vm\.app_id = v_member\.app_id\s+AND vm\.uploaded_by_user_id = v_member\.user_id\s+AND vm\.status = 'approved'\s+RETURNING vm\.id/);
        expect(s).toContain("'removed_post_ids', to_jsonb(v_post_ids)");
        expect(s).toMatch(/'app_member', p_member_id,/);
        expect(s).toContain("'suspend',");
        expect(s).toContain("'reason', v_reason");
    });

    it('the reason is trimmed and capped', () => {
        expect(b()).toContain("v_reason TEXT := NULLIF(left(btrim(COALESCE(p_reason, '')), 500), '')");
    });
});

describe('20261027000001 — unsuspend_app_member', () => {
    const b = () => body('unsuspend_app_member');

    it('only an org member, and only a suspended member', () => {
        const s = b();
        expect(s).toContain("'Only the app team can unsuspend a member'");
        expect(s).toContain("'This member is not suspended'");
        // The check itself, then its position. (indexOf alone is -1 when the
        // check is gone, and -1 is "before" everything: it would pass.)
        const check = s.indexOf('FROM organization_members om\n        WHERE om.organization_id = v_org_id\n          AND om.user_id = v_user_id\n    ) THEN\n        RETURN QUERY SELECT false, \'Only the app team can unsuspend a member\'');
        expect(check).toBeGreaterThan(-1);
        expect(check).toBeLessThan(s.indexOf('UPDATE app_members'));
    });

    it('reads the LATEST suspend entry for this member', () => {
        expect(b()).toMatch(/FROM audit_logs al\s+WHERE al\.organization_id = v_org_id\s+AND al\.entity_type = 'app_member'\s+AND al\.entity_id = p_member_id\s+AND al\.action = 'suspend'\s+ORDER BY al\.created_at DESC\s+LIMIT 1/);
    });

    it('puts back exactly those posts: theirs, this app, still removed, not removed by a reviewer', () => {
        const s = b();
        expect(s).toMatch(/SET status = 'approved'\s+WHERE vm\.id = ANY \(v_ids\)\s+AND vm\.app_id = v_member\.app_id\s+AND vm\.uploaded_by_user_id = v_member\.user_id\s+AND vm\.status = 'removed'\s+AND NOT EXISTS \(\s+SELECT 1 FROM content_reports cr\s+WHERE cr\.media_id = vm\.id\s+AND cr\.status = 'removed'/);
        expect(s).toContain("SET suspended_at = NULL,\n        suspended_reason = NULL");
        expect(s).toContain("'unsuspend',");
        expect(s).toContain("'restored_post_ids', to_jsonb(v_restored)");
    });

    it('a missing or malformed list restores nothing rather than failing', () => {
        expect(b()).toContain("CASE WHEN jsonb_typeof(v_listed) = 'array' THEN v_listed ELSE '[]'::JSONB END");
    });
});

describe('20261027000001 — create_social_post', () => {
    const INSERTED = [
        "    -- Suspended in this app (20261027000001): a clear answer, not the",
        "    -- \"Join this app to post\" the member check below would give.",
        "    IF EXISTS (",
        "        SELECT 1 FROM app_members am",
        "        WHERE am.app_id = p_app_id",
        "          AND am.user_id = v_user_id",
        "          AND am.deleted_at IS NULL",
        "          AND am.suspended_at IS NOT NULL",
        "    ) THEN",
        "        RETURN QUERY SELECT false, NULL::UUID, 'Your account is suspended in this app'::TEXT;",
        "        RETURN;",
        "    END IF;",
        "",
    ].join('\n') + '\n';
    const MEMBER_LINE = '          AND am.suspended_at IS NULL\n';

    it('the live definition is this file\'s', () => {
        expect(latestDefinition('create_social_post').file).toBe(FILE);
    });

    it('VERBATIM from 20260922000003, plus the suspended check and one member-check line', () => {
        const now = rawBlock(text, 'create_social_post');
        const before = rawBlock(sql(SOURCE), 'create_social_post');
        expect(now.split(INSERTED).length - 1, 'the suspended check').toBe(1);
        expect(now.split(MEMBER_LINE).length - 1, 'the member-check line').toBe(1);
        expect(now.replace(INSERTED, '').replace(MEMBER_LINE, '')).toBe(before);
    });

    it('the suspended check comes before the member check', () => {
        const now = rawBlock(text, 'create_social_post');
        expect(now.indexOf(INSERTED)).toBeGreaterThan(-1);
        expect(now.indexOf(INSERTED)).toBeLessThan(now.indexOf('    -- Member of this app.'));
    });

    it('the post-install block asserts the live body carries both checks', () => {
        expect(code).toContain("position('am.suspended_at IS NOT NULL' IN v_src) = 0");
        expect(code).toContain("position('am.suspended_at IS NULL' IN v_src) = 0");
    });

    it('none of the five feed readers is re-created here (status removed already hides a post)', () => {
        for (const reader of ['get_venue_feed_v3', 'get_following_feed_v3', 'get_venue_page_feed', 'get_recent_post_pins', 'get_member_posts']) {
            expect(code, reader).not.toMatch(new RegExp(`FUNCTION ${reader}\\(`));
        }
    });
});

describe('20261027000001 — grants', () => {
    const SIGS = [
        ['suspend_app_member(UUID, TEXT)', 'public.suspend_app_member(uuid, text)'],
        ['unsuspend_app_member(UUID)', 'public.unsuspend_app_member(uuid)'],
        ['create_social_post(UUID, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER, BIGINT, DECIMAL, DECIMAL)',
            'public.create_social_post(uuid, text, text, uuid, text, text, integer, bigint, numeric, numeric)'],
    ];

    for (const [sig, regsig] of SIGS) {
        it(`${sig.split('(')[0]}: REVOKE from PUBLIC AND anon, GRANT authenticated, asserted`, () => {
            expect(code).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;`);
            expect(code).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM anon;`);
            expect(code).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated;`);
            expect(code).toContain(`'${regsig}'`);
        });
    }

    it('the assertion loop checks anon CANNOT and authenticated CAN', () => {
        expect(code).toContain("IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN");
        expect(code).toContain("IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN");
    });

    it('stops if audit_logs has CHECK constraints the new values might not pass', () => {
        expect(code).toMatch(/FROM pg_constraint\s+WHERE conrelid = 'public\.audit_logs'::regclass AND contype = 'c'/);
    });
});

// ===========================================================================
// purge-venue
// ===========================================================================

describe('purge-venue (Delete forever)', () => {
    const at = s => {
        const i = fn.indexOf(s);
        expect(i, `not found: ${s}`).toBeGreaterThan(-1);
        return i;
    };

    it('the caller from their own JWT, and a UUID venue id', () => {
        expect(fn).toContain('await userClient.auth.getUser(token)');
        expect(fn).toContain("return json({ success: false, error: 'Not authenticated' }, 401)");
        expect(fn).toContain('if (!UUID_RE.test(venueId))');
    });

    it('only an org member of the venue\'s app, and only a venue already soft-deleted', () => {
        expect(fn).toMatch(/\.from\('organization_members'\)\s+\.select\('user_id'\)\s+\.eq\('organization_id', orgId\)\s+\.eq\('user_id', user\.id\)/);
        expect(fn).toContain("return json({ success: false, error: 'Only the app team can delete a venue' }, 403)");
        expect(fn).toContain('if (!venue.deleted_at) {');
        expect(at('if (!orgId || !membership)')).toBeLessThan(at("const { error: deleteErr } = await admin.from('venues').delete().eq('id', venueId)"));
        expect(at('if (!venue.deleted_at)')).toBeLessThan(at("admin.from('venues').delete()"));
    });

    it('order: read the files, write the audit row, delete the venue, THEN remove files', () => {
        const files = at(".from('venue_media')\n      .select('id, storage_path, thumbnail_url, uploaded_by_user_id')");
        const audit = at("admin.from('audit_logs').insert({");
        const del = at("admin.from('venues').delete()");
        const remove = at('admin.storage.from(BUCKET).remove(chunk)');
        expect(files).toBeLessThan(audit);
        expect(audit).toBeLessThan(del);
        expect(del).toBeLessThan(remove);
        // A failed audit write stops before anything is deleted.
        expect(fn.slice(audit, del)).toContain("return json({ success: false, error: 'Could not delete this venue' }, 500)");
    });

    it('removes only files under this org or the poster\'s own folder, and none another row still uses', () => {
        expect(fn).toContain('path.startsWith(`${orgId}/`) || (!!uploader && path.startsWith(`members/${uploader}/`))');
        expect(fn).toContain("!path.startsWith('/') && !path.includes('..')");
        for (const col of ["'storage_path').in('storage_path', unique)", "'thumbnail_url').in('thumbnail_url', publicUrls)",
            "'cover_image_url').in('cover_image_url', publicUrls)", "'profile_image_url').in('profile_image_url', publicUrls)"]) {
            expect(fn).toContain(col);
        }
        expect(fn).toContain('const paths = unique.filter(p => !stillUsed.has(p))');
    });

    it('in chunks; a cleanup failure is logged and the venue is still gone', () => {
        expect(fn).toContain('const REMOVE_CHUNK = 100');
        expect(fn).toContain('for (let i = 0; i < paths.length; i += REMOVE_CHUNK)');
        expect(fn).toContain("console.error('purge-venue: storage cleanup failed for', venueId, cleanupErr)");
    });

    it('never returns a path to the client; a double tap is a success', () => {
        const returns = [...fn.matchAll(/return json\((\{[^)]*\})/g)].map(m => m[1]);
        expect(returns.length).toBeGreaterThan(5);
        for (const r of returns) expect(r).not.toMatch(/path|unique|candidates/);
        expect(fn).toContain('return json({ success: true, already: true })');
    });

    it('the audit row says who, what and how much', () => {
        const insert = fn.slice(fn.indexOf("admin.from('audit_logs').insert({"), fn.indexOf("if (auditErr)"));
        for (const k of ["entity_type: 'venue'", "action: 'delete_forever'", 'entity_id: venueId', 'organization_id: orgId',
            'user_id: user.id', 'posts_removed: rows.length']) {
            expect(insert, k).toContain(k);
        }
    });
});

// ===========================================================================
// The dashboard (app/venues.html), run in jsdom with a stubbed client
// ===========================================================================

import { JSDOM } from 'jsdom';

const adminHtml = read('app/venues.html');
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

/** The page's main inline script: the one that defines switchAdminTab. */
function mainScript() {
    const scripts = [...adminHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    const main = scripts.filter(s => s.includes('function switchAdminTab(tab)'));
    expect(main.length).toBe(1);
    return main[0];
}

let w, d;

function bootAdmin() {
    // Markup only (no scripts run), then stubs, then the page's own script.
    const dom = new JSDOM(adminHtml.replace(/<script[\s\S]*?<\/script>/g, ''), { url: 'https://royaltyapp.ai/app/venues.html', runScripts: 'dangerously' });
    const win = dom.window;
    w = win;
    d = win.document;
    win.__calls = [];
    win.__answers = {};
    // A chainable query builder that records every call and answers per table.
    const query = (table) => {
        const rec = { table, ops: [] };
        win.__calls.push(rec);
        const builder = new Proxy({}, {
            get(_, k) {
                if (k === 'then') {
                    const ans = win.__answers[table];
                    const out = typeof ans === 'function' ? ans(rec) : (ans || { data: [], error: null });
                    return (res, rej) => Promise.resolve(out).then(res, rej);
                }
                return (...args) => { rec.ops.push([k, ...args]); return builder; };
            }
        });
        return builder;
    };
    win.__rpc = [];
    win.__invoke = [];
    win.supabase = {
        from: query,
        rpc: async (name, args) => { win.__rpc.push({ name, args }); return win.__answers[`rpc:${name}`] || { data: [{ success: true }], error: null }; },
        functions: { invoke: async (name, opts) => { win.__invoke.push({ name, body: opts.body }); return win.__answers[`fn:${name}`] || { data: { success: true }, error: null }; } },
        auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    };
    win.AppUtils = {
        // Exactly what app/utils.js does: text context only, quotes left as they are.
        escapeHtml: (t) => { if (!t) return ''; const div = win.document.createElement('div'); div.textContent = t; return div.innerHTML; },
        tr: (key, fallback, rep) => String(fallback).replace(/\{(\w+)\}/g, (m, k) => (rep && rep[k] !== undefined ? rep[k] : m)),
        debounce: (f) => f,
    };
    win.__toasts = [];
    win.showToast = (m, type) => win.__toasts.push([m, type]);
    win.__audit = [];
    win.AuditLog = { log: (p) => { win.__audit.push(p); return Promise.resolve({}); } };
    win.__danger = [];
    win.DangerModal = { show: (opts) => win.__danger.push(opts) };
    win.confirm = () => true;
    // The page's own start-up (DOMContentLoaded → initVenues) stops here: no
    // signed-in user. Without it, every test logged a ReferenceError.
    win.requireAuth = async () => null;
    win.VENUE_CATEGORIES = [];
    win.sanitizeGenres = (g) => g || [];
    win.genreLabel = (g) => g;
    const el = d.createElement('script');
    el.textContent = mainScript();
    d.body.appendChild(el);
    win.eval(`currentOrganization = { id: 'org-1' }; currentApp = { id: 'app-1', name: 'ViibeView', organization_id: 'org-1' };`);
}

describe('dashboard: Recently deleted', () => {
    beforeEach(bootAdmin);

    it('lists soft-deleted venues of THIS app, newest first, with Restore and Delete forever', async () => {
        w.__answers.venues = { data: [{ id: 'v1', name: 'Old Bar', city: 'Austin', state: 'TX', deleted_at: '2026-10-20T10:00:00Z' }], error: null };
        await w.eval('loadDeletedVenues()');
        const rec = w.__calls.find(c => c.table === 'venues');
        expect(rec.ops).toContainEqual(['eq', 'app_id', 'app-1']);
        expect(rec.ops).toContainEqual(['not', 'deleted_at', 'is', null]);
        expect(rec.ops).toContainEqual(['order', 'deleted_at', { ascending: false }]);
        expect(d.getElementById('deleted-venues').style.display).toBe('');
        const row = d.querySelector('.deleted-venue-row');
        expect(row.querySelector('.deleted-venue-name').textContent).toBe('Old Bar');
        expect(row.innerHTML).toContain(`onclick="restoreVenue('v1')"`);
        expect(row.innerHTML).toContain(`onclick="confirmPurgeVenue('v1')"`);
    });

    it('none deleted: no section', async () => {
        w.__answers.venues = { data: [], error: null };
        await w.eval('loadDeletedVenues()');
        expect(d.getElementById('deleted-venues').style.display).toBe('none');
    });

    it('Restore clears deleted_at and logs it', async () => {
        w.eval(`deletedVenues = [{ id: 'v1', name: 'Old Bar' }]`);
        await w.eval(`restoreVenue('v1')`);
        const upd = w.__calls.find(c => c.table === 'venues' && c.ops.some(o => o[0] === 'update'));
        expect(upd.ops).toContainEqual(['update', { deleted_at: null }]);
        expect(upd.ops).toContainEqual(['eq', 'id', 'v1']);
        expect(w.__audit.at(-1)).toMatchObject({ organizationId: 'org-1', entityType: 'venue', entityId: 'v1', entityName: 'Old Bar', action: 'restore', newData: { app_id: 'app-1' } });
    });

    it('Delete forever asks for the venue name to be typed, then calls purge-venue', async () => {
        w.eval(`deletedVenues = [{ id: 'v1', name: 'Old Bar' }]`);
        w.eval(`confirmPurgeVenue('v1')`);
        const opts = w.__danger.at(-1);
        expect(opts.confirmPhrase).toBe('Old Bar');
        expect(opts.itemName).toBe('Old Bar');
        expect(w.__invoke.length, 'it deleted before the name was typed').toBe(0);
        await opts.onConfirm();
        expect(w.__invoke).toEqual([{ name: 'purge-venue', body: { venue_id: 'v1' } }]);
        expect(w.__toasts.at(-1)[1]).toBe('success');
    });

    it("a refusal from purge-venue is shown, not swallowed", async () => {
        w.eval(`deletedVenues = [{ id: 'v1', name: 'Old Bar' }]`);
        w.__answers['fn:purge-venue'] = { data: { success: false, error: 'Only the app team can delete a venue' }, error: null };
        w.eval(`confirmPurgeVenue('v1')`);
        await w.__danger.at(-1).onConfirm();
        expect(w.__toasts.at(-1)).toEqual(['Only the app team can delete a venue', 'error']);
    });

    it('the ordinary Delete is still soft, logs, and refreshes Recently deleted', () => {
        const del = adminHtml.slice(adminHtml.indexOf('async function deleteVenue(venueId, venueName, event)'));
        const body = del.slice(0, del.indexOf('\n    }\n'));
        expect(body).toContain(".update({ deleted_at: new Date().toISOString() })");
        expect(body).toContain("auditViibe({ entityType: 'venue', entityId: venueId, entityName: venueName, action: 'delete' });");
        expect(body).toContain('await Promise.all([loadVenues(), loadDeletedVenues()]);');
        expect(adminHtml).toMatch(/await loadVenues\(\);\n\s+setupEventListeners\(\);\n[\s\S]{0,120}loadDeletedVenues\(\);/);
    });
});

describe('dashboard: suspend and unsuspend', () => {
    beforeEach(bootAdmin);

    const members = [
        { id: 'm1', display_name: 'Kai', email: 'k@x.test', user_id: 'u-k', suspended_at: null },
        { id: 'm2', display_name: 'Lou', email: 'l@x.test', user_id: 'u-l', suspended_at: '2026-10-27T10:00:00Z', suspended_reason: 'spam' },
        { id: 'm3', first_name: 'Loyal', email: 'y@x.test', user_id: null, suspended_at: null },
    ];

    it('the list reads the suspension columns and shows a badge and the right button', async () => {
        w.__answers.app_members = { data: members, error: null };
        await w.eval('loadMembers()');
        const rec = w.__calls.find(c => c.table === 'app_members');
        expect(rec.ops.find(o => o[0] === 'select')[1]).toContain('suspended_at, suspended_reason');
        const row = id => d.querySelector(`tr[data-member-id="${id}"]`);
        expect(row('m1').innerHTML).toContain(`onclick="openSuspendMember('m1')"`);
        expect(row('m1').querySelector('.badge')).toBeNull();
        expect(row('m2').querySelector('.badge-inactive').textContent).toBe('Suspended');
        expect(row('m2').querySelector('.badge-inactive').getAttribute('title')).toBe('spam');
        expect(row('m2').innerHTML).toContain(`onclick="unsuspendMember('m2')"`);
        expect(row('m2').innerHTML).not.toContain('openSuspendMember');
        // No account, nothing to suspend.
        expect(row('m3').innerHTML).not.toContain('Suspend');
        expect(row('m3').innerHTML).toContain('removeMember(');
    });

    it("a member's name with quotes cannot write an attribute into Remove (stored XSS, fixed 2026-10-27)", async () => {
        const evil = 'x" onmouseover="window.__pwned=1';
        w.__answers.app_members = { data: [{ id: 'm9', display_name: evil, user_id: 'u-q', suspended_at: null }], error: null };
        await w.eval('loadMembers()');
        const remove = [...d.querySelectorAll('tr[data-member-id="m9"] button')].find(b => b.textContent === 'Remove');
        expect(remove.getAttributeNames()).toEqual(['class', 'onclick']);
        expect(remove.getAttribute('onclick')).toBe("removeMember('m9')");
        // ...and Remove still names them, looked up by id.
        let asked = '';
        w.confirm = (msg) => { asked = msg; return true; };
        await w.eval(`removeMember('m9')`);
        expect(asked).toContain(evil);
        expect(w.__audit.at(-1)).toMatchObject({ entityType: 'app_member', entityId: 'm9', entityName: evil, action: 'remove' });
    });

    it('no handler attribute on the page carries escaped text (escapeHtml leaves " alone)', () => {
        const handlers = [...adminHtml.matchAll(/\son[a-z]+="([^"]*)"/g)].map(m => m[1]);
        expect(handlers.length).toBeGreaterThan(10);
        for (const h of handlers) expect(h, h).not.toContain('escapeHtml(');
        expect(adminHtml).toContain(`onclick="deleteVenue('\${venue.id}', null, event)"`);
        expect(adminHtml).toContain("venueName = venueName || allVenues.find(v => v.id === venueId)?.name || '';");
    });

    it('a reason with a quote cannot write an attribute into the badge', async () => {
        w.__answers.app_members = { data: [{ id: 'm9', display_name: 'Q', user_id: 'u-q', suspended_at: '2026-10-27T10:00:00Z',
            suspended_reason: 'spam" onmouseover="window.__pwned=1' }], error: null };
        await w.eval('loadMembers()');
        const badge = d.querySelector('tr[data-member-id="m9"] .badge-inactive');
        expect(badge.getAttributeNames()).toEqual(['class', 'title']);
        expect(badge.getAttribute('title')).toBe('spam" onmouseover="window.__pwned=1');
    });

    it('Suspend: the dialog, the reason, the RPC, then the list again', async () => {
        w.__answers.app_members = { data: members, error: null };
        await w.eval('loadMembers()');
        w.eval(`openSuspendMember('m1')`);
        expect(d.getElementById('suspend-modal').classList.contains('active')).toBe(true);
        expect(d.getElementById('suspend-modal-title').textContent).toBe('Suspend Kai?');
        d.getElementById('suspend-reason').value = '  spam links  ';
        w.__answers['rpc:suspend_app_member'] = { data: [{ success: true, error_message: null, posts_removed: 3 }], error: null };
        await w.eval('confirmSuspendMember()');
        expect(w.__rpc.at(-1)).toEqual({ name: 'suspend_app_member', args: { p_member_id: 'm1', p_reason: 'spam links' } });
        expect(d.getElementById('suspend-modal').classList.contains('active')).toBe(false);
        expect(w.__toasts.at(-1)).toEqual(['Kai is suspended. 3 posts hidden.', 'success']);
        expect(w.__calls.filter(c => c.table === 'app_members').length, 'the list was not reloaded').toBe(2);
    });

    it('a refusal stays in the dialog, which can be tried again', async () => {
        w.__answers.app_members = { data: members, error: null };
        await w.eval('loadMembers()');
        w.eval(`openSuspendMember('m1')`);
        w.__answers['rpc:suspend_app_member'] = { data: [{ success: false, error_message: 'This person is on the app team. Remove them from the team first.', posts_removed: 0 }], error: null };
        await w.eval('confirmSuspendMember()');
        expect(d.getElementById('suspend-modal').classList.contains('active')).toBe(true);
        expect(d.getElementById('suspend-error').hidden).toBe(false);
        expect(d.getElementById('suspend-error').textContent).toContain('on the app team');
        expect(d.getElementById('suspend-confirm').disabled).toBe(false);
    });

    it('Unsuspend: confirm, the RPC, how many came back', async () => {
        w.__answers.app_members = { data: members, error: null };
        await w.eval('loadMembers()');
        w.__answers['rpc:unsuspend_app_member'] = { data: [{ success: true, error_message: null, posts_restored: 2 }], error: null };
        await w.eval(`unsuspendMember('m2')`);
        expect(w.__rpc.at(-1)).toEqual({ name: 'unsuspend_app_member', args: { p_member_id: 'm2' } });
        expect(w.__toasts.at(-1)).toEqual(['Lou can post again. 2 posts restored.', 'success']);
    });

    it('Cancel and the backdrop close the dialog', () => {
        expect(adminHtml).toContain("document.getElementById('suspend-cancel')?.addEventListener('click', closeSuspendMember);");
        expect(adminHtml).toContain("if (e.target.id === 'suspend-modal') closeSuspendMember();");
    });
});

describe('dashboard: the Activity tab', () => {
    beforeEach(bootAdmin);

    it('a tab, a panel, and switching to it loads it every time', () => {
        expect(d.querySelector('.admin-tab[data-admin-tab="activity"]')).toBeTruthy();
        expect(d.getElementById('admin-panel-activity')).toBeTruthy();
        expect(adminHtml).toContain("if (tab === 'activity') loadActivity(true);");
    });

    it("this organization's ViibeView entries, newest first, 20 at a time", async () => {
        const page = Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, entity_type: 'venue', action: 'delete', entity_name: `V${i}`, new_data: { app_id: 'app-1' }, created_at: '2026-10-27T10:00:00Z', user_name: 'Jay' }));
        w.__answers.audit_logs = { data: page, error: null };
        await w.eval('loadActivity(true)');
        const rec = w.__calls.find(c => c.table === 'audit_logs');
        expect(rec.ops).toContainEqual(['eq', 'organization_id', 'org-1']);
        expect(rec.ops).toContainEqual(['in', 'entity_type', ['venue', 'app_member', 'venue_media']]);
        expect(rec.ops).toContainEqual(['order', 'created_at', { ascending: false }]);
        expect(rec.ops).toContainEqual(['range', 0, 19]);
        expect(d.querySelectorAll('.activity-row').length).toBe(20);
        expect(d.getElementById('activity-more').style.display).toBe('');
        w.__answers.audit_logs = { data: [{ id: 'z', entity_type: 'venue', action: 'restore', entity_name: 'Z', new_data: {} }], error: null };
        await w.eval('loadActivity(false)');
        expect(w.__calls.filter(c => c.table === 'audit_logs').at(-1).ops).toContainEqual(['range', 20, 39]);
        expect(d.querySelectorAll('.activity-row').length).toBe(21);
        expect(d.getElementById('activity-more').style.display).toBe('none');
    });

    it("another app's entries in the same organization are left out", async () => {
        w.__answers.audit_logs = { data: [
            { id: 'a', entity_type: 'venue', action: 'delete', entity_name: 'Mine', new_data: { app_id: 'app-1' } },
            { id: 'b', entity_type: 'venue', action: 'delete', entity_name: 'Theirs', new_data: { app_id: 'app-2' } },
        ], error: null };
        await w.eval('loadActivity(true)');
        expect([...d.querySelectorAll('.activity-text')].map(e => e.textContent)).toEqual(['Deleted the venue Mine']);
    });

    it('each entry in words, with what it changed', () => {
        const line = row => w.eval(`activityLine(${JSON.stringify(row)})`);
        expect(line({ entity_type: 'app_member', action: 'suspend', entity_name: 'Kai', new_data: { removed_post_ids: ['p1', 'p2'], reason: 'spam' } }))
            .toEqual({ text: 'Suspended Kai', details: '2 posts hidden · “spam”' });
        expect(line({ entity_type: 'app_member', action: 'unsuspend', entity_name: 'Kai', new_data: { restored_post_ids: ['p1'] } }).details).toBe('1 posts restored');
        expect(line({ entity_type: 'venue', action: 'delete_forever', entity_name: 'Old Bar', new_data: { posts_removed: 4 } }))
            .toEqual({ text: 'Deleted the venue Old Bar forever', details: '4 posts deleted' });
        expect(line({ entity_type: 'venue_media', action: 'report_remove', new_data: {} }).text).toBe('Removed a reported post');
        // Names and reasons are escaped before they become HTML.
        expect(line({ entity_type: 'app_member', action: 'suspend', entity_name: '<img src=x onerror=1>', new_data: { reason: '<b>' } }).text).not.toContain('<img');
        expect(line({ entity_type: 'app_member', action: 'suspend', entity_name: 'x', new_data: { reason: '<b>' } }).details).not.toContain('<b>');
    });

    it('nothing yet: the empty state', async () => {
        w.__answers.audit_logs = { data: [], error: null };
        await w.eval('loadActivity(true)');
        expect(d.getElementById('activity-empty').style.display).toBe('block');
    });
});

describe('dashboard: every change is logged', () => {
    const fnText = sig => {
        const i = adminHtml.indexOf(sig);
        expect(i, sig).toBeGreaterThan(-1);
        return adminHtml.slice(i, adminHtml.indexOf('\n    }\n', i));
    };

    it('member remove, report review, media delete, venue delete and restore', () => {
        expect(fnText('async function removeMember(memberId, memberName)')).toContain("auditViibe({ entityType: 'app_member', entityId: memberId, entityName: memberName, action: 'remove' });");
        expect(fnText('async function reviewReport(mediaId, action)')).toContain("auditViibe({ entityType: 'venue_media', entityId: mediaId, action: `report_${action}` });");
        expect(fnText('async function deleteMedia(mediaId, venueId)')).toContain("auditViibe({ entityType: 'venue_media', entityId: mediaId, action: 'delete', newData: { venue_id: venueId } });");
        expect(fnText('async function restoreVenue(venueId)')).toContain("action: 'restore'");
    });

    it('only after the change succeeded', () => {
        const review = fnText('async function reviewReport(mediaId, action)');
        expect(review.indexOf('auditViibe(')).toBeGreaterThan(review.indexOf("if (error || !row || row.success === false) {"));
        const remove = fnText('async function removeMember(memberId, memberName)');
        expect(remove.indexOf('auditViibe(')).toBeGreaterThan(remove.indexOf('if (error) {'));
    });

    it("auditViibe tags the app, and never blocks (it isn't awaited)", () => {
        bootAdmin();
        w.eval(`auditViibe({ entityType: 'venue', entityId: 'v', action: 'delete' })`);
        expect(w.__audit.at(-1)).toMatchObject({ organizationId: 'org-1', newData: { app_id: 'app-1' } });
        expect(adminHtml).not.toMatch(/await auditViibe\(/);
    });
});

describe('dashboard: release plumbing', () => {
    it('the shared scripts it uses are current', () => {
        expect(adminHtml).toContain('<script src="../i18n/i18n.js?v=3"></script>');
        expect(adminHtml).toContain('<script src="/js/venue-places.js?v=2"></script>');
        expect(adminHtml).toContain('<script src="audit-log.js?v=1"></script>');
        expect(adminHtml).toContain('<script src="danger-modal.js?v=1"></script>');
    });
});

// ===========================================================================
// The member app: the suspended answer, in the member's language
// ===========================================================================

describe('the member app says "suspended" plainly', () => {
    const social = read('customer-app/social.js');

    it('publishViibe turns the server\'s suspended answer into social.accountSuspended', () => {
        const i = social.indexOf('async function publishViibe(');
        const body = social.slice(i, social.indexOf('\n}\n', i));
        expect(body).toContain("if (/suspended/i.test(row?.error_message || '')) {");
        expect(body).toContain("translateOr('social.accountSuspended', null,");
        // ...and the server really says "suspended".
        expect(text).toContain("'Your account is suspended in this app'::TEXT");
    });

    it('translated in all 8 languages', () => {
        for (const lang of ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ar']) {
            const soc = JSON.parse(read(`i18n/${lang}.json`)).social;
            expect(soc.accountSuspended, lang).toBeTruthy();
        }
    });
});
