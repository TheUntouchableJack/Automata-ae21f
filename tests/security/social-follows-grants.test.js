/**
 * Grant-footer and column-leak guards for the ViibeView Phase 2 RPCs.
 *
 * This repo has been bitten in BOTH directions, and each time it failed
 * silently:
 *
 *   Too open — `REVOKE ALL ... FROM PUBLIC; GRANT ... TO authenticated` reads
 *   like "signed-in callers only" and is not: Supabase's ALTER DEFAULT
 *   PRIVILEGES grants anon EXECUTE directly, and REVOKE FROM PUBLIC does not
 *   touch that grant. Measured in 20260828000005. The only correct shape is all
 *   THREE lines, including `FROM anon`.
 *
 *   Too closed — adding any footer to an anon-readable feed function empties it
 *   for every signed-out visitor, and the client renders its empty state over
 *   the permission error it only logs (20260828000003:21-28).
 *
 * And because the anon-readable functions ARE public API — anyone with the anon
 * key can call them — they must never select a column that is not meant to
 * leave the row: email, phone, points_balance, tier, pin_hash, auth_token or
 * last_name.
 *
 * Static assertions over migration text. No network, no database.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = '/Users/jaywhitley/AI Projects/Automata';
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');

const FILES = [
    '20260903000000_revoke_anon_member_rpcs.sql',
    '20260903000001_social_follows.sql',
    '20260903000002_member_profiles.sql',
    '20260903000003_follow_lists_and_discovery.sql',
    '20260903000004_feed_author_and_following.sql',
];

const sql = FILES.map(f => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')).join('\n');

// Every function Phase 2 creates or replaces, and whether a caller holding only
// the anon key is supposed to be able to execute it.
//
// The rule of thumb: if a signed-out visitor can SEE the thing in the UI, the
// function behind it is anon-readable. Browsing is anonymous in this app by
// design, so profiles, follower lists and discovery are all readable; anything
// that reads auth.uid() to decide what to do is not.
const AUTHENTICATED_ONLY = [
    'social_member_signup',
    'get_social_member',
    'delete_social_member_data',
    'follow_target',
    'unfollow_target',
    'update_social_profile',
    'get_following_feed',
];

const ANON_READABLE = [
    'social_follower_count',
    'get_member_profile',
    'get_member_posts',
    'get_member_followers',
    'get_member_following',
    'discover_members',
    'get_venue_feed',
];

const FORBIDDEN_COLUMNS = [
    'email',
    'phone',
    'points_balance',
    'tier',
    'pin_hash',
    'auth_token',
    'last_name',
];

/** Everything between a function's definition and the next CREATE/DROP or EOF. */
function bodyAndFooterOf(fnName) {
    const start = sql.search(
        new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ${fnName}\\s*\\(`)
    );
    if (start === -1) return null;

    const rest = sql.slice(start);
    // The footer sits after the body's closing `$$;`, before the next statement
    // that opens a new object.
    const next = rest.slice(1).search(/\n(?:CREATE|DROP|ALTER|COMMENT|UPDATE) /);
    return next === -1 ? rest : rest.slice(0, next + 1);
}

/** The SQL between $$ ... $$ — the part that actually selects columns. */
function bodyOf(fnName) {
    const section = bodyAndFooterOf(fnName);
    if (!section) return null;
    const open = section.indexOf('AS $$');
    const close = section.indexOf('$$;', open);
    if (open === -1 || close === -1) return null;
    return section.slice(open, close);
}

describe('Phase 2 migrations exist and were parsed', () => {
    it('every migration file is present', () => {
        for (const f of FILES) {
            expect(fs.existsSync(path.join(MIGRATIONS, f)), f).toBe(true);
        }
    });

    it('every function under test was actually found', () => {
        // Guards the whole file against passing vacuously after a rename:
        // a regex that matches nothing makes every not.toMatch() below green.
        const missing = [...AUTHENTICATED_ONLY, ...ANON_READABLE]
            // get_venue_feed and the three grant-only functions in M0 are
            // handled separately below.
            .filter(fn => !['social_member_signup', 'get_social_member', 'delete_social_member_data'].includes(fn))
            .filter(fn => bodyAndFooterOf(fn) === null);
        expect(missing).toEqual([]);
    });
});

describe('authenticated-only functions carry all THREE footer lines', () => {
    for (const fn of AUTHENTICATED_ONLY) {
        it(`${fn} revokes PUBLIC, revokes anon, and grants authenticated`, () => {
            // Searched across the whole Phase 2 corpus: M0 issues the footers
            // for the three functions it inherits without redefining them.
            const revokePublic = new RegExp(`REVOKE ALL ON FUNCTION ${fn}\\([^)]*\\) FROM PUBLIC;`);
            const revokeAnon = new RegExp(`REVOKE ALL ON FUNCTION ${fn}\\([^)]*\\) FROM anon;`);
            const grantAuth = new RegExp(`GRANT EXECUTE ON FUNCTION ${fn}\\([^)]*\\) TO authenticated;`);

            expect(sql, `${fn}: missing REVOKE ... FROM PUBLIC`).toMatch(revokePublic);
            // The one that actually matters — see the file header.
            expect(sql, `${fn}: missing REVOKE ... FROM anon (this is the line that restricts anon)`)
                .toMatch(revokeAnon);
            expect(sql, `${fn}: missing GRANT ... TO authenticated`).toMatch(grantAuth);
        });
    }
});

describe('anon-readable functions carry NO footer at all', () => {
    for (const fn of ANON_READABLE) {
        it(`${fn} is followed by no GRANT or REVOKE`, () => {
            const section = bodyAndFooterOf(fn);
            expect(section, `${fn} was not found`).toBeTruthy();

            // Comments explain the rule and legitimately contain the words, so
            // strip them before looking for real statements.
            const code = section.replace(/^\s*--.*$/gm, '');

            expect(code, `${fn}: a grant footer here empties it for signed-out visitors, silently`)
                .not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${fn}\\(`));
            expect(code, `${fn}: a REVOKE here empties it for signed-out visitors, silently`)
                .not.toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${fn}\\(`));
        });
    }
});

describe('anon-readable functions leak no private column', () => {
    // get_venue_feed and social_follower_count are excluded from the column
    // sweep for honest reasons: the feed selects from venue_media/venues (it
    // touches app_members only for display_name and avatar_url), and the count
    // returns an integer. Both are still asserted footer-free above.
    const PROFILE_RPCS = [
        'get_member_profile',
        'get_member_posts',
        'get_member_followers',
        'get_member_following',
        'discover_members',
    ];

    for (const fn of PROFILE_RPCS) {
        it(`${fn} never selects a private column`, () => {
            const body = bodyOf(fn);
            expect(body, `${fn} body was not found`).toBeTruthy();

            const code = body.replace(/^\s*--.*$/gm, '');
            // Not vacuous: the stripped body must still be substantial.
            expect(code.length).toBeGreaterThan(body.length * 0.4);

            for (const col of FORBIDDEN_COLUMNS) {
                // Word-boundary match, so `first_name` does not trip on
                // `last_name` and `tier` does not trip on a longer identifier.
                expect(code, `${fn} references ${col}, which anon must never receive`)
                    .not.toMatch(new RegExp(`\\b${col}\\b`));
            }
        });
    }

    it('the name fallback is first name only, matching get_app_leaderboard', () => {
        // COALESCE(display_name, first_name, 'Member') — never a full name.
        // Surnames are not something a member opted into publishing.
        const uses = sql.match(/COALESCE\((?:am|m)\.display_name, (?:am|m)\.first_name, 'Member'\)/g) || [];
        expect(uses.length).toBeGreaterThanOrEqual(4);
    });
});

describe('the profile_public backfill is scoped', () => {
    const m2 = fs.readFileSync(path.join(MIGRATIONS, '20260903000002_member_profiles.sql'), 'utf8');

    // ⚠️ Assert against CODE, not prose. This migration's header explains the
    // unscoped UPDATE and the column default it deliberately does NOT issue —
    // so a naive substring search flags the warning as the very thing it warns
    // about. Same trap the app/venues.html test documents.
    const m2code = m2.replace(/^\s*--.*$/gm, '');

    it('the comment strip did not eat the migration', () => {
        // Without this, every assertion below passes vacuously against an
        // empty haystack.
        expect(m2code.length).toBeGreaterThan(m2.length * 0.3);
        expect(m2code).toContain('CREATE OR REPLACE FUNCTION update_social_profile');
    });

    it('updates profile_public for exactly one pinned app id', () => {
        // An unscoped UPDATE would put every member of every Royalty loyalty
        // tenant onto that tenant's public leaderboard — profile_public also
        // gates get_app_leaderboard (customer-apps-migration.sql:655). That is
        // a cross-tenant privacy incident, not a data cleanup.
        const updates = m2code.match(/UPDATE app_members\s+SET profile_public = true[\s\S]*?;/g) || [];
        expect(updates.length).toBe(1);
        expect(updates[0]).toMatch(/WHERE app_id = '[0-9a-f-]{36}'/);
        expect(updates[0]).toMatch(/deleted_at IS NULL/);
    });

    it('never changes the column default', () => {
        // A default change would flip every FUTURE Royalty signup, everywhere.
        expect(m2code).not.toMatch(/ALTER COLUMN profile_public SET DEFAULT/);
    });

    it('ships the off switch in the same release', () => {
        // Public-by-default only means what it says if it can be turned off.
        expect(m2code).toMatch(/p_profile_public BOOLEAN/);
        const html = fs.readFileSync(path.join(ROOT, 'customer-app/social.html'), 'utf8');
        expect(html).toContain('id="edit-profile-public"');
    });
});

describe('social_follows is written only through its RPCs', () => {
    const m1 = fs.readFileSync(path.join(MIGRATIONS, '20260903000001_social_follows.sql'), 'utf8');

    it('has RLS on with a read-own policy and NO write policy', () => {
        expect(m1).toMatch(/ALTER TABLE social_follows ENABLE ROW LEVEL SECURITY;/);

        const policies = m1.match(/CREATE POLICY[\s\S]*?;/g) || [];
        expect(policies.length).toBe(1);
        expect(policies[0]).toMatch(/FOR SELECT/);
        expect(policies[0]).toMatch(/follower_user_id = auth\.uid\(\)/);

        // A client INSERT policy would let anyone forge edges at scale, and
        // would turn the partial unique index into an existence oracle for
        // user ids (a duplicate returns a distinguishable 23505).
        expect(m1).not.toMatch(/FOR INSERT/);
        expect(m1).not.toMatch(/FOR UPDATE/);
        expect(m1).not.toMatch(/FOR DELETE/);
    });

    it('account deletion clears follow edges BEFORE it releases the user id', () => {
        // After `UPDATE app_members SET ... user_id = NULL` the function has
        // lost its only handle on the auth user and cannot find the edges.
        const deleteEdges = m1.indexOf('DELETE FROM social_follows');
        const releaseUser = m1.indexOf('user_id = NULL');
        expect(deleteEdges).toBeGreaterThan(-1);
        expect(releaseUser).toBeGreaterThan(-1);
        expect(deleteEdges).toBeLessThan(releaseUser);
    });
});
