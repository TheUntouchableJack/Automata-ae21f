/**
 * The upgrade page for Starter/Growth/Scale (plan abstract-gliding-hellman, Phase 3, 2026-11-25).
 *
 * Before: a Growth subscriber's banner said "Free", the success screen said "Welcome to Pro!" with
 * Pro's limits, the comparison table was Free/Pro/Max, the promo box never sent its code, AppSumo
 * owners could buy a plan over their lifetime deal, and checkout ran in an embedded modal.
 *
 * Runs the REAL app/plan-limits.js and app/upgrade.js against the REAL markup of app/upgrade.html.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const HTML = read('app/upgrade.html')
const JS = read('app/upgrade.js')
const BODY = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('<!-- Scripts -->'))

const FREE = { id: 'org-1', plan_type: 'free', subscription_status: 'inactive', stripe_subscription_id: null, cancelled_at: null }
const HAD_ONE = { ...FREE, subscription_status: 'canceled', cancelled_at: '2026-11-01T00:00:00Z' }
const GROWTH = { id: 'org-1', plan_type: 'subscription', subscription_tier: 'growth', subscription_status: 'trialing', stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1' }
const LEGACY_PRO = { ...GROWTH, subscription_tier: 'pro', subscription_status: 'active' }
const LTD = { id: 'org-1', plan_type: 'appsumo_lifetime', appsumo_tier: 2, has_royalty_pro: false, stripe_customer_id: null }

const $ = (id) => document.getElementById(id)
const card = (plan) => document.querySelector(`.upgrade-plan-card[data-plan="${plan}"]`)
const btn = (plan) => card(plan).querySelector('button')

let PL
beforeAll(() => {
  window.showToast = vi.fn()
  window.getValidSession = async () => ({ access_token: 'tok' })
  window.eval(read('app/plan-limits.js'))
  PL = window.PLAN_LIMITS
  // One eval for upgrade.js and its hooks: its top-level let/const stay private to that eval.
  window.eval(JS + `
    window.__up = {
      set: (org, role) => { currentUser = { id: 'u1', email: 'o@example.com' }; currentOrganization = org; currentMembership = role === null ? null : { role: role || 'owner' }; },
      org: () => currentOrganization,
      render: () => renderCurrentPlan(),
      deepLink: () => handlePlanDeepLink(),
      success: (org, opts) => renderSuccess(org, opts),
      showSuccess: (opts) => showSuccessState(opts),
      checkout: (plan, b) => handleCheckout(plan, b),
      bind: () => setupEventListeners(),
      planName: upgradePlanName,
      cardState: upgradeCardState,
      trial: upgradeTrialAvailable,
      metrics: upgradeSuccessMetrics,
      settled: upgradeIsSettled,
    };`)
})

beforeEach(() => {
  document.body.innerHTML = BODY
  try { sessionStorage.clear() } catch (e) { /* jsdom */ }
  // tests/setup.js swaps window.location for a plain object: drive it directly.
  Object.assign(window.location, { search: '', hash: '', origin: 'https://royaltyapp.ai', pathname: '/app/upgrade.html' })
  window.location.assign = vi.fn()
  window.showToast.mockClear()
})

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

// ----- comparison table against PLAN_LIMITS -----
const TIERS = ['free', 'starter', 'growth', 'scale']
const planOf = (t) => (t === 'free' ? PL.free : PL.subscription[t])
function expectedCell(key, v) {
  if (typeof v === 'boolean') return v ? '✓' : '—'
  if ((key === 'emails_monthly' || key === 'sms_monthly') && v === 0) return '—'
  if (v === -1) return 'Unlimited'
  const n = Number(v).toLocaleString('en-US')
  return key === 'royal_queries_monthly' ? n + '/mo' : n
}

