/**
 * Guards for Jay's 2026-10-06 ViibeView round (15 items):
 *
 *   SQL      venue owners + flyers, delete without storage, the 7am reset
 *   Edge     delete-social-post — order of operations
 *   Client   five tabs + Me, Search → Members, back navigation + the z-index
 *            ladder, phone-only 9:16 recording, delete from every list,
 *            flyers, onboarding after signup, the Follow button
 *
 * ⚠️ THE SQL ASSERTIONS READ THE LIVE DEFINITION, not one file.
 * latestDefinition(fn) walks every migration in apply order and returns the
 * LAST `CREATE … FUNCTION fn(` — the one prod actually runs. Asserting against
 * a single file passes forever after a later migration silently re-creates the
 * function without the property under test.
 *
 * ⚠️ EVERY absence assertion runs on comment-stripped text (sqlCode / fnCode).
 * Three syntaxes have failed against CORRECT code in this repo: `--`, `//` and
 * `<!-- -->` inside a template literal. Slices are bounded at BOTH ends, and
 * the assertions are on writes, not lookups.
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
const authJs = read('customer-app/social-auth.js');
const html = read('customer-app/social.html');
const css = read('customer-app/social.css');
const edge = read('supabase/functions/delete-social-post/index.ts');

const sql = name => fs.readFileSync(path.join(MIGRATIONS, name), 'utf8');
const ownersSql = sql('20261006000001_venue_owners_and_flyers.sql');
const deleteSql = sql('20261006000002_delete_social_post_no_storage.sql');
const resetSql  = sql('20261006000003_feed_morning_reset.sql');

/** SQL with `--` comment text removed. Mandatory before any absence check. */
function sqlCode(text) {
    return text.split('\n').map(l => {
        const i = l.indexOf('--');
        return i < 0 ? l : l.slice(0, i);
    }).join('\n');
}

const migrationFiles = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort();

/**
 * The definition prod runs: the last CREATE of `fn` across all migrations, in
 * apply order, comments stripped, sliced from CREATE to its own closing `$$;`.
 */
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

/** The WHERE … ORDER BY of a function body — the predicate region. */
function whereClause(body) {
    const start = body.indexOf('WHERE vm.app_id');
    const end = body.indexOf('ORDER BY', start);
    return start < 0 || end < 0 ? '' : body.slice(start, end);
}

/** The source of one top-level JS function, to its own closing brace. */
function fnBody(source, signature) {
    const start = source.indexOf(signature);
    if (start < 0) return null;
    const end = source.indexOf('\n}', start);
    return end < 0 ? null : source.slice(start, end);
}

