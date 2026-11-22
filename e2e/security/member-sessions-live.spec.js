/**
 * E2E: member sessions (20261122000002) — LIVE against Royalty PRODUCTION, as anon.
 *
 * ⚠️ UNGATED ON PURPOSE, like phase-a-anon-grants.spec.js: only the published anon key,
 * no sign-in, no writes, no email sent. Run: npx playwright test e2e/security/member-sessions-live.spec.js --project=chromium
 *
 *   42501     = closed to anon (what every new function must answer)
 *   PGRST202  = PROVES NOTHING: the function is missing or the argument names are wrong
 *
 * Edge-function probes pick inputs that stop before any side effect (org-invite-send: 401 before the body is read):
 *   member-code send   with the nil app id      → 404 app_not_found (no code issued, no email)
 *   member-code verify with no code ever issued → 410 expired (no row, nothing counted)
 *   royal-ai-recommend as anon                  → 401/403 before the AI switch is read
 *
 * 🔴 Never run the royal-ai-recommend probes against a version deployed before 2026-11-22:
 *    that version has no caller check, and the empty-body call runs Claude for EVERY eligible
 *    org (it was only harmless on 11-22 because the AI switch was off while credits were out).
 */

import { test, expect } from '@playwright/test';

const SUPABASE_URL = 'https://vhpmmfhfwnpmavytoomd.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZocG1tZmhmd25wbWF2eXRvb21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1OTgyMDYsImV4cCI6MjA4NTE3NDIwNn0.6JmfnTTR8onr3ZgFpzdZa4BbVBraUyePVEUHOJgxmuk';
const NIL = '00000000-0000-0000-0000-000000000000';
const HASH = '0'.repeat(64);
const headers = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' };

async function rpc(request, fn, body) {
    const res = await request.post(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { headers, data: body, failOnStatusCode: false });
    let json = null;
    try { json = await res.json(); } catch { /* no body */ }
    return { status: res.status(), code: json?.code ?? null, json };
}

async function fn(request, name, body) {
    const res = await request.post(`${SUPABASE_URL}/functions/v1/${name}`, { headers, data: body, failOnStatusCode: false });
    let json = null;
    try { json = await res.json(); } catch { /* no body */ }
    return { status: res.status(), json };
}

const SESSION_ONLY = [
    ['join_app',                        { p_app_id: NIL, p_first_name: 'x', p_last_name: null, p_phone: null, p_timezone: null }],
    ['check_in',                        { p_app_id: NIL }],
    ['member_get_profile',              { p_app_id: NIL }],
    ['member_get_activity',             { p_app_id: NIL, p_limit: 1 }],
    ['member_redeem_reward',            { p_app_id: NIL, p_reward_id: NIL }],
    ['member_submit_reward_suggestion', { p_app_id: NIL, p_reward_name: 'xx', p_description: null, p_suggested_points: null }],
    ['member_get_tickets',              { p_app_id: NIL }],
    ['member_get_unread_count',         { p_app_id: NIL }],
    ['member_get_ticket_messages',      { p_ticket_id: NIL }],
    ['member_get_ticket_ai_history',    { p_ticket_id: NIL }],
    ['member_reply_to_ticket',          { p_ticket_id: NIL, p_message: 'x' }],
    ['member_update_profile',           { p_app_id: NIL, p_first_name: 'x', p_last_name: null, p_phone: null }],
];

const SERVICE_ONLY = [
    ['member_code_issue',   { p_app_id: NIL, p_email: 'probe@example.invalid', p_code_hash: HASH, p_ip: null }],
    ['member_code_check',   { p_app_id: NIL, p_email: 'probe@example.invalid', p_code_hash: HASH }],
    ['app_setting_int',     { p_settings: {}, p_keys: ['a'], p_default: 1, p_min: 0, p_max: 2 }],
    ['member_tz',           { p_tz: 'UTC' }],
    ['new_redemption_code', {}],
    ['member_ticket_owner', { p_ticket_id: NIL }],
];

// B2 (20261122000003): counter redemption.
const B2_SESSION_ONLY = [
    ['lookup_redemption',      { p_code: 'ZZZZZZZZ' }],
    ['fulfill_redemption',     { p_code: 'ZZZZZZZZ' }],
    ['counter_summary',        { p_app_id: NIL, p_since: '2026-01-01T00:00:00Z' }],
    ['member_get_redemptions', { p_app_id: NIL }],
];
const B2_SERVICE_ONLY = [
    ['staff_manages_app',         { p_app_id: NIL }],
    ['normalize_redemption_code', { p_code: 'x' }],
    ['redemption_view',           { p_id: NIL, p_result: 'x' }],
];