describe('comparison table', () => {
  it('is Free / Starter / Growth / Scale (no Pro, no Max)', () => {
    const heads = [...document.querySelectorAll('#comparison-table thead th')].map((th) => th.textContent.trim())
    expect(heads).toEqual(['Features', 'Free', 'Starter', 'Growth', 'Scale'])
    expect($('comparison-table').textContent).not.toMatch(/\bPro\b|\bMax\b/)
  })
  it('every cell tied to a limit matches PLAN_LIMITS', () => {
    const rows = [...document.querySelectorAll('#comparison-table tr[data-limit]')]
    expect(rows.length).toBe(14)
    for (const row of rows) {
      const key = row.dataset.limit
      const cells = [...row.querySelectorAll('td')].slice(1).map((td) => td.textContent.trim())
      expect(cells, key).toEqual(TIERS.map((t) => expectedCell(key, planOf(t)[key])))
    }
  })
  it('covers every feature flag the plans differ on', () => {
    const keys = new Set([...document.querySelectorAll('#comparison-table tr[data-limit]')].map((r) => r.dataset.limit))
    for (const k of ['members', 'emails_monthly', 'sms_monthly', 'royal_queries_monthly', 'review_mode', 'autonomous_mode',
      'business_learning', 'fatigue_protection', 'performance_metrics', 'visit_attribution', 'white_label',
      'email_support', 'priority_support', 'dedicated_support']) {
      expect(keys.has(k), k).toBe(true)
    }
  })
  it('group rows span all five columns', () => {
    document.querySelectorAll('#comparison-table tr.feature-group td').forEach((td) => expect(td.getAttribute('colspan')).toBe('5'))
  })
})

describe('plan cards', () => {
  it('prices match PLAN_LIMITS, monthly and annual', () => {
    for (const t of ['starter', 'growth', 'scale']) {
      const el = card(t).querySelector('.price-amount')
      expect(Number(el.dataset.monthly), t).toBe(PL.subscription[t].price_monthly)
      expect(Number(el.dataset.annual), t).toBe(PL.subscription[t].price_annual)
      expect(el.textContent.trim()).toBe('$' + PL.subscription[t].price_monthly)
    }
  })
  it('customer counts on the cards match PLAN_LIMITS', () => {
    for (const t of TIERS) {
      const n = planOf(t).members.toLocaleString('en-US')
      expect(card(t).querySelector('.plan-features-list').textContent, t).toContain(`${n} customers`)
    }
  })
  it('the Royalty Pro card matches PLAN_LIMITS.royalty_pro', () => {
    const rp = PL.royalty_pro
    const box = $('royalty-pro-section').textContent
    expect(box).toContain('$' + rp.price_monthly)
    expect(box).toContain(`+${rp.emails_monthly_bonus.toLocaleString('en-US')} emails/mo + ${rp.sms_monthly} SMS/mo`)
  })
})

describe('no embedded checkout, no promo box (D2)', () => {
  it('the page loads no Stripe.js and has no modal or promo field', () => {
    expect(HTML).not.toContain('js.stripe.com')
    expect(HTML).not.toMatch(/checkout-modal|checkout-promo|promo-code/)
    expect(JS).not.toMatch(/validatePromoCode|initEmbeddedCheckout|STRIPE_PUBLISHABLE_KEY|embedded: true/)
  })
  it('no link goes to the broken settings ?tab=billing', () => {
    expect(HTML).not.toContain('tab=billing')
  })
  it('checkout asks for Stripe-hosted checkout and goes there', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test' }) }))
    vi.stubGlobal('fetch', fetchMock)
    window.__up.set(FREE, 'owner')
    const b = btn('growth')
    const p = window.__up.checkout('growth', b)
    expect(b.disabled).toBe(true)
    await p.catch(() => {})
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/functions\/v1\/create-checkout-session$/)
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ priceKey: 'growth_monthly', organizationId: 'org-1', embedded: false })
    expect(body.successUrl).toMatch(/\/app\/upgrade\.html\?success=true$/)
    expect(body.cancelUrl).toMatch(/\/app\/upgrade\.html\?canceled=true$/)
    expect(body).not.toHaveProperty('promoCode')
    expect(window.location.assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test')
  })
  it('a refusal (409) is shown and the button comes back', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'This organization already has a subscription.' }) })))
    window.__up.set(FREE, 'owner')
    const b = btn('scale')
    b.textContent = 'Start Free Trial'
    await window.__up.checkout('scale', b)
    expect(window.showToast).toHaveBeenCalledWith(expect.stringMatching(/already has a subscription/), 'error')
    expect(b.disabled).toBe(false)
    expect(b.textContent).toBe('Start Free Trial')
  })
})

