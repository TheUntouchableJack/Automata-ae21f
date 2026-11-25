/**
 * Billing guards for create-checkout-session (plan abstract-gliding-hellman, Phase 4, 2026-11-25).
 *
 * Before: any owner/admin could start any subscription. A Growth subscriber could buy a second
 * plan, an AppSumo lifetime org could buy a plan over its lifetime deal, every subscription got a
 * fresh 14-day trial, and a super admin "viewing as" an org could start a checkout for it.
 * These tests pin decide() and that the function calls it before Stripe is touched.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  decide, kindOf, hasLiveSubscription, neverSubscribed, neverHadAddon, safeReturnUrl,
  REFUSAL_MESSAGES, TRIAL_DAYS,
} from '../../supabase/functions/_shared/checkout-rules.ts'

const root = path.resolve(__dirname, '../..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')

const OWNER = { role: 'owner', is_impersonating: false }
const ADMIN = { role: 'admin', is_impersonating: false }
const MEMBER = { role: 'member', is_impersonating: false }
const VIEW_AS = { role: 'owner', is_impersonating: true }

// A brand-new org as the column defaults leave it.
const FRESH = { plan_type: 'free', subscription_status: 'inactive', stripe_subscription_id: null, cancelled_at: null }
const GROWTH_TRIAL = { plan_type: 'subscription', subscription_status: 'trialing', stripe_subscription_id: 'sub_1' }
const CANCELLED = { plan_type: 'free', subscription_status: 'canceled', stripe_subscription_id: null, cancelled_at: '2026-11-01T00:00:00Z' }
const LTD = { plan_type: 'appsumo_lifetime', has_royalty_pro: false, royalty_pro_subscription_id: null, royalty_pro_status: null }

describe('kindOf', () => {
  it('sorts every price key the function knows', () => {
    for (const t of ['starter', 'growth', 'scale']) {
      expect(kindOf(`${t}_monthly`)).toBe('tier')
      expect(kindOf(`${t}_annual`)).toBe('tier')
    }
    expect(kindOf('royalty_pro_monthly')).toBe('addon')
    expect(kindOf('sms_bundle_100')).toBe('bundle')
    expect(kindOf('email_bundle_5000')).toBe('bundle')
  })
  it('refuses legacy and malformed keys', () => {
    for (const k of ['pro_monthly', 'max_annual', 'royalty_pro_annual', 'growth', 'growth_monthly ', '', null, 7]) {
      expect(kindOf(k)).toBe(null)
    }
  })
  it('every key in PRICES has a kind (no price slips past decide)', () => {
    const src = read('supabase/functions/create-checkout-session/index.ts')
    const block = src.slice(src.indexOf('const PRICES'), src.indexOf('}', src.indexOf('const PRICES')))
    const keys = [...block.matchAll(/^\s*([a-z_0-9]+):\s*'price_/gm)].map((m) => m[1])
    expect(keys.length).toBe(9)
    for (const k of keys) expect(kindOf(k), k).not.toBe(null)
  })
})

describe('decide: who may check out', () => {
  it('owner and admin may; member and non-member may not', () => {
    expect(decide({ priceKey: 'growth_monthly', org: FRESH, membership: OWNER }).ok).toBe(true)
    expect(decide({ priceKey: 'growth_monthly', org: FRESH, membership: ADMIN }).ok).toBe(true)
    expect(decide({ priceKey: 'growth_monthly', org: FRESH, membership: MEMBER })).toMatchObject({ ok: false, status: 403, code: 'not_owner_or_admin' })
    expect(decide({ priceKey: 'growth_monthly', org: FRESH, membership: null })).toMatchObject({ ok: false, status: 403 })
    expect(decide({ priceKey: 'growth_monthly', org: FRESH, membership: undefined })).toMatchObject({ ok: false, status: 403 })
  })
  it('"view as" is refused for every kind, bundles included', () => {
    for (const priceKey of ['growth_monthly', 'royalty_pro_monthly', 'sms_bundle_100']) {
      const org = priceKey === 'royalty_pro_monthly' ? LTD : FRESH
      expect(decide({ priceKey, org, membership: VIEW_AS })).toMatchObject({ ok: false, status: 403, code: 'impersonating' })
    }
  })
  it('an unknown price is a 400 before anything else', () => {
    expect(decide({ priceKey: 'max_monthly', org: FRESH, membership: null })).toMatchObject({ ok: false, status: 400, code: 'invalid_price' })
  })
})

describe('decide: plans (Starter/Growth/Scale)', () => {
  it('a fresh free org gets the 14-day trial', () => {
    expect(decide({ priceKey: 'growth_monthly', org: FRESH, membership: OWNER }))
      .toEqual({ ok: true, status: 200, code: 'ok', trialDays: TRIAL_DAYS, kind: 'tier' })
    expect(TRIAL_DAYS).toBe(14)
  })
  it('null plan_type and null/empty status count as a fresh org', () => {
    expect(decide({ priceKey: 'scale_annual', org: {}, membership: OWNER }).trialDays).toBe(14)
    expect(decide({ priceKey: 'scale_annual', org: { plan_type: null, subscription_status: '' }, membership: OWNER }).trialDays).toBe(14)
  })
  it('an org that had a subscription before pays from day one (no second trial)', () => {
    expect(decide({ priceKey: 'growth_monthly', org: CANCELLED, membership: OWNER })).toMatchObject({ ok: true, trialDays: 0 })
    expect(decide({ priceKey: 'growth_monthly', org: { ...FRESH, cancelled_at: '2026-01-01' }, membership: OWNER }).trialDays).toBe(0)
    expect(decide({ priceKey: 'growth_monthly', org: { ...FRESH, subscription_status: 'incomplete_expired' }, membership: OWNER }).trialDays).toBe(0)
  })
  it('a subscribed org cannot start a second plan', () => {
    for (const org of [
      GROWTH_TRIAL,
      { ...GROWTH_TRIAL, subscription_status: 'active' },
      { ...GROWTH_TRIAL, subscription_status: 'past_due' },
      { plan_type: 'subscription', subscription_status: 'active', stripe_subscription_id: null }, // admin-granted
    ]) {
      expect(decide({ priceKey: 'starter_monthly', org, membership: OWNER })).toMatchObject({ ok: false, status: 409, code: 'already_subscribed' })
    }
  })
  it('a free org still holding a live subscription id is refused too', () => {
    const org = { plan_type: 'free', subscription_status: 'active', stripe_subscription_id: 'sub_x' }
    expect(decide({ priceKey: 'growth_monthly', org, membership: OWNER })).toMatchObject({ status: 409, code: 'already_subscribed' })
  })
  it('a free org with a dead subscription id may subscribe again (no trial)', () => {
    const org = { plan_type: 'free', subscription_status: 'canceled', stripe_subscription_id: 'sub_old' }
    expect(decide({ priceKey: 'growth_monthly', org, membership: OWNER })).toMatchObject({ ok: true, trialDays: 0 })
  })
  it('AppSumo lifetime orgs are pointed at Royalty Pro', () => {
    expect(decide({ priceKey: 'growth_monthly', org: LTD, membership: OWNER })).toMatchObject({ ok: false, status: 409, code: 'ltd_use_royalty_pro' })
  })
})

describe('decide: Royalty Pro add-on', () => {
  it('a lifetime org without it may add it, with a trial the first time', () => {
    expect(decide({ priceKey: 'royalty_pro_monthly', org: LTD, membership: OWNER })).toMatchObject({ ok: true, trialDays: 14, kind: 'addon' })
    const hadIt = { ...LTD, royalty_pro_subscription_id: 'sub_rp', royalty_pro_status: 'canceled' }
    expect(decide({ priceKey: 'royalty_pro_monthly', org: hadIt, membership: OWNER })).toMatchObject({ ok: true, trialDays: 0 })
  })
  it('not twice', () => {
    expect(decide({ priceKey: 'royalty_pro_monthly', org: { ...LTD, has_royalty_pro: true }, membership: OWNER }))
      .toMatchObject({ ok: false, status: 409, code: 'already_subscribed' })
    expect(decide({ priceKey: 'royalty_pro_monthly', org: { ...LTD, royalty_pro_subscription_id: 'sub_rp', royalty_pro_status: 'trialing' }, membership: OWNER }))
      .toMatchObject({ ok: false, status: 409 })
  })
  it('only for lifetime orgs', () => {
    for (const org of [FRESH, GROWTH_TRIAL, {}]) {
      expect(decide({ priceKey: 'royalty_pro_monthly', org, membership: OWNER })).toMatchObject({ ok: false, status: 409, code: 'royalty_pro_ltd_only' })
    }
  })
})

describe('decide: bundles are unchanged', () => {
  it('any plan may buy a bundle, never with a trial', () => {
    for (const org of [FRESH, GROWTH_TRIAL, LTD, CANCELLED]) {
      expect(decide({ priceKey: 'sms_bundle_100', org, membership: ADMIN })).toEqual({ ok: true, status: 200, code: 'ok', trialDays: 0, kind: 'bundle' })
    }
  })
})

describe('helpers', () => {
  it('hasLiveSubscription needs an id AND a running status', () => {
    expect(hasLiveSubscription({ stripe_subscription_id: 'sub', subscription_status: 'trialing' })).toBe(true)
    expect(hasLiveSubscription({ stripe_subscription_id: 'sub', subscription_status: 'canceled' })).toBe(false)
    expect(hasLiveSubscription({ stripe_subscription_id: null, subscription_status: 'active' })).toBe(false)
  })
  it('neverSubscribed / neverHadAddon', () => {
    expect(neverSubscribed(FRESH)).toBe(true)
    expect(neverSubscribed({ ...FRESH, stripe_subscription_id: 'sub' })).toBe(false)
    expect(neverHadAddon(LTD)).toBe(true)
    expect(neverHadAddon({ ...LTD, royalty_pro_status: 'canceled' })).toBe(false)
  })
  it('every refusal code has a message', () => {
    for (const code of ['invalid_price', 'not_owner_or_admin', 'impersonating', 'already_subscribed', 'ltd_use_royalty_pro', 'royalty_pro_ltd_only']) {
      expect(REFUSAL_MESSAGES[code], code).toBeTruthy()
    }
  })
  it('safeReturnUrl keeps our own pages and drops anything else', () => {
    const allowed = ['https://royaltyapp.ai', 'http://localhost:5173']
    const fb = 'https://royaltyapp.ai/app/upgrade.html?canceled=true'
    const ok = 'https://royaltyapp.ai/app/upgrade.html?session_id={CHECKOUT_SESSION_ID}&success=true&from=offer'
    expect(safeReturnUrl(ok, allowed, fb)).toBe(ok) // {CHECKOUT_SESSION_ID} left unencoded for Stripe
    expect(safeReturnUrl('http://localhost:5173/app/dashboard.html', allowed, fb)).toBe('http://localhost:5173/app/dashboard.html')
    for (const bad of ['https://evil.example/app', 'https://royaltyapp.ai.evil.example/', 'javascript:alert(1)', '/app/dashboard.html', '', null, 42]) {
      expect(safeReturnUrl(bad, allowed, fb), String(bad)).toBe(fb)
    }
  })
})

describe('create-checkout-session uses decide()', () => {
  const src = read('supabase/functions/create-checkout-session/index.ts')
  it('imports the rules and decides before any Stripe customer is created', () => {
    expect(src).toMatch(/from '\.\.\/_shared\/checkout-rules\.ts'/)
    const decideAt = src.indexOf('decide({ priceKey, org, membership })')
    expect(decideAt).toBeGreaterThan(0)
    expect(decideAt).toBeLessThan(src.indexOf('stripe.customers.create'))
    expect(decideAt).toBeLessThan(src.indexOf('stripe.checkout.sessions.create'))
  })
  it('selects every column decide() reads', () => {
    for (const col of ['plan_type', 'subscription_status', 'stripe_subscription_id', 'cancelled_at', 'has_royalty_pro', 'royalty_pro_subscription_id', 'royalty_pro_status']) {
      expect(src).toContain(col)
    }
    expect(src).toMatch(/\.select\('role, is_impersonating'\)/)
  })
  it('the trial is decide()\'s, with no card and cancel-at-end (D1); no hard-coded 14', () => {
    expect(src).not.toMatch(/trial_period_days:\s*14/)
    expect(src).toMatch(/trial_period_days = decision\.trialDays/)
    expect(src).toMatch(/missing_payment_method: 'cancel'/)
    expect(src).toMatch(/payment_method_collection = 'if_required'/)
    expect(src).toMatch(/trialDays: decision\.trialDays/)
  })
  it('return URLs from the browser go through safeReturnUrl', () => {
    expect(src).toMatch(/success_url = safeReturnUrl\(successUrl/)
    expect(src).toMatch(/cancel_url = safeReturnUrl\(cancelUrl/)
  })
  it('a Stripe failure never reaches the browser as Stripe wrote it (it can name the masked key)', () => {
    const tail = src.slice(src.lastIndexOf('} catch (error) {'))
    expect(tail).not.toMatch(/error\.message/)
    expect(tail).toContain("code: 'checkout_unavailable'")
    expect(tail).toContain("console.error('Error creating checkout session:', error)")
  })
  it('keeps verify_jwt = true in config.toml', () => {
    const cfg = read('supabase/config.toml')
    expect(cfg).toMatch(/\[functions\.create-checkout-session\]\s*\nenabled = true\s*\nverify_jwt = true/)
  })
})