test.describe('B1a + B2 — member and counter functions refuse anon', () => {
    for (const [name, body] of [...SESSION_ONLY, ...SERVICE_ONLY, ...B2_SESSION_ONLY, ...B2_SERVICE_ONLY]) {
        test(`${name} → 42501 for anon`, async ({ request }) => {
            const { code, json } = await rpc(request, name, body);
            expect(code, `${name} answered ${JSON.stringify(json)}`).toBe('42501');
        });
    }
});

test.describe('B1a — member-code and royal-ai-recommend at the door', () => {
    test('member-code rejects a malformed request', async ({ request }) => {
        const { status, json } = await fn(request, 'member-code', {});
        expect(status).toBe(400);
        expect(json?.success).toBe(false);
    });

    test('member-code send for an app that does not exist: 404, nothing issued', async ({ request }) => {
        const { status, json } = await fn(request, 'member-code', { action: 'send', app_id: NIL, email: 'probe@example.invalid' });
        expect(status).toBe(404);
        expect(json?.code).toBe('app_not_found');
    });

    test('member-code verify with no code issued: 410 expired, no token', async ({ request }) => {
        const { status, json } = await fn(request, 'member-code', { action: 'verify', app_id: NIL, email: 'probe@example.invalid', code: '000000' });
        expect(status).toBe(410);
        expect(json?.code).toBe('expired');
        expect(json?.token_hash).toBeUndefined();
    });

    test('royal-ai-recommend cron mode (every org) refuses the anon key', async ({ request }) => {
        const { status } = await fn(request, 'royal-ai-recommend', {});
        expect(status).toBe(403);
    });

    test('royal-ai-recommend on-demand refuses a caller who is not signed in', async ({ request }) => {
        const { status } = await fn(request, 'royal-ai-recommend', { organization_id: NIL });
        expect(status).toBe(401);
    });
});

// Staff invitations (20261122000006, org-invite-send). The lookup is anon by design: the accept page
// shows the invite before anyone signs in, and a token is a random uuid only the invitee's email has.
const INVITE_CLOSED = [
    ['accept_org_invitation', { p_token: 'probe-probe-probe-probe-probe' }],
    ['org_invite_claim_send', { p_invitation_id: NIL, p_caller: NIL }],
];

test.describe('Invites — accept and the send gate refuse anon; a bogus token reveals nothing', () => {
    for (const [name, body] of INVITE_CLOSED) {
        test(`${name} → 42501 for anon`, async ({ request }) => {
            const { code, json } = await rpc(request, name, body);
            expect(code, `${name} answered ${JSON.stringify(json)}`).toBe('42501');
        });
    }

    test('get_org_invitation with a bogus token: {status: invalid} and nothing else', async ({ request }) => {
        const { status, json } = await rpc(request, 'get_org_invitation', { p_token: 'probe-probe-probe-probe-probe' });
        expect(status).toBe(200);
        expect(json).toEqual({ status: 'invalid' });
    });

    test('org-invite-send refuses a caller who is not signed in, before reading anything', async ({ request }) => {
        const { status, json } = await fn(request, 'org-invite-send', { invitation_id: NIL });
        expect(status).toBe(401);
        expect(json?.code).toBe('not_signed_in');
    });
});

// Member-limit functions (20261122000008). Before it they answered anon with any org's customer count
// and cap (probe: the nil org). After it: service_role only, and the dashboard's warning goes through
// org_member_usage, which is authenticated-only (PGRST202 before the migration: it didn't exist).
const MEMBER_LIMIT_CLOSED = [
    ['get_org_member_limit', { p_org_id: NIL }],
    ['count_org_members', { p_org_id: NIL }],
    ['check_member_limit', { p_org_id: NIL }],
    ['org_member_usage', { p_org_id: NIL }],
];

test.describe('Member limits — no org\'s customer count or cap for anon', () => {
    for (const [name, body] of MEMBER_LIMIT_CLOSED) {
        test(`${name} → 42501 for anon`, async ({ request }) => {
            const { code, json } = await rpc(request, name, body);
            expect(code, `${name} answered ${JSON.stringify(json)}`).toBe('42501');
            // The EXECUTE check itself, not something the body raised for the nil id.
            expect(json?.message).toMatch(new RegExp(`permission denied for function ${name}`));
        });
    }
});
