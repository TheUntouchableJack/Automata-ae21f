/**
 * The one guard against the single failure mode a separate Following RPC
 * introduces.
 *
 * get_venue_feed and get_following_feed are deliberately two functions rather
 * than one function with a p_following argument (see the header of migration
 * 20260903000004: a merged function would need another DROP + CREATE outage on
 * every change, and could not have an honest grant footer — browsing must be
 * anon-executable and a Following feed cannot be).
 *
 * The cost of that choice is that ONE renderFeedCard() reads both, so their
 * RETURNS TABLE lists have to stay identical. If they drift, nothing errors:
 * the client reads `undefined` for the missing column and renders a card with a
 * blank byline, or no avatar, or no duration — the exact silent-failure shape
 * this app keeps producing.
 *
 * Static assertions over the migration text. No network, no database.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = '/Users/jaywhitley/AI Projects/Automata';
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');

const feedSql = fs.readFileSync(
    path.join(MIGRATIONS, '20260903000004_feed_author_and_following.sql'),
    'utf8'
);

/**
 * Pulls the `RETURNS TABLE ( ... )` block that follows a named CREATE FUNCTION.
 * Returns the column list normalised to one trimmed entry per line, so a
 * whitespace-only difference is not reported as a drift.
 */
function returnsTableOf(sql, fnName) {
    const start = sql.search(
        new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ${fnName}\\s*\\(`)
    );
    expect(start, `${fnName} is not defined in this migration`).toBeGreaterThan(-1);

    const rest = sql.slice(start);
    const marker = rest.indexOf('RETURNS TABLE (');
    expect(marker, `${fnName} has no RETURNS TABLE block`).toBeGreaterThan(-1);

    const open = marker + 'RETURNS TABLE '.length;
    let depth = 0;
    let end = -1;
    for (let i = open; i < rest.length; i++) {
        if (rest[i] === '(') depth++;
        else if (rest[i] === ')') {
            depth--;
            if (depth === 0) { end = i; break; }
        }
    }
    expect(end, `${fnName}'s RETURNS TABLE block is unbalanced`).toBeGreaterThan(-1);

    return rest
        .slice(open + 1, end)
        .split(',')
        .map(s => s.trim().replace(/\s+/g, ' '))
        .filter(Boolean);
}

describe('the two feed RPCs share one contract', () => {
    const venueFeed = returnsTableOf(feedSql, 'get_venue_feed');
    const followingFeed = returnsTableOf(feedSql, 'get_following_feed');

    it('parsed something real — a vacuous comparison would pass forever', () => {
        // Two empty arrays are equal. Without this the whole file could go
        // green after a rename that made returnsTableOf() find nothing.
        expect(venueFeed.length).toBeGreaterThan(20);
        expect(venueFeed).toContain('id UUID');
        expect(venueFeed).toContain('uploaded_by_user_id UUID');
    });

    it('get_venue_feed and get_following_feed return the identical column list', () => {
        // Order matters as much as membership: PostgREST returns objects, but a
        // reordered list is still a different function signature to maintain,
        // and the next person copying one into the other will trip over it.
        expect(followingFeed).toEqual(venueFeed);
    });

    it('both carry the Phase 2 author columns the feed card renders', () => {
        for (const col of ['author_display_name TEXT', 'author_avatar_url TEXT']) {
            expect(venueFeed, `get_venue_feed is missing ${col}`).toContain(col);
            expect(followingFeed, `get_following_feed is missing ${col}`).toContain(col);
        }
    });

    it('they ship in the SAME migration file', () => {
        // Split them across two files and one can be applied without the other,
        // which is precisely the drift the test above exists to prevent.
        expect(feedSql).toContain('CREATE FUNCTION get_venue_feed(');
        expect(feedSql).toMatch(/CREATE OR REPLACE FUNCTION get_following_feed\(/);
    });
});

describe('the client reads the two feeds through one path', () => {
    const js = fs.readFileSync(path.join(ROOT, 'customer-app/social.js'), 'utf8');

    it('loadFeed picks the RPC by mode and renders both with renderFeedCard', () => {
        expect(js).toMatch(/get_following_feed/);
        expect(js).toMatch(/supabaseClient\.rpc\(rpcName,/);
        // One renderer. Two would be free to drift in exactly the way the
        // column-parity assertion above is trying to prevent.
        expect((js.match(/function renderFeedCard\(/g) || []).length).toBe(1);
    });

    it('the Following chip is gated on a signed-in user', () => {
        // get_following_feed is authenticated-only. A chip offered to a
        // signed-out visitor could only ever return an empty feed.
        expect(js).toMatch(/currentUserId\s*\n?\s*\?\s*`<button class="pill/);
    });

    it('refreshFilterPills exempts the Following chip from the "chip vanished" reset', () => {
        // The chip is not derived from the venue set, so the derived-list check
        // answers "gone" every time — and any venue edit would silently kick
        // the user back to All mid-scroll.
        expect(js).toMatch(/const stillThere = feedMode === 'following'\s*\n\s*\?\s*true/);
    });
});
