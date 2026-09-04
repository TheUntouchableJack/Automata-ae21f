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

// ============================================================================
// M4 — 20260904000008_close_member_pii_chain.sql
//
// The odd one out in this file: M1/M2/M3 change GRANTS, M4 changes SHAPES and
// touches no grant at all except to restore the ones its own DROPs removed. So
// it gets its OWN corpus rather than joining FILES — the header's warning about
// a shared corpus resolving the first match of a function name applies doubly
// here, where get_member_profile is named in all four files and M4 is the only
// one that DROPs it.
//
// What M4 closes: get_app_leaderboard returned app_members.id for every public
// member, and get_member_profile(UUID) — which has no profile_public gate —
// turned any such id into a name, email and phone. Two anon requests, verified
// live 2026-09-04 against three real rows.
// ============================================================================
const M4 = '20260904000008_close_member_pii_chain.sql';
const raw4 = fs.readFileSync(path.join(MIGRATIONS, M4), 'utf8');
const code4 = stripComments(raw4);
const ddl4 = stripDoBlocks(code4);

describe('M4 closes the member PII chain', () => {
    // ⚠️ Anti-vacuity FIRST. Every not.toMatch below passes against an empty
    // string, and M4 is comment-heavy enough that a greedy strip is a real risk.
    it('the corpus is real and survived both strips', () => {
        expect(raw4.length).toBeGreaterThan(2000);
        expect(code4.length, 'M4 is almost entirely comments after stripping')
            .toBeGreaterThan(raw4.length * 0.25);
        expect(ddl4.length, 'stripDoBlocks ate the top-level DDL — every prohibition ' +
            'assertion below would pass vacuously')
            .toBeGreaterThan(600);
        // Positive anchors: the statements the prohibitions are relative to.
        expect(ddl4).toMatch(/CREATE FUNCTION public\.get_app_leaderboard/);
        expect(ddl4).toMatch(/CREATE FUNCTION public\.get_member_profile/);
    });

    // 🔴 THE SILENT FAILURE. get_member_profile is overloaded: the 1-arg loyalty
    // form is M4's target, the 2-arg (UUID, UUID) form is ViibeView's profile
    // overlay. A bare-name DROP raises 42725 rather than guessing, but a DROP of
    // the (UUID, UUID) form would succeed and take the WRONG one — emptying every
    // overlay with no error visible anywhere, because social.js:660 destructures
    // { data } and never inspects error.
    it('drops get_member_profile TYPE-QUALIFIED to the 1-arg form only', () => {
        expect(ddl4).toMatch(/DROP FUNCTION public\.get_member_profile\(UUID\);/);

        expect(ddl4, 'a bare-name DROP would raise 42725 on this overloaded function')
            .not.toMatch(/DROP FUNCTION\s+(IF EXISTS\s+)?(public\.)?get_member_profile\s*;/i);

        expect(ddl4, '🔴 M4 drops the 2-arg ViibeView overload. Every profile overlay ' +
            'goes empty and fails SILENTLY — social.js:660 ignores error.')
            .not.toMatch(/DROP FUNCTION[^;]*get_member_profile\s*\(\s*UUID\s*,\s*UUID\s*\)/i);
    });

    // 🔴 Ambiguity at RUN time, not deploy time. Leaving the 2-arg leaderboard in
    // place alongside the new 3-arg form makes get_app_leaderboard(app, 10) match
    // both — 42725 for real users while the push reports green.
    it('drops the old 2-arg get_app_leaderboard exactly once', () => {
        const drops = ddl4.match(/DROP FUNCTION[^;]*get_app_leaderboard[^;]*;/gi) || [];
        expect(drops, `leaderboard drops found: ${drops.join(' | ')}`).toHaveLength(1);
        expect(drops[0]).toMatch(/public\.get_app_leaderboard\(UUID,\s*INTEGER\)/i);
        // ...and the post-flight proves it is GONE rather than merely shadowed.
        expect(raw4).toMatch(/to_regprocedure\('public\.get_app_leaderboard\(uuid,integer\)'\)/);
    });

    // ⚠️ A DROP takes the function's grants with it, silently. Forgetting the
    // re-GRANT turns both functions into 42501 for every caller.
    it('re-GRANTs both recreated functions', () => {
        expect(ddl4, 'the leaderboard DROP took its grants and they were not restored')
            .toMatch(/GRANT EXECUTE ON FUNCTION public\.get_app_leaderboard\(UUID,\s*INTEGER,\s*UUID\) TO anon, authenticated;/);
        expect(ddl4, 'the profile DROP took its grants and they were not restored')
            .toMatch(/GRANT EXECUTE ON FUNCTION public\.get_member_profile\(UUID\) TO anon, authenticated;/);
    });

    it('never re-grants the 2-arg overload it must not have touched', () => {
        // Not a widening and not a repair: M4 must leave that function alone
        // entirely. A GRANT here would mean a DROP happened.
        expect(ddl4).not.toMatch(/GRANT[^;]*get_member_profile\s*\(\s*UUID\s*,\s*UUID\s*\)/i);
    });

    // The actual payload: the PII is gone from the returned SHAPE.
    //
    // ⚠️ Assert on the RETURNS TABLE block, not on the body. `am.id` appears
    // legitimately in both bodies — the leaderboard compares it to build is_me,
    // and the profile returns the caller's own id, which they had to know to ask.
    // A body-wide /am\.id/ prohibition fails against correct code.
    const shapeOf = (name) => {
        const fn = ddl4.slice(ddl4.indexOf(`CREATE FUNCTION public.${name}`));
        const start = fn.indexOf('RETURNS TABLE');
        const end = fn.indexOf('LANGUAGE');
        expect(start, `could not locate the RETURNS TABLE of ${name}`).toBeGreaterThan(-1);
        expect(end, `could not locate the end of ${name}'s signature`).toBeGreaterThan(start);
        return fn.slice(start, end);
    };

    it('get_member_profile returns neither email nor phone', () => {
        const shape = shapeOf('get_member_profile');
        expect(shape.length).toBeGreaterThan(50);          // the slice is real
        expect(shape, `still returns email — the chain is not closed. Shape: ${shape}`)
            .not.toMatch(/\bemail\b/);
        expect(shape, `still returns phone — the chain is not closed. Shape: ${shape}`)
            .not.toMatch(/\bphone\b/);
        // Positive control: the slice would trivially satisfy the above if empty.
        expect(shape).toMatch(/\bfirst_name\b/);
    });

    it('get_app_leaderboard returns is_me and no dereferenceable id', () => {
        const shape = shapeOf('get_app_leaderboard');
        expect(shape.length).toBeGreaterThan(50);
        expect(shape, `still returns a bare id — the harvest chain is open. Shape: ${shape}`)
            .not.toMatch(/\bid\b/);
        expect(shape, 'no is_me — the "this is you" highlight would be dead')
            .toMatch(/\bis_me BOOLEAN\b/);
        expect(ddl4).toMatch(/AS is_me/);
    });

    it('keeps the columns app.html actually renders', () => {
        for (const col of ['am.first_name', 'am.last_name', 'am.points_balance',
                           'am.tier', 'am.notifications_enabled']) {
            expect(ddl4, `M4 dropped ${col}, which app.html renders`).toContain(col);
        }
    });

    it('preserves the leaderboard visibility filter', () => {
        expect(ddl4).toMatch(/am\.profile_public = true/);
        expect(ddl4).toMatch(/am\.deleted_at IS NULL/);
    });

    it('carries a no-op warning, a functionality guard and isolated COMMENTs', () => {
        expect(raw4).toMatch(/RAISE WARNING/);
        expect(raw4).toMatch(/functionality guard/i);
        // 🔴 The must-stay-OPEN direction. Security assertions all pass on a
        // database where every caller is broken.
        for (const fn of ['get_app_leaderboard\\(uuid,integer,uuid\\)',
                          'get_member_profile\\(uuid\\)',
                          'get_member_profile\\(uuid,uuid\\)']) {
            expect(raw4, `the functionality guard omits ${fn}`)
                .toMatch(new RegExp(`'public\\.${fn}'`));
        }
        const comments = (code4.match(/COMMENT ON /g) || []).length;
        const doBlocks = (code4.match(/DO \$doc\$/g) || []).length;
        expect(doBlocks).toBe(comments);
        expect(comments).toBeGreaterThanOrEqual(2);
    });

    it('reloads the PostgREST schema cache', () => {
        // Both signatures changed; a stale cache answers PGRST202, which reads as
        // a broken migration rather than a stale cache.
        expect(ddl4).toMatch(/NOTIFY pgrst, 'reload schema';/);
    });
});