/** fnBody with // and <!-- --> comments stripped. */
function fnCode(source, signature) {
    const body = fnBody(source, signature);
    if (body === null) return null;
    return body
        .replace(/<!--[\s\S]*?-->/g, '')
        .split('\n')
        .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .map(l => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

// ===========================================================================
// SQL — the live definitions
// ===========================================================================

describe('the 7am reset — home feed and map', () => {
    const CUTOFF = 'AND vm.created_at >= v_cutoff';

    it('social_feed_cutoff is the most recent 7am Pacific, as specified', () => {
        const def = latestDefinition('social_feed_cutoff');
        expect(def, 'social_feed_cutoff is not defined').toBeTruthy();
        const flat = def.body.replace(/\s+/g, ' ');
        expect(flat).toContain(
            "(date_trunc('day', (now() AT TIME ZONE 'America/Los_Angeles') - interval '7 hours') " +
            "+ interval '7 hours') AT TIME ZONE 'America/Los_Angeles'");
        expect(flat).toMatch(/LANGUAGE sql STABLE/);
        // Not SECURITY DEFINER — it touches no table.
        expect(flat).not.toContain('SECURITY DEFINER');
    });

    for (const fn of ['get_venue_feed_v3', 'get_following_feed_v3', 'get_recent_post_pins']) {
        it(`${fn}: cutoff predicate, NO permanent exemption, NO ttl`, () => {
            const def = latestDefinition(fn);
            expect(def, `${fn} not found`).toBeTruthy();
            expect(def.file, `${fn}'s live definition is not the reset migration`)
                .toBe('20261006000003_feed_morning_reset.sql');

            const where = whereClause(def.body);
            expect(where.length, `${fn}: WHERE clause not found`).toBeGreaterThan(100);
            expect(where).toContain(CUTOFF);
            expect(where, `${fn} still exempts permanent posts`).not.toContain('is_permanent');
            expect(def.body, `${fn} still reads the TTL`).not.toContain('v_ttl_hours');
            // The cutoff is ASSIGNED from the helper, not merely declared.
            expect(def.body).toMatch(/v_cutoff := social_feed_cutoff\(p_app_id\);/);
        });
    }

    it('the two v3 feeds carry the predicate character for character', () => {
        const a = whereClause(latestDefinition('get_venue_feed_v3').body);
        const b = whereClause(latestDefinition('get_following_feed_v3').body);
        const line = s => s.split('\n').map(l => l.trim()).filter(l => l.startsWith('AND vm.created_at'));
        expect(line(a)).toEqual([CUTOFF]);
        expect(line(b)).toEqual([CUTOFF]);
    });

    it('flyers never become map pins', () => {
        const where = whereClause(latestDefinition('get_recent_post_pins').body);
        expect(where).toContain('AND NOT vm.is_flyer');
    });

    it('venue pages KEEP the TTL and team-posts-permanent rule, and pin flyers first', () => {
        const def = latestDefinition('get_venue_page_feed');
        expect(def.file).toBe('20261006000003_feed_morning_reset.sql');
        const where = whereClause(def.body);
        expect(where).toContain('OR vm.is_permanent');
        expect(where).toContain('v_ttl_hours IS NULL');
        expect(where).not.toContain('v_cutoff');
        expect(def.body).toContain('ORDER BY vm.is_flyer DESC, vm.created_at DESC');
        // ...and returns the column the badge reads.
        expect(def.body).toMatch(/is_flyer BOOLEAN\s*\)/);
        expect(def.body).toMatch(/vm\.is_flyer\s*FROM venue_media vm/);
        // A new OUT column needs DROP first (42P13 otherwise).
        expect(sqlCode(resetSql)).toContain('DROP FUNCTION IF EXISTS get_venue_page_feed(UUID, UUID, INTEGER, INTEGER);');
    });

    it('⚠️ NO grant footer on the three open readers — in ANY migration', () => {
        // Anonymous browsing runs on the default EXECUTE TO PUBLIC. A REVOKE
        // anywhere — and CREATE OR REPLACE keeps whatever a REVOKE left —
        // empties all three for every signed-out visitor with a 200.
        for (const fn of ['get_venue_feed_v3', 'get_venue_page_feed', 'get_recent_post_pins']) {
            const re = new RegExp(`(REVOKE|GRANT)[^;]*ON FUNCTION\\s+(public\\.)?${fn}\\s*\\(`);
            for (const file of migrationFiles) {
                expect(re.test(sqlCode(sql(file))), `${file} grants/revokes ${fn}`).toBe(false);
            }
        }
        // The closed one keeps all three lines.
        const code = sqlCode(resetSql);
        const sig = 'get_following_feed_v3(UUID, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER)';
        expect(code).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;`);
        expect(code).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM anon;`);
        expect(code).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated;`);
    });

    it('the install check asserts both directions and the 7am sanity', () => {
        const code = sqlCode(resetSql);
        const check = code.slice(code.lastIndexOf('DO $$'), code.lastIndexOf('END $$;'));
        expect(check.length).toBeGreaterThan(500);
        expect(check).toMatch(/IF NOT has_function_privilege\('anon', v_fn, 'EXECUTE'\)/);
        expect(check).toMatch(/IF v_anon THEN/);
        expect(check).toContain("v_cutoff := social_feed_cutoff(NULL);");
        expect(check).toContain('IF v_cutoff > now() THEN');
        expect(check).toContain("IF v_cutoff <= now() - interval '24 hours' THEN");
        expect(check).toContain("(v_cutoff AT TIME ZONE 'America/Los_Angeles')::TIME <> TIME '07:00'");
    });

    it('get_member_posts is untouched — profiles keep every post', () => {
        expect(latestDefinition('get_member_posts').file).not.toMatch(/^20261006/);
    });
});

describe('delete_social_post — no storage, owners may delete', () => {
    const live = () => latestDefinition('delete_social_post');

    it('the live definition never touches storage tables', () => {
        const def = live();
        expect(def.file).toBe('20261006000002_delete_social_post_no_storage.sql');
        expect(def.body.length).toBeGreaterThan(800);
        expect(def.body).not.toContain('storage.objects');
        expect(def.body).not.toMatch(/DELETE FROM storage/i);
        // ...and it still deletes the ROW (the write, not a lookup).
        expect(def.body).toContain('DELETE FROM venue_media WHERE id = p_media_id;');
    });

    it('a venue owner is authorized, and NULL means no', () => {
        const body = live().body;
        expect(body).toMatch(/FROM venue_owners vo\s+WHERE vo\.venue_id = v_media\.venue_id\s+AND vo\.user_id = v_user_id/);
        // ⚠️ `NULL = uid OR false` is NULL, and `IF NOT NULL` never fires.
        expect(body).toContain('IF NOT COALESCE(v_authorized, false) THEN');
        expect(body).not.toMatch(/IF NOT v_authorized THEN/);
        // The authorization comes BEFORE the delete.
        expect(body.indexOf('COALESCE(v_authorized, false)'))
            .toBeLessThan(body.indexOf('DELETE FROM venue_media'));
    });

    it('same signature, 3-line footer', () => {
        const code = sqlCode(deleteSql);
        expect(code).toContain('RETURNS TABLE (success BOOLEAN, error_message TEXT)');
        expect(code).toContain('REVOKE ALL ON FUNCTION delete_social_post(UUID) FROM PUBLIC;');
        expect(code).toContain('REVOKE ALL ON FUNCTION delete_social_post(UUID) FROM anon;');
        expect(code).toContain('GRANT EXECUTE ON FUNCTION delete_social_post(UUID) TO authenticated;');
    });
});

describe('venue_owners and add_venue_flyer', () => {
    const code = sqlCode(ownersSql);

    it('venue_owners: RLS on, select-own only, no write grant', () => {
        expect(code).toContain('ALTER TABLE venue_owners ENABLE ROW LEVEL SECURITY;');
        expect(code).toMatch(/ON venue_owners FOR SELECT\s+TO authenticated\s+USING \(user_id = auth\.uid\(\)\);/);
        expect(code).toContain('REVOKE ALL ON TABLE venue_owners FROM anon;');
        expect(code).toContain('REVOKE ALL ON TABLE venue_owners FROM authenticated;');
        expect(code).toContain('GRANT SELECT ON TABLE venue_owners TO authenticated;');
        expect(code).not.toMatch(/GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*ON TABLE venue_owners/);
        // Exactly one policy on the table.
        expect((code.match(/CREATE POLICY[^;]*ON venue_owners/g) || []).length).toBe(1);
        expect(code).toMatch(/PRIMARY KEY \(venue_id, user_id\)/);
    });

    it('the owner RPCs are org-member-only and take app_id from the venue', () => {
        for (const fn of ['list_venue_owners', 'add_venue_owner', 'remove_venue_owner']) {
            const def = latestDefinition(fn);
            expect(def, fn).toBeTruthy();
            expect(def.body).toMatch(/FROM organization_members om\s+WHERE om\.organization_id = v_(venue\.organization_id|org_id)\s+AND om\.user_id = v_caller/);
        }
        const add = latestDefinition('add_venue_owner').body;
        expect(add).toContain("lower(btrim(COALESCE(p_email, '')))");
        expect(add).toContain('WHERE lower(btrim(u.email)) = v_email');
        expect(add).toContain("No ViibeView account for that email. Ask them to sign up first.");
        expect(add).toMatch(/VALUES \(v_venue\.id, v_user_id, v_venue\.app_id, v_caller\)/);
    });

    it('add_venue_flyer validates the PATH, the OBJECT and the URL before it writes', () => {
        const body = latestDefinition('add_venue_flyer').body;
        const insertAt = body.indexOf('INSERT INTO venue_media');
        expect(insertAt).toBeGreaterThan(-1);
        const checks = body.slice(0, insertAt);

        expect(checks).toContain("v_path LIKE 'members/' || v_caller::TEXT || '/%'");
        expect(checks).toContain("(v_is_org_member AND v_path LIKE v_venue.organization_id::TEXT || '/%')");
        expect(checks).toContain("position('..' IN v_path) = 0");
        expect(checks).toMatch(/!~ '\\\.\(jpe\?g\|png\|webp\)\$'/);
        expect(checks).toMatch(/FROM storage\.objects o\s+WHERE o\.bucket_id = 'venue-media'\s+AND o\.name = v_path\s+AND o\.owner_id = v_caller::TEXT/);
        expect(checks).toContain('right(v_url, length(v_marker || v_path)) <> v_marker || v_path');
        expect(checks).toMatch(/EXISTS \(SELECT 1 FROM venue_media vm WHERE vm\.storage_path = v_path\)/);
        // Caller: org member OR owner of THIS venue.
        expect(checks).toContain('IF NOT (v_is_org_member OR v_is_owner) THEN');
        expect(checks).toMatch(/FROM venue_owners vo\s+WHERE vo\.venue_id = v_venue\.id\s+AND vo\.user_id = v_caller/);

        // The row: image, flyer, permanent, approved, NO author.
        const insert = body.slice(insertAt, body.indexOf('RETURNING id', insertAt));
        expect(insert).toMatch(/v_venue\.id, v_venue\.app_id, NULL,\s*'image', v_path, v_url, NULL,/);
        expect(insert).toMatch(/'approved', true, true/);
    });

    it('every new RPC carries the 3-line footer', () => {
        for (const sig of ['list_venue_owners(UUID)', 'add_venue_owner(UUID, TEXT)',
                           'remove_venue_owner(UUID, UUID)', 'add_venue_flyer(UUID, TEXT, TEXT, TEXT)']) {
            expect(code).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;`);
            expect(code).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM anon;`);
            expect(code).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated;`);
        }
    });
});

