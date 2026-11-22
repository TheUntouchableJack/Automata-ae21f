/**
 * Staff give rewards at the counter (plan royalty-in-store-loop, B2, 2026-11-22).
 *
 * A member redeems in the app and shows an 8-character code (and its QR). Staff open
 * /app/counter.html, type or scan it, and press Give: fulfill_redemption marks it fulfilled
 * once, by that staff user. Behaviour (org scoping, give-once, expiry, summary) is tested on
 * PGlite: ~/Documents/Design Benches/royalty-in-store-loop-2026-11-22/pglite/b2.mjs (33 checks,
 * 7 mutations caught). These tests pin the grants, the client↔SQL argument names, that the
 * counter page never writes database text as HTML, and the release plumbing.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const SQL = read('supabase/migrations/20261122000003_counter_redemption.sql')
const COUNTER_JS = read('app/counter.js')
const COUNTER_HTML = read('app/counter.html')
const APP = read('customer-app/app.html')
const DASH_JS = read('app/dashboard.js')
const EN = JSON.parse(read('i18n/en.json'))

const FNS = {
  lookup_redemption: ['p_code'],
  fulfill_redemption: ['p_code'],
  counter_summary: ['p_app_id', 'p_since'],
  member_get_redemptions: ['p_app_id'],
}

function fnHead(name) {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  return SQL.slice(start, SQL.indexOf('\nRETURNS', start))
}
function rpcArgs(src, name) {
  const calls = [...src.matchAll(new RegExp(`\\.rpc\\(\\s*'${name}'\\s*,\\s*\\{([^}]*)\\}`, 'g'))]
  return calls.map((m) => [...m[1].matchAll(/\b(p_[a-z_]+)\s*:/g)].map((a) => a[1]))
}
const get = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)

describe('migration 20261122000003: grants', () => {
  it('the 4 client functions are authenticated-only, the 3 helpers service_role-only, checked by a post-flight', () => {
    for (const name of Object.keys(FNS)) {
      expect([...fnHead(name).matchAll(/\b(p_[a-z_]+)\s+[A-Z]/g)].map((m) => m[1])).toEqual(FNS[name])
    }
    const grants = SQL.slice(SQL.indexOf('DO $grants$'), SQL.indexOf('DO $postflight$'))
    for (const f of ["'public.lookup_redemption(text)'", "'public.fulfill_redemption(text)'",
      "'public.counter_summary(uuid,timestamp with time zone)'", "'public.member_get_redemptions(uuid)'"]) {
      expect(grants).toContain(f)
    }
    for (const f of ["'public.staff_manages_app(uuid)'", "'public.normalize_redemption_code(text)'", "'public.redemption_view(uuid,text)'"]) {
      expect(grants).toContain(f)
    }
    expect(SQL).toContain("RAISE EXCEPTION 'post-flight: wrong grants")
  })

  it('every staff function checks org membership through staff_manages_app', () => {
    for (const name of ['lookup_redemption', 'fulfill_redemption', 'counter_summary']) {
      const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
      const body = SQL.slice(start, SQL.indexOf('$$;', SQL.indexOf('$$', start) + 2))
      expect(body, name).toMatch(/staff_manages_app\(/)
    }
    expect(SQL).toMatch(/JOIN organization_members om ON om\.organization_id = a\.organization_id\s+WHERE a\.id = p_app_id AND om\.user_id = auth\.uid\(\)/)
  })

  it('fulfil locks the row and refuses given, cancelled and expired codes', () => {
    const start = SQL.indexOf('CREATE OR REPLACE FUNCTION public.fulfill_redemption(')
    const body = SQL.slice(start, SQL.indexOf('$$;', SQL.indexOf('$$', start) + 2))
    expect(body).toMatch(/WHERE rr\.redemption_code = v_code\s+FOR UPDATE;/)
    expect(body.indexOf("IF v_row.status = 'fulfilled'")).toBeLessThan(body.indexOf("SET status = 'fulfilled'"))
    expect(body.indexOf('v_row.expires_at <= NOW()')).toBeLessThan(body.indexOf("SET status = 'fulfilled'"))
    expect(body).toContain('fulfilled_by = auth.uid()')
  })

  it('also makes a resend expire the earlier sign-in codes (fix to 20261122000002)', () => {
    const start = SQL.indexOf('CREATE OR REPLACE FUNCTION public.member_code_issue(')
    expect(start).toBeGreaterThan(-1)
    const body = SQL.slice(start, SQL.indexOf('$$;', SQL.indexOf('$$', start) + 2))
    expect(body.indexOf('SET expires_at = LEAST(expires_at, NOW())')).toBeLessThan(body.indexOf('INSERT INTO member_login_codes'))
  })
})

describe('clients call the B2 functions with the SQL argument names', () => {
  it('counter.js', () => {
    expect(rpcArgs(COUNTER_JS, 'lookup_redemption')).toEqual([['p_code']])
    expect(rpcArgs(COUNTER_JS, 'fulfill_redemption')).toEqual([['p_code']])
    expect(rpcArgs(COUNTER_JS, 'counter_summary')).toEqual([['p_app_id', 'p_since']])
  })
  it('dashboard.js and the customer app', () => {
    expect(rpcArgs(DASH_JS, 'counter_summary')).toEqual([['p_app_id', 'p_since']])
    expect(rpcArgs(APP, 'member_get_redemptions')).toEqual([['p_app_id']])
  })
})

describe('counter page', () => {
  it('writes database text with textContent only', () => {
    expect(COUNTER_JS).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/)
  })

  it('every translation key it uses exists in en.json', () => {
    const keys = new Set([
      ...[...COUNTER_HTML.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]),
      ...[...COUNTER_JS.matchAll(/counterT\('([^']+)'/g)].map((m) => m[1]),
    ])
    expect(keys.size).toBeGreaterThan(20)
    for (const k of keys) expect(typeof get(EN, k), k).toBe('string')
    // ...and the {placeholders} in the English strings match what the code passes.
    expect(EN.counter.forCustomer).toContain('{name}')
    expect(EN.counter.givenByOn).toContain('{date}')
    expect(EN.counter.givenByOn).toContain('{name}')
  })

  it('is in the sidebar, after Rewards, with its own icon', () => {
    const sidebar = read('app/sidebar.js')
    const rewards = sidebar.indexOf("{ id: 'rewards', icon: 'gift'")
    const counter = sidebar.indexOf("{ id: 'counter', icon: 'scan', href: '/app/counter.html', labelKey: 'nav.counter'")
    expect(rewards).toBeGreaterThan(-1)
    expect(counter).toBeGreaterThan(rewards)
    expect(sidebar).toMatch(/\n\s+scan: `<svg/)
    expect(typeof EN.nav.counter).toBe('string')
  })

  it('every app page loads the same sidebar.js version', () => {
    const versions = new Set()
    for (const f of fs.readdirSync(path.join(ROOT, 'app')).filter((n) => n.endsWith('.html'))) {
      for (const m of read(`app/${f}`).matchAll(/sidebar\.js\?v=(\d+)/g)) versions.add(m[1])
    }
    expect([...versions]).toEqual(['26'])
  })

  it('the dashboard links to it next to the count', () => {
    const html = read('app/dashboard.html')
    expect(html).toContain('id="stat-rewards-given-today"')
    expect(html).toContain('<a href="/app/counter.html" data-i18n="dashboard.openCounter">')
    expect(html).toContain('dashboard.js?v=23')
    expect(typeof EN.dashboard.rewardsGivenToday).toBe('string')
  })
})

describe('customer app: My rewards', () => {
  it('lists unused codes and shows the code sheet right after a redeem', () => {
    expect(APP).toContain('id="my-rewards-section"')
    expect(APP).toContain('id="code-show-modal"')
    const redeem = APP.slice(APP.indexOf('async function redeemReward('), APP.indexOf('// ===== My rewards'))
    expect(redeem).toMatch(/showRedemptionCode\(\{ reward_name: reward\.name, redemption_code: result\.redemption_code, expires_at: result\.expires_at \}\)/)
    expect(redeem).not.toMatch(/showToast\(`Redeemed! Code/)
  })

  it('draws the QR with qrcode-generator@1.4.4, never the 404ing qrcode@1.5.3 build path', () => {
    expect(APP).toContain('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js')
    expect(APP).not.toMatch(/<script[^>]+qrcode@1\.5\.3/)
    expect(APP).toMatch(/if \(typeof qrcode === 'function'\)/)
  })

  it('escapes reward names in the list', () => {
    const fn = APP.slice(APP.indexOf('async function loadMyRedemptions()'), APP.indexOf('function showRedemptionCode('))
    expect(fn).toContain("escapeHtml(r.reward_name || 'Reward')")
    expect(fn).toContain("escapeHtml(r.redemption_code || '')")
  })
})
