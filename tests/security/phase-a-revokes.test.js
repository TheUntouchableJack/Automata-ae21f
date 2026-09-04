/**
 * Static guards for the Phase A revokes (20260904000005/6/7).
 *
 * Two failure directions, and this repo has shipped both:
 *
 *   Too open — `REVOKE ALL ... FROM PUBLIC` alone is a silent no-op. Supabase's
 *   ALTER DEFAULT PRIVILEGES grants anon and authenticated EXECUTE *directly*,
 *   and revoking the PUBLIC pseudo-role does not touch a direct role grant.
 *   Measured in 20260828000005, re-measured in 20260904000004. The only correct
 *   shape is all THREE lines.
 *
 *   Too closed — this is the one that mattered here. The plan these files came
 *   from would have revoked 19 functions; 8 of them are called by live pages, so
 *   it would have switched off royaltyapp.ai's loyalty app and its /a/:slug join
 *   page to fix an access-control bug. The scope was cut to what is genuinely
 *   uncalled. The MUST-NOT-REVOKE list below is that decision, pinned.
 *
 * ⚠️ Its own corpus, deliberately. social-follows-grants.test.js warns that a
 * shared corpus resolves the FIRST match of a function name and then quietly
 * asserts nothing about the file you meant. These three files only.
 *
 * Static assertions over migration text. No network, no database.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = '/Users/jaywhitley/AI Projects/Automata';
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');

const M1 = '20260904000005_revoke_uncalled_member_rpcs.sql';
const M2 = '20260904000006_revoke_pin_helper_grants.sql';
const M3 = '20260904000007_app_members_table_layer.sql';
const FILES = [M1, M2, M3];

const raw = Object.fromEntries(
    FILES.map(f => [f, fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')])
);
const sql = FILES.map(f => raw[f]).join('\n');

// Strip -- line comments so a function named only in prose cannot satisfy an
// assertion about a statement. Block comments are not used in these files.
const stripComments = s => s.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
const code = stripComments(sql);

// ⚠️ Comment-stripping alone is NOT enough for "this file must never contain X".
// These migrations quote the dangerous shapes verbatim inside RAISE messages and
// COMMENT bodies — "Something revoked it ... with ON ALL FUNCTIONS IN SCHEMA",
// "FORCE ROW LEVEL SECURITY is ON — this breaks every SECURITY DEFINER RPC".
// Those live in string literals inside DO blocks, so a naive not.toMatch over
// the whole file fails against a correct migration. Six assertions in this file
// did exactly that on first run.
//
// ddl() removes every DO $tag$ ... $tag$ block, leaving only top-level DDL —
// the statements Postgres actually executes as schema changes. Prohibition
// assertions run against THIS; assertions that a guard exists run against raw.
const stripDoBlocks = s => s.replace(/DO \$(\w+)\$[\s\S]*?\$\1\$\s*;/g, '');
const ddl = stripDoBlocks(code);

// sw.js is JavaScript — // comments, not --.
const stripJsComments = s => s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

// Every function REVOKED by M1 + M2, with its exact type list.
const REVOKED = [
    ['update_member_setting', 'UUID, TEXT, TEXT'],
    ['save_fcm_token', 'UUID, TEXT'],
    ['clear_fcm_token', 'UUID'],
    ['create_ticket_from_ai_chat', 'UUID, UUID, UUID, TEXT, TEXT, TEXT'],
    ['get_ticket_messages_for_customer', 'UUID, UUID'],
    ['get_ticket_ai_history', 'UUID, UUID'],
    ['upgrade_pin_to_bcrypt', 'UUID, TEXT'],
    ['hash_pin_bcrypt', 'TEXT'],
    ['verify_pin_bcrypt', 'TEXT, TEXT'],
    ['verify_pin_legacy_sha256', 'TEXT, TEXT'],
    ['verify_app_member_login', 'UUID, TEXT, TEXT, TEXT'],
];

// 🔴 The functionality decision, pinned. Revoking any of these switches off a
// live page. If a future change adds one to a REVOKE line, this file fails.
const MUST_NOT_REVOKE = [
    // loyalty app.html
    'get_member_profile(UUID)',
    'get_member_activity',
    'redeem_reward',
    'submit_reward_suggestion',
    'get_my_tickets',
    'get_customer_unread_count',
    'customer_reply_to_ticket',
    // /a/:slug join page, index.html:2519 — loyalty AND newsletter
    'customer_app_signup',
    // ViibeView
    'social_member_signup',
    'get_social_member',
    'get_venue_feed',
    'get_social_feed',
    'update_social_profile',
];

describe('the corpus parsed and is substantial', () => {
    it.each(FILES)('%s exists and is non-trivial', f => {
        expect(raw[f].length).toBeGreaterThan(2000);
    });

    // ⚠️ Anti-vacuity. Every not.toMatch below passes trivially against an empty
    // string, so prove the comment strip left real SQL behind before trusting one.
    it('the comment strip did not eat the migrations', () => {
        expect(code.length).toBeGreaterThan(sql.length * 0.25);
    });

    it('each file individually survived the strip', () => {
        for (const f of FILES) {
            const c = stripComments(raw[f]);
            expect(c.length, `${f} is almost entirely comments after stripping`)
                .toBeGreaterThan(raw[f].length * 0.15);
        }
    });
});

describe('every revoked function carries all THREE lines', () => {
    // ⚠️ FROM PUBLIC alone leaves Supabase's direct anon/authenticated grants in
    // place. This is the single most repeated footgun in this repo.
    it.each(REVOKED)('%s revokes PUBLIC, anon and authenticated', (fn, types) => {
        const sig = `public\\.${fn}\\(\\s*${types.replace(/, /g, ',\\s*')}\\s*\\)`;

        for (const role of ['PUBLIC', 'anon', 'authenticated']) {
            const re = new RegExp(`REVOKE ALL ON FUNCTION ${sig} FROM ${role};`, 'i');
            expect(code, `${fn}: missing "REVOKE ALL ... FROM ${role}"`).toMatch(re);
        }
    });

    // A copy-paste that duplicates one function and drops another keeps the
    // per-function tests green while leaving a hole. Count the lines.
    it('there are exactly 11 revoked functions x 3 lines = 33 REVOKE ALL ON FUNCTION lines', () => {
        const lines = code.match(/REVOKE ALL ON FUNCTION/g) || [];
        expect(lines.length).toBe(REVOKED.length * 3);
        expect(REVOKED.length).toBe(11);
    });

    it('every revoked signature is type-qualified, never a bare name', () => {
        // A bare name on an overloaded function raises 42725; on any function it
        // is ambiguous intent. get_member_profile is the live example.
        const bare = code.match(/REVOKE ALL ON FUNCTION public\.\w+ +FROM/g) || [];
        expect(bare, `bare-name REVOKE(s): ${bare.join(', ')}`).toEqual([]);
    });

    it('never uses ON ALL FUNCTIONS IN SCHEMA', () => {
        // ddl(), not code(): M2 quotes this shape inside a RAISE message as the
        // thing that would have caused an over-broad revoke.
        expect(ddl).not.toMatch(/ON ALL FUNCTIONS IN SCHEMA/i);
        expect(ddl.length, 'stripDoBlocks ate the whole file').toBeGreaterThan(1500);
    });
});

describe('🔴 the functionality decision is pinned', () => {
    // The whole point of the re-scope. If any of these appears in a REVOKE, a
    // live royaltyapp.ai surface just went dark.
    it.each(MUST_NOT_REVOKE)('%s is never revoked', name => {
        const fn = name.replace(/\(.*/, '');
        // Anchored to a real REVOKE statement in top-level DDL. An unanchored
        // `REVOKE[^;]*` spans prose inside RAISE strings and false-positives on
        // sentences like "Something revoked it by bare name".
        const revokes = ddl.match(
            new RegExp(`REVOKE [A-Z ,]*ON FUNCTION public\\.${fn}\\s*\\(`, 'gi')
        ) || [];

        if (name === 'get_member_profile(UUID)') {
            // Overloaded: the 1-arg loyalty form is NOT revoked here either, and
            // the 2-arg ViibeView form must never be. Assert neither is touched.
            expect(revokes, `get_member_profile revoked: ${revokes.join(' | ')}`).toEqual([]);
        } else {
            expect(revokes, `${fn} revoked: ${revokes.join(' | ')}`).toEqual([]);
        }
    });

    // 🔴 The silent failure. Revoking the 2-arg overload empties every ViibeView
    // profile overlay with no error anywhere — social.js destructures { data }
    // and never inspects error.
    it('the 2-arg ViibeView get_member_profile overload is never revoked', () => {
        expect(ddl).not.toMatch(/REVOKE [A-Z ,]*ON FUNCTION public\.get_member_profile\s*\(\s*UUID\s*,\s*UUID\s*\)/i);
    });

    it('customer_app_signup is asserted STILL GRANTED, not merely left alone', () => {
        // M2 and M3 both carry a post-flight that fails the push if signup broke.
        expect(raw[M2]).toMatch(/has_function_privilege\('anon',\s*v_signup,\s*'EXECUTE'\)/);
        expect(raw[M3]).toMatch(/customer_app_signup/);
        expect(raw[M2]).toMatch(/FUNCTIONALITY GUARD/);
        expect(raw[M3]).toMatch(/FUNCTIONALITY GUARD/);
    });

    it('M1 carries a functionality guard naming all 9 live call sites', () => {
        expect(raw[M1]).toMatch(/FUNCTIONALITY GUARD/);
        for (const fn of ['get_member_profile', 'get_member_activity', 'redeem_reward',
                          'submit_reward_suggestion', 'get_my_tickets',
                          'get_customer_unread_count', 'customer_reply_to_ticket',
                          'customer_app_signup']) {
            expect(raw[M1], `M1's keep-list omits ${fn}`).toMatch(new RegExp(`'public\\.${fn}\\(`));
        }
    });
});