describe('plan names come from PLAN_LIMITS', () => {
  it('names every kind of org', () => {
    expect(window.__up.planName(FREE)).toBe('Free')
    expect(window.__up.planName(GROWTH)).toBe('Growth')
    expect(window.__up.planName({ ...GROWTH, subscription_tier: 'starter' })).toBe('Starter')
    expect(window.__up.planName({ ...GROWTH, subscription_tier: 'scale' })).toBe('Scale')
    expect(window.__up.planName(LEGACY_PRO)).toBe('Pro')
    expect(window.__up.planName({ ...GROWTH, subscription_tier: 'enterprise' })).toBe('Enterprise')
    expect(window.__up.planName(LTD)).toBe('AppSumo Lifetime Tier 2')
    expect(window.__up.planName({ ...LTD, has_royalty_pro: true })).toBe('AppSumo Lifetime Tier 2 + Royalty Pro')
  })
})

describe('the page for each kind of org', () => {
  it('free org: Free is current, the paid cards start a trial', () => {
    window.__up.set(FREE, 'owner'); window.__up.render()
    expect($('current-plan-name').textContent).toBe('Free')
    expect(btn('free').disabled).toBe(true)
    expect(btn('free').textContent).toBe('Current Plan')
    expect(card('free').classList.contains('current')).toBe(true)
    for (const t of ['starter', 'growth', 'scale']) {
      expect(btn(t).classList.contains('checkout-btn'), t).toBe(true)
      expect(btn(t).textContent).toBe('Start Free Trial')
      expect(btn(t).disabled).toBe(false)
    }
    expect($('manage-billing-link').style.display).toBe('none')
    expect($('page-subtitle').textContent).toMatch(/No card needed/)
  })
  it('free org that had a subscription: no trial promised', () => {
    window.__up.set(HAD_ONE, 'owner'); window.__up.render()
    expect(btn('growth').textContent).toBe('Subscribe')
    expect($('page-subtitle').textContent).not.toMatch(/free trial/)
  })
  it('Growth subscriber: banner says Growth + Trial; Growth is current; others change plan in the portal', () => {
    window.__up.set(GROWTH, 'owner'); window.__up.render()
    expect($('current-plan-name').textContent).toBe('Growth')
    expect($('current-plan-status').textContent).toBe('Trial')
    expect(card('growth').classList.contains('current')).toBe(true)
    expect(btn('growth').disabled).toBe(true)
    expect(card('free').classList.contains('current')).toBe(false)
    for (const t of ['free', 'starter', 'scale']) {
      expect(btn(t).classList.contains('portal-btn'), t).toBe(true)
      expect(btn(t).classList.contains('checkout-btn'), t).toBe(false)
      expect(btn(t).textContent).toBe('Change Plan')
    }
    expect(btn('scale').classList.contains('btn-primary')).toBe(true) // higher tier
    expect(btn('starter').classList.contains('btn-secondary')).toBe(true)
    expect($('manage-billing-link').style.display).toBe('inline-flex')
    expect(document.querySelectorAll('.upgrade-plan-card .checkout-btn')).toHaveLength(0)
  })
  it('legacy Pro subscriber: named Pro, nothing marked current, everything via the portal', () => {
    window.__up.set(LEGACY_PRO, 'owner'); window.__up.render()
    expect($('current-plan-name').textContent).toBe('Pro')
    expect(document.querySelectorAll('.upgrade-plan-card.current')).toHaveLength(0)
    expect(document.querySelectorAll('.upgrade-plan-card .checkout-btn')).toHaveLength(0)
    // pro ranks with growth: scale is the only step up
    expect(btn('scale').classList.contains('btn-primary')).toBe(true)
    expect(btn('growth').classList.contains('btn-secondary')).toBe(true)
  })
  it('AppSumo lifetime org sees only the Royalty Pro add-on', () => {
    window.__up.set(LTD, 'owner'); window.__up.render()
    expect($('upgrade-plans').style.display).toBe('none')
    expect($('billing-toggle-container').style.display).toBe('none')
    expect($('comparison-section').style.display).toBe('none')
    expect($('royalty-pro-section').style.display).toBe('block')
    const rp = $('royalty-pro-section').querySelector('[data-plan="royalty_pro"]')
    expect(rp.classList.contains('checkout-btn')).toBe(true)
    expect(rp.disabled).toBe(false)
  })
  it('AppSumo org that already has Royalty Pro cannot buy it again', () => {
    window.__up.set({ ...LTD, has_royalty_pro: true, royalty_pro_status: 'active', stripe_customer_id: 'cus_2' }, 'owner'); window.__up.render()
    const rp = $('royalty-pro-section').querySelector('[data-plan="royalty_pro"]')
    expect(rp.disabled).toBe(true)
    expect(rp.classList.contains('checkout-btn')).toBe(false)
    expect($('manage-billing-link').style.display).toBe('inline-flex')
  })
  it('Royalty Pro is hidden from everyone else', () => {
    for (const org of [FREE, GROWTH]) {
      window.__up.set(org, 'owner'); window.__up.render()
      expect($('royalty-pro-section').style.display).toBe('none')
    }
  })
  it('a plain member sees no checkout', () => {
    window.__up.set(FREE, 'member'); window.__up.render()
    for (const t of ['starter', 'growth', 'scale']) {
      expect(btn(t).disabled, t).toBe(true)
      expect(btn(t).classList.contains('checkout-btn')).toBe(false)
    }
  })
  it('"view as" shows no checkout buttons anywhere', () => {
    sessionStorage.setItem('adminViewAsOrg', JSON.stringify({ orgId: 'x' }))
    for (const org of [FREE, GROWTH, LTD]) {
      document.body.innerHTML = BODY
      window.__up.set(org, 'owner'); window.__up.render()
      const live = [...document.querySelectorAll('.checkout-btn, .portal-btn')].filter((b) => !b.disabled && b.offsetParent !== undefined && !b.closest('[style*="display: none"]') && !b.hidden)
      expect(live.filter((b) => !b.closest('#upgrade-success')), org.plan_type).toHaveLength(0)
    }
  })
})

