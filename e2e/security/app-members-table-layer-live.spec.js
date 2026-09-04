/**
 * E2E: app_members table layer — LIVE against Royalty PRODUCTION, signed in.
 *
 * Run it with the wrapper, which fails loudly when the credentials are missing:
 *   npm run test:table-layer:live
 *
 * Gated, unlike its sibling phase-a-anon-grants.spec.js, only because it needs a
 * real session. The anon half is ungated on purpose and covers the part that can
 * be checked without credentials.
 *
 * ⚠️ Why this suite exists. Before 20260904000007, a signed-in ViibeView member
 * could PATCH /rest/v1/app_members and every column answered HTTP 204 — including
 * points_balance, tier, pin_hash and auth_token. 204, not 42501, means the column
 * privilege check PASSED and only the RLS row filter (user_id = auth.uid()) kept
 * the write to zero rows. On their OWN row every one of those writes would have
 * landed. That made all eleven RPC revokes of 20260904000005/6 cosmetic.
 *
 * Every probe below targets id=eq.<nil uuid>, so ZERO rows are touched whatever
 * the result. Read-only in effect.
 *
 * It asserts BOTH directions:
 *   CLOSED — sensitive columns now 42501 for a client role.
 *   OPEN   — 🔴 the owner dashboard still works. app/venues.html:1710 needs
 *            UPDATE(deleted_at, user_id) and app/dashboard.js:872 needs SELECT
 *            on EVERY column for its select('*', {count:'exact'}).
 */

import { test, expect } from '@playwright/test';

const SUPABASE_URL = 'https://vhpmmfhfwnpmavytoomd.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZocG1tZmhmd25wbWF2eXRvb21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1OTgyMDYsImV4cCI6MjA4NTE3NDIwNn0.6JmfnTTR8onr3ZgFpzdZa4BbVBraUyePVEUHOJgxmuk';

const NIL = '00000000-0000-0000-0000-000000000000';
const VIIBEVIEW_APP_ID = '6119865e-83f8-4731-b320-8ea705a2ac18';

const EMAIL = process.env.VIIBEVIEW_TEST_EMAIL;
const PASSWORD = process.env.VIIBEVIEW_TEST_PASSWORD;

// The wrapper exits 1 when these are missing, so reaching a skip here means
// somebody ran playwright directly. Say so rather than reporting green.
test.skip(!EMAIL || !PASSWORD,
    'VIIBEVIEW_TEST_EMAIL / _PASSWORD not set — run `npm run test:table-layer:live`');

let jwt = null;

test.beforeAll(async ({ request }) => {
    const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
        data: { email: EMAIL, password: PASSWORD },
        failOnStatusCode: false,
    });
    const json = await res.json().catch(() => null);
    jwt = json?.access_token ?? null;
    expect(jwt, `sign-in failed for ${EMAIL}: ${JSON.stringify(json)}`).toBeTruthy();
});

const authed = () => ({
    apikey: ANON_KEY,
    Authorization: `Bearer ${jwt}`,
    'Content-Type': 'application/json',
});