describe('each migration guards against being a silent no-op', () => {
    it.each(FILES)('%s warns when there was nothing to revoke', f => {
        // An all-42501 post-flight proves nothing if the file was already inert.
        expect(raw[f]).toMatch(/RAISE WARNING/);
    });

    it.each(FILES)('%s asserts service_role survived', f => {
        expect(raw[f]).toMatch(/service_role/);
    });

    it.each(FILES)('%s isolates COMMENTs in their own DO block', f => {
        // 20260903000005's lesson: a docstring failure must never roll back the
        // revoke it documents.
        // Count in stripped code: every file also NAMES "COMMENT ON TABLE" in
        // its prose header, which is not a statement.
        const c = stripComments(raw[f]);
        const comments = (c.match(/COMMENT ON /g) || []).length;
        const doBlocks = (c.match(/DO \$doc\$/g) || []).length;
        expect(doBlocks, `${f} has ${comments} COMMENTs in ${doBlocks} $doc$ blocks`)
            .toBeGreaterThanOrEqual(1);
        expect(doBlocks).toBe(comments);
    });
});

describe('M3 table layer', () => {
    const m3 = stripComments(raw[M3]);

    it('revokes anon writes but NOT anon SELECT', () => {
        expect(m3).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON public\.app_members FROM anon;/);
        // ⚠️ Revoking anon SELECT risks breaking an unknown view/embed for no
        // gain — anon's SELECT is already inert under RLS.
        expect(m3).not.toMatch(/REVOKE[^;]*\bSELECT\b[^;]*ON public\.app_members FROM anon/i);
        expect(m3).not.toMatch(/REVOKE ALL ON public\.app_members/i);
    });

    it('drops exactly the two unsafe policies and keeps the two load-bearing ones', () => {
        expect(m3).toMatch(/DROP POLICY IF EXISTS "Public can join published apps" ON public\.app_members;/);
        expect(m3).toMatch(/DROP POLICY IF EXISTS "Members can update own membership" ON public\.app_members;/);
        // 🔴 "Org can manage app members" is FOR ALL and is the owner's ONLY path.
        expect(m3).not.toMatch(/DROP POLICY[^;]*"Org can manage app members"/);
        expect(m3).not.toMatch(/DROP POLICY[^;]*"Members can read own membership"/);
    });

    it('grants back EXACTLY the two columns app/venues.html:1710 writes', () => {
        expect(m3).toMatch(/REVOKE UPDATE ON public\.app_members FROM authenticated;/);
        expect(m3).toMatch(/GRANT UPDATE \(deleted_at, user_id\) ON public\.app_members TO authenticated;/);
    });

    it('never column-restricts SELECT — dashboard.js does select(*)', () => {
        expect(m3).not.toMatch(/GRANT SELECT \(/i);
    });

    it('asserts FORCE ROW LEVEL SECURITY is off', () => {
        // FORCE subjects the table owner to RLS and breaks every SECURITY
        // DEFINER RPC on this table, ViibeView included.
        expect(raw[M3]).toMatch(/relforcerowsecurity/);
        // The post-flight QUOTES this shape in its failure message, so check DDL.
        expect(stripDoBlocks(m3)).not.toMatch(/ALTER TABLE[^;]*FORCE ROW LEVEL SECURITY/i);
    });
});