describe('?plan= deep link', () => {
  it('free org: highlights the card, strips the parameter, starts nothing', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const replace = vi.spyOn(window.history, 'replaceState')
    window.location.search = '?plan=growth&x=1'
    window.__up.set(FREE, 'owner'); window.__up.render(); window.__up.deepLink()
    expect(card('growth').classList.contains('is-highlighted')).toBe(true)
    expect(replace).toHaveBeenCalledWith({}, '', '/app/upgrade.html?x=1')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(window.location.assign).not.toHaveBeenCalled()
  })
  it('subscribed org or a bad value: stripped, nothing highlighted', () => {
    const replace = vi.spyOn(window.history, 'replaceState')
    window.location.search = '?plan=scale'
    window.__up.set(GROWTH, 'owner'); window.__up.render(); window.__up.deepLink()
    expect(document.querySelectorAll('.is-highlighted')).toHaveLength(0)
    expect(replace).toHaveBeenCalledWith({}, '', '/app/upgrade.html')
    window.location.search = '?plan=max'
    window.__up.set(FREE, 'owner'); window.__up.render(); window.__up.deepLink()
    expect(document.querySelectorAll('.is-highlighted')).toHaveLength(0)
  })
})

describe('success screen', () => {
  it('waits neutrally until the webhook has set the plan', () => {
    window.__up.success(null)
    expect($('success-title').textContent).toBe('Starting your plan…')
    expect($('success-metrics').children).toHaveLength(0)
    expect($('success-manage-billing').hidden).toBe(true)
    window.__up.success(FREE, { timedOut: true })
    expect($('success-title').textContent).toBe('Almost there')
  })
  it('Growth trial: named Growth, Growth\'s own limits', () => {
    window.__up.success(GROWTH)
    expect($('success-title').textContent).toBe('Welcome to Growth!')
    expect($('success-subtitle').textContent).toMatch(/14-day free trial has started/)
    const tiles = $('success-metrics').textContent
    expect(tiles).toContain(PL.subscription.growth.members.toLocaleString('en-US'))
    expect(tiles).toContain(PL.subscription.growth.emails_monthly.toLocaleString('en-US'))
    expect(tiles).toContain('Autonomous Mode')
    expect(tiles).not.toMatch(/Unlimited/) // Pro's old claim
    expect($('success-manage-billing').hidden).toBe(false)
  })
  it('Starter and Scale get their own names and limits', () => {
    window.__up.success({ ...GROWTH, subscription_tier: 'starter', subscription_status: 'active' })
    expect($('success-title').textContent).toBe('Welcome to Starter!')
    expect($('success-subtitle').textContent).toBe('Your subscription is active.')
    expect($('success-metrics').textContent).toContain('Review-mode automations')
    window.__up.success({ ...GROWTH, subscription_tier: 'scale' })
    expect($('success-title').textContent).toBe('Welcome to Scale!')
    expect($('success-metrics').textContent).toContain('10,000')
    expect($('success-metrics').textContent).toContain('Visit Attribution')
  })
  it('Royalty Pro add-on', () => {
    window.__up.success({ ...LTD, has_royalty_pro: true, royalty_pro_status: 'trialing', stripe_customer_id: 'cus' })
    expect($('success-title').textContent).toBe('Welcome to Royalty Pro!')
    expect($('success-metrics').textContent).toContain('+10,000')
  })
  it('never more than six tiles, never empty for a paid plan', () => {
    for (const t of ['starter', 'growth', 'scale']) {
      const m = window.__up.metrics(PL.subscription[t], false)
      expect(m.length, t).toBeGreaterThanOrEqual(4)
      expect(m.length, t).toBeLessThanOrEqual(6)
    }
  })
  it('polls the org every 2 s until the plan shows, then names it; "Back to my app" only from the offer', async () => {
    vi.useFakeTimers()
    const orgs = [FREE, FREE, GROWTH]
    const single = vi.fn()
    const memberFilters = []
    window.supabase = {
      from: (table) => {
        const q = {
          select: () => q,
          eq: (c, v) => { if (table === 'organization_members') memberFilters.push([c, v]); return q },
          limit: () => ({ single: async () => ({ data: { organization_id: 'org-1', role: 'owner' }, error: null }) }),
          single: async () => { single(); return { data: orgs.shift() || GROWTH, error: null } },
        }
        return q
      },
    }
    window.celebrate = vi.fn()
    window.__up.set(FREE, 'owner')
    const done = window.__up.showSuccess({ fromOffer: true })
    expect($('upgrade-success').style.display).toBe('block')
    expect($('success-back-to-app').hidden).toBe(false)
    expect($('success-title').textContent).toBe('Starting your plan…')
    await vi.advanceTimersByTimeAsync(2000)
    expect($('success-title').textContent).toBe('Starting your plan…')
    await vi.advanceTimersByTimeAsync(4000)
    await done
    expect(single).toHaveBeenCalledTimes(3)
    expect(memberFilters).toContainEqual(['is_impersonating', false]) // never a "view as" row
    expect($('success-title').textContent).toBe('Welcome to Growth!')
    expect(window.celebrate).toHaveBeenCalled()
  })
  it('gives up after 20 s with a calm message', async () => {
    vi.useFakeTimers()
    window.supabase = {
      from: () => {
        const q = {
          select: () => q,
          eq: () => q,
          limit: () => ({ single: async () => ({ data: { organization_id: 'org-1', role: 'owner' }, error: null }) }),
          single: async () => ({ data: FREE, error: null }),
        }
        return q
      },
    }
    window.__up.set(FREE, 'owner')
    const done = window.__up.showSuccess({})
    expect($('success-back-to-app').hidden).toBe(true)
    await vi.advanceTimersByTimeAsync(22000)
    await done
    expect($('success-title').textContent).toBe('Almost there')
  })
})

describe('the page stays English-only and current', () => {
  it('no retired price keys, the pinned Royalty Pro ternary kept', () => {
    expect(JS).toMatch(/plan === 'royalty_pro'\s*\?\s*'royalty_pro_monthly'/)
    expect(JS).not.toMatch(/['"](pro|max)_(monthly|annual)['"]/)
    expect(JS).not.toMatch(/let planName = 'Pro'|tierOrder\s*=\s*\{ free: 0, pro: 1/)
    expect(JS).toMatch(/UPGRADE_TIER_ORDER = \{ free: 0, starter: 1, growth: 2, scale: 3, pro: 2, max: 3 \}/)
  })
  it('returning browsers get the new files', () => {
    expect(HTML).toContain('upgrade.js?v=2"')
    expect(HTML).toContain('upgrade.css?v=2"')
    expect(HTML).toContain('plan-limits.js?v=3"')
  })
})
