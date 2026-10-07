/**
 * Guards for the 12-feature ViibeView batch: the v3 feed contract (#5, #6, #12),
 * the onboarding preferences (#1, #2), the full-screen feed (#3, #4) and the
 * capture/interruption work (#9, #11).
 *
 * Static assertions over migration text and client source. No network, no
 * database — which is exactly the point: prod holds one venue and two posts, so
 * a live "all results are within N miles" check is trivially true over an empty
 * array. These assert the things that CANNOT be observed against a two-post
 * tenant, and every one of them fails OPEN if the parse finds nothing, so each
 * block opens with a non-emptiness guard.
 *
 * ⚠️ 2026-10-06: the feed functions' LIVE definitions (the 7am reset, no
 * permanent exemption, no footer on the open readers) are asserted in
 * viibeview-2026-10-06-batch.test.js via latestDefinition(). Assertions here
 * that read 20260907000002 prove that file, not what prod runs today.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Derived, never hard-coded. An absolute path to one checkout makes every
// file-reading test in here silently read THAT tree — so a `git worktree`
// baseline at an older commit reads the CURRENT files and reports them as
// passing. That cost a wrong "these failures are pre-existing" conclusion once.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');

const v3Sql = fs.readFileSync(
    path.join(MIGRATIONS, '20260907000002_feed_contract_v3.sql'),
    'utf8'
);
const prefsSql = fs.readFileSync(
    path.join(MIGRATIONS, '20260907000001_member_preferences.sql'),
    'utf8'
);
const js = fs.readFileSync(path.join(ROOT, 'customer-app/social.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'customer-app/social.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'customer-app/social.css'), 'utf8');

/**
 * The source of ONE top-level function, sliced to its own closing brace.
 *
 * ⚠️ Returns null when the signature is not found, and every caller asserts
 * that before asserting anything about the body. A fixed byte window is the
 * other way to do this and it has already bitten this file once: the window
 * truncated past the line under test and the assertion failed for a reason
 * that had nothing to do with the code.
 *
 * `\n}` is a safe terminator only because this file's functions are top-level
 * and its style indents every nested brace — which is asserted by the length
 * guard each caller applies.
 */
function fnBody(signature) {
    const start = js.indexOf(signature);
    if (start < 0) return null;
    const rest = js.slice(start);
    const end = rest.indexOf('\n}');
    if (end < 0) return null;
    return rest.slice(0, end);
}

/**
 * fnBody with comments removed, for assertions about ABSENCE.
 *
 * ⚠️ This repo has been bitten by exactly this before: a test asserting that
 * something does NOT appear matched the code's own warning saying not to add
 * it. The only way to make such a test pass is then to DELETE THE WARNING,
 * which is the opposite of what the test wanted. Any `.not.toContain` /
 * `.not.toMatch` over source must run through here.
 *
 * TWO comment syntaxes, because this file renders markup from template
 * literals and documents it in `<!-- -->` inside those literals — which is
 * source to a `.not.toContain` and prose to a human. Both were caught here:
 * the JS one by the venue grid's "NOT called here" note, the HTML one by
 * renderFeedCard's "the scrim and .feed-panel-info are gone".
 *
 * Whole-line JS comments only. An inline trailing `//` is left alone on
 * purpose — stripping it needs a string/regex-literal parser, and getting THAT
 * wrong silently removes real code from the text under test.
 */
function fnCode(signature) {
    const body = fnBody(signature);
    if (body === null) return null;
    return body
        .replace(/<!--[\s\S]*?-->/g, '')
        .split('\n')
        .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
}

/** Same parser as viibeview-follows.test.js — see that file's header. */
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

/**
 * SQL with `--` line comments removed. Needed wherever an assertion looks for
 * the ABSENCE of something the file deliberately WARNS about in prose.
 */
function withoutComments(sql) {
    return sql.split('\n').map(line => line.replace(/--.*$/, '')).join('\n');
}

