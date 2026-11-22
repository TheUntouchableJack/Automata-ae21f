/**
 * Loyalty members get real sessions; check-in works again (plan royalty-in-store-loop, B1a, 2026-11-22).
 *
 * Before: a member was an app_members.id in localStorage, and the RPCs behind the customer app
 * took that id from the caller (anyone who learned it could spend the points). QR check-in was
 * revoked; PIN login had been broken since March. Now a member signs in with an emailed code
 * (member-code edge function → verifyOtp) and every member RPC keys on auth.uid().
 *
 * These tests pin:
 *   - the migration's grants: 12 member functions authenticated-only, 6 helpers service_role-only;
 *   - that no new member function takes a member id, and every one reads auth.uid();
 *   - the client↔SQL contract: every RPC the customer app calls exists with those argument names
 *     (PostgREST resolves by NAME, so a renamed argument is a PGRST202 in production);
 *   - that the customer app no longer calls any member-id RPC or stores app_member_id;
 *   - both pages share one non-default auth storageKey;
 *   - member-code: the auth user is created only after the code checks out, the email escapes the
 *     business name, the code never comes back in a response;
 *   - royal-ai-recommend checks its caller before any AI work.
 * Behaviour (limits, streaks, linking, lockouts) is tested on PGlite in the round's bench:
 * ~/Documents/Design Benches/royalty-in-store-loop-2026-11-22/pglite/run.mjs (120 checks).
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  EMAIL_TEXT, LANGS, codeEmail, escapeHtml, fromName, hmacHex, pickLang, safeColor, sixDigits,
} from '../../supabase/functions/_shared/member-code.ts'

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const MIGRATION = read('supabase/migrations/20261122000002_member_sessions_checkin.sql')
const INDEX = read('customer-app/index.html')
const APP = read('customer-app/app.html')
const FN = read('supabase/functions/member-code/index.ts')
const RECOMMEND = read('supabase/functions/royal-ai-recommend/index.ts')

const MEMBER_FNS = {
  join_app: ['p_app_id', 'p_first_name', 'p_last_name', 'p_phone', 'p_timezone'],
  check_in: ['p_app_id'],
  member_get_profile: ['p_app_id'],
  member_get_activity: ['p_app_id', 'p_limit'],
  member_redeem_reward: ['p_app_id', 'p_reward_id'],
  member_submit_reward_suggestion: ['p_app_id', 'p_reward_name', 'p_description', 'p_suggested_points'],
  member_get_tickets: ['p_app_id'],
  member_get_unread_count: ['p_app_id'],
  member_get_ticket_messages: ['p_ticket_id'],
  member_get_ticket_ai_history: ['p_ticket_id'],
  member_reply_to_ticket: ['p_ticket_id', 'p_message'],
  member_update_profile: ['p_app_id', 'p_first_name', 'p_last_name', 'p_phone'],
}
const INTERNAL_FNS = ['member_code_issue', 'member_code_check', 'app_setting_int', 'member_tz',
  'new_redemption_code', 'member_ticket_owner']

// The member-id RPCs B1b will revoke, plus the dead PIN/visit paths. None may stay in the client.
const OLD_MEMBER_RPCS = ['redeem_reward', 'get_member_profile', 'get_member_activity', 'submit_reward_suggestion',
  'get_my_tickets', 'get_customer_unread_count', 'customer_reply_to_ticket', 'record_member_visit',
  'get_ticket_messages_for_customer', 'get_ticket_ai_history', 'update_member_profile',
  'customer_app_signup', 'verify_app_member_login']

// The full CREATE ... $$; text of one function.
function fnBody(name) {
  const start = MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  expect(start, `${name} is defined`).toBeGreaterThan(-1)
  const open = MIGRATION.indexOf('$$', start)
  const close = MIGRATION.indexOf('$$;', open + 2)
  return MIGRATION.slice(start, close + 3)
}
function fnArgs(name) {
  const body = fnBody(name)
  const head = body.slice(body.indexOf('(') + 1, body.indexOf('\nRETURNS'))
  return [...head.matchAll(/\b(p_[a-z_]+)\s+[A-Z]/g)].map((m) => m[1])
}
// .rpc('name', { p_a: ..., p_b: ... }) → { name, args }
function rpcCalls(src) {
  const out = []
  for (const m of src.matchAll(/\.rpc\(\s*'([a-z_0-9]+)'\s*(?:,\s*\{([\s\S]*?)\})?\s*\)/g)) {
    out.push({ name: m[1], args: m[2] ? [...m[2].matchAll(/\b(p_[a-z_]+)\s*:/g)].map((a) => a[1]) : [] })
  }
  return out
}

describe('migration 20261122000002: grants', () => {
  it('lists exactly the 12 member functions and the 6 internal helpers in its grant block', () => {
    const grants = MIGRATION.slice(MIGRATION.indexOf('-- ===== 10. Grants'), MIGRATION.indexOf('-- ===== 11.'))
    for (const name of Object.keys(MEMBER_FNS)) {
      expect(grants, name).toContain(`'public.${name}(`)
    }
    for (const name of INTERNAL_FNS) expect(grants, name).toContain(`'public.${name}(`)
    expect(grants).toContain("REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon'")
    expect(grants).toContain("GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role'")
    expect(grants).toContain("REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated'")
    expect(grants).toContain("GRANT EXECUTE ON FUNCTION %s TO service_role'")
  })

  it('has a post-flight that fails the push if anon can execute anything or read the codes table', () => {
    const post = MIGRATION.slice(MIGRATION.indexOf('-- ===== 11. Post-flight'))
    expect(post).toMatch(/has_function_privilege\('anon', v_fn, 'EXECUTE'\)/)
    expect(post).toMatch(/has_function_privilege\('authenticated', v_fn, 'EXECUTE'\)/)
    expect(post).toMatch(/has_table_privilege\('anon', 'public\.member_login_codes'/)
    expect(post).toContain("RAISE EXCEPTION 'post-flight: wrong grants")
  })

  it('closes the codes table to every client role and gives it no policy', () => {
    expect(MIGRATION).toContain('ALTER TABLE public.member_login_codes ENABLE ROW LEVEL SECURITY;')
    expect(MIGRATION).toContain('REVOKE ALL ON public.member_login_codes FROM PUBLIC, anon, authenticated;')
    expect(MIGRATION).not.toMatch(/CREATE POLICY[^;]*member_login_codes/)
  })

  it('refuses to ship if the live handle_new_user has no app_member branch', () => {
    expect(MIGRATION).toMatch(/pg_get_functiondef\('public\.handle_new_user\(\)'::regprocedure\)/)
    expect(MIGRATION).toMatch(/IF position\('app_member' IN v_def\) = 0 THEN\s+RAISE EXCEPTION/)
  })
})

describe('migration 20261122000002: identity comes from the session', () => {
  for (const name of Object.keys(MEMBER_FNS)) {
    it(`${name} takes no member id and reads auth.uid() (directly or via member_ticket_owner)`, () => {
      const body = fnBody(name)
      expect(fnArgs(name)).toEqual(MEMBER_FNS[name])
      expect(body).not.toMatch(/p_member_id|p_user_id/)
      expect(body).toMatch(/auth\.uid\(\)|member_ticket_owner\(/)
      expect(body).toContain('SECURITY DEFINER')
      expect(body).toMatch(/SET search_path = public/)
    })
  }

  it('member_ticket_owner, the helper the ticket functions rely on, is itself keyed on auth.uid()', () => {
    expect(fnBody('member_ticket_owner')).toMatch(/m\.user_id = auth\.uid\(\)/)
  })

  it('check_in reads the names the builder writes, with the old names as fallbacks, default 1 a day', () => {
    const body = fnBody('check_in')
    expect(body).toContain("ARRAY['points_per_scan', 'points_per_visit'], 10, 0, 1000")
    expect(body).toContain("ARRAY['daily_scan_limit', 'daily_visit_limit'], 1, 1, 20")
    expect(body).toMatch(/FOR UPDATE;/)
  })

  it('redemption codes expire after 30 days', () => {
    expect(fnBody('member_redeem_reward')).toContain("NOW() + INTERVAL '30 days'")
  })
})

describe('customer app ↔ SQL contract', () => {
  const calls = [...rpcCalls(INDEX), ...rpcCalls(APP)]

  it('calls each new function with exactly the argument names the migration defines', () => {
    const ours = calls.filter((c) => c.name in MEMBER_FNS)
    expect(ours.map((c) => c.name).sort()).toEqual(expect.arrayContaining([
      'join_app', 'check_in', 'member_get_profile', 'member_get_activity', 'member_redeem_reward',
      'member_submit_reward_suggestion', 'member_get_tickets', 'member_get_unread_count',
      'member_get_ticket_messages', 'member_get_ticket_ai_history', 'member_reply_to_ticket',
      'member_update_profile',
    ]))
    for (const c of ours) {
      for (const a of c.args) expect(MEMBER_FNS[c.name], `${c.name}(${a})`).toContain(a)
      // Arguments without a DEFAULT must be sent.
      const required = MEMBER_FNS[c.name].filter((a) => !new RegExp(`${a}\\s+[A-Z]+\\s+DEFAULT`).test(fnBody(c.name)))
      for (const a of required) expect(c.args, `${c.name} needs ${a}`).toContain(a)
    }
  })

  it('no longer calls any member-id RPC', () => {
    const names = calls.map((c) => c.name)
    for (const old of OLD_MEMBER_RPCS) expect(names, old).not.toContain(old)
  })

  it('no longer stores a member id or PIN token as identity', () => {
    for (const src of [INDEX, APP]) {
      expect(src).not.toMatch(/localStorage\.setItem\('app_member_id'/)
      expect(src).not.toMatch(/localStorage\.setItem\('app_auth_token'/)
      expect(src).not.toMatch(/localStorage\.getItem\('app_member_id'\)/)
    }
    expect(INDEX).not.toMatch(/generateToken|signup-pin|login-pin|turnstile/i)
  })

  it('both pages use the same non-default auth storageKey', () => {
    for (const src of [INDEX, APP]) {
      expect(src).toContain("const MEMBER_AUTH_STORAGE_KEY = 'royalty-member-auth';")
      expect(src).toMatch(/createClient\(SUPABASE_URL, SUPABASE_ANON_KEY, \{\s+auth: \{ storageKey: MEMBER_AUTH_STORAGE_KEY/)
    }
  })

  it('signs in as: member-code send → member-code verify → verifyOtp(token_hash) → join_app', () => {
    const send = INDEX.indexOf("action: 'send'")
    const verify = INDEX.indexOf("action: 'verify'")
    const otp = INDEX.indexOf('supabaseClient.auth.verifyOtp({ token_hash: data.token_hash')
    const join = INDEX.indexOf("supabaseClient.rpc('join_app'")
    expect(send).toBeGreaterThan(-1)
    expect(verify).toBeGreaterThan(send)
    expect(otp).toBeGreaterThan(verify)
    expect(join).toBeGreaterThan(otp)
  })

  it('app.html needs a session before it loads anything, and signs out on logout', () => {
    const init = APP.slice(APP.indexOf('async function init()'), APP.indexOf('async function loadApp()'))
    expect(init.indexOf('auth.getSession()')).toBeGreaterThan(-1)
    expect(init.indexOf('auth.getSession()')).toBeLessThan(init.indexOf('await loadApp()'))
    expect(APP).toMatch(/async function logout\(\) \{[\s\S]*?supabaseClient\.auth\.signOut\(\)/)
  })

  it('app.html redirects with absolute paths (it is also served at /a/{slug}/checkin)', () => {
    // A relative 'index.html' from /a/{slug}/checkin is /a/{slug}/index.html: no Netlify rule, a 404
    // for every customer who scans the printed QR before signing in.
    expect(APP).not.toMatch(/location\.href = [`'"]index\.html/)
    expect(APP).toContain("window.location.href = `/customer-app/index.html?slug=${encodeURIComponent(appSlug)}${checkinAction}`")
  })

  it('app.html reads the slug and the check-in from the /a/{slug}/checkin path, not only the query', () => {
    // Netlify's 200 rewrite keeps the browser on /a/{slug}/checkin: location.search is empty there.
    const init = APP.slice(APP.indexOf('async function init()'), APP.indexOf('async function loadApp()'))
    expect(init).toContain("const pathMatch = window.location.pathname.match(/^\\/a\\/([^\\/?#]+)(\\/checkin)?\\/?$/);")
    expect(init).toMatch(/appSlug = params\.get\('slug'\) \|\| \(pathMatch \? decodeURIComponent\(pathMatch\[1\]\) : null\)/)
    expect(init).toMatch(/const wantsCheckin = params\.get\('action'\) === 'checkin' \|\| !!\(pathMatch && pathMatch\[2\]\);/)
    expect(init).toMatch(/const action = wantsCheckin \? 'checkin'/)
  })

  it('every new index.html string exists in all 8 languages', () => {
    const keys = ['enterEmailCode', 'sendCode', 'checkEmail', 'codeSentTo', 'yourCode', 'continueBtn',
      'resendCode', 'differentEmail', 'codeResent', 'sending', 'checking', 'noPinNeeded', 'addNameToJoin',
      'errWrongCode', 'errExpired', 'errLocked', 'errRateLimited', 'errEmail', 'errPhoneTaken',
      'errPhoneInvalid', 'errPhoneRequired', 'errFull', 'errRemoved', 'errEmailTaken', 'errGeneric']
    const table = INDEX.slice(INDEX.indexOf('const TRANSLATIONS = {'), INDEX.indexOf('let currentLanguage'))
    for (const lang of ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ar']) {
      const start = table.indexOf(`            ${lang}: {`)
      const end = table.indexOf('\n            },', start)
      const block = table.slice(start, end)
      for (const k of keys) expect(block, `${lang}.${k}`).toMatch(new RegExp(`\\n\\s+${k}: "`))
    }
  })
})

describe('member-code edge function', () => {
  it('creates the auth user only after the code checks out, as an app_member, pre-confirmed', () => {
    const check = FN.indexOf("admin.rpc('member_code_check'")
    const create = FN.indexOf('admin.auth.admin.createUser(')
    const link = FN.indexOf("admin.auth.admin.generateLink({ type: 'magiclink', email })")
    expect(check).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(check)
    expect(link).toBeGreaterThan(create)
    expect(FN.slice(create, link)).toMatch(/email_confirm: true/)
    expect(FN.slice(create, link)).toMatch(/user_type: 'app_member'/)
    expect(FN.slice(check, create)).toMatch(/if \(checked !== 'ok'\) return json/)
  })

  it('never sends the code back to the browser', () => {
    const send = FN.slice(FN.indexOf("if (action === 'send')"), FN.indexOf("if (action === 'verify')"))
    expect(send).toContain('return json({ success: true })')
    // The variable `code` never appears as a response value (`x: code` or shorthand `{ code }`).
    for (const call of send.match(/json\(\{[^)]*\)/g)) {
      expect(call).not.toMatch(/:\s*code\b|[{,]\s*code\s*[,}]/)
    }
  })

  it('hashes with a server secret, never stores the code', () => {
    expect(FN).toMatch(/hmacHex\(supabaseServiceKey, `\$\{appId\}:\$\{email\}:\$\{code\}`\)/)
    expect(FN).toMatch(/p_code_hash: hash/)
    expect(FN).not.toMatch(/p_code: /)
  })

  it('is pinned verify_jwt = false in config.toml', () => {
    expect(read('supabase/config.toml')).toMatch(/\[functions\.member-code\]\nverify_jwt = false/)
  })
})

describe('member-code helpers', () => {
  it('escapes the business name in the email body and strips it for headers', () => {
    const mail = codeEmail('<img src=x onerror=alert(1)> "Bean" & Co', '#123456', '123456', 'en')
    expect(mail.html).not.toContain('<img src=x')
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt; &quot;Bean&quot; &amp; Co')
    expect(fromName('Evil"\r\nBcc: x@y.z <a@b>')).not.toMatch(/["\r\n<>@]/)
    expect(mail.subject).toBe('123456 is your code for img src=x onerror=alert(1) Bean & Co')
  })

  it('does not treat $ in a business name as a replacement pattern', () => {
    const mail = codeEmail("Pay$&Go $' $1", '#123456', '654321', 'en')
    expect(mail.subject).toBe("654321 is your code for Pay$&Go $' $1")
    expect(mail.html).toContain('Pay$&amp;Go')
  })

  it('accepts only #rrggbb colours and known languages', () => {
    expect(safeColor('#AbCdEf')).toBe('#AbCdEf')
    expect(safeColor('red;background:url(x)')).toBe('#6366f1')
    expect(pickLang('fr-CA')).toBe('fr')
    expect(pickLang('xx')).toBe('en')
    expect(codeEmail('A', '#000000', '111111', 'ar').html).toContain('dir="rtl"')
  })

  it('has every email string in all 8 languages, each with its placeholders', () => {
    expect([...LANGS].sort()).toEqual(['ar', 'de', 'en', 'es', 'fr', 'it', 'pt', 'zh'])
    for (const lang of LANGS) {
      const t = EMAIL_TEXT[lang]
      expect(t.subject).toContain('{code}')
      expect(t.subject).toContain('{app}')
      expect(t.intro).toContain('{app}')
      expect(t.footer).toContain('{app}')
      expect(t.expires.length).toBeGreaterThan(3)
      expect(t.ignore.length).toBeGreaterThan(3)
    }
  })

  it('makes 6-digit codes across the whole range', () => {
    const codes = Array.from({ length: 3000 }, () => sixDigits())
    expect(codes.every((c) => /^\d{6}$/.test(c))).toBe(true)
    expect(codes.some((c) => c.startsWith('0'))).toBe(true)
    expect(new Set(codes).size).toBeGreaterThan(2950)
  })

  it('HMACs deterministically, and differently per key and per message', async () => {
    const a = await hmacHex('k1', 'app:e@x.co:123456')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await hmacHex('k1', 'app:e@x.co:123456')).toBe(a)
    expect(await hmacHex('k2', 'app:e@x.co:123456')).not.toBe(a)
    expect(await hmacHex('k1', 'app:e@x.co:123457')).not.toBe(a)
  })
})

describe('royal-ai-recommend checks its caller', () => {
  it('runs the caller check before the AI switch or any org work', () => {
    const handler = RECOMMEND.slice(RECOMMEND.indexOf('Deno.serve('))
    const gate = handler.indexOf('await callerProblem(supabase, req, onDemand ? organization_id : null)')
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(handler.indexOf('await assertAiEnabled(supabase)'))
    expect(gate).toBeLessThan(handler.indexOf('getEligibleOrgs(supabase)'))
  })

  it('cron mode (every org) needs the service-role key; on-demand needs org membership or super admin', () => {
    const fn = RECOMMEND.slice(RECOMMEND.indexOf('async function callerProblem('))
    expect(fn).toMatch(/if \(orgId === null\) \{[\s\S]*?token === supabaseServiceKey \? null : \{ status: 403/)
    expect(fn).toMatch(/supabase\.auth\.getUser\(token\)/)
    expect(fn).toMatch(/\.from\('organization_members'\)[\s\S]*?\.eq\('organization_id', orgId\)[\s\S]*?\.eq\('user_id', user\.id\)/)
    expect(fn).toMatch(/profile\?\.is_admin \? null : \{ status: 403/)
  })
})

describe('check-in defaults', () => {
  it('a new app allows one check-in a day unless the owner raises it', () => {
    expect(read('app/app-builder.js')).toContain("settings.daily_scan_limit || 1;")
    expect(read('app/app-builder.js')).toContain("getElementById('daily-scan-limit').value) || 1,")
    expect(read('app/app-builder.html')).toContain('<input type="number" id="daily-scan-limit" value="1" min="1" max="20">')
    expect(read('app/apps.js')).toContain('daily_scan_limit: 1,')
    expect(read('app/app-templates-library.js')).not.toMatch(/daily_scan_limit: (?!1,)\d+/)
  })
})
