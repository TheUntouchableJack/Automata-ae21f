/**
 * Guards for the 2026-09-22 ViibeView batch:
 *
 *   Phase 1  Follow button — pending intent, in-flight guard, follower count
 *   Phase 2  Manual venue entry — the form, the coordinates, the country bug
 *   Phase 3  Post lifetime — is_permanent, the four readers, the seed, the copy
 *   Phase 4  Venue page — collapsible sections, calcDistance, crowd privacy
 *
 * Phase 5's guards live in viibeview-feed-v3.test.js, next to the full-screen
 * feed assertions they extend.
 *
 * Static assertions over migration text and client source, plus a small jsdom
 * block for calcDistance. No network and no database: prod holds one venue and
 * two posts, so anything asserted against live data here would be trivially
 * true. These pin the things a two-post tenant CANNOT demonstrate.
 *
 * ⚠️ EVERY BLOCK OPENS WITH A NON-EMPTINESS GUARD. A slice that finds nothing
 * makes every not.toContain() below it pass, which is the failure mode this
 * repo has been bitten by more than once.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

// Derived, never hard-coded: an absolute path to one checkout makes every
// file-reading test here silently read THAT tree, so a `git worktree` baseline
// at an older commit reads the CURRENT files and reports them as passing.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');

const js = fs.readFileSync(path.join(ROOT, 'customer-app/social.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'customer-app/social.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'customer-app/social.css'), 'utf8');

const sql = name => fs.readFileSync(path.join(MIGRATIONS, name), 'utf8');

const followsSql   = sql('20260922000001_social_follows_grant_and_venue_follower_count.sql');
const createdBySql = sql('20260922000002_venue_created_by.sql');
const permSql      = sql('20260922000003_post_permanence.sql');
const ttlSql       = sql('20260922000004_post_ttl_readers.sql');
const crowdSql     = sql('20260922000005_venue_crowd_mix.sql');

/** The source of one top-level function, sliced to its own closing brace. */
function fnBody(signature) {
    const start = js.indexOf(signature);
    if (start < 0) return null;
    const rest = js.slice(start);
    const end = rest.indexOf('\n}');
    if (end < 0) return null;
    return rest.slice(0, end);
}

/**
 * SQL with `--` comment text removed, for assertions about ABSENCE.
 *
 * ⚠️ Mandatory, not tidiness. This exact class has already failed against
 * CORRECT code here: an assertion that a migration does not REVOKE matched the
 * migration's own warning saying never to REVOKE, and the only way to go green
 * would have been to delete the warning.
 *
 * Caught three more while writing this file: the TTL disjunct counted 5
 * because the header quotes the predicate it is documenting, and
 * saveNewVenue's `!pendingPlace` check "survived" in a comment explaining that
 * it had been removed.
 */
function sqlCode(text) {
    return text.split('\n').map(l => {
        const i = l.indexOf('--');
        return i < 0 ? l : l.slice(0, i);
    }).join('\n');
}

/** fnBody with JS and HTML comments stripped — the same rule, for client source. */
function fnCode(signature) {
    const body = fnBody(signature);
    if (body === null) return null;
    return body
        .replace(/<!--[\s\S]*?-->/g, '')
        .split('\n')
        .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
}

// ===========================================================================
// Phase 1 — the Follow button
// ===========================================================================

