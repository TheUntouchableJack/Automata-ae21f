/**
 * E2E: Phase A grants — LIVE against Royalty PRODUCTION, as anon.
 *
 * ⚠️ UNGATED ON PURPOSE. No credentials, no writes, no sign-in — just the anon
 * key that is already published in customer-app/social.js:8. This is the only
 * artefact that proves the holes are actually closed in prod rather than merely
 * closed in a migration file, and gating it behind an env var is exactly how a
 * green suite that never ran gets shipped (baf7dab, and the
 * "a skipped test cannot report its own breakage" lesson).
 *
 * It asserts BOTH directions, and the second is the one that protects
 * royaltyapp.ai:
 *
 *   CLOSED — the 11 functions revoked by 20260904000005/6 answer 42501.
 *   OPEN   — the 8 functions live pages depend on still answer. Revoking any of
 *            them would switch off the loyalty app or the /a/:slug join page.
 *
 * Probe technique (from the 20260904000004 header): call with the nil UUID so
 * the call can only ever abort.
 *
 *   42501             = CLOSED, permission checked before the body ran
 *   200 / body error  = OPEN (23502, 22P02, P0001, 42702, 22023, …)
 *   PGRST202          = PROVES NOTHING — wrong argument NAMES. PostgREST
 *                       resolves overloads by key, so a typo in this file would
 *                       otherwise read as a successful revoke.
 *   401 (bad apikey)  = proves nothing
 */

import { test, expect } from '@playwright/test';

const SUPABASE_URL = 'https://vhpmmfhfwnpmavytoomd.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZocG1tZmhmd25wbWF2eXRvb21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1OTgyMDYsImV4cCI6MjA4NTE3NDIwNn0.6JmfnTTR8onr3ZgFpzdZa4BbVBraUyePVEUHOJgxmuk';

const NIL = '00000000-0000-0000-0000-000000000000';
const VIIBEVIEW_APP_ID = '6119865e-83f8-4731-b320-8ea705a2ac18';

async function rpc(request, fn, body) {
    const res = await request.post(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        headers: {
            apikey: ANON_KEY,
            Authorization: `Bearer ${ANON_KEY}`,
            'Content-Type': 'application/json',
        },
        data: body,
        failOnStatusCode: false,
    });
    let json = null;
    try { json = await res.json(); } catch { /* 204 has no body */ }
    return { status: res.status(), code: json?.code ?? null, json };
}

// ---------------------------------------------------------------------------
// CLOSED: revoked 2026-09-04. Each was verified reaching its body beforehand.
// ---------------------------------------------------------------------------
const CLOSED = [
    ['update_member_setting',            { p_member_id: NIL, p_key: 'x', p_value: 'y' }],
    ['save_fcm_token',                   { p_member_id: NIL, p_fcm_token: 'x' }],
    ['clear_fcm_token',                  { p_member_id: NIL }],
    ['create_ticket_from_ai_chat',       { p_app_id: NIL, p_member_id: NIL, p_session_id: NIL,
                                           p_subject: 'x', p_description: 'x', p_escalation_reason: null }],
    ['get_ticket_messages_for_customer', { p_ticket_id: NIL, p_member_id: NIL }],
    ['get_ticket_ai_history',            { p_ticket_id: NIL, p_member_id: NIL }],
    ['upgrade_pin_to_bcrypt',            { p_member_id: NIL, p_pin: '0000' }],
    ['hash_pin_bcrypt',                  { p_pin: '0000' }],
    ['verify_pin_bcrypt',                { p_pin: '0000', p_hash: 'x' }],
    ['verify_pin_legacy_sha256',         { p_pin: '0000', p_hash: 'x' }],
    ['verify_app_member_login',          { p_app_id: NIL, p_email: 'x@y.invalid',
                                           p_phone: null, p_pin: '0000' }],
];

// ---------------------------------------------------------------------------
// 🔴 OPEN: royaltyapp.ai functionality. These must NOT be revoked.
// ---------------------------------------------------------------------------
const MUST_STAY_OPEN = [
    ['get_member_profile',       { p_member_id: NIL },                                'loyalty app.html:2817'],
    ['get_member_activity',      { p_member_id: NIL, p_limit: 1 },                    'loyalty app.html:2953'],
    ['redeem_reward',            { p_app_id: NIL, p_member_id: NIL, p_reward_id: NIL }, 'loyalty app.html:4563'],
    ['submit_reward_suggestion', { p_app_id: NIL, p_member_id: NIL, p_reward_name: 'x',
                                   p_description: null, p_suggested_points: null, p_category: null },
                                                                                       'loyalty app.html'],
    ['get_my_tickets',           { p_member_id: NIL, p_app_id: NIL },                 'loyalty app.html'],
    ['get_customer_unread_count',{ p_member_id: NIL, p_app_id: NIL },                 'loyalty app.html'],
    ['customer_reply_to_ticket', { p_ticket_id: NIL, p_member_id: NIL, p_message: 'x' }, 'loyalty app.html'],
    ['customer_app_signup',      { p_app_id: NIL, p_first_name: 'x', p_last_name: 'x',
                                   p_email: 'probe@example.invalid', p_phone: null, p_pin_hash: null },
                                                                                       '/a/:slug join page, index.html:2519'],
];

test.describe('Phase A — the anon key cannot reach the revoked member surface', () => {
    for (const [fn, body] of CLOSED) {
        test(`${fn} is revoked (42501)`, async ({ request }) => {
            const { status, code, json } = await rpc(request, fn, body);

            // ⚠️ Assert the SQLSTATE, never just the status. A 404/PGRST202 from
            // a typo in the argument names above is not a revoke, and checking
            // only for "not 200" would let that pass as a fix forever.
            expect(code, `${fn}: PGRST202 means the ARGUMENT NAMES in this spec are ` +
                `wrong, not that the function is revoked. Fix the probe. Got: ` +
                JSON.stringify(json)).not.toBe('PGRST202');

            expect(status, `${fn}: expected a permission denial`).not.toBe(200);
            expect(code, `${fn} is still reachable by anon — got ${status} ${JSON.stringify(json)}`)
                .toBe('42501');
        });
    }
});