async function patch(request, data) {
    const res = await request.patch(`${SUPABASE_URL}/rest/v1/app_members?id=eq.${NIL}`, {
        headers: authed(), data, failOnStatusCode: false,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status(), code: json?.code ?? null, json };
}

test.describe('the session is real', () => {
    // ⚠️ MUST RUN FIRST IN SPIRIT: a dead or unauthenticated JWT 401s on
    // everything, and then every "CLOSED" assertion below passes for entirely
    // the wrong reason. Prove the session reaches a member row before trusting
    // a single denial.
    test('get_social_member returns this member row', async ({ request }) => {
        const res = await request.post(`${SUPABASE_URL}/rest/v1/rpc/get_social_member`, {
            headers: authed(),
            data: { p_app_id: VIIBEVIEW_APP_ID },
            failOnStatusCode: false,
        });
        const json = await res.json().catch(() => null);

        expect(res.status(), 'the JWT is not a working session — every other ' +
            'assertion in this file is worthless').toBe(200);
        expect(Array.isArray(json) && json.length,
            'expected a 1-element array; got ' + JSON.stringify(json)).toBeTruthy();
        expect(json[0].email).toBe(EMAIL);
    });
});

test.describe('a signed-in member cannot write sensitive columns', () => {
    // The full set the migration's post-flight asserts, so the DB-side and
    // HTTP-side checks cannot drift apart.
    const SENSITIVE = [
        ['points_balance', 999999],
        ['total_points_earned', 999999],
        ['total_points_redeemed', 999999],
        ['tier', 'platinum'],
        ['pin_hash', 'probe'],
        ['pin_hash_version', 'probe'],
        ['auth_token', 'probe'],
        ['email', 'probe@example.invalid'],
        ['phone', '+10000000000'],
        ['app_id', NIL],
        ['customer_id', NIL],
        ['referral_code', 'PROBE'],
        ['profile_public', true],
        ['display_name', 'probe'],
        ['avatar_url', 'https://example.invalid/a.png'],
    ];

    for (const [col, value] of SENSITIVE) {
        test(`PATCH ${col} is denied (42501)`, async ({ request }) => {
            const { status, code, json } = await patch(request, { [col]: value });

            // 204 here is the pre-migration behaviour: the column grant existed
            // and only the RLS row filter kept it to zero rows. On the member's
            // own row it would have landed.
            expect(status, `${col}: 204 means the column privilege check PASSED. ` +
                `On this member's OWN row the write would succeed, and every RPC ` +
                `revoke in 20260904000005/6 is cosmetic.`).not.toBe(204);

            expect(code, `${col} is still writable by a client role: ` +
                JSON.stringify(json)).toBe('42501');
        });
    }
});

test.describe('🔴 the owner dashboard still works', () => {
    // app/venues.html:1709-1712 removeMember() — the ONLY direct client UPDATE
    // on this table in the repo. 20260904000007 §4 grants back exactly these two
    // columns; if either is missing, removing a member from the owner dashboard
    // 42501s.
    test('UPDATE(deleted_at) is still granted', async ({ request }) => {
        const { status, code } = await patch(request, { deleted_at: '2026-09-04T00:00:00Z' });
        expect(code, 'authenticated LOST UPDATE(deleted_at) — app/venues.html:1710 ' +
            'removeMember() is bricked').not.toBe('42501');
        expect(status).toBe(204);
    });

    test('UPDATE(user_id) is still granted', async ({ request }) => {
        const { status, code } = await patch(request, { user_id: null });
        expect(code, 'authenticated LOST UPDATE(user_id) — app/venues.html:1711 ' +
            'removeMember() is bricked').not.toBe('42501');
        expect(status).toBe(204);
    });

    test('the exact removeMember payload {deleted_at, user_id} is accepted', async ({ request }) => {
        // Both columns in ONE statement, as the dashboard actually sends it. A
        // per-column grant can pass individually and still fail combined.
        const { status, code } = await patch(request,
            { deleted_at: '2026-09-04T00:00:00Z', user_id: null });
        expect(code).not.toBe('42501');
        expect(status).toBe(204);
    });

    // ⚠️ NEVER column-restrict SELECT on app_members. dashboard.js:872-873 does
    // select('*', { count: 'exact', head: true }), which needs SELECT on every
    // column — a grant that omits one turns the member count into a 42501.
    test("dashboard.js select('*') with an exact count still works", async ({ request }) => {
        const res = await request.get(
            `${SUPABASE_URL}/rest/v1/app_members?select=*&app_id=eq.${VIIBEVIEW_APP_ID}&deleted_at=is.null`, {
                headers: { ...authed(), Prefer: 'count=exact' },
                failOnStatusCode: false,
            });
        expect(res.status(), "select('*') on app_members is denied — the owner " +
            'dashboard member count is broken. SELECT must never be ' +
            'column-restricted on this table.').toBe(200);
        expect(res.headers()['content-range']).toBeTruthy();
    });

    test('the venues.html member-list projection still works', async ({ request }) => {
        const cols = 'id,first_name,last_name,display_name,email,phone,avatar_url,user_id,joined_at,last_login_at';
        const res = await request.get(
            `${SUPABASE_URL}/rest/v1/app_members?select=${cols}&app_id=eq.${VIIBEVIEW_APP_ID}&deleted_at=is.null`, {
                headers: authed(), failOnStatusCode: false,
            });
        expect(res.status(), 'app/venues.html:1612 member list is broken').toBe(200);
    });
});

test.describe('a signed-in member cannot INSERT or DELETE memberships', () => {
    test('INSERT into a published app is denied', async ({ request }) => {
        const res = await request.post(`${SUPABASE_URL}/rest/v1/app_members`, {
            headers: { ...authed(), Prefer: 'return=minimal' },
            data: { app_id: VIIBEVIEW_APP_ID, email: 'probe@example.invalid', referred_by: NIL },
            failOnStatusCode: false,
        });
        const json = await res.json().catch(() => null);
        // 23503 would mean RLS passed and only the deliberate FK stopped the row.
        expect(json?.code, 'a member reached the INSERT path: ' + JSON.stringify(json))
            .not.toBe('23503');
        expect([401, 403]).toContain(res.status());
    });

    test('DELETE is denied', async ({ request }) => {
        const res = await request.delete(
            `${SUPABASE_URL}/rest/v1/app_members?id=eq.${NIL}`, {
                headers: authed(), failOnStatusCode: false,
            });
        // No DELETE policy matches a member, so this must not report success.
        expect(res.status()).not.toBe(200);
    });
});