describe('M4 client half — the two halves are not independently correct', () => {
    const html = fs.readFileSync(path.join(ROOT, 'customer-app/app.html'), 'utf8');

    it('app.html reads is_me instead of comparing member ids', () => {
        expect(html.length).toBeGreaterThan(10000);          // corpus is real
        // The old comparison cannot work: member.id is now undefined, so isMe
        // would be false for everyone and the highlight would die SILENTLY.
        expect(html, 'app.html still compares member.id — the leaderboard no longer ' +
            'returns one, so the "this is you" highlight is permanently false')
            .not.toMatch(/member\.id === currentMember\.id/);
        const uses = html.match(/member\.is_me === true/g) || [];
        expect(uses, 'both render paths (podium and list) must read is_me').toHaveLength(2);
    });

    it('app.html passes its own member id to the leaderboard', () => {
        expect(html).toMatch(/p_member_id: currentMember\?\.id \|\| null/);
    });

    it('app.html no longer renders email or phone', () => {
        for (const ref of ['profile-email', 'profile-phone',
                           'currentMember.email', 'currentMember.phone']) {
            expect(html, `app.html still references ${ref}, which get_member_profile ` +
                'no longer returns').not.toContain(ref);
        }
    });

    it('sw.js bumped its cache generation past v10', () => {
        // ⚠️ Mandatory, not cosmetic. The fetch handler is cache-first keyed on
        // the full URL, so a returning PWA user keeps the old app.html — pairing
        // old client code with the new RPC shapes — until the cache name changes.
        const sw = fs.readFileSync(path.join(ROOT, 'customer-app/sw.js'), 'utf8');
        const names = stripJsComments(sw).match(/royalty-[a-z]+-v(\d+)/g) || [];
        expect(names).toHaveLength(3);
        for (const n of names) {
            expect(Number(n.match(/v(\d+)$/)[1]),
                `${n} was not bumped — returning PWA users keep the old app.html`)
                .toBeGreaterThanOrEqual(11);
        }
    });
});