describe('Phase 1 — Follow button', () => {
    it('a signed-out tap is HELD, not discarded', () => {
        // The bug Jay sees: the signup sheet opens, the account is created, and
        // no follow is ever written — the button still reads "Follow". There
        // was no pending-intent storage at all, unlike the composer's.
        const toggle = fnBody('async function toggleFollow(type, id)');
        expect(toggle, 'toggleFollow not found').toBeTruthy();
        expect(toggle).toMatch(/requireAccount\([^)]*,\s*\{[\s\S]*pendingFollow:\s*\{\s*type,\s*id\s*\}/);

        const require_ = fnBody('async function requireAccount(reason, { pendingVenueId, pendingFollow } = {})');
        expect(require_, 'requireAccount did not take the pendingFollow option').toBeTruthy();
        expect(require_).toContain('hasPendingFollow = true');
    });

    it('onSignedIn both RESUMES the follow and REPAINTS the buttons', () => {
        const onSignedIn = fnBody('async function onSignedIn()');
        expect(onSignedIn, 'onSignedIn not found').toBeTruthy();

        // The resume.
        expect(onSignedIn).toContain('if (hasPendingFollow)');
        expect(onSignedIn).toMatch(/toggleFollow\(type, id\)/);

        // ⚠️ AND the repaint, which is the other half of the same bug. The
        // venue page is still mounted underneath the overlay, painted from a
        // followingKeys that was empty all session. Reloading the state without
        // repainting leaves a correct Set behind a stale label.
        expect(onSignedIn).toContain('repaintFollowButtons()');

        // ⚠️ ORDER: after checkOwnerAccess(), which is what sets currentUserId,
        // and after loadFollowingState(), which needs it. A repaint before
        // either paints from an empty Set and is a no-op.
        const owner = onSignedIn.indexOf('await checkOwnerAccess()');
        const load = onSignedIn.indexOf('await loadFollowingState({ force: true })');
        const paint = onSignedIn.indexOf('repaintFollowButtons()');
        expect(owner).toBeGreaterThan(-1);
        expect(load).toBeGreaterThan(owner);
        expect(paint).toBeGreaterThan(load);
    });

    it('browsing without an account abandons the pending follow too', () => {
        // Without this, someone who taps Follow, backs out, and signs in an
        // hour later from the Profile tab silently follows a venue they have
        // long since forgotten. The composer already had this; the follow
        // needed it for the same reason.
        const i = js.indexOf("getElementById('auth-browse-btn')");
        expect(i, 'the browse-without-an-account handler is gone').toBeGreaterThan(-1);
        const handler = js.slice(i, i + 400);
        expect(handler).toContain('hasPendingFollow = false');
        expect(handler).toContain('pendingFollowId = undefined');
    });

    it('a double tap cannot race follow_target against unfollow_target', () => {
        const toggle = fnBody('async function toggleFollow(type, id)');
        expect(toggle, 'toggleFollow not found').toBeTruthy();

        expect(toggle).toMatch(/if \(followInFlight\.has\(key\)\) return;/);
        expect(toggle).toContain('followInFlight.add(key)');

        // ⚠️ Cleared in a FINALLY. An exception from the RPC layer would
        // otherwise wedge the key permanently and the button would never
        // respond again — a worse outcome than the race it guards.
        const finallyAt = toggle.indexOf('} finally {');
        expect(finallyAt, 'the in-flight key is not cleared in a finally').toBeGreaterThan(-1);
        expect(toggle.slice(finallyAt)).toContain('followInFlight.delete(key)');
    });

    it('the busy state reaches the orphaned .follow-btn:disabled rule', () => {
        // The CSS rule has existed since the button shipped and nothing ever
        // set `disabled`, so it was unreachable. No CSS change was needed —
        // only a writer.
        expect(css).toMatch(/\.follow-btn:disabled \{/);
        const paint = fnBody('function paintFollowButton(btn, following, busy = false)');
        expect(paint, 'paintFollowButton did not gain the busy argument').toBeTruthy();
        expect(paint).toContain('btn.disabled = !!busy');

        const repaint = fnBody('function repaintFollowButtons()');
        expect(repaint, 'repaintFollowButtons not found').toBeTruthy();
        expect(repaint).toMatch(/followInFlight\.has\(followKey\('venue', venuePageVenueId\)\)/);
    });

    it('a failed follow-state load goes EMPTY, not stale', () => {
        const load = fnBody('async function loadFollowingState({ force = false } = {})');
        expect(load, 'loadFollowingState not found').toBeTruthy();

        // ⚠️ Bounded to the ERROR ARM at both ends. `slice(indexOf('if (error'))`
        // runs to the end of the function and swallows the success path, so an
        // assertion over it can be satisfied by the wrong occurrence — and the
        // identical `followingKeys = new Set(); followingLoaded = false;` pair
        // in the early-return block above makes that a live risk, not a
        // theoretical one.
        const errStart = load.indexOf('if (error) {');
        expect(errStart, 'the error arm was not found').toBeGreaterThan(-1);
        const errEnd = load.indexOf('\n    }', errStart);
        expect(errEnd, 'the error arm is unterminated').toBeGreaterThan(errStart);
        const errArm = load.slice(errStart, errEnd);

        expect(errArm).toContain('followingKeys = new Set()');
        // followingLoaded must go false too, or the retry in openVenuePage
        // no-ops forever and the empty Set becomes permanent.
        expect(errArm).toContain('followingLoaded = false');
    });

    it('openVenuePage retries the follow state before repainting', () => {
        const open = fnBody('async function openVenuePage(venueId)');
        expect(open, 'openVenuePage not found').toBeTruthy();

        const load = open.indexOf('await loadFollowingState()');
        const paint = open.indexOf('repaintFollowButtons()');
        expect(load, 'openVenuePage does not retry the follow state').toBeGreaterThan(-1);
        expect(paint).toBeGreaterThan(load);
    });

    it('the follower count writes into its OWN span', () => {
        // ⚠️ NOT a re-render of #venue-page-identity. That block owns the
        // avatar, name, rating, here-now badge and distance; rebuilding all of
        // it to change one number is the repaintVenueGenres outerHTML trap in a
        // different place.
        const render = fnBody('function renderVenueFollowerCount()');
        expect(render, 'renderVenueFollowerCount not found').toBeTruthy();
        expect(render).toContain("getElementById('venue-page-followers')");
        expect(render, 'the follower count re-renders the whole identity block')
            .not.toContain('venue-page-identity');

        // ...and the span is a SIBLING of the identity block in the markup, or
        // openVenuePage's innerHTML write would wipe it on every open.
        const identityAt = html.indexOf('id="venue-page-identity"');
        const followersAt = html.indexOf('id="venue-page-followers"');
        expect(identityAt).toBeGreaterThan(-1);
        expect(followersAt).toBeGreaterThan(identityAt);
        expect(html.slice(identityAt, followersAt)).toContain('</div>');
    });

    it('the migration DROPs get_venue_detail and adds NO grant footer', () => {
        // CREATE OR REPLACE cannot add an OUT column (42P13).
        expect(followsSql).toMatch(/DROP FUNCTION IF EXISTS get_venue_detail\(UUID\);/);
        expect(followsSql).toMatch(/follower_count INTEGER/);
        expect(followsSql).toMatch(/social_follower_count\(v\.app_id, 'venue', v\.id\)/);

        // ⚠️ The plan said "re-issue get_venue_detail's footer". It HAS no
        // footer — 20260901000001:32-41 states that get_venue_detail,
        // get_venue_feed and get_recent_post_pins all rely on the default
        // EXECUTE TO PUBLIC, and that this is the only reason anon can browse.
        // A DROP takes grants with it, but there are none to take. Adding one
        // here would empty the venue page for every signed-out visitor.
        //
        // sqlCode, not the raw text: the file's own warning says the words.
        const code = sqlCode(followsSql);
        expect(code, 'a grant footer was added to get_venue_detail')
            .not.toMatch(/REVOKE[\s\S]{0,80}get_venue_detail/i);
        expect(code, 'a grant footer was added to get_venue_detail')
            .not.toMatch(/GRANT EXECUTE[\s\S]{0,80}get_venue_detail/i);

        // The grant that IS issued is the table one social_follows never got.
        expect(code).toMatch(/GRANT SELECT ON TABLE social_follows TO authenticated;/);

        // Both directions asserted at install time, since both fail silently.
        expect(followsSql).toMatch(/has_table_privilege\('authenticated', 'public\.social_follows', 'SELECT'\)/);
        expect(followsSql).toMatch(/has_function_privilege\('anon', 'public\.get_venue_detail\(uuid\)', 'EXECUTE'\)/);
    });
});

// ===========================================================================
// Phase 2 — manual venue entry
// ===========================================================================

describe('Phase 2 — manual venue entry', () => {
    it('the country bug is fixed — a real pre-existing defect', () => {
        // #add-venue-country was populated by choosePlace() and then never
        // read, so every venue added from this sheet took the DB default 'US'
        // — including the one in Perpignan.
        const save = fnBody('async function saveNewVenue()');
        expect(save, 'saveNewVenue not found').toBeTruthy();
        expect(save).toMatch(/country: document\.getElementById\('add-venue-country'\)\?\.value\.trim\(\) \|\| null/);
    });

    it('coordinates come from the INPUTS, not from pendingPlace', () => {
        const save = fnBody('async function saveNewVenue()');
        expect(save, 'saveNewVenue not found').toBeTruthy();

        expect(save).toMatch(/readCoordInput\('add-venue-lat', 90\)/);
        expect(save).toMatch(/readCoordInput\('add-venue-lng', 180\)/);

        // pendingPlace is null on the manual path by definition. Reading
        // pendingPlace.lat there would throw, and gating on it is exactly why
        // manual entry could not exist.
        //
        // ⚠️ fnCode, not fnBody: saveNewVenue's own comment explains that the
        // `if (!pendingPlace) return` gate was REMOVED, so asserting absence
        // over the raw body fails against correct code.
        const code = fnCode('async function saveNewVenue()');
        expect(code, 'saveNewVenue still reads coordinates off pendingPlace')
            .not.toMatch(/pendingPlace\.(lat|lng)/);
        expect(code, 'the !pendingPlace hard gate is still there')
            .not.toMatch(/if \(!pendingPlace/);
        expect(save).toMatch(/if \(!currentApp \|\| !ownerOrgId\) return;/);
    });

    it('is_active is COMPUTED, never the literal true', () => {
        // ⚠️ HONOUR venues_active_requires_coordinates, do not trip it. Sending
        // is_active:true with a null latitude is a 23514 whose message names a
        // constraint the owner cannot understand or act on.
        const save = fnBody('async function saveNewVenue()');
        expect(save, 'saveNewVenue not found').toBeTruthy();
        expect(save).toMatch(/is_active: hasCoords/);
        expect(save, 'is_active is hard-coded true again').not.toMatch(/is_active: true/);

        // The two-tap confirmation, so "no coordinates" is a choice and not an
        // error. Same contract as app/venues.html's showCoordsRequiredModal().
        expect(save).toContain('coordlessSaveConfirmed');
    });

    it('a hidden venue is NOT pushed into the local array', () => {
        // get_venues_for_map filters on is_active, so pushing a hidden venue
        // shows a pin and a swim-lane card that both vanish on reload — which
        // reads as the save having failed after the fact.
        const save = fnBody('async function saveNewVenue()');
        expect(save, 'saveNewVenue not found').toBeTruthy();
        const pushAt = save.indexOf('venues.push(created)');
        expect(pushAt, 'the local push is gone entirely').toBeGreaterThan(-1);
        expect(save.slice(0, pushAt)).toMatch(/if \(data\.is_active\) \{/);
    });

    it('longitude 0 and latitude 0 are VALID, and out-of-range is not', () => {
        // The prime meridian runs through London. A truthiness check rejects
        // it, which is the bug calcDistance had for the same reason.
        const read = fnBody('function readCoordInput(id, max)');
        expect(read, 'readCoordInput not found').toBeTruthy();
        expect(read).toContain('Number.isFinite(n)');
        expect(read).toMatch(/if \(n < -max \|\| n > max\) return null/);
        // An empty string is "not given", which Number('') would turn into 0 —
        // a real coordinate. That check has to come first.
        expect(read).toMatch(/String\(raw\)\.trim\(\) === ''\) return null/);
    });

    it('the category placeholder comes FIRST, so nothing is chosen by accident', () => {
        // Without it a manual save silently lands on whatever
        // VENUE_CATEGORIES[0] happens to be — the owner never chose it and
        // never saw a prompt. With it, the existing isValidCategory guard
        // produces "Choose a category", which is the right message.
        const render = fnBody('function renderAddVenueCategoryOptions(selected)');
        expect(render, 'renderAddVenueCategoryOptions not found').toBeTruthy();
        expect(render).toMatch(/const placeholder = /);
        expect(render).toMatch(/select\.innerHTML = placeholder \+ cats/);
        expect(render).toContain('social.chooseCategory');
    });

    it('the manual button is STATIC markup and goes prominent on a dead end', () => {
        // Static, not injected by runPlaceSearch: data-i18n resolves at load,
        // and the contract test can assert it exists.
        expect(html).toMatch(/id="add-venue-manual-btn"[^>]*data-i18n="social\.addVenueManual"/s);

        const search = fnBody('async function runPlaceSearch(query)');
        expect(search, 'runPlaceSearch not found').toBeTruthy();
        const zero = search.slice(search.indexOf('if (placeResults.length === 0)'));
        expect(zero.length, 'the zero-result arm was not found').toBeGreaterThan(50);
        expect(zero).toContain("classList.add('is-prominent')");
        expect(css).toMatch(/\.add-venue-manual-btn\.is-prominent \{/);
    });

    it('the geocoder reuses the ONE Nominatim client', () => {
        // Two independent queues against a service that allows ~1 req/sec from
        // a single source is how both surfaces get rate-limited at once.
        const geo = fnBody('async function geocodeVenueAddress()');
        expect(geo, 'geocodeVenueAddress not found').toBeTruthy();
        expect(geo).toContain('window.VenuePlaces.geocodeAddress(');
        expect(geo, 'a second fetch path to Nominatim was introduced')
            .not.toMatch(/fetch\(|nominatim/i);
    });

    it('created_by_user_id is PROVENANCE and is read by no policy', () => {
        expect(createdBySql).toMatch(/ADD COLUMN IF NOT EXISTS created_by_user_id UUID/);
        expect(createdBySql).toMatch(/ON DELETE SET NULL/);
        // The comment has to say so in the database, not only in this file —
        // it is what a future reader sees in \d+ venues.
        expect(createdBySql).toMatch(/COMMENT ON COLUMN venues\.created_by_user_id/);
        expect(createdBySql).toMatch(/NOT an ownership/i);

        // Nothing in the migration touches a policy.
        const code = sqlCode(createdBySql);
        expect(code, 'the provenance column grew an RLS policy').not.toMatch(/CREATE POLICY/i);
    });
});

// ===========================================================================
// Phase 3 — post lifetime
// ===========================================================================

describe('Phase 3 — post lifetime', () => {
    it('BOTH backfills ship, and the NULL-author one is asserted at install', () => {
        // ⚠️ Backfill B is the one that matters on deploy day. Every row
        // predating 20260828000001 has uploaded_by_user_id = NULL and no
        // backfill of authorship is possible, so backfill A cannot reach them
        // — it joins on the author id. Without B they keep is_permanent=false
        // and the 24h TTL expires every seeded row in the tenant at once.
        expect(permSql).toMatch(/om\.user_id = vm\.uploaded_by_user_id/);

        // ⚠️ Assert the UPDATE, not the predicate. The post-install assertion
        // in section 7 runs a SELECT with a byte-identical WHERE clause, so
        // `toMatch(/WHERE uploaded_by_user_id IS NULL ... is_permanent = false/)`
        // is satisfied by the CHECK even when the backfill it is checking has
        // been deleted outright — which is exactly what a mutation proved.
        // The `UPDATE venue_media\nSET` prefix is what makes this the write.
        expect(permSql, 'backfill B is not an UPDATE any more').toMatch(
            /UPDATE venue_media\nSET is_permanent = true\nWHERE uploaded_by_user_id IS NULL\n\s+AND is_permanent = false;/
        );

        // ...and the install-time check that it worked, which is a different
        // statement and is asserted separately for the same reason.
        expect(permSql).toMatch(/Backfill B missed/);
        expect(permSql).toMatch(/RAISE EXCEPTION\n\s*'Backfill B missed/);
    });

    it('permanence is stamped at WRITE time from the ORG arm', () => {
        expect(permSql).toMatch(/v_is_app_member BOOLEAN;/);
        expect(permSql).toMatch(/v_is_org_member BOOLEAN;/);
        // v_is_member stays their OR, so the authorization decision is
        // byte-for-byte what it was.
        expect(permSql).toMatch(/v_is_member := v_is_app_member OR v_is_org_member;/);
        // ...and the org arm alone decides permanence.
        expect(permSql).toMatch(/is_permanent\n\s*\)/);
        expect(permSql).toMatch(/v_is_org_member\n\s*\)\n\s*RETURNING id INTO v_media_id;/);

        // ⚠️ NOT derived from the storage-path prefix: an org member posting
        // with no venue selected falls to the members/ path and would silently
        // lose permanence.
        const code = sqlCode(permSql);
        expect(code, 'permanence was derived from the storage path')
            .not.toMatch(/p_storage_path[\s\S]{0,40}members\//);
    });

    it('the TTL disjunct appears in EXACTLY FOUR functions', () => {
        // ⚠️ sqlCode: the file's header QUOTES the predicate it is
        // documenting, so counting over the raw text finds five and the only
        // way to reach four would be to delete the documentation.
        const hits = sqlCode(ttlSql).match(/OR vm\.is_permanent/g) || [];
        expect(hits.length,
            'the is_permanent disjunct is not in exactly four places').toBe(4);

        for (const fn of ['get_venue_feed_v3', 'get_following_feed_v3',
                          'get_venue_page_feed', 'get_recent_post_pins']) {
            expect(ttlSql, `${fn} was not re-created`).toContain(fn + '(');
        }
    });

    it('⚠️ get_member_posts is EXEMPT and is not touched', () => {
        // A profile that empties every 24h reads as an abandoned account and
        // undercuts the entire reason to follow anyone. get_member_posts is
        // already gated on profile_public OR self, so it is not a firehose.
        const code = sqlCode(ttlSql);
        expect(code, 'get_member_posts was given the TTL predicate')
            .not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION get_member_posts/);
    });

    it('⚠️ the predicate is STRING-IDENTICAL across all four', () => {
        // The RETURNS TABLE equality test in viibeview-follows.test.js cannot
        // see a BODY divergence — neither v3 function gains or loses a column,
        // so it keeps passing however far the predicates drift apart. This is
        // the guard that test does not give.
        const re = /AND \(v_ttl_hours IS NULL\n\s+OR vm\.is_permanent\n\s+OR vm\.created_at > now\(\) - make_interval\(secs => \(v_ttl_hours \* 3600\)::DOUBLE PRECISION\)\)/g;
        const hits = sqlCode(ttlSql).match(re) || [];
        expect(hits.length, 'the four predicates are not written identically').toBe(4);
        hits.forEach(h => expect(h).toBe(hits[0]));
    });

    it('⚠️ the three must-stay-OPEN functions get NO grant footer', () => {
        // Anon browsing depends on the default EXECUTE TO PUBLIC. A footer
        // empties the feed, the venue page and the map for every signed-out
        // visitor — a 200 with zero rows, rendered as "No posts yet".
        //
        // sqlCode: the file's own header warns about each of these by name.
        const code = sqlCode(ttlSql);
        for (const fn of ['get_venue_feed_v3', 'get_venue_page_feed', 'get_recent_post_pins']) {
            expect(code, `${fn} was given a REVOKE footer`)
                .not.toMatch(new RegExp(`REVOKE[^\\n]*${fn}`, 'i'));
            expect(code, `${fn} was given a GRANT footer`)
                .not.toMatch(new RegExp(`GRANT EXECUTE[^\\n]*${fn}`, 'i'));
        }

        // get_following_feed_v3 keeps its REAL footer, all three lines.
        expect(code).toMatch(/REVOKE ALL ON FUNCTION get_following_feed_v3[^\n]*FROM PUBLIC;/);
        expect(code).toMatch(/REVOKE ALL ON FUNCTION get_following_feed_v3[^\n]*FROM anon;/);
        expect(code).toMatch(/GRANT EXECUTE ON FUNCTION get_following_feed_v3[^\n]*TO authenticated;/);
    });

    it('social_feed_ttl_hours is NOT redefined — the value is SEEDED', () => {
        // Its whole design is that every unparseable shape returns NULL, i.e.
        // no expiry, because the other direction empties every tenant on this
        // database silently. Changing that to make 24h the default would apply
        // to every social app everywhere.
        const code = sqlCode(ttlSql);
        expect(code, 'social_feed_ttl_hours was redefined')
            .not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION social_feed_ttl_hours/);

        // ...and the seed is guarded both ways.
        expect(ttlSql).toMatch(/NOT \(COALESCE\(settings, '\{\}'::JSONB\) \? 'post_ttl_hours'\)/);
        expect(ttlSql).toMatch(/app_type = 'social'/);
        // COALESCE on the left too: settings is nullable and NULL || anything
        // is NULL, which would discard the write.
        expect(ttlSql).toMatch(/SET settings = COALESCE\(settings, '\{\}'::JSONB\) \|\|/);
    });

    it('get_recent_post_pins gets SET search_path back', () => {
        // Lost when 20260904000001 re-created it without the line
        // 20260901000001 had added. Pre-existing, and fixed here rather than
        // carried forward once more.
        const i = ttlSql.indexOf('CREATE FUNCTION get_recent_post_pins(');
        expect(i, 'get_recent_post_pins was not re-created').toBeGreaterThan(-1);
        const body = ttlSql.slice(i, ttlSql.indexOf('\n$$;', i));
        expect(body).toContain('SET search_path = public');
        expect(ttlSql).toMatch(/proconfig @> ARRAY\['search_path=public'\]/);
    });

    it('⚠️ the settings copy no longer ships a lie, in all 8 locales', () => {
        // After the readers change, "Home feed only. Viibes stay on venue
        // pages, profiles and the map." is false. Shipping the predicate
        // without this ships a lie in the owner's own settings panel.
        for (const lang of ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ar']) {
            const j = JSON.parse(fs.readFileSync(path.join(ROOT, `i18n/${lang}.json`), 'utf8'));
            const hint = j.social.postLifetimeHint;
            expect(hint, `${lang}.json has no postLifetimeHint`).toBeTruthy();
            expect(hint, `${lang}.json still says "Home feed only"`).not.toMatch(/Home feed only/i);
        }
        // ...and the inline English fallback in the markup moved with it,
        // which is what a first paint shows before I18n runs.
        expect(html, 'the hardcoded English fallback still says "Home feed only"')
            .not.toMatch(/data-i18n="social\.postLifetimeHint">Home feed only/);
    });
});

// ===========================================================================
// Phase 4 — the venue page
// ===========================================================================

describe('Phase 4 — venue page', () => {
    it('⚠️ collapse state lives in a MODULE object, not the DOM', () => {
        // repaintVenueGenres() does `block.outerHTML = ...` on EVERY genre chip
        // tap. A state held in a class on that element snaps shut under the
        // finger of anyone changing what is playing.
        expect(js).toMatch(/const VENUE_SECTION_DEFAULTS = /);
        expect(js).toMatch(/let venueSectionsOpen = \{ \.\.\.VENUE_SECTION_DEFAULTS \}/);

        const section = fnBody('function renderVenueSection(key, titleKey, titleText, body)');
        expect(section, 'renderVenueSection not found').toBeTruthy();
        expect(section, 'the rebuilt section does not read the module state')
            .toMatch(/venueSectionsOpen\[key\]/);
    });

    it('⚠️ toggleVenueSection does NOT call repaintVenueGenres', () => {
        // That would be the outerHTML trap the whole design exists to avoid:
        // a full swap on every expand, discarding focus and anything
        // in-progress inside the body.
        const toggle = fnBody('function toggleVenueSection(key)');
        expect(toggle, 'toggleVenueSection not found').toBeTruthy();
        expect(toggle.length, 'toggleVenueSection body is suspiciously short').toBeGreaterThan(100);
        expect(toggle, 'the toggle re-renders the genre block')
            .not.toContain('repaintVenueGenres');
        expect(toggle).toContain("classList.toggle('open', open)");
        expect(toggle).toContain("setAttribute('aria-expanded'");
    });

    it('repaintVenueGenres targets the NEW selector', () => {
        // `.venue-page-genres` no longer exists. A querySelector still matching
        // it returns null, and every genre tap silently fails to repaint —
        // optimistic state applied, chip never lit, rollback invisible.
        const repaint = fnBody('function repaintVenueGenres()');
        expect(repaint, 'repaintVenueGenres not found').toBeTruthy();
        expect(repaint).toContain(`.venue-section[data-section="sound"]`);
        expect(repaint, 'the old class selector is still in use')
            .not.toContain(`querySelector('.venue-page-genres')`);
    });

    it('a quiet venue with no genres grows NO empty accordion', () => {
        // The non-owner/zero-genre branch must keep returning '' — wrapping
        // nothing in a section gives every such venue a head that expands to a
        // blank box.
        const render = fnBody('function renderVenueGenreSection(venue)');
        expect(render, 'renderVenueGenreSection not found').toBeTruthy();
        expect(render).toMatch(/if \(genres\.length === 0\) return '';/);
    });

    it('sections reset between venues', () => {
        // Without this an expanded "Who's here" on one venue silently carries
        // into the next venue the visitor opens, and so does its crowd mix.
        const open = fnBody('async function openVenuePage(venueId)');
        expect(open, 'openVenuePage not found').toBeTruthy();
        expect(open).toContain('resetVenueSections()');
        expect(open).toContain('venueCrowdMix = null');
        expect(open).toContain('expandedVenuePostId = null');
    });

    it('⚠️ the crowd mix is ALL-TIME and suppressed BELOW THRESHOLD', () => {
        // "2 men, 1 woman here tonight", next to a grid that names and
        // pictures them, is re-identification of a specific person at a named
        // bar at a known time. Both constraints are server-side.
        expect(crowdSql).toMatch(/v_min_respondents CONSTANT INTEGER := 10;/);
        expect(crowdSql).toMatch(/IF v_respondents < v_min_respondents THEN\n\s+RETURN;/);

        // ⚠️ No time window anywhere in the aggregate. `INTERVAL` or `now()`
        // appearing here is the change that makes this function unsafe.
        const i = crowdSql.indexOf('CREATE FUNCTION get_venue_crowd_mix(');
        expect(i, 'get_venue_crowd_mix not found').toBeGreaterThan(-1);
        const body = sqlCode(crowdSql.slice(i, crowdSql.indexOf('\n$$;', i)));
        expect(body, 'the crowd mix grew a time window').not.toMatch(/INTERVAL/i);
        expect(body, 'the crowd mix grew a time window').not.toMatch(/now\(\)/);

        // Suppression returns ZERO ROWS, not small counts — a row of {1, 0} has
        // already published one person's gender, whatever the client does next.
        expect(crowdSql).toMatch(/get_venue_crowd_mix returned % row\(s\)/);
    });

    it('the gender bar is pure CSS, accessible, and honest about no data', () => {
        // ApexCharts is ~130KB into a PWA whose premise is a fast cold start,
        // and social.html ships no chart library today.
        expect(html, 'a chart library was added to social.html')
            .not.toMatch(/apexcharts|chart\.js|d3\.js|recharts/i);

        const bar = fnBody('function renderGenderMixBar(mix)');
        expect(bar, 'renderGenderMixBar not found').toBeTruthy();
        expect(bar).toContain('role="img"');
        expect(bar).toMatch(/aria-label="\$\{escapeHtml\(summary\)\}"/);
        // ⚠️ null is the NORMAL state — the RPC returns zero rows below the
        // threshold by design. It must not fall back to a 50/50 bar over no
        // data.
        expect(bar).toMatch(/if \(!mix \|\| total === 0\)/);
        expect(bar).toContain('social.genderMixLocked');

        // Colour is not the only channel: a numeric legend carries the same
        // information as text, for greyscale and for colour-vision deficiency.
        expect(bar).toContain('gender-bar-legend');
        expect(css).toMatch(/\.gender-bar-female \{/);
        expect(css).toMatch(/\.gender-bar-male \{/);
    });

    it('the accordion uses display, not max-height', () => {
        // The genre block holds 19 chips wrapping to an unknowable number of
        // rows depending on locale and viewport, so any fixed max-height either
        // clips it or animates to a guess.
        const rule = css.slice(css.indexOf('.venue-section-body {'));
        const block = rule.slice(0, rule.indexOf('}'));
        expect(block.length, '.venue-section-body rule not found').toBeGreaterThan(10);
        expect(block).toContain('display: none');
        expect(block, 'the accordion body was given a max-height').not.toContain('max-height');
        expect(css).toMatch(/\.venue-section\.open \.venue-section-body \{[^}]*display: block/);
    });

    it('the empty branch hides ALL THREE elements', () => {
        const grid = fnBody('function renderVenuePageGrid()');
        expect(grid, 'renderVenuePageGrid not found').toBeTruthy();

        // ⚠️ Assert the HIDE, not the lookup. `toContain("getElementById(
        // 'venue-page-feed-header')")` passes on code that finds the element
        // and then does nothing with it — a mutation deleting the
        // `header.style.display = ...` line left the suite green. Every one of
        // the three needs its own write asserted.
        expect(grid, 'the grid itself is not hidden when empty')
            .toMatch(/container\.style\.display = isEmpty \? 'none' : ''/);
        expect(grid, 'the "Recent Posts" header is not hidden when empty')
            .toMatch(/if \(header\) header\.style\.display = isEmpty \? 'none' : ''/);
        expect(grid, 'the divider is not hidden when empty')
            .toMatch(/if \(divider\) divider\.style\.display = isEmpty \? 'none' : ''/);

        // ...and all three are resolved from the ids the markup actually ships.
        expect(grid).toContain("getElementById('venue-page-feed-header')");
        expect(grid).toContain("getElementById('venue-page-feed-divider')");

        // #venue-page-empty is gone: "show nothing until there is something"
        // makes it unreachable. The CLASS stays — #member-page-empty wears it.
        expect(html, '#venue-page-empty is still in the markup')
            .not.toMatch(/id="venue-page-empty"/);
        expect(html).toMatch(/id="member-page-empty"/);
        expect(css).toMatch(/\.venue-page-empty \{/);
    });

    it('closeVenuePage clears the grid rather than only pausing it', () => {
        // A paused <video> left in the DOM keeps its buffer and keeps
        // downloading. Same reasoning closeMemberProfile has always had.
        const close = fnBody('function closeVenuePage()');
        expect(close, 'closeVenuePage not found').toBeTruthy();
        expect(close).toMatch(/pageEl\.innerHTML = ''/);
    });

    it('closeMemberProfile disconnects the observer it now owns', () => {
        // There is ONE module-level handle, so without this the next open
        // disconnects only the most recent observer and every earlier one
        // keeps holding torn-down .feed-media elements.
        const close = fnBody('function closeMemberProfile()');
        expect(close, 'closeMemberProfile not found').toBeTruthy();
        expect(close).toMatch(/venueVideoObserver\.disconnect\(\)/);
        expect(close).toMatch(/venueVideoObserver = null/);
    });
});

// ===========================================================================
// Phase 4 — calcDistance, behaviourally
// ===========================================================================

describe('Phase 4 — calcDistance guard', () => {
    let calcDistance;

    beforeAll(() => {
        // Evaluated in isolation rather than by loading social.js: this is one
        // pure function and booting the whole app to reach it would make the
        // test depend on everything else in the file.
        const src = fnBody('function calcDistance(lat1, lon1, lat2, lon2)');
        expect(src, 'calcDistance not found').toBeTruthy();
        const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
        calcDistance = dom.window.eval(`(${src}\n})`);
    });

    it('⚠️ longitude 0 is the prime meridian, not "missing"', () => {
        // It runs through London. `if (!lon1)` rejected every venue on it, and
        // the failure was silent — the distance line simply did not render.
        const d = calcDistance(51.5, 0, 51.5, 1);
        expect(d).not.toBeNull();
        expect(d).toBeGreaterThan(0);
    });

    it('⚠️ latitude 0 is the equator, not "missing"', () => {
        const d = calcDistance(0, 10, 1, 10);
        expect(d).not.toBeNull();
        expect(d).toBeGreaterThan(60);   // ~69 miles per degree of latitude
    });

    it('⚠️ DECIMAL columns arrive as STRINGS on some PostgREST paths', () => {
        // venues.latitude/longitude are DECIMAL. A string "0" is truthy and
        // slipped past the old guard, but only by accident.
        const asStrings = calcDistance('34.0913', '-118.3450', '34.0', '-118.0');
        const asNumbers = calcDistance(34.0913, -118.3450, 34.0, -118.0);
        expect(asStrings).toBeCloseTo(asNumbers, 6);
        expect(calcDistance('0', '0', '1', '0')).toBeCloseTo(calcDistance(0, 0, 1, 0), 6);
    });

    it('genuinely absent coordinates still return null', () => {
        // The guard must not have been loosened into no guard at all.
        for (const args of [
            [null, 0, 1, 1], [0, null, 1, 1], [0, 0, null, 1], [0, 0, 1, null],
            [undefined, 0, 1, 1], ['', 0, 1, 1], ['abc', 0, 1, 1], [NaN, 0, 1, 1],
        ]) {
            expect(calcDistance(...args), `expected null for ${JSON.stringify(args)}`).toBeNull();
        }
    });

    it('a known distance is still computed correctly', () => {
        // Non-vacuous guard: every assertion above is about REJECTING input.
        // Without this, a calcDistance that returned 0 for everything passes
        // all of them.
        // LA (34.05, -118.25) to NY (40.71, -74.01) is ~2451 statute miles.
        expect(calcDistance(34.05, -118.25, 40.71, -74.01)).toBeGreaterThan(2400);
        expect(calcDistance(34.05, -118.25, 40.71, -74.01)).toBeLessThan(2500);
        expect(calcDistance(34.05, -118.25, 34.05, -118.25)).toBeCloseTo(0, 6);
    });
});