describe('cross-file: the premises M3 rests on still hold', () => {
    it('app/venues.html has exactly ONE app_members update, writing {deleted_at, user_id}', () => {
        const html = fs.readFileSync(path.join(ROOT, 'app/venues.html'), 'utf8');
        // Assert the site count FIRST — otherwise a second update site added
        // later silently escapes the shape check below.
        const updates = html.match(/\.from\('app_members'\)\s*\n?\s*\.update\(/g) || [];
        expect(updates.length, 'a second app_members UPDATE appeared in venues.html — ' +
            'M3 grants only (deleted_at, user_id), so the new one will 42501')
            .toBe(1);
        expect(html).toMatch(/\.update\(\{ deleted_at: new Date\(\)\.toISOString\(\), user_id: null \}\)/);
    });

    it('no customer-app/ file writes app_members directly', () => {
        // M3 §3 drops the member UPDATE policy on exactly this premise.
        const dir = path.join(ROOT, 'customer-app');
        const files = fs.readdirSync(dir).filter(f => /\.(js|html)$/.test(f));
        expect(files.length).toBeGreaterThan(3);   // the corpus is real

        for (const f of files) {
            const src = fs.readFileSync(path.join(dir, f), 'utf8');
            expect(src, `customer-app/${f} writes app_members directly — M3 §3 drops ` +
                'the member UPDATE policy, so that write now matches zero rows')
                .not.toMatch(/\.from\(['"]app_members['"]\)/);
        }
    });

    it('customer-app/app.js is gone and sw.js no longer precaches it', () => {
        // ⚠️ cache.addAll() is all-or-nothing: the file and the precache entry
        // had to go in the same commit or the SW stops installing for every
        // ViibeView visitor.
        expect(fs.existsSync(path.join(ROOT, 'customer-app/app.js'))).toBe(false);
        const sw = fs.readFileSync(path.join(ROOT, 'customer-app/sw.js'), 'utf8');
        // sw.js is JS: // comments, not --. The entry is commented out there.
        expect(stripJsComments(sw)).not.toMatch(/'\/customer-app\/app\.js'/);
    });

    it('every remaining sw.js precache entry exists on disk', () => {
        const sw = fs.readFileSync(path.join(ROOT, 'customer-app/sw.js'), 'utf8');
        const list = stripJsComments(sw).match(/'\/customer-app\/[^']+'/g) || [];
        expect(list.length).toBeGreaterThan(4);
        for (const entry of list) {
            const rel = entry.replace(/'/g, '').replace(/^\//, '');
            expect(fs.existsSync(path.join(ROOT, rel)), `sw.js precaches ${rel}, which does not exist — ` +
                'cache.addAll() is all-or-nothing and the service worker will never install')
                .toBe(true);
        }
    });
});
