/**
 * The plan offer (plan abstract-gliding-hellman, Phases 1-2, 2026-11-25).
 *
 * Before: a visitor who clicked Growth on Pricing was recorded and then quietly left on Free;
 * nothing ever offered Growth again, and the plan sat in sessionStorage, which the confirmation
 * link (a new tab) loses. Now signup keeps it on the account (user_metadata.plan_intent) and the
 * dashboard offers exactly that plan's 14-day trial once the app is live.
 *
 * Runs the REAL app/plan-limits.js and app/plan-offer.js.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const LANGS = ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ar']
const NOW = Date.parse('2026-11-25T12:00:00Z')
const DAY = 86400000

// Everything true: the one person who should see the offer.
const BASE = {
  intent: 'growth',
  org: { id: 'org-1', plan_type: 'free' },
  role: 'owner',
  isSuperAdmin: false,
  viewingAs: false,
  hasPublishedApp: true,
  dismissed: false,
  accountCreatedAt: new Date(NOW - 2 * DAY).toISOString(),
  now: NOW,
  billing: { subscription_status: 'inactive', cancelled_at: null },
}

let PO
beforeAll(() => {
  window.eval(read('app/plan-limits.js'))
  window.eval(read('app/plan-offer.js'))
  PO = window.PlanOffer
})

describe('intentFor: the plan they picked, from the account', () => {
  it('reads plan_intent, then the older signup_source.plan', () => {
    expect(PO.intentFor({ user_metadata: { plan_intent: 'growth' } })).toBe('growth')
    expect(PO.intentFor({ user_metadata: { signup_source: { plan: 'scale' } } })).toBe('scale')
    expect(PO.intentFor({ user_metadata: { plan_intent: 'starter', signup_source: { plan: 'scale' } } })).toBe('starter')
    expect(PO.intentFor({ user_metadata: { plan_intent: 'Growth' } })).toBe('growth')
  })
  it('only paid tiers count', () => {
    for (const v of ['free', 'pro', 'max', 'enterprise', '', null, 7, { a: 1 }]) {
      expect(PO.intentFor({ user_metadata: { plan_intent: v } }), String(v)).toBe(null)
    }
    expect(PO.intentFor({ user_metadata: { signup_source: 'growth' } })).toBe(null)
    expect(PO.intentFor({})).toBe(null)
    expect(PO.intentFor(null)).toBe(null)
  })
})

describe('eligibility matrix', () => {
  it('the base case is eligible, for each paid tier, owner or admin', () => {
    for (const intent of ['starter', 'growth', 'scale']) {
      for (const role of ['owner', 'admin']) {
        expect(PO.reason({ ...BASE, intent, role }), `${intent}/${role}`).toBe(null)
        expect(PO.eligible({ ...BASE, intent, role })).toBe(true)
      }
    }
  })
  const NO = [
    ['no intent', { intent: null }, 'no_paid_intent'],
    ['free intent', { intent: 'free' }, 'no_paid_intent'],
    ['already subscribed', { org: { id: 'o', plan_type: 'subscription' } }, 'not_free'],
    ['lifetime deal', { org: { id: 'o', plan_type: 'appsumo_lifetime' } }, 'not_free'],
    ['plain member', { role: 'member' }, 'role'],
    ['no role', { role: undefined }, 'role'],
    ['super admin', { isSuperAdmin: true }, 'super_admin'],
    ['"view as"', { viewingAs: true }, 'viewing_as'],
    ['no published app', { hasPublishedApp: false }, 'no_published_app'],
    ['dismissed', { dismissed: true }, 'dismissed'],
    ['account 31 days old', { accountCreatedAt: new Date(NOW - 31 * DAY).toISOString() }, 'account_too_old'],
    ['no creation date', { accountCreatedAt: undefined }, 'account_age_unknown'],
    ['billing not loaded', { billing: undefined }, 'billing_unknown'],
    ['billing row missing', { billing: null }, null], // null = loaded, nothing on record → never subscribed
    ['cancelled before', { billing: { subscription_status: 'canceled', cancelled_at: '2026-11-01' } }, 'had_subscription'],
    ['status left over', { billing: { subscription_status: 'past_due', cancelled_at: null } }, 'had_subscription'],
    ['trial cancelled (cancelled_at only)', { billing: { subscription_status: 'inactive', cancelled_at: '2026-11-20' } }, 'had_subscription'],
  ]
  for (const [name, patch, why] of NO) {
    it(`${name} → ${why === null ? 'eligible' : why}`, () => {
      expect(PO.reason({ ...BASE, ...patch })).toBe(why)
    })
  }
  it('30 days old exactly is still eligible', () => {
    expect(PO.reason({ ...BASE, accountCreatedAt: new Date(NOW - 30 * DAY).toISOString() })).toBe(null)
  })
  it('null plan_type counts as free; null/empty status as never subscribed', () => {
    expect(PO.reason({ ...BASE, org: { id: 'o', plan_type: null } })).toBe(null)
    expect(PO.reason({ ...BASE, billing: { subscription_status: null } })).toBe(null)
    expect(PO.reason({ ...BASE, billing: { subscription_status: '' } })).toBe(null)
  })
})

// ----- check() and mount() against a stubbed client -----
function stubDb({ billing = { subscription_status: 'inactive', cancelled_at: null }, published = [{ id: 'app-1' }] } = {}) {
  const calls = []
  window.supabase = {
    from: (table) => {
      const q = { table, filters: [] }
      calls.push(q)
      const chain = {
        select: (cols) => { q.cols = cols; return chain },
        eq: (c, v) => { q.filters.push(['eq', c, v]); return chain },
        is: (c, v) => { q.filters.push(['is', c, v]); return chain },
        limit: async () => ({ data: table === 'customer_apps' ? published : [], error: null }),
        maybeSingle: async () => ({ data: billing, error: null }),
      }
      return chain
    },
  }
  return calls
}

const USER = { id: 'u1', created_at: new Date(Date.now() - DAY).toISOString(), user_metadata: { plan_intent: 'growth' } }
const ORG = { id: 'org-1', plan_type: 'free' }

describe('check()', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })
  it('eligible owner: one billing query, the tier back', async () => {
    const calls = stubDb()
    const r = await PO.check({ user: USER, org: ORG, role: 'owner', isSuperAdmin: false, hasPublishedApp: true })
    expect(r).toEqual({ eligible: true, tier: 'growth', reason: null })
    expect(calls.map((c) => c.table)).toEqual(['organizations'])
    expect(calls[0].cols).toBe('subscription_status, cancelled_at')
  })
  it('no query at all when something cheaper rules it out', async () => {
    const calls = stubDb()
    const r = await PO.check({ user: USER, org: ORG, role: 'member', hasPublishedApp: true })
    expect(r.eligible).toBe(false)
    expect(calls).toHaveLength(0)
  })
  it('without hasPublishedApp (Intelligence) it looks for a published, undeleted app', async () => {
    const calls = stubDb()
    const r = await PO.check({ user: USER, org: ORG, role: 'owner' })
    expect(r.eligible).toBe(true)
    expect(calls[0].table).toBe('customer_apps')
    expect(calls[0].filters).toEqual(expect.arrayContaining([['eq', 'is_published', true], ['is', 'deleted_at', null], ['eq', 'organization_id', 'org-1']]))
    stubDb({ published: [] })
    expect((await PO.check({ user: USER, org: ORG, role: 'owner' })).reason).toBe('no_published_app')
  })
  it('"view as" and dismissal come from the browser', async () => {
    stubDb()
    sessionStorage.setItem('adminViewAsOrg', '{"orgId":"org-1"}')
    expect((await PO.check({ user: USER, org: ORG, role: 'owner', hasPublishedApp: true })).reason).toBe('viewing_as')
    sessionStorage.clear()
    localStorage.setItem('royalty_plan_offer_dismissed:org-1', '2026-11-25')
    expect((await PO.check({ user: USER, org: ORG, role: 'owner', hasPublishedApp: true })).reason).toBe('dismissed')
  })
  it('an org that subscribed before is never offered again', async () => {
    stubDb({ billing: { subscription_status: 'canceled', cancelled_at: '2026-11-25T10:00:00Z' } })
    expect((await PO.check({ user: USER, org: ORG, role: 'owner', hasPublishedApp: true })).reason).toBe('had_subscription')
  })
})

describe('mount(): the card', () => {
  let box
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear()
    document.body.innerHTML = '<div id="plan-offer" hidden></div>'
    box = document.getElementById('plan-offer')
    window.location.origin = 'https://royaltyapp.ai'
    window.location.hash = ''
    window.location.assign = vi.fn()
    window.getValidSession = async () => ({ access_token: 'tok' })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('stays hidden for someone not eligible', async () => {
    stubDb()
    expect(await PO.mount({ container: box, user: { ...USER, user_metadata: {} }, org: ORG, role: 'owner', hasPublishedApp: true })).toBe(false)
    expect(box.hidden).toBe(true)
    expect(box.children).toHaveLength(0)
  })

  it('names the plan and its price from PLAN_LIMITS, as text', async () => {
    stubDb()
    expect(await PO.mount({ container: box, user: USER, org: ORG, role: 'owner', hasPublishedApp: true })).toBe(true)
    expect(box.hidden).toBe(false)
    expect(box.querySelector('.plan-offer-title').textContent).toBe('You picked Growth.')
    expect(box.querySelector('.plan-offer-terms').textContent)
      .toBe('Try it free for 14 days, no card needed. Then $39.99/mo, cancel anytime.')
    expect(box.querySelector('.plan-offer-start').textContent).toBe('Start free trial')
    expect(box.querySelector('.plan-offer-stay').textContent).toBe('Stay on Free')
    expect(box.getAttribute('role')).toBe('region')
    expect(box.querySelector('script, [onclick], [onerror]')).toBe(null)
  })

  it('each tier shows its own price', async () => {
    for (const [tier, price] of [['starter', '$19.99'], ['scale', '$79.99']]) {
      document.body.innerHTML = '<div id="plan-offer" hidden></div>'
      box = document.getElementById('plan-offer')
      stubDb()
      await PO.mount({ container: box, user: { ...USER, user_metadata: { plan_intent: tier } }, org: ORG, role: 'owner', hasPublishedApp: true })
      expect(box.querySelector('.plan-offer-terms').textContent).toContain(price + '/mo')
    }
  })

  it('Start free trial: hosted checkout for <tier>_monthly, back to the app on cancel, spinner while waiting', async () => {
    stubDb()
    let resolveFetch
    const fetchMock = vi.fn(() => new Promise((r) => { resolveFetch = r }))
    vi.stubGlobal('fetch', fetchMock)
    await PO.mount({ container: box, user: USER, org: ORG, role: 'owner', hasPublishedApp: true })
    box.querySelector('.plan-offer-start').click()
    await new Promise((r) => setTimeout(r, 0))
    const start = box.querySelector('.plan-offer-start')
    expect(start.disabled).toBe(true)
    expect(start.querySelector('.plan-offer-spinner').hidden).toBe(false)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/functions\/v1\/create-checkout-session$/)
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual({
      priceKey: 'growth_monthly',
      organizationId: 'org-1',
      embedded: false,
      successUrl: 'https://royaltyapp.ai/app/upgrade.html?success=true&from=offer',
      cancelUrl: 'https://royaltyapp.ai/app/dashboard.html',
    })
    resolveFetch({ ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_1', trialDays: 14 }) })
    await new Promise((r) => setTimeout(r, 0))
    expect(window.location.assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_1')
  })

  it('a refusal is shown in the card and the button comes back', async () => {
    stubDb()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Too many checkout attempts.' }) })))
    await PO.mount({ container: box, user: USER, org: ORG, role: 'owner', hasPublishedApp: true })
    box.querySelector('.plan-offer-start').click()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    const err = box.querySelector('.plan-offer-error')
    expect(err.hidden).toBe(false)
    expect(err.textContent).toBe('Too many checkout attempts.')
    expect(box.querySelector('.plan-offer-start').disabled).toBe(false)
    expect(window.location.assign).not.toHaveBeenCalled()
  })

  it('Stay on Free hides it for good (per org)', async () => {
    stubDb()
    await PO.mount({ container: box, user: USER, org: ORG, role: 'owner', hasPublishedApp: true })
    box.querySelector('.plan-offer-stay').click()
    expect(box.hidden).toBe(true)
    expect(localStorage.getItem('royalty_plan_offer_dismissed:org-1')).toBeTruthy()
    document.body.innerHTML = '<div id="plan-offer" hidden></div>'
    expect(await PO.mount({ container: document.getElementById('plan-offer'), user: USER, org: ORG, role: 'owner', hasPublishedApp: true })).toBe(false)
  })

  it('re-renders in the new language', async () => {
    stubDb()
    await PO.mount({ container: box, user: USER, org: ORG, role: 'owner', hasPublishedApp: true })
    window.I18n = { t: (k, v) => (k === 'planOffer.title' ? `Has elegido ${v.plan}.` : k) }
    window.dispatchEvent(new Event('i18n:changed'))
    expect(box.querySelector('.plan-offer-title').textContent).toBe('Has elegido Growth.')
    delete window.I18n
  })
})

describe('pointLink(): Intelligence', () => {
  it('turns the Pro link into the trial offer and keeps it through language loads', () => {
    document.body.innerHTML = '<a href="/app/upgrade.html" class="caption-upgrade-link" data-i18n="intelligence.seeProLink">See what Pro unlocks →</a>'
    const a = document.querySelector('a')
    expect(PO.pointLink(a, 'scale')).toBe(true)
    expect(a.hasAttribute('data-i18n')).toBe(false)
    expect(a.textContent).toBe('Try Scale free for 14 days →')
    expect(a.getAttribute('href')).toBe('/app/dashboard.html#plan-offer')
  })
})

describe('wiring', () => {
  const DASH_HTML = read('app/dashboard.html')
  const DASH_JS = read('app/dashboard.js')
  const INTEL_HTML = read('app/intelligence.html')
  const INTEL_JS = read('app/intelligence.js')
  const SIGNUP = read('app/signup.html')

  it('the mount point sits in #app-metrics-section > .container, above the customer-cap warning', () => {
    document.body.innerHTML = DASH_HTML.slice(DASH_HTML.indexOf('<body>') + 6, DASH_HTML.indexOf('<script src="https://cdn.jsdelivr.net/npm/canvas-confetti'))
    const offer = document.getElementById('plan-offer')
    expect(offer).not.toBe(null)
    expect(offer.hidden).toBe(true)
    expect(offer.parentElement.matches('#app-metrics-section > .container')).toBe(true)
    expect(offer.nextElementSibling.id).toBe('member-cap-warning')
  })
  it('script order: plan-limits, then plan-offer, then the page script; css versioned on its own', () => {
    for (const [html, page] of [[DASH_HTML, 'dashboard.js?v=28'], [INTEL_HTML, 'intelligence.js?v=16']]) {
      const pl = html.indexOf('plan-limits.js?v=3"')
      const po = html.indexOf('plan-offer.js?v=1"')
      const auth = html.indexOf('auth.js?v=')
      expect(pl).toBeGreaterThan(0)
      expect(po).toBeGreaterThan(pl)
      expect(po).toBeGreaterThan(auth)
      expect(html.indexOf(page)).toBeGreaterThan(po)
    }
    expect(DASH_HTML).toContain('<link rel="stylesheet" href="plan-offer.css?v=2">')
    expect(read('app/plan-offer.css')).toMatch(/\.plan-offer-title \{[^}]*text-transform: none;/)
    expect(read('app/dashboard.css')).not.toContain('.plan-offer')
  })
  it('every page that loads plan-limits.js loads v=3', () => {
    for (const f of ['apps', 'admin', 'upgrade', 'dashboard', 'intelligence', 'settings', 'venues']) {
      expect(read(`app/${f}.html`), f).toContain('plan-limits.js?v=3"')
      expect(read(`app/${f}.html`), f).not.toMatch(/plan-limits\.js\?v=[12]"/)
    }
  })
  it('dashboard mounts it after the apps load, with the published-app flag', () => {
    const at = DASH_JS.indexOf('PlanOffer.mount({')
    expect(at).toBeGreaterThan(DASH_JS.indexOf('loadAppMetrics()\n    ]);'))
    const call = DASH_JS.slice(at, DASH_JS.indexOf('});', at))
    expect(call).toMatch(/hasPublishedApp: allApps\.some\(a => a\.is_published\)/)
    expect(call).toMatch(/isSuperAdmin: userInfo\.profile\?\.is_admin === true/)
    expect(call).toMatch(/role: orgData\.role/)
  })
  it('intelligence points the link only when eligible', () => {
    expect(INTEL_JS).toMatch(/PlanOffer\.check\(\{[\s\S]*?\}\)\.then\(\(offer\) => \{\s*if \(offer\.eligible\) \{\s*PlanOffer\.pointLink\(document\.querySelector\('#crown-onboarding-card \.caption-upgrade-link'\), offer\.tier\)/)
  })
  it('plan-offer.js leaks no globals but PlanOffer', () => {
    const src = read('app/plan-offer.js')
    expect(src.trim().startsWith('/**')).toBe(true)
    expect(src).toMatch(/^\(function \(\) \{/m)
    expect(src).toMatch(/^\}\)\(\);\s*$/m)
    expect(src.match(/window\.[A-Za-z]+ = /g)).toEqual(['window.PlanOffer = '])
  })
  it('signup keeps the plan on the account, opted out of analytics or not', () => {
    const submit = SIGNUP.slice(SIGNUP.indexOf("signupForm.addEventListener('submit'"))
    expect(submit).toMatch(/if \(source\) metadata\.signup_source = source;\s*const pickedPlan = pickedPlanIntent\(\);\s*if \(pickedPlan\) metadata\.plan_intent = pickedPlan;/)
    const fn = SIGNUP.match(/function pickedPlanIntent\(\) \{[\s\S]*?\n {8}\}/)[0]
    expect(fn).not.toMatch(/Analytics|attribution/)
    // eslint-disable-next-line no-new-func
    const run = new Function(`${fn}; return pickedPlanIntent();`)
    window.location.search = '?plan=Growth'
    expect(run()).toBe('growth')
    window.location.search = '?plan=free'
    expect(run()).toBe(null)
    window.location.search = ''
    sessionStorage.setItem('royalty_plan_intent', 'scale')
    expect(run()).toBe('scale')
    sessionStorage.clear()
    expect(run()).toBe(null)
    expect(read('app/onboarding-save.js')).toContain("sessionStorage.getItem('royalty_plan_intent')") // left alone
  })
})

describe('translations', () => {
  const KEYS = ['eyebrow', 'title', 'terms', 'start', 'starting', 'stay', 'tryLink', 'errorSession', 'errorGeneric']
  it('every planOffer key exists in all 8 languages, with its placeholders', () => {
    for (const lang of LANGS) {
      const po = JSON.parse(read(`i18n/${lang}.json`)).planOffer
      for (const k of KEYS) expect(typeof po?.[k], `${lang}.${k}`).toBe('string')
      expect(po.title, lang).toContain('{plan}')
      expect(po.tryLink, lang).toContain('{plan}')
      expect(po.terms, lang).toContain('{price}')
      expect(po.terms, lang).toMatch(/14/)
    }
  })
})