// ===========================================================================
// Edge function — order of operations
// ===========================================================================

describe('delete-social-post edge function', () => {
    const at = s => {
        const i = edge.indexOf(s);
        expect(i, `not found: ${s}`).toBeGreaterThan(-1);
        return i;
    };

    it('identify → read the row → RPC as the caller → remove files → respond', () => {
        const getUser = at('userClient.auth.getUser(token)');
        const readRow = at(".select('storage_path, thumbnail_url, uploaded_by_user_id, is_flyer, app_id')");
        const rpc = at("userClient.rpc('delete_social_post'");
        const remove = at('admin.storage.from(BUCKET).remove(paths)');
        const done = edge.lastIndexOf('return json({ success: true })');
        expect(getUser).toBeLessThan(readRow);
        expect(readRow).toBeLessThan(rpc);
        expect(rpc).toBeLessThan(remove);
        expect(remove).toBeLessThan(done);
    });

    it('authorization stays in SQL — the RPC runs with the CALLER\'s JWT', () => {
        expect(edge).not.toMatch(/admin\.rpc\('delete_social_post'/);
        // A refusal is a 403 and nothing is removed.
        const refusal = edge.slice(edge.indexOf("userClient.rpc('delete_social_post'"), edge.indexOf('// ── 4.'));
        expect(refusal).toMatch(/if \(rpcErr \|\| !outcome\?\.success\) \{[\s\S]*\}, 403\)/);
    });

    it('only files that belong to the post, never with traversal, never if still referenced', () => {
        expect(edge).toContain("path.startsWith(`members/${row.uploaded_by_user_id}/`)");
        expect(edge).toContain('path.startsWith(`${orgId}/`)');
        expect(edge).toContain("(row.is_flyer && path.startsWith('members/'))");
        // ...and the rule is APPLIED to the candidate list, not merely defined.
        // (Mutation: deleting this filter left every assertion above green.)
        expect(edge).toMatch(/\.filter\(isCleanPath\)\s*\.filter\(belongsToPost\)/);
        expect(edge).toMatch(/!path\.startsWith\('\/'\) && !path\.includes\('\.\.'\)/);
        expect(edge).toContain(".in('storage_path', unique)");
        expect(edge).toContain(".in('thumbnail_url', publicUrls)");
        expect(edge).toContain('const paths = unique.filter(p => !stillUsed.has(p))');
    });

    it('a cleanup failure still succeeds, and paths never reach the client', () => {
        const tail = edge.slice(edge.indexOf('} catch (cleanupErr) {'));
        expect(tail).toContain("console.error('delete-social-post: storage cleanup failed for'");
        expect(tail.indexOf('return json({ success: true })')).toBeGreaterThan(-1);
        // No response body anywhere names a path.
        for (const m of edge.matchAll(/json\(\{([^}]*)\}/g)) {
            expect(m[1]).not.toMatch(/path/i);
        }
    });
});