test.describe('🔴 Phase A — royaltyapp.ai functionality is intact', () => {
    for (const [fn, body, where] of MUST_STAY_OPEN) {
        test(`${fn} still answers anon (${where})`, async ({ request }) => {
            const { status, code, json } = await rpc(request, fn, body);

            expect(code, `${fn}: PGRST202 — this probe's argument names are wrong, ` +
                `so it proves nothing either way. Got: ${JSON.stringify(json)}`)
                .not.toBe('PGRST202');

            // A body error is fine and expected (nil ids); 42501 is not.
            expect(code, `${fn} has been REVOKED and ${where} is now broken. ` +
                `Phase A was explicitly scoped to leave this open — see ` +
                `20260904000005's functionality guard.`)
                .not.toBe('42501');
        });
    }
});

test.describe('Phase A — ViibeView is untouched', () => {
    // Positive controls in the same file as the revoke assertions, so a dead or
    // rotated anon key fails both halves visibly instead of turning every
    // "CLOSED" assertion green for the wrong reason.
    test('get_app_by_slug(viibeview) returns the app', async ({ request }) => {
        const { status, json } = await rpc(request, 'get_app_by_slug', { p_slug: 'viibeview' });
        expect(status, 'the anon key itself is broken — every other result in ' +
            'this file is meaningless').toBe(200);
        expect(Array.isArray(json) && json.length).toBeTruthy();
        expect(json[0].slug).toBe('viibeview');
    });

    test('get_venue_feed returns rows', async ({ request }) => {
        const { status, json } = await rpc(request, 'get_venue_feed', { p_app_id: VIIBEVIEW_APP_ID });
        expect(status).toBe(200);
        expect(Array.isArray(json)).toBe(true);
    });

    // 🔴 THE OVERLOAD SPLIT. get_member_profile has a 1-arg loyalty form and a
    // 2-arg ViibeView form. A bare-name revoke would take both, and the ViibeView
    // failure is SILENT — social.js:660 destructures { data } and never inspects
    // error, so every profile overlay would just render blank.
    test('the 2-arg ViibeView get_member_profile overload still answers anon', async ({ request }) => {
        const { status, code, json } = await rpc(request, 'get_member_profile',
            { p_app_id: VIIBEVIEW_APP_ID, p_user_id: NIL });

        expect(code, 'PGRST202 — the 2-arg overload was not resolved, so this ' +
            'assertion proves nothing').not.toBe('PGRST202');
        expect(code, 'anon LOST EXECUTE on get_member_profile(UUID, UUID). Every ' +
            'ViibeView profile overlay is now blank, and silently. Fix: GRANT ' +
            'EXECUTE ON FUNCTION public.get_member_profile(UUID, UUID) TO anon, ' +
            'authenticated;').not.toBe('42501');
        expect(status).toBe(200);
    });
});

test.describe('Phase A — previously-closed holes stay closed', () => {
    // Regression controls for the two revokes that came before this batch.
    const PRIOR = [
        ['award_points',        { p_app_id: NIL, p_member_id: NIL, p_points: 1,
                                  p_type: 'x', p_description: 'x', p_metadata: {} }, '20260904000004'],
        ['record_member_visit', { p_app_id: NIL, p_member_id: NIL },                 '20260903000005'],
    ];

    for (const [fn, body, migration] of PRIOR) {
        test(`${fn} is still revoked (${migration})`, async ({ request }) => {
            const { code } = await rpc(request, fn, body);
            expect(code).toBe('42501');
        });
    }
});

test.describe('Phase A — app_members is not writable by anon', () => {
    // The table layer. Before 20260904000007 an anon INSERT against a REAL
    // published app returned 23503 (a FK error) — meaning RLS had already
    // passed and, without the deliberate FK violation, the row would have been
    // created. Every RPC revoke above is cosmetic if this one regresses.
    //
    // ⚠️ Must use a REAL published app id. With a nil app_id the roleless
    // "Public can join published apps" policy fails its OWN is_published check
    // and returns 42501 — which looks like a pass and proves nothing.
    test('anon cannot INSERT a membership into a published app', async ({ request }) => {
        const res = await request.post(`${SUPABASE_URL}/rest/v1/app_members`, {
            headers: {
                apikey: ANON_KEY,
                Authorization: `Bearer ${ANON_KEY}`,
                'Content-Type': 'application/json',
                Prefer: 'return=minimal',
            },
            data: { app_id: VIIBEVIEW_APP_ID, email: 'probe@example.invalid', referred_by: NIL },
            failOnStatusCode: false,
        });
        const json = await res.json().catch(() => null);

        expect(json?.code, 'anon reached the app_members INSERT path — it can mint ' +
            'memberships in any published app. 23503 here means RLS PASSED and only ' +
            'the deliberate FK violation stopped the row.').toBe('42501');
    });

    test('anon cannot UPDATE points_balance', async ({ request }) => {
        const res = await request.patch(
            `${SUPABASE_URL}/rest/v1/app_members?id=eq.${NIL}`, {
                headers: {
                    apikey: ANON_KEY,
                    Authorization: `Bearer ${ANON_KEY}`,
                    'Content-Type': 'application/json',
                },
                data: { points_balance: 999999 },
                failOnStatusCode: false,
            });
        const json = await res.json().catch(() => null);
        expect(json?.code).toBe('42501');
    });
});