/** The body of a CREATE FUNCTION, from its `AS $$` to the matching `$$;`. */
function bodyOf(sql, fnName) {
    const start = sql.search(
        new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ${fnName}\\s*\\(`)
    );
    expect(start, `${fnName} is not defined`).toBeGreaterThan(-1);
    const rest = sql.slice(start);
    const open = rest.indexOf('AS $$');
    expect(open, `${fnName} has no AS $$ body`).toBeGreaterThan(-1);
    const close = rest.indexOf('$$;', open + 5);
    expect(close, `${fnName}'s body is unterminated`).toBeGreaterThan(-1);
    return rest.slice(open, close);
}

describe('feed contract v3 — shape', () => {
    const venueV3 = returnsTableOf(v3Sql, 'get_venue_feed_v3');
    const followingV3 = returnsTableOf(v3Sql, 'get_following_feed_v3');

    it('parsed something real — a vacuous comparison would pass forever', () => {
        expect(venueV3.length).toBeGreaterThan(20);
        expect(venueV3).toContain('id UUID');
        expect(venueV3).toContain('uploaded_by_user_id UUID');
    });

    it('the two v3 feeds return the identical column list', () => {
        // One renderFeedCard() reads both. Drift is silent: the client reads
        // undefined for the missing column and paints a blank byline.
        expect(followingV3).toEqual(venueV3);
    });

    it('v3 keeps the v2 column list exactly, so renderFeedCard did not have to change', () => {
        const v2Sql = fs.readFileSync(
            path.join(MIGRATIONS, '20260903000004_feed_author_and_following.sql'),
            'utf8'
        );
        expect(returnsTableOf(v2Sql, 'get_venue_feed')).toEqual(venueV3);
    });
});

describe('feed contract v3 — the three new predicates', () => {
    const venueBody = bodyOf(v3Sql, 'get_venue_feed_v3');
    const followingBody = bodyOf(v3Sql, 'get_following_feed_v3');

    it('parsed real bodies', () => {
        expect(venueBody.length).toBeGreaterThan(500);
        expect(followingBody.length).toBeGreaterThan(500);
    });

    it('#12 — both feeds are video only', () => {
        for (const [name, body] of [['venue', venueBody], ['following', followingBody]]) {
            expect(body, `${name} feed is not video-only`).toMatch(/vm\.media_type = 'video'/);
        }
    });

    it('#6 — TTL is read SERVER-SIDE, never taken as a parameter', () => {
        // A client-supplied TTL is spoofable by anyone holding the anon key.
        expect(venueBody).toMatch(/social_feed_ttl_hours\(p_app_id\)/);
        expect(followingBody).toMatch(/social_feed_ttl_hours\(p_app_id\)/);
        expect(v3Sql).not.toMatch(/p_ttl_hours/);
    });

    it('#6 — a NULL TTL means no expiry', () => {
        expect(venueBody).toMatch(/v_ttl_hours IS NULL\s*\n?\s*OR vm\.created_at >/);
    });

    it('#5 — a radius with no coordinates filters NOTHING', () => {
        // ⚠️ The load-bearing one. getCurrentCoords() resolves to null on
        // permission-denied AND on timeout, and a denied location permission
        // must never produce an empty feed.
        for (const [name, body] of [['venue', venueBody], ['following', followingBody]]) {
            expect(body, `${name} feed would filter without a fix`)
                .toMatch(/WHEN p_lat IS NULL OR p_lng IS NULL THEN NULL/);
        }
    });

    it('#5 — a zero or negative radius also means "Any", not "nothing"', () => {
        expect(venueBody).toMatch(/p_radius_miles IS NULL OR p_radius_miles <= 0 THEN NULL/);
    });

    it('#5 — the whole distance predicate short-circuits on a NULL radius', () => {
        expect(venueBody).toMatch(/AND \(v_radius IS NULL OR \(/);
    });

    it('#5 — distance is measured on the post coordinate COALESCEd over the venue', () => {
        expect(venueBody).toMatch(/COALESCE\(vm\.latitude, v\.latitude\)/);
        expect(venueBody).toMatch(/COALESCE\(vm\.longitude, v\.longitude\)/);
    });

    it('the bounding box is a prefilter that is SKIPPED where it would be wrong', () => {
        // A wrong box drops valid rows silently; skipping it only costs a scan.
        expect(venueBody).toMatch(/v_use_bbox/);
        expect(venueBody).toMatch(/NOT v_use_bbox OR/);
    });
});

describe('feed contract v3 — grants', () => {
    it('get_venue_feed_v3 has NO grant footer', () => {
        // ⚠️ Anon browsing depends on the default EXECUTE TO PUBLIC. A footer
        // here empties the feed for every signed-out visitor, silently: the
        // client logs the permission error and renders "No posts yet".
        expect(v3Sql).not.toMatch(/REVOKE ALL ON FUNCTION get_venue_feed_v3/);
        expect(v3Sql).not.toMatch(/GRANT EXECUTE ON FUNCTION get_venue_feed_v3/);
    });

    it('get_following_feed_v3 keeps the real three-line footer', () => {
        expect(v3Sql).toMatch(/REVOKE ALL ON FUNCTION get_following_feed_v3\([^)]*\) FROM PUBLIC/);
        expect(v3Sql).toMatch(/REVOKE ALL ON FUNCTION get_following_feed_v3\([^)]*\) FROM anon/);
        expect(v3Sql).toMatch(/GRANT EXECUTE ON FUNCTION get_following_feed_v3\([^)]*\) TO authenticated/);
    });

    it('update_social_app_settings is authenticated-only', () => {
        expect(v3Sql).toMatch(/REVOKE ALL ON FUNCTION update_social_app_settings\(UUID, JSONB\) FROM anon/);
        expect(v3Sql).toMatch(/GRANT EXECUTE ON FUNCTION update_social_app_settings\(UUID, JSONB\) TO authenticated/);
    });

    it('🔴 nothing in this batch grants table-level UPDATE on customer_apps', () => {
        // That table holds every Royalty tenant's row.
        //
        // ⚠️ Comments are stripped first. Without that this assertion matches
        // the migration's OWN warning ("NEVER grant table-level UPDATE on
        // customer_apps") and fails against correct code — a test that can only
        // pass if the warning is deleted is worse than no test.
        for (const sql of [v3Sql, prefsSql]) {
            const statements = withoutComments(sql);
            expect(statements.length).toBeGreaterThan(500);   // stripping worked
            expect(statements).not.toMatch(/GRANT[^;]*UPDATE[^;]*ON\s+(TABLE\s+)?customer_apps/i);
            expect(statements).not.toMatch(/GRANT\s+ALL[^;]*ON\s+(TABLE\s+)?customer_apps/i);
        }
    });

    it('the migration asserts the must-stay-OPEN direction too', () => {
        // The direction that fails silently is the one worth a post-install
        // assertion — a closed feed returns 200 with zero rows.
        expect(v3Sql).toMatch(/anon CANNOT execute it/);
    });

    it('the v2 pair is left installed as the rollback target', () => {
        expect(v3Sql).not.toMatch(/DROP FUNCTION[^\n]*get_venue_feed\(/);
        expect(v3Sql).not.toMatch(/DROP FUNCTION[^\n]*get_following_feed\(/);
    });

    it('update_social_app_settings merges only an allow-list', () => {
        const body = bodyOf(v3Sql, 'update_social_app_settings');
        expect(body.length).toBeGreaterThan(500);
        expect(body).toMatch(/organization_members/);
        expect(body).toMatch(/'post_ttl_hours'/);
        expect(body).toMatch(/'feed_radius_default'/);
        // `settings || p_settings` would let an org member rewrite branding,
        // features, plan_type or whatever lands in that column next.
        expect(body).not.toMatch(/settings\s*\|\|\s*p_settings/);
        expect(body).toMatch(/COALESCE\(settings, '\{\}'::JSONB\) \|\| v_patch/);
    });
});

describe('member preferences (#1, #2)', () => {
    it('set_member_preferences is a NEW function, not an argument on update_social_profile', () => {
        // ⚠️ Every argument of update_social_profile has a DEFAULT, so adding
        // one creates an OVERLOAD that goes ambiguous (42725) at RUN time while
        // the migration reports success.
        expect(prefsSql).toMatch(/CREATE OR REPLACE FUNCTION set_member_preferences\(/);
        expect(prefsSql).not.toMatch(/FUNCTION update_social_profile\(/);
    });

    it('it is keyed on auth.uid() and authenticated-only', () => {
        const body = bodyOf(prefsSql, 'set_member_preferences');
        expect(body.length).toBeGreaterThan(300);
        expect(body).toMatch(/v_user_id UUID := auth\.uid\(\)/);
        expect(prefsSql).toMatch(/REVOKE ALL ON FUNCTION set_member_preferences\([^)]*\) FROM anon/);
        expect(prefsSql).toMatch(/GRANT EXECUTE ON FUNCTION set_member_preferences\([^)]*\) TO authenticated/);
    });

    it('get_social_member returns the new columns AND re-issues its grant footer', () => {
        // ⚠️ It is the full-write prefill source for the edit sheet, and DROP
        // destroys its footer. Losing the footer hands every member's email,
        // phone and points balance to the anon key.
        const cols = returnsTableOf(prefsSql, 'get_social_member');
        expect(cols.length).toBeGreaterThan(10);
        expect(cols).toContain('preferred_categories TEXT[]');
        expect(cols).toContain('preferred_genres TEXT[]');
        expect(prefsSql).toMatch(/REVOKE ALL ON FUNCTION get_social_member\(UUID\) FROM anon/);
        expect(prefsSql).toMatch(/GRANT EXECUTE ON FUNCTION get_social_member\(UUID\) TO authenticated/);
        expect(prefsSql).toMatch(/anon can EXECUTE it/);
    });

    it('the new app_members columns are additive and nullable', () => {
        // app_members is shared with the Royalty loyalty app.
        expect(prefsSql).toMatch(/ADD COLUMN IF NOT EXISTS preferred_categories TEXT\[\];/);
        expect(prefsSql).toMatch(/ADD COLUMN IF NOT EXISTS preferred_genres TEXT\[\];/);
        expect(prefsSql).not.toMatch(/preferred_(categories|genres) TEXT\[\][^;]*NOT NULL/);
    });

    it('the client reuses the shared vocabularies rather than inventing a taxonomy', () => {
        expect(js).toMatch(/window\.VENUE_CATEGORIES \|\| \[\], preferredCategories/);
        expect(js).toMatch(/window\.MUSIC_GENRES \|\| \[\], preferredGenres/);
    });

    it('a preference orders the chips but never invents one', () => {
        // orderByPreference() reorders the DERIVED list. The set of chips still
        // comes from the venues this tenant actually has.
        expect(js).toMatch(/orderByPreference\(\s*\n?\s*\(window\.VENUE_CATEGORIES \|\| \[\]\)\.filter/);
    });

    it('orderByPreference never returns NaN from its comparator', () => {
        // Two unranked entries are both Infinity, and Infinity - Infinity is
        // NaN — which no comparator may return.
        const body = js.slice(js.indexOf('function orderByPreference'));
        expect(body.slice(0, 600)).toMatch(/if \(ra === rb\) return 0;/);
        expect(body.slice(0, 600)).not.toMatch(/return ra - rb;/);
    });

    it('a preference-seeded filter that returns nothing falls back to All', () => {
        // ⚠️ availableFilters() proves the CATEGORY exists, not that anything
        // was POSTED under it. An empty opening feed reads as a broken app.
        expect(js).toMatch(/async function clearPreferenceSeedIfEmpty\(\)/);
        const body = js.slice(js.indexOf('async function clearPreferenceSeedIfEmpty'));
        expect(body.slice(0, 500)).toMatch(/if \(feedItems\.length\) return;/);
        expect(body.slice(0, 500)).toMatch(/activeCategory = null;/);
        // And it is actually wired into the boot sequence.
        expect(js).toMatch(/await clearPreferenceSeedIfEmpty\(\);/);
    });

    it('the onboarding overlay ships and is shown before the feed loads', () => {
        expect(html).toMatch(/id="onboarding-overlay"/);
        // Four panels: three intro, one picker.
        expect((html.match(/data-ob-panel="/g) || []).length).toBe(4);
        expect(js).toMatch(/const ONBOARDING_PANELS = 4;/);
        // maybeShowOnboarding() must precede the awaits in init().
        const init = js.slice(js.indexOf('async function init()'), js.indexOf('// ===== Branding ====='));
        expect(init.indexOf('maybeShowOnboarding()')).toBeGreaterThan(-1);
        expect(init.indexOf('maybeShowOnboarding()')).toBeLessThan(init.indexOf('await loadVenues()'));
    });

    it('onboarding owns its own listeners rather than waiting for setupEventListeners', () => {
        // setupEventListeners() runs at the END of init(), behind four awaits.
        // Wiring Skip and Next there leaves them dead while the intro is up.
        //
        // 2026-10-06: the listeners moved into showOnboarding(), which a new
        // signup calls with force:true — so they are wired ONCE, behind a flag,
        // or a second showing would double every handler.
        const start = js.indexOf('function showOnboarding({ force = false } = {})');
        expect(start, 'showOnboarding not found').toBeGreaterThan(-1);
        const fn = js.slice(start, js.indexOf('\n}', start));
        expect(fn).toMatch(/onboarding-skip'\)\s*\n?\s*\?\.addEventListener/);
        expect(fn).toMatch(/getElementById\('onboarding-next'\)\?\.addEventListener/);
        expect(fn.indexOf('if (onboardingWired) return;'), 'listeners are not wired once')
            .toBeLessThan(fn.indexOf("getElementById('onboarding-next')"));
        expect(fn.indexOf('if (onboardingWired) return;')).toBeGreaterThan(-1);

        const maybe = js.slice(js.indexOf('function maybeShowOnboarding()'));
        expect(maybe.slice(0, 200)).toMatch(/if \(hasOnboarded\(\)\) return;\s*showOnboarding\(\);/);
    });
});

describe('the client talks to v3, and only to v3', () => {
    it('loadFeed calls the _v3 pair', () => {
        expect(js).toMatch(/useFollowing \? 'get_following_feed_v3' : 'get_venue_feed_v3'/);
    });

    it('it sends coordinates and radius', () => {
        expect(js).toMatch(/p_radius_miles: radius/);
        expect(js).toMatch(/p_lat: coords \? coords\.lat : null/);
    });

    it('⚠️ no fix means NO radius — never radius-with-null-coords', () => {
        expect(js).toMatch(/const radius = coords \? feedRadiusMiles : null;/);
    });

    it('the distance chip opens a sheet and does NOT clear the active category', () => {
        // Distance is a scope, not a category. It combines with what is active.
        const setFilter = js.slice(js.indexOf('function setFilter(kind, value)'));
        const distanceBranch = setFilter.slice(0, setFilter.indexOf("if (kind === 'following')"));
        expect(distanceBranch).toMatch(/openRadiusSheet\(\);\s*\n\s*return;/);
        expect(distanceBranch).not.toMatch(/activeCategory = null/);
    });

    it("'' is the stored form of Any and is not confused with unset", () => {
        // A truthiness check would re-apply the tenant default to everyone who
        // deliberately chose Any.
        const fn = js.slice(js.indexOf('function loadRadiusPreference()'));
        expect(fn.slice(0, 900)).toMatch(/if \(stored !== null\)/);
    });

    it('an empty distance-scoped feed says so and offers a one-tap fix', () => {
        expect(js).toMatch(/social\.emptyNearbyTitle/);
        expect(js).toMatch(/ctaAction = \(\) => setRadius\(null\);/);
    });
});

describe('full-screen feed (#3, #4, #12)', () => {
    it('the feed renders panels, not cards', () => {
        expect(js).toMatch(/<article class="feed-panel"/);
        expect(css).toMatch(/\.feed-panel \{[^}]*scroll-snap-align: start;/s);
        expect(css).toMatch(/scroll-snap-type: y mandatory/);
    });

    it('the dead .video-fullscreen-overlay block is gone', () => {
        // Two competing full-screen implementations, one of which does nothing.
        expect(css).not.toMatch(/^\.video-fullscreen-overlay \{/m);
        expect(css).not.toMatch(/^\.video-fullscreen-close \{/m);
    });

    it('🔴 the scroll chrome reads the CONTAINER, not window', () => {
        const fn = js.slice(js.indexOf('function updateScrollChrome()'));
        expect(fn.slice(0, 900)).toMatch(/container\.scrollTop/);
        expect(fn.slice(0, 900)).not.toMatch(/window\.scrollY/);
    });

    it('🔴 the infinite-scroll observer is rooted on the container', () => {
        // With the default viewport root the sentinel sits inside a scroller
        // whose own box never moves, so pagination silently stops after page 1.
        const fn = js.slice(js.indexOf('function setupInfiniteScroll()'));
        expect(fn.slice(0, 900)).toMatch(/root: container, rootMargin: '400px'/);
        expect(fn.slice(0, 900)).toMatch(/feedScrollObserver\.disconnect\(\)/);
    });

    it('🔴 the video observer is rooted on the container too', () => {
        const fn = js.slice(js.indexOf('function setupVideoObserver()'));
        expect(fn.slice(0, 2400)).toMatch(/root: container, threshold: 0\.6/);
    });

    it('the load-more sentinel is rendered INSIDE the scroller', () => {
        // An observer rooted on the container cannot see a sentinel outside it.
        expect(js).toMatch(/<div class="load-more-trigger" id="load-more-trigger"><\/div>/);
        expect(html).not.toMatch(/<div class="load-more-trigger"/);
    });

    it('nothing in the feed path still scrolls window', () => {
        const feedRegion = js.slice(js.indexOf('function setupScrollChrome()'));
        expect(feedRegion.slice(0, 1500)).not.toMatch(/window\.scrollTo/);
        // ...and the post-publish scroll-to-top moved with it.
        expect(js).not.toMatch(/window\.scrollTo\(\{ top: 0, behavior: 'smooth' \}\)/);
    });

    it('no affordance was lost in EITHER re-layout', () => {
        // ⚠️ This list is the guard against a layout change quietly dropping
        // the sound toggle or the here-tonight badge. Items may MOVE between
        // renderFeedCard and venueStripMarkup, but nothing on this list may
        // leave.
        //
        // Both functions are searched together, because that is the honest
        // boundary now: the panel is what the two of them render jointly.
        const card = fnBody('function renderFeedCard(item)');
        const strip = fnBody('function venueStripMarkup(item, identity)');
        expect(card, 'renderFeedCard not found').toBeTruthy();
        expect(strip, 'venueStripMarkup not found').toBeTruthy();
        const panel = card + '\n' + strip;

        // ⚠️ The strip's CALL is asserted against renderFeedCard alone, before
        // the two are concatenated. In the combined text `venueStripMarkup(`
        // is satisfied by the function's own DEFINITION — a mutation deleting
        // the call from renderFeedCard left the suite green, with the panel
        // rendering a bare video and no venue at all.
        expect(card, 'renderFeedCard no longer renders the venue strip')
            .toMatch(/\$\{venueStripMarkup\(item, identity\)\}/);

        for (const affordance of [
            'showPostOptions(',             // 3-dots
            'toggleFeedSound(',             // sound
            'toggleVideoPlay(this)',        // play/pause
            'hereNowBadge(venue)',          // here tonight
        ]) {
            expect(panel, `the full-screen panel dropped ${affordance}`).toContain(affordance);
        }
    });

    it('2026-10-06: the home feed shows NO author, caption or duration (Jay)', () => {
        // The bottom strip is gone by decision. fnCode: renderFeedCard's own
        // comment names what was removed.
        const code = fnCode('function renderFeedCard(item)');
        expect(code, 'renderFeedCard not found').toBeTruthy();
        expect(code.length).toBeGreaterThan(300);   // non-emptiness guard
        for (const gone of ['feed-panel-meta', 'postHeaderMarkup(', 'feed-caption', 'formatDuration(']) {
            expect(code, `${gone} is back in the home feed`).not.toContain(gone);
        }

        // The sound toggle sits INSIDE .feed-media now, bottom-right on the
        // video — between the media div's opening tag and its close.
        const mediaOpen = code.indexOf('<div class="feed-media"');
        const sound = code.indexOf('feed-panel-sound');
        const mediaClose = code.indexOf('</div>', sound);
        expect(mediaOpen).toBeGreaterThan(-1);
        expect(sound, 'the sound toggle left .feed-media').toBeGreaterThan(mediaOpen);
        expect(mediaClose).toBeGreaterThan(sound);

        // CSS: the footer's rules went with it.
        expect(css).not.toMatch(/^\.feed-panel-meta \{/m);
        expect(css).not.toMatch(/^\.feed-panel \.feed-caption \{/m);
        const soundRule = css.slice(css.indexOf('.feed-panel-sound {'));
        const soundBlock = soundRule.slice(0, soundRule.indexOf('}'));
        expect(soundBlock).toContain('position: absolute');
        expect(soundBlock).toContain('bottom: var(--spacing-md)');
        expect(soundBlock).toContain('right: var(--spacing-md)');
    });

    it('⚠️ Phase 5: nothing is overlaid on the video any more', () => {
        const card = fnBody('function renderFeedCard(item)');
        expect(card, 'renderFeedCard not found').toBeTruthy();

        // The opaque venue strip exists (the meta footer was removed on
        // 2026-10-06 — see the test above)...
        expect(fnBody('function venueStripMarkup(item, identity)')).toContain('feed-panel-venue');

        // ...and the two overlay elements are gone. fnCode, not fnBody:
        // renderFeedCard's own comment says "The scrim and .feed-panel-info are
        // gone", so asserting absence over the raw body would fail against
        // correct code and the only fix would be deleting the explanation.
        const code = fnCode('function renderFeedCard(item)');
        expect(code, 'the scrim is back').not.toContain('feed-panel-scrim');
        expect(code, 'the overlay info block is back').not.toContain('feed-panel-info');

        // CSS: the single most dangerous line in the phase. `position:absolute;
        // inset:0` on .feed-panel .feed-media must have been REPLACED, not
        // appended to — an appended rule loses and the video covers the strips.
        const mediaRule = css.slice(css.indexOf('.feed-panel .feed-media {'));
        const block = mediaRule.slice(0, mediaRule.indexOf('}'));
        // relative, not static: it is the containing block for the sound
        // toggle. Still in the flex flow — no inset, asserted below.
        expect(block).toContain('position: relative');
        expect(block).toContain('flex: 1 1 auto');
        // min-height:0 — without it a tall clip refuses to shrink and
        // overflows the panel.
        expect(block).toContain('min-height: 0');
        expect(block, 'the absolute-positioning rule survived').not.toContain('inset: 0');

        // Exactly ONE `.feed-panel .feed-media {` rule, so there is no second
        // declaration further down the file quietly restoring the old one.
        expect(css.split('.feed-panel .feed-media {').length - 1).toBe(1);

        // .feed-panel is a flex column.
        const panelRule = css.slice(css.indexOf('\n.feed-panel {'));
        const panelBlock = panelRule.slice(0, panelRule.indexOf('}'));
        expect(panelBlock).toContain('display: flex');
        expect(panelBlock).toContain('flex-direction: column');
        // ...and snap survived. The panel is still exactly one scroller-height.
        expect(panelBlock).toContain('scroll-snap-align: start');
        expect(panelBlock).toContain('scroll-snap-stop: always');
        expect(panelBlock).toContain('height: 100%');
    });

    it('⚠️ postHeaderMarkup itself was NOT forked for the feed', () => {
        // The strip is venue-primary, which inverts postHeaderMarkup's
        // author-first logic — and the inversion is forked at the CALL SITE,
        // in venueStripMarkup. Adding a mode to the shared function would make
        // a browse change reshape the member profile, which renders it too.
        const fn = fnBody('function postHeaderMarkup(identity, { showVenue = true } = {})');
        expect(fn, 'postHeaderMarkup signature changed').toBeTruthy();
        // The default is still true — the member profile relies on it.
        expect(fn).toContain('showVenue = true');
    });

    it('an unattached Viibe falls back to the author, not an empty white bar', () => {
        // venue_id is nullable. A strip rendered from nothing is a blank
        // surface above the video — worse than the overlay it replaced.
        const strip = fnBody('function venueStripMarkup(item, identity)');
        expect(strip, 'venueStripMarkup not found').toBeTruthy();
        expect(strip).toMatch(/const hasVenue = !!\(item\.venue_id && name\)/);
        expect(strip).toMatch(/hasVenue \? name : identity\.title/);
        expect(strip).toMatch(/hasVenue \? item\.venue_profile_image_url : identity\.imageUrl/);
    });

    it('the light-on-dark colour overrides are GONE, not merely unused', () => {
        // ~30 lines forcing white text onto the shared header markup existed
        // only because that markup was drawn over a video. Both strips are
        // light surfaces now. Leaving the overrides in place would paint white
        // text on a white strip — invisible, with nothing in the console.
        const panelCss = css.slice(css.indexOf('\n.feed-panel {'), css.indexOf('.feed-card {'));
        expect(panelCss.length, 'the .feed-panel CSS block was not found').toBeGreaterThan(500);
        expect(panelCss).not.toMatch(/\.feed-panel \.venue-handle \{[^}]*color: #fff/);
        expect(panelCss).not.toMatch(/\.feed-panel-scrim \{/);
        expect(panelCss).not.toMatch(/\.feed-panel-info \{/);
    });

    it('the photo branch survives as the rollback path', () => {
        // Pointing loadFeed() back at get_venue_feed brings photos with it.
        const fn = js.slice(js.indexOf('function renderFeedCard(item)'));
        expect(fn.slice(0, 3000)).toMatch(/<img src="\$\{escapeHtml\(item\.url\)\}"/);
    });

    it('⚠️ the two surfaces INVERTED in Phase 4, and did not merge', () => {
        // The venue page renders the reels grid; the MEMBER PROFILE renders
        // .feed-card. Both classes still exist and neither surface renders
        // both — the separation from .feed-panel is what stops a browse change
        // reshaping someone's own list of posts, and it survived the swap.
        expect(js).toMatch(/<div class="feed-card" data-media-id=/);
        expect(css).toMatch(/^\.feed-card \{/m);

        // The tile markup lives in reelsTileMarkup() since 2026-10-06, shared
        // with the Me tab. Assert the CALL against the grid, and the markup
        // against the helper.
        const grid = fnBody('function renderVenuePageGrid()');
        expect(grid, 'renderVenuePageGrid not found').toBeTruthy();
        expect(grid).toMatch(/venuePageFeed\.map\(item => reelsTileMarkup\(item, \{/);
        const tile = fnBody("function reelsTileMarkup(item, { expanded = false, onTap = '' } = {})");
        expect(tile, 'reelsTileMarkup not found').toBeTruthy();
        expect(tile).toContain('member-grid-tile');
        expect(grid + tile, 'the venue page is still rendering the old card stack')
            .not.toContain('class="feed-card"');

        const list = fnBody('function renderMemberList()');
        expect(list, 'renderMemberList not found').toBeTruthy();
        expect(list).toContain('class="feed-card"');
        expect(list, 'the member profile is still rendering the old tile grid')
            .not.toContain('member-grid-tile');

        // ...and #venue-page-feed wears the grid geometry in the markup.
        expect(html).toMatch(/class="venue-page-feed member-grid" id="venue-page-feed"/);
    });

    it('the sound toggle resolves both the panel and the venue-page shapes', () => {
        // The button is inside .feed-media on every surface since 2026-10-06;
        // .feed-panel is still checked first — the panel holds one video.
        expect(js).toMatch(/btn\.closest\('\.feed-panel'\) \|\| btn\.closest\('\.feed-media'\)/);
    });
});

describe('video performance (#9)', () => {
    it('preload="none" only when there is a poster to paint instead', () => {
        // ⚠️ Posts predating thumbnail generation have thumbnail_url NULL and no
        // backfill is possible. A blanket preload="none" paints them black.
        const fn = js.slice(js.indexOf('function videoPreloadMode(item)'));
        expect(fn.slice(0, 300)).toMatch(/item\.thumbnail_url \? 'none' : 'metadata'/);
        expect(js).toMatch(/preload="\$\{videoPreloadMode\(item\)\}"/);
    });

    it('only the visible panel and its neighbours hold a src', () => {
        expect(js).toMatch(/const VIDEO_HYDRATION_WINDOW = 1;/);
        expect(js).toMatch(/<video data-src=/);
        const fn = js.slice(js.indexOf('function hydrateVideosAround(index)'));
        expect(fn.slice(0, 900)).toMatch(/video\.removeAttribute\('src'\)/);
        expect(fn.slice(0, 900)).toMatch(/video\.load\(\)/);
    });

    it('⚠️ hydration is seeded synchronously so an inert observer cannot blank the feed', () => {
        const fn = js.slice(js.indexOf('function setupVideoObserver()'));
        expect(fn.slice(0, 2600)).toMatch(/hydrateVideosAround\(0\);/);
    });

    it('the MEMBER PROFILE list is lazy, and its observer hydrates', () => {
        // ⚠️ Prod holds ONE post on the one venue, so a browser walkthrough
        // cannot tell "seeds the first card" from "hydrates every card" — both
        // look like one loaded video. Pinned here instead.
        //
        // Phase 4 moved this list from the venue page to the profile. The risk
        // MOVED WITH IT and did not shrink: a profile renders every post a
        // member has with no limit, and a plain src at preload="metadata" is a
        // connection per card on first paint.
        const list = fnBody('function renderMemberList()');
        expect(list, 'renderMemberList not found').toBeTruthy();
        expect(list.length, 'renderMemberList body is suspiciously short').toBeGreaterThan(500);
        expect(list).toMatch(/<video data-src="\$\{escapeHtml\(post\.url\)\}"/);
        expect(list).toMatch(/preload="\$\{videoPreloadMode\(post\)\}"/);
        expect(list, 'the profile list lost its observer').toMatch(/setupVideoObserverIn\(list\)/);

        const body = fnBody('function setupVideoObserverIn(container)');
        expect(body, 'setupVideoObserverIn not found').toBeTruthy();
        expect(body.length, 'setupVideoObserverIn is unterminated').toBeGreaterThan(500);

        // play() on a data-src-only element rejects — the card would stay a
        // poster forever, silently.
        expect(body).toMatch(/ensureVideoSrc\(video\);/);

        // ⚠️ And the synchronous seed, for the same reason hydrateVideosAround(0)
        // exists on the main feed: an observer that never fires would leave the
        // whole list black with nothing in the console.
        expect(body).toMatch(/querySelector\('\.feed-media video\[data-src\]'\)/);
        // querySelector, NOT querySelectorAll — seeding all of them is exactly
        // the cost this change removes.
        expect(body).not.toMatch(/querySelectorAll\('\.feed-media video\[data-src\]'\)/);
    });

    it('⚠️ the VENUE PAGE grid has NO observer and NO autoplay', () => {
        // 40 autoplaying tiles OOM a phone. This is the assertion the plan
        // called for and the one a browser pass on a two-post tenant can never
        // make: every tile there is visible at once, so "the grid autoplays
        // everything" and "the grid autoplays the one post" look identical.
        const grid = fnBody('function renderVenuePageGrid()');
        expect(grid, 'renderVenuePageGrid not found').toBeTruthy();
        expect(grid.length, 'renderVenuePageGrid body is suspiciously short').toBeGreaterThan(500);
        // The tile markup moved to reelsTileMarkup() (2026-10-06).
        const tile = fnBody("function reelsTileMarkup(item, { expanded = false, onTap = '' } = {})");
        expect(tile, 'reelsTileMarkup not found').toBeTruthy();

        // ⚠️ fnCode, not fnBody. renderVenuePageGrid's own header comment says
        // "setupVideoObserverIn() is deliberately NOT called here" — asserting
        // absence over the raw body fails against CORRECT code, and the only
        // way to go green would be to delete the warning.
        const code = fnCode('function renderVenuePageGrid()');
        expect(code, 'the venue grid attached the lazy-autoplay observer')
            .not.toContain('setupVideoObserverIn');
        expect(code, 'the venue grid autoplays').not.toMatch(/\.play\(\)/);

        // A collapsed tile is a poster, not a video element. The <img> branch
        // has to be there or the "no autoplay" assertion above is satisfied by
        // markup that still holds 40 <video> elements.
        expect(tile).toMatch(/<img src="\$\{escapeHtml\(item\.thumbnail_url\)\}"[^>]*loading="lazy"/);

        // ⚠️ ...and preload="metadata" for the legacy rows whose thumbnail_url
        // is NULL and can never be backfilled. "none" paints those solid black.
        expect(tile).toMatch(/preload="metadata"/);
        // ...and the helper itself never autoplays or observes either.
        const tileCode = fnCode("function reelsTileMarkup(item, { expanded = false, onTap = '' } = {})");
        expect(tileCode).not.toContain('setupVideoObserverIn');
        expect(tileCode).not.toMatch(/\.play\(\)/);

        // Hydration happens on tap, in its own function, and nowhere else.
        // Scoped to one grid since the Me tab got its own (2026-10-06).
        expect(fnBody('function hydrateExpandedVenuePost()'))
            .toContain("hydrateExpandedTileIn(document.getElementById('venue-page-feed'))");
        const tap = fnBody('function hydrateExpandedTileIn(container)');
        expect(tap, 'hydrateExpandedTileIn not found').toBeTruthy();
        expect(tap).toMatch(/ensureVideoSrc\(video\)/);
        expect(tap).toMatch(/applySoundState\(video\)/);
    });

    it('tapping a panel hydrates it even outside the window', () => {
        // play() on a src-less element rejects.
        const fn = js.slice(js.indexOf('function toggleVideoPlay(mediaEl)'));
        expect(fn.slice(0, 800)).toMatch(/ensureVideoSrc\(video\);/);
    });

    it('capture is portrait and bitrate-capped, with ideal (never exact) constraints', () => {
        expect(js).toMatch(/width: \{ ideal: 720 \}/);
        expect(js).toMatch(/height: \{ ideal: 1280 \}/);
        // Lowered from 2_500_000 / 96_000 on 2026-09-09 — every stored byte is
        // re-paid on every feed load, and the org went over its free-tier
        // Supabase egress. The assertion stays: the point is that a cap EXISTS,
        // so an uncapped 1080p phone encode can never reach storage.
        expect(js).toMatch(/videoBitsPerSecond: 1_200_000/);
        expect(js).toMatch(/audioBitsPerSecond: 64_000/);
        // `exact` raises OverconstrainedError and being unable to record at all
        // is worse than recording at whatever the camera offers.
        const camera = js.slice(js.indexOf('const videoConstraints = {'));
        expect(camera.slice(0, 400)).not.toMatch(/exact:/);
    });

    it('generateThumbnail handles the Infinity-duration MediaRecorder blob', () => {
        // Every miss is permanent: the post is pinned to preload="metadata" for
        // life, on every render, for every visitor.
        const fn = js.slice(js.indexOf('function generateThumbnail(file)'));
        expect(fn.slice(0, 3000)).toMatch(/!Number\.isFinite\(duration\)/);
        expect(fn.slice(0, 3000)).toMatch(/graceTimer = setTimeout\(draw, 1200\)/);
        // A blank canvas LOOKS like a poster, which is worse than none.
        expect(fn.slice(0, 3000)).toMatch(/if \(!video\.videoWidth \|\| !video\.videoHeight\)/);
    });

    it('the poster is downscaled, not drawn at full source resolution', () => {
        // With preload="none" the poster is the ONLY byte cost of a panel
        // nobody scrolls to, so it is paid on every post while the video is
        // paid on one. Full-resolution at 0.7 made an 82 KB poster for a 5s clip.
        expect(js).toMatch(/const POSTER_MAX_EDGE_PX = 720;/);
        expect(js).toMatch(/const POSTER_JPEG_QUALITY = 0\.6;/);

        const fn = js.slice(js.indexOf('function generateThumbnail(file)'));
        expect(fn.length, 'generateThumbnail not found').toBeGreaterThan(1000);
        const body = fn.slice(0, 3000);
        expect(body).toMatch(/POSTER_MAX_EDGE_PX/);
        expect(body).toMatch(/toBlob\(\(blob\) => finish\(blob\), 'image\/jpeg', POSTER_JPEG_QUALITY\)/);
        // The bug this replaces: canvas sized straight off the source.
        expect(body).not.toMatch(/canvas\.width = video\.videoWidth;/);
    });
});

describe('interruption handling (#11)', () => {
    it('the draft is written BEFORE the first byte is uploaded', () => {
        const fn = js.slice(js.indexOf('async function submitPost()'));
        const body = fn.slice(0, 4000);
        expect(body.indexOf('await saveDraft(payload)')).toBeGreaterThan(-1);
        expect(body.indexOf('await saveDraft(payload)'))
            .toBeLessThan(body.indexOf('await publishViibe(payload'));
    });

    it('the draft is cleared on POST success, not on upload success', () => {
        // create_social_post can still refuse it — a rate limit, say — and that
        // is a retry-later case, not a discard case.
        const fn = js.slice(js.indexOf('async function submitPost()'));
        const body = fn.slice(0, 4500);
        expect(body.indexOf('await publishViibe(payload'))
            .toBeLessThan(body.indexOf('await clearDraft()'));
    });

    it('⚠️ a 409 Duplicate counts as SUCCESS, not as a failure', () => {
        // upsert: false means a retry after a lost response collides with the
        // bytes it already wrote. Calling that a failure throws away a
        // recording that is safely in storage.
        const fn = js.slice(js.indexOf('function isAlreadyUploaded(error)'));
        expect(fn.slice(0, 500)).toMatch(/status === 409/);
        expect(js).toMatch(/if \(!error \|\| isAlreadyUploaded\(error\)\) return \{ ok: true \};/);
    });

    it('only network and 5xx failures are retried', () => {
        // A 4xx says the same thing three times; retrying just makes it slower.
        const fn = js.slice(js.indexOf('function isRetriableUploadError(error)'));
        expect(fn.slice(0, 600)).toMatch(/return status >= 500;/);
    });

    it('the storage path is part of the draft, not recomputed on resume', () => {
        // A fresh timestamped path per attempt could never collide with — and
        // therefore never recognise — bytes a previous attempt had written.
        expect(js).toMatch(/const path = payload\.path;/);
    });

    it('every draft helper degrades to a no-op rather than throwing', () => {
        // IndexedDB is unavailable in some private-browsing modes. Losing the
        // safety net must not take the post down with it.
        const fn = js.slice(js.indexOf('function openDraftDb()'));
        expect(fn.slice(0, 1200)).toMatch(/resolve\(null\)/);
        expect(fn.slice(0, 1200)).not.toMatch(/reject\(/);
    });

    it('one uploader serves both the composer and the resume path', () => {
        expect((js.match(/async function publishViibe\(/g) || []).length).toBe(1);
        expect(js).toMatch(/async function resumeDraft\(draft\)/);
        expect(js).toMatch(/await publishViibe\(draft, \{ onStatus/);
    });

    it("a draft for another tenant on the same device is left alone", () => {
        expect(js).toMatch(/draft\.appId !== currentApp\.id/);
    });

    it('the progress UI reports stages honestly, not fake byte percentages', () => {
        // supabase-js v2's storage.upload() is a fetch with no progress event.
        expect(js).toMatch(/STAGE markers, not byte progress/);
        expect(js).toMatch(/social\.uploadRetrying/);
    });
});

describe('release plumbing', () => {
    it('the cache-bust versions moved together', () => {
        expect(html).toContain('/customer-app/social.js?v=21');
        expect(html).toContain('/customer-app/social-auth.js?v=5');
        expect(html).toContain('/customer-app/social.css?v=16');
        // ⚠️ sw.js caches social.HTML too, so a ?v bump alone is not enough for
        // a returning PWA user.
        const sw = fs.readFileSync(path.join(ROOT, 'customer-app/sw.js'), 'utf8');
        expect(sw).toContain("const CACHE_NAME = 'royalty-rewards-v16'");
        expect(sw).toContain("const STATIC_CACHE = 'royalty-static-v16'");
        expect(sw).toContain("const DYNAMIC_CACHE = 'royalty-dynamic-v16'");
        // ...and the generation carries its own dated rationale, in the style
        // every previous one does. A bump with no note is a bump nobody can
        // later tell was mandatory or cosmetic.
        expect(sw).toMatch(/\/\/ v16 \(2026-10-06\):/);
    });

    it('new translation keys can actually reach a returning visitor', () => {
        // TRANSLATION_VERSION lives INSIDE the cached i18n.js, so both move.
        const i18n = fs.readFileSync(path.join(ROOT, 'i18n/i18n.js'), 'utf8');
        expect(i18n).toContain('const TRANSLATION_VERSION = 17;');
        expect(html).toContain('/i18n/i18n.js?v=6');
    });

    it('supabase-js is pinned, not floating on a major', () => {
        // The recovery landing turns detectSessionInUrl off and takes ownership
        // of the URL, so exactly one library behaviour is load-bearing. A silent
        // minor bump changing it is a password reset nobody can complete, with
        // nothing in the console.
        expect(html).toMatch(/@supabase\/supabase-js@\d+\.\d+\.\d+/);
        expect(html).not.toContain('@supabase/supabase-js@2"');
    });

    it('every i18n key the new UI references exists in en.json', () => {
        const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/en.json'), 'utf8'));
        const keys = new Set();
        for (const m of html.matchAll(/data-i18n(?:-aria|-placeholder|-attr)?="([^"]+)"/g)) {
            keys.add(m[1].replace(/^\[html\]/, ''));
        }
        for (const m of js.matchAll(/translateOr\('([^']+)'/g)) keys.add(m[1]);
        expect(keys.size).toBeGreaterThan(80);   // non-emptiness guard

        const missing = [...keys].filter(
            k => k.split('.').reduce((o, p) => (o ? o[p] : undefined), en) === undefined
        );
        expect(missing, `missing i18n keys: ${missing.join(', ')}`).toEqual([]);
    });

    it('the new migrations do not reuse an existing number', () => {
        const files = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql'));
        for (const stamp of [
            '20260907000001', '20260907000002',
            // The 2026-09-22 batch. One file per stamp — two files sharing one
            // would apply in an order the filesystem decides, and 000004
            // references a column 000003 creates.
            '20260922000001', '20260922000002', '20260922000003',
            '20260922000004', '20260922000005',
            // The 2026-10-06 round. 000002 reads venue_owners and 000003 reads
            // venue_media.is_flyer, both created by 000001.
            '20261006000001', '20261006000002', '20261006000003',
        ]) {
            expect(files.filter(f => f.startsWith(stamp)).length,
                `${stamp} is claimed by more than one file`).toBe(1);
        }
    });
});