// ===========================================================================
// Client — static
// ===========================================================================

describe('client wiring (static)', () => {
    it('replaceState passes history.state through, in both files', () => {
        expect(js).toContain("history.replaceState(history.state, '', window.location.pathname + window.location.search);");
        expect(authJs).toContain("history.replaceState(history.state, '', window.location.pathname + (search ? `?${search}` : ''));");
        expect(sqlCode(js + authJs)).not.toMatch(/history\.replaceState\(null,/);
    });

    it('back navigation is set up at parse time and leaving Feed arms it', () => {
        expect(js).toMatch(/^setupBackNavigation\(\);$/m);
        expect(fnBody(js, 'function switchTab(tabId) {')).toContain('syncBackGuard();');
    });

    it('the composer detaches onstop BEFORE anything stops the recorder', () => {
        const fn = fnCode(js, 'function closeCreatePost() {');
        expect(fn).toBeTruthy();
        const detach = fn.indexOf('mediaRecorder.onstop = null;');
        expect(detach).toBeGreaterThan(-1);
        expect(detach).toBeLessThan(fn.indexOf('mediaRecorder.stop()'));
        expect(detach).toBeLessThan(fn.indexOf('stopCamera();'));
    });

    it('the recorder records the 9:16 crop when it can, the camera when it cannot', () => {
        const fn = fnBody(js, 'function startRecording() {');
        expect(fn).toContain('const source = startCropPipeline(viewfinder) || cameraStream;');
        expect(fn).toContain('mediaRecorder = new MediaRecorder(source, {');
        expect(fn).toContain('mediaRecorder = new MediaRecorder(cameraStream, { mimeType });');
        expect(fn).toContain('timer.textContent = formatClock(remaining)');
        expect(fn).not.toMatch(/`0:\$\{/);
        // Upright only.
        expect(fn.indexOf('if (isLandscape())')).toBeLessThan(fn.indexOf('new MediaRecorder'));
    });

    it('openCreatePost gates on the phone AFTER requireAccount; startCamera re-checks', () => {
        const open = fnBody(js, 'async function openCreatePost(venueId) {');
        expect(open.indexOf('requireAccount(')).toBeLessThan(open.indexOf('isPhoneDevice()'));
        const cam = fnBody(js, 'async function startCamera() {');
        expect(cam.indexOf('if (!isPhoneDevice())')).toBeLessThan(cam.indexOf('getUserMedia({'));
    });

    it('a new signup ALWAYS sees onboarding', () => {
        const fn = fnBody(js, 'async function handleSignupSubmit(e) {');
        expect(fn.indexOf('showOnboarding({ force: true });')).toBeGreaterThan(fn.indexOf('await onSignedIn();'));
    });

    it('the CSS: viewfinder 9:16, solid controls, five-column nav, Follow in the row', () => {
        const block = sel => {
            const i = css.indexOf(`\n${sel} {`);
            expect(i, sel).toBeGreaterThan(-1);
            return css.slice(i, css.indexOf('}', i));
        };
        expect(block('.camera-viewfinder')).toContain('aspect-ratio: 9 / 16');
        expect(block('.camera-viewfinder')).toContain('height: min(62vh, 560px)');
        expect(block('.recording-controls')).not.toContain('gradient');
        expect(block('.nav-item')).toContain('flex: 1');
        expect(block('.nav-item')).toContain('min-width: 0');
        const follow = block('.venue-page-actions .follow-btn');
        expect(follow).toContain('border-radius: 12px');
        expect(follow).toContain('flex-direction: column');
        expect(follow).toContain('justify-content: center');
        expect(follow).toContain('font-size: 11px');
        expect(css).toContain('.venue-page-actions .follow-btn::before {');
        expect(css).toContain('.venue-page-actions .follow-btn.following::before {');
    });

    it('people-sheet venue rows close the member page too', () => {
        expect(fnBody(js, 'function renderPeopleList(rows) {'))
            .toContain("`closePeopleSheet(); closeMemberProfile(); openVenuePage('${escapeHtml(row.target_id)}')`");
    });

    it("renderMemberList checks 'image', not 'photo'", () => {
        const code = fnCode(js, 'function renderMemberList() {');
        expect(code).toContain("const isVideo = post.media_type !== 'image';");
        expect(code).not.toContain("'photo'");
    });

    it('owners: loaded from venue_owners, and they can delete at their venue', () => {
        expect(fnBody(js, 'async function checkOwnerAccess() {'))
            .toMatch(/\.from\('venue_owners'\)\s*\.select\('venue_id'\)\s*\.eq\('user_id', session\.user\.id\)/);
        expect(fnBody(js, 'function renderPostOptionsMain() {'))
            .toContain('(!!item && !!item.venue_id && ownedVenueIds.has(item.venue_id))');
    });

    it('flyers: resized, uploaded to the member prefix, recorded by add_venue_flyer', () => {
        const fn = fnBody(js, 'async function handleFlyerPick(event) {');
        expect(fn).toContain('downscaleImage(file, FLYER_MAX_PX, FLYER_QUALITY)');
        expect(js).toContain('const FLYER_MAX_PX = 1600;');
        expect(js).toContain('const FLYER_QUALITY = 0.85;');
        expect(fn).toContain('const path = `members/${currentUserId}/flyer-${Date.now()}.jpg`;');
        expect(fn).toContain("supabaseClient.rpc('add_venue_flyer', {");
        expect(fn.indexOf('.upload(path, blob')).toBeLessThan(fn.indexOf("rpc('add_venue_flyer'"));
        expect(fn).toContain('await loadVenuePageFeed();');
        expect(fnBody(js, "function reelsTileMarkup(item, { expanded = false, onTap = '' } = {}) {"))
            .toContain('<span class="flyer-badge" data-i18n="social.flyerBadge">Flyer</span>');
    });

    it("Jay's copy, verbatim", () => {
        const en = JSON.parse(read('i18n/en.json')).social;
        expect(en.ob1Title).toBe('See the vibe first');
        expect(en.ob1Body).toBe("Real 15-second clips from tonight's spots, so you know what it's like before you go.");
        expect(en.ob2Title).toBe('Your city, live');
        expect(en.ob2Body).toBe('Bars, restaurants and parties near you, on one map. Swipe through tonight, one place at a time.');
        expect(en.ob3Title).toBe('Discover the undiscovered');
        expect(en.ob3Body).toBe('Follow the places and people you love, and post your own Viibe in 15 seconds.');
        // An empty home feed is the normal state after 7am — it says so.
        expect(en.emptyFeedTitle).toBe('No live posts available right now');
        expect(fnBody(js, 'function renderFeedEmptyState() {'))
            .toContain("titleText = 'No live posts available right now';");
        expect(en.postLifetimeHint).toBe('The home feed and map clear every morning at 7am Pacific. This controls how long posts stay on venue pages; team posts and flyers stay.');
        // The HTML defaults match, so a missing translation still says it right.
        for (const k of ['ob1Title', 'ob1Body', 'ob2Title', 'ob2Body', 'ob3Title', 'ob3Body', 'postLifetimeHint', 'emptyFeedTitle']) {
            expect(html, k).toContain(`data-i18n="social.${k}">${en[k].replace(/&/g, '&amp;')}<`);
        }
    });
});

// ===========================================================================
// Client — behaviour (jsdom)
// ===========================================================================

let w, d;
const tick = () => new Promise(r => setTimeout(r, 0));

const UA = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
    androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};

function setDevice({ ua = UA.mac, coarse = false, mobile, standalone = false } = {}) {
    Object.defineProperty(w.navigator, 'userAgent', { get: () => ua, configurable: true });
    Object.defineProperty(w.navigator, 'userAgentData', {
        get: () => (mobile === undefined ? undefined : { mobile }), configurable: true,
    });
    w.matchMedia = q => ({
        matches: q.includes('pointer: coarse') ? coarse
            : q.includes('display-mode: standalone') ? standalone
            : false,
        addEventListener() {}, removeEventListener() {},
    });
}

beforeEach(async () => {
    // 'dangerously' + a real <script>, as viibeview-member-venues.test.js
    // explains: an indirect eval would hide social.js's top-level `let`s.
    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        url: 'https://royaltyapp.ai/customer-app/social.html?slug=viibeview',
    });
    w = dom.window;
    d = w.document;
    // A first-run intro would be the top surface in every back test.
    w.localStorage.setItem('viibeview_onboarded_v1', '1');
    setDevice();

    w.__session = null;
    w.__rpcCalls = [];
    w.__rpc = () => ({ data: null, error: null });
    const thenable = { then: (r) => r({ data: null, error: new Error('stubbed') }) };
    const chain = new Proxy(thenable, { get: (t, k) => (k in t ? t[k] : () => chain) });
    w.supabase = {
        createClient: () => ({
            auth: { getSession: async () => ({ data: { session: w.__session } }) },
            from: () => chain,
            rpc: (name, args) => {
                w.__rpcCalls.push({ name, args });
                return Promise.resolve(w.__rpc(name, args));
            },
            storage: { from: () => ({ upload: async () => ({}), getPublicUrl: () => ({ data: { publicUrl: '' } }), remove: async () => ({}) }) },
        }),
    };

    const load = rel => {
        const el = d.createElement('script');
        el.textContent = read(rel);
        d.body.appendChild(el);
    };
    load('js/venue-categories.js');
    load('js/music-genres.js');
    load('customer-app/social-auth.js');
    load('customer-app/social.js');

    // init() cannot reach a database here and would replace the body.
    w.showEmptyState = () => {};
    w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };

    await tick();
    w.eval("currentApp = { id: 'app-1', organization_id: 'org-1' };");

    // History spies. pushState is real (the guard reads history.state back);
    // back() is counted, not performed.
    w.__pushes = [];
    const realPush = w.history.pushState.bind(w.history);
    w.history.pushState = (state, title, url) => { w.__pushes.push(state); realPush(state, title, url); };
    w.__backs = 0;
    w.history.back = () => { w.__backs++; };
});

const visible = id => d.getElementById(id).classList.contains('visible');
const open = id => d.getElementById(id).classList.add('visible');
const gesture = () => d.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
const back = (state = null) => w.dispatchEvent(new w.PopStateEvent('popstate', { state }));

describe('back navigation (jsdom)', () => {
    it('⚠️ no guard before the first user gesture; exactly ONE after', async () => {
        open('venue-page');
        await tick();
        expect(w.__pushes.length, 'pushed before any gesture — Chrome would skip it').toBe(0);

        gesture();
        await tick();
        expect(w.__pushes.length).toBe(1);
        expect(w.history.state.viibeBackGuard).toBe(true);

        // A second surface does not stack a second entry.
        open('member-page');
        await tick();
        expect(w.__pushes.length).toBe(1);
    });

    it('back closes the top-most surface, re-arms, and finally leaves', async () => {
        gesture();
        open('venue-page');
        open('member-page');
        await tick();
        expect(w.__pushes.length).toBe(1);

        back();
        expect(visible('member-page'), 'the member page sits ABOVE the venue page').toBe(false);
        expect(visible('venue-page')).toBe(true);
        expect(w.__pushes.length, 'not re-armed with the venue page still open').toBe(2);

        back();
        await tick();
        expect(visible('venue-page')).toBe(false);
        expect(w.__pushes.length, 're-armed with nothing left to close').toBe(2);
        expect(w.__backs).toBe(0);

        // Nothing open, on Feed, in a browser tab: take the press the rest of the way.
        back();
        expect(w.__backs).toBe(1);
    });

    it('a popstate landing ON a guard entry is the forward button — ignored', async () => {
        gesture();
        open('venue-page');
        await tick();
        back({ viibeBackGuard: true });
        expect(visible('venue-page')).toBe(true);
    });

    it('leaving Feed arms it; back returns to Feed', async () => {
        gesture();
        w.eval("switchTab('search')");
        await tick();
        expect(w.__pushes.length).toBe(1);
        back();
        expect(w.eval('activeTab')).toBe('feed');
        expect(d.getElementById('tab-feed').classList.contains('active')).toBe(true);
    });

    it('installed app: back on a clean Feed warns first, and does NOT re-arm', async () => {
        setDevice({ standalone: true });
        gesture();
        await tick();
        expect(w.__pushes.length, 'standalone keeps a guard so it can warn').toBe(1);

        const toasts = [];
        w.showToast = m => toasts.push(m);
        back();
        expect(toasts).toEqual(['Press back again to exit']);
        expect(w.__pushes.length, 're-armed — the next press would warn forever').toBe(1);
        expect(w.__backs).toBe(0);
    });

    it('the composer with a clip asks "Discard this Viibe?"; back again only closes the dialog', async () => {
        gesture();
        w.eval("selectedPostFile = new File(['x'], 'a.mp4', { type: 'video/mp4' });");
        open('create-post-modal');
        await tick();

        back();
        expect(visible('confirm-dialog')).toBe(true);
        expect(d.getElementById('confirm-title').textContent).toBe('Discard this Viibe?');
        expect(visible('create-post-modal')).toBe(true);

        back();
        expect(visible('confirm-dialog'), 'closed through #confirm-cancel').toBe(false);
        expect(visible('create-post-modal'), 'cancelling the discard kept the composer').toBe(true);
    });

    it('auth steps back one view: forgot → login → splash → closed', async () => {
        gesture();
        w.eval("showAuth('forgot')");
        await tick();
        const shown = () => ['splash', 'login', 'signup', 'forgot', 'reset']
            .filter(v => d.getElementById(`auth-view-${v}`).style.display !== 'none');

        back();
        expect(shown()).toEqual(['login']);
        back();
        expect(shown()).toEqual(['splash']);
        back();
        expect(visible('auth-overlay')).toBe(false);
    });

    it('⚠️ the z-index ladder agrees with BACK_SURFACES, top first', () => {
        // Every rule's z-index, by selector. Combined selectors (`a,\nb {`)
        // count for each part.
        // Comments go FIRST: they hold commas, and splitting a selector list
        // on a comma inside a comment mangles the selector after it.
        const zBy = {};
        const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
        for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
            const z = /z-index:\s*(\d+)/.exec(m[2]);
            if (!z) continue;
            for (const sel of m[1].split(',').map(s => s.trim())) {
                zBy[sel] = Number(z[1]);
            }
        }
        const zOf = id => {
            if (zBy[`#${id}`] !== undefined) return zBy[`#${id}`];
            const el = d.getElementById(id);
            const classes = [...el.classList].map(c => `.${c}`).filter(c => zBy[c] !== undefined);
            expect(classes.length, `no z-index for #${id}`).toBeGreaterThan(0);
            return Math.max(...classes.map(c => zBy[c]));
        };

        const order = w.eval('BACK_SURFACES.map(s => s.id)');
        expect(order.length).toBeGreaterThan(10);
        const zs = order.map(zOf);
        for (let i = 1; i < zs.length; i++) {
            expect(zs[i], `${order[i]} (${zs[i]}) is above ${order[i - 1]} (${zs[i - 1]})`)
                .toBeLessThanOrEqual(zs[i - 1]);
        }

        // The four "opens behind" bugs, by name.
        expect(zOf('auth-overlay')).toBeGreaterThan(zOf('venue-page'));
        expect(zOf('auth-overlay')).toBeGreaterThan(zOf('member-page'));
        expect(zOf('post-options-sheet')).toBeGreaterThan(zOf('member-page'));
        expect(zOf('confirm-dialog')).toBeGreaterThan(zOf('member-page'));
        expect(zOf('edit-profile-sheet')).toBeGreaterThan(zOf('member-page'));
        expect(zBy['#confirm-backdrop']).toBeGreaterThan(zOf('create-post-modal'));
        expect(zOf('onboarding-overlay')).toBe(3500);
    });
});

describe('the Me tab (jsdom)', () => {
    const profile = over => ({ user_id: 'me-1', display_name: 'Pahkie', bio: null, location: null,
        avatar_url: null, post_count: 2, follower_count: 3, following_count: 0, is_private: false, ...over });
    const posts = [
        { id: 'p1', media_type: 'video', url: 'u1', thumbnail_url: 't1', venue_id: 'v1', uploaded_by_user_id: 'me-1' },
        { id: 'p2', media_type: 'video', url: 'u2', thumbnail_url: 't2', venue_id: null, uploaded_by_user_id: 'me-1' },
    ];

    it('signed out: the join prompt\'s buttons open the auth overlay', () => {
        // setupAuthListeners() normally runs inside init(), which cannot reach
        // a database here — call it directly, then click like a user.
        w.eval('setupAuthListeners()');
        d.getElementById('me-signup-btn').click();
        expect(visible('auth-overlay')).toBe(true);
        expect(d.getElementById('auth-view-signup').style.display).toBe('');
        w.eval('hideAuth()');
        d.getElementById('me-login-btn').click();
        expect(d.getElementById('auth-view-login').style.display).toBe('');
    });

    it('signed out: the join prompt, and no fetch', async () => {
        w.eval("switchTab('me')");
        await tick(); await tick();
        expect(d.getElementById('me-signed-out').style.display).toBe('');
        expect(d.getElementById('me-signed-in').style.display).toBe('none');
        expect(w.__rpcCalls.filter(c => c.name === 'get_member_posts')).toEqual([]);
    });

    it('signed in: identity, stats and grid — and a FRESH fetch on every open', async () => {
        w.__session = { user: { id: 'me-1' }, access_token: 'tok' };
        let following = 0;
        w.__rpc = (name) => name === 'get_member_profile' ? { data: [profile({ following_count: following })], error: null }
            : name === 'get_member_posts' ? { data: posts, error: null }
            : { data: null, error: null };

        w.eval("switchTab('me')");
        await tick(); await tick();
        expect(d.getElementById('me-signed-in').style.display).toBe('');
        expect(d.getElementById('me-name').textContent).toBe('Pahkie');
        expect(d.querySelectorAll('#me-grid .member-grid-tile').length).toBe(2);
        const stats = d.getElementById('me-stats');
        expect(stats.innerHTML).toContain("openPeopleSheet('following', 'me-1')");
        expect([...stats.querySelectorAll('.member-stat-value')].map(e => e.textContent)).toEqual(['2', '3', '0']);

        // The "0 Following" bug: a follow made elsewhere, then back to Me.
        following = 1;
        w.eval("switchTab('feed'); switchTab('me')");
        await tick(); await tick();
        expect(w.__rpcCalls.filter(c => c.name === 'get_member_profile').length).toBe(2);
        expect([...d.querySelectorAll('#me-stats .member-stat-value')].map(e => e.textContent)).toEqual(['2', '3', '1']);
    });

    it('your own member page shows Edit profile, not Follow', () => {
        w.eval("currentUserId = 'me-1'; memberPageUserId = 'me-1';");
        w.eval(`memberPageProfile = ${JSON.stringify(profile())}; renderMemberProfile();`);
        const btn = d.getElementById('member-page-follow-btn');
        expect(btn.style.display).toBe('');
        expect(btn.getAttribute('data-i18n')).toBe('social.editProfile');
        // ...and the follow repaint leaves it alone.
        w.eval('repaintFollowButtons()');
        expect(btn.getAttribute('data-i18n')).toBe('social.editProfile');
    });
});

describe('Search → Members (jsdom)', () => {
    it('lists members and never yourself', async () => {
        w.eval("currentUserId = 'me-1';");
        w.__rpc = (name) => name === 'discover_members' ? { data: [
            { target_type: 'user', target_id: 'me-1', name: 'Me Myself', avatar_url: null, subtitle: null },
            { target_type: 'user', target_id: 'u-2', name: 'Other Person', avatar_url: null, subtitle: null },
        ], error: null } : { data: null, error: null };

        w.eval("setSearchScope('members')");
        await tick();
        const rows = [...d.querySelectorAll('#search-results .people-row')];
        expect(rows.length).toBe(1);
        expect(rows[0].textContent).toContain('Other Person');
        expect(rows[0].getAttribute('onclick')).toContain("openMemberProfile('u-2')");
        expect(d.querySelector('.search-scope-btn[data-scope="members"]').classList.contains('active')).toBe(true);
    });

    it('a slower, older response never paints over a newer one', async () => {
        const pending = [];
        w.__rpc = (name, args) => new Promise(resolve => pending.push({ args, resolve }));
        w.eval("searchScope = 'members'; handleSearch('ol'); handleSearch('old');");
        await tick();
        expect(pending.length).toBe(2);
        const row = name => ({ data: [{ target_type: 'user', target_id: name, name, avatar_url: null }], error: null });
        pending[1].resolve(row('newer'));
        await tick();
        pending[0].resolve(row('older'));
        await tick();
        expect(d.getElementById('search-results').textContent).toContain('newer');
        expect(d.getElementById('search-results').textContent).not.toContain('older');
    });
});

describe('recorder helpers (jsdom tables)', () => {
    it('formatClock', () => {
        const f = n => w.eval(`formatClock(${JSON.stringify(n)})`);
        expect([0, 5, 15, 59, 60, 75, -3, 'x'].map(f))
            .toEqual(['0:00', '0:05', '0:15', '0:59', '1:00', '1:15', '0:00', '0:00']);
    });

    it('cropRectFor', () => {
        const c = (a, b) => w.eval(`cropRectFor(${a}, ${b})`);
        expect(c(720, 1280)).toBeNull();                       // already 9:16
        expect(c(1080, 1920)).toBeNull();
        expect(c(730, 1280)).toBeNull();                       // within 2%
        expect(c(1280, 720)).toEqual({ sx: 438, sy: 0, sw: 405, sh: 720 });   // landscape frame
        expect(c(480, 640)).toEqual({ sx: 60, sy: 0, sw: 360, sh: 640 });     // 3:4
        expect(c(1080, 2400)).toEqual({ sx: 0, sy: 240, sw: 1080, sh: 1920 }); // taller than 9:16
        expect(c(0, 0)).toBeNull();
        expect(c(null, 720)).toBeNull();
    });

    it('isPhoneDevice', () => {
        const cases = [
            [{ ua: UA.iphone }, true],
            [{ ua: UA.ipad, coarse: true }, false],
            [{ ua: UA.androidPhone, coarse: true }, true],
            [{ ua: UA.androidPhone, coarse: false }, false],   // spoofed UA, fine pointer
            [{ ua: UA.androidTablet, coarse: true }, false],   // no "Mobile"
            [{ ua: UA.mac }, false],
            [{ ua: UA.mac, mobile: true }, true],              // userAgentData says so
        ];
        for (const [device, expected] of cases) {
            setDevice(device);
            expect(w.eval('isPhoneDevice()'), JSON.stringify(device)).toBe(expected);
        }
    });

    it('⚠️ a desktop NEVER calls getUserMedia', async () => {
        w.__session = { user: { id: 'me-1' }, access_token: 'tok' };
        let calls = 0;
        Object.defineProperty(w.navigator, 'mediaDevices', {
            value: { getUserMedia: async () => { calls++; throw new Error('no camera in jsdom'); } },
            configurable: true,
        });
        w.showToast = () => {};

        setDevice({ ua: UA.mac });
        await w.eval('openCreatePost()');
        expect(d.getElementById('upload-desktop-block').style.display).toBe('flex');
        expect(d.getElementById('upload-placeholder').style.display).toBe('none');
        await w.eval('startCamera()');
        d.getElementById('upload-placeholder').click();
        await tick();
        expect(calls).toBe(0);

        // The same path on a phone does ask — so the zero above is the gate.
        setDevice({ ua: UA.iphone });
        await w.eval('startCamera()');
        expect(calls).toBeGreaterThan(0);
    });
});

describe('deletePost (jsdom)', () => {
    const p = (id, over = {}) => ({ id, media_type: 'video', url: `u-${id}`, thumbnail_url: `t-${id}`,
        venue_id: 'v1', uploaded_by_user_id: 'me-1', ...over });

    beforeEach(() => {
        w.__session = { user: { id: 'me-1' }, access_token: 'tok-123' };
        w.showToast = () => {};
        const lists = ['feedItems', 'venuePageFeed', 'postPins', 'memberPagePosts', 'mePosts'];
        w.eval(lists.map(l => `${l} = ${JSON.stringify([p('gone'), p('kept')])};`).join('\n'));
        w.eval(`memberPageUserId = 'me-1'; memberPageProfile = { user_id: 'me-1', post_count: 2 };
                meProfile = { user_id: 'me-1', post_count: 2 };`);
    });

    const lists = () => w.eval(`({ feedItems, venuePageFeed, postPins, memberPagePosts, mePosts })`);

    it('deletes through the edge function and clears all FIVE lists', async () => {
        const requests = [];
        w.fetch = async (url, init) => {
            requests.push({ url, init });
            return { ok: true, status: 200, json: async () => ({ success: true }) };
        };

        await w.eval("deletePost('gone')");

        expect(requests.length).toBe(1);
        expect(requests[0].url).toMatch(/\/functions\/v1\/delete-social-post$/);
        expect(requests[0].init.headers.Authorization).toBe('Bearer tok-123');
        expect(JSON.parse(requests[0].init.body)).toEqual({ media_id: 'gone' });

        const after = lists();
        for (const [name, list] of Object.entries(after)) {
            expect(list.map(i => i.id), name).toEqual(['kept']);
        }
        expect(w.eval('memberPageProfile.post_count')).toBe(1);
        expect(w.eval('meProfile.post_count')).toBe(1);
        // The RPC was not also called.
        expect(w.__rpcCalls.filter(c => c.name === 'delete_social_post')).toEqual([]);
    });

    it('a 404 (function not deployed) falls back to the RPC', async () => {
        w.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
        w.__rpc = (name) => name === 'delete_social_post' ? { data: [{ success: true, error_message: null }], error: null } : { data: null, error: null };
        await w.eval("deletePost('gone')");
        expect(w.__rpcCalls.filter(c => c.name === 'delete_social_post').map(c => c.args)).toEqual([{ p_media_id: 'gone' }]);
        expect(lists().mePosts.map(i => i.id)).toEqual(['kept']);
    });

    it('a refusal (403) removes NOTHING and says why', async () => {
        const toasts = [];
        w.showToast = m => toasts.push(m);
        w.fetch = async () => ({ ok: false, status: 403, json: async () => ({ success: false, error: 'You can only delete your own posts' }) });
        await w.eval("deletePost('gone')");
        expect(toasts).toEqual(['You can only delete your own posts']);
        for (const [name, list] of Object.entries(lists())) {
            expect(list.map(i => i.id), name).toEqual(['gone', 'kept']);
        }
        expect(w.__rpcCalls.filter(c => c.name === 'delete_social_post')).toEqual([]);
    });

    it('a venue owner sees Delete on a post at their venue', () => {
        w.eval(`isOwner = false; currentUserId = 'someone-else'; ownedVenueIds = new Set(['v1']); optionsMediaId = 'gone';`);
        w.eval('renderPostOptionsMain()');
        expect(d.getElementById('post-options-body').innerHTML).toContain('confirmDeletePost()');
        w.eval(`ownedVenueIds = new Set(['v2']); renderPostOptionsMain();`);
        expect(d.getElementById('post-options-body').innerHTML).not.toContain('confirmDeletePost()');
    });
});
