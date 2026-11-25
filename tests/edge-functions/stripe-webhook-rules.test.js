/**
 * stripe-webhook: which subscription an event is about (plan abstract-gliding-hellman, Phase 4).
 *
 * Before: every subscription event on a Stripe customer applied to the org's plan. Cancelling the
 * Royalty Pro add-on (or a stray second subscription) dropped the org to Free; add-on updates
 * overwrote the tier; a trial's $0 opening invoice turned 'trialing' into 'active'.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  subscriptionRole, updatedTarget, deletedAction, paymentSucceededUpdate, paymentFailedColumn, invoiceIsAddOn,
} from '../../supabase/functions/_shared/stripe-webhook-rules.ts'

const root = path.resolve(__dirname, '../..')
const src = fs.readFileSync(path.join(root, 'supabase/functions/stripe-webhook/index.ts'), 'utf8')

const ORG = { stripe_subscription_id: 'sub_main', royalty_pro_subscription_id: null }
const LTD_WITH_ADDON = { stripe_subscription_id: null, royalty_pro_subscription_id: 'sub_rp' }

describe('subscriptionRole', () => {
  it('the subscription the org runs on is main', () => {
    expect(subscriptionRole('sub_main', ORG, false)).toBe('main')
  })
  it('a different plan subscription on the same customer is other', () => {
    expect(subscriptionRole('sub_stray', ORG, false)).toBe('other')
  })
  it('no plan id on record → unlinked (events before checkout.session.completed)', () => {
    expect(subscriptionRole('sub_new', { stripe_subscription_id: null }, false)).toBe('unlinked')
  })
  it('the add-on, by its recorded id or (none recorded yet) by its price', () => {
    expect(subscriptionRole('sub_rp', LTD_WITH_ADDON, false)).toBe('addon')
    expect(subscriptionRole('sub_rp', LTD_WITH_ADDON, true)).toBe('addon')
    expect(subscriptionRole('sub_rp_new', { stripe_subscription_id: null, royalty_pro_subscription_id: null }, true)).toBe('addon')
  })
  it('a second add-on subscription is other, not the add-on', () => {
    expect(subscriptionRole('sub_rp2', LTD_WITH_ADDON, true)).toBe('other')
  })
  it('the add-on is never main, even on an org with a plan id', () => {
    expect(subscriptionRole('sub_rp', { stripe_subscription_id: 'sub_main', royalty_pro_subscription_id: 'sub_rp' }, false)).toBe('addon')
  })
  it('no subscription id → other', () => {
    expect(subscriptionRole(null, ORG, false)).toBe('other')
    expect(subscriptionRole(undefined, { stripe_subscription_id: null }, false)).toBe('other')
  })
})

describe('what each event may change', () => {
  it('subscription.deleted downgrades only for main', () => {
    expect(deletedAction('main')).toBe('downgrade')
    expect(deletedAction('addon')).toBe('addon')
    expect(deletedAction('other')).toBe(null)
    expect(deletedAction('unlinked')).toBe(null)
  })
  it('subscription.updated: plan for main, its own column for the add-on, nothing for other', () => {
    expect(updatedTarget('main', 'active')).toBe('plan')
    expect(updatedTarget('main', 'canceled')).toBe('plan') // the org's own subscription: always reported
    expect(updatedTarget('addon', 'canceled')).toBe('addon')
    expect(updatedTarget('other', 'active')).toBe(null)
  })
  it('an unlinked subscription writes the plan only while it runs (a late event can\'t revive a tier on a Free org)', () => {
    for (const s of ['trialing', 'active', 'past_due']) expect(updatedTarget('unlinked', s), s).toBe('plan')
    for (const s of ['canceled', 'incomplete_expired', '', null, undefined]) expect(updatedTarget('unlinked', s), String(s)).toBe(null)
  })
  it('invoiceIsAddOn reads the first line\'s price', () => {
    const isAddOn = (id) => id === 'price_rp'
    expect(invoiceIsAddOn({ lines: { data: [{ price: { id: 'price_rp' } }] } }, isAddOn)).toBe(true)
    expect(invoiceIsAddOn({ lines: { data: [{ price: { id: 'price_growth' } }] } }, isAddOn)).toBe(false)
    expect(invoiceIsAddOn({ lines: { data: [] } }, isAddOn)).toBe(false)
    expect(invoiceIsAddOn({}, isAddOn)).toBe(false)
    expect(invoiceIsAddOn(null, isAddOn)).toBe(false)
  })
  it('a lifetime org re-buying Royalty Pro: an early paid invoice is the add-on, never the plan', () => {
    // checkout.session.completed hasn't stored the new add-on id yet; the old one is on record.
    const org = { stripe_subscription_id: null, royalty_pro_subscription_id: 'sub_rp_old' }
    const role = subscriptionRole('sub_rp_new', org, invoiceIsAddOn({ lines: { data: [{ price: { id: 'price_rp' } }] } }, (id) => id === 'price_rp'))
    expect(role).toBe('other')
    expect(paymentSucceededUpdate(role, 7900)).toBe(null)
    expect(paymentFailedColumn(role)).toBe(null)
    // first purchase, nothing on record yet
    const first = subscriptionRole('sub_rp_1', { stripe_subscription_id: null, royalty_pro_subscription_id: null }, true)
    expect(paymentSucceededUpdate(first, 7900)).toEqual({ royalty_pro_status: 'active' })
  })
  it('a $0 invoice (trial start) changes nothing; a paid one marks the right column active', () => {
    expect(paymentSucceededUpdate('main', 0)).toBe(null)
    expect(paymentSucceededUpdate('main', null)).toBe(null)
    expect(paymentSucceededUpdate('main', 3999)).toEqual({ subscription_status: 'active' })
    expect(paymentSucceededUpdate('unlinked', 3999)).toEqual({ subscription_status: 'active' })
    expect(paymentSucceededUpdate('addon', 7900)).toEqual({ royalty_pro_status: 'active' })
    expect(paymentSucceededUpdate('other', 3999)).toBe(null)
  })
  it('a failed payment marks the subscription that failed', () => {
    expect(paymentFailedColumn('main')).toBe('subscription_status')
    expect(paymentFailedColumn('addon')).toBe('royalty_pro_status')
    expect(paymentFailedColumn('other')).toBe(null)
  })
})

describe('stripe-webhook/index.ts uses the rules', () => {
  const section = (name) => {
    const start = src.indexOf(`case '${name}'`)
    const next = src.indexOf("case '", start + 10)
    return src.slice(start, next > 0 ? next : undefined)
  }
  it('imports the rules module', () => {
    expect(src).toMatch(/from '\.\.\/_shared\/stripe-webhook-rules\.ts'/)
  })
  it('subscription.deleted asks deletedAction before the downgrade write', () => {
    const s = section('customer.subscription.deleted')
    expect(s).toMatch(/select\('id, stripe_subscription_id, royalty_pro_subscription_id'\)/)
    expect(s.indexOf('deletedAction(')).toBeGreaterThan(0)
    expect(s.indexOf('deletedAction(')).toBeLessThan(s.indexOf("plan_type: 'free'"))
    expect(s).toMatch(/has_royalty_pro: false/)
  })
  it('subscription.updated routes the add-on to royalty_pro_status before the tier write', () => {
    const s = section('customer.subscription.updated')
    expect(s).toMatch(/updatedTarget\(role, subscription\.status\)/)
    expect(s.indexOf('royalty_pro_status: subscription.status')).toBeLessThan(s.indexOf('subscription_tier: planInfo'))
  })
  it('invoice.payment_succeeded no longer writes active unconditionally', () => {
    const s = section('invoice.payment_succeeded')
    expect(s).toMatch(/paymentSucceededUpdate\(paidRole, invoice\.amount_paid\)/)
    expect(s).toMatch(/subscriptionRole\(invoice\.subscription as string \| null, org,\s*invoiceIsAddOn\(invoice,/)
    expect(s).not.toMatch(/subscription_status: 'active'/)
  })
  it('invoice.payment_failed marks the column for the subscription that failed', () => {
    const s = section('invoice.payment_failed')
    expect(s).toMatch(/paymentFailedColumn\(failedRole\)/)
    expect(s).toMatch(/subscriptionRole\(invoice\.subscription as string \| null, org, invoiceIsAddOn\(invoice, isAddOnInvoice\)\)/)
    expect(s).toMatch(/\[failedColumn\]: 'past_due'/)
  })
  it('keeps verify_jwt = false pinned in config.toml (Stripe signs, it has no JWT)', () => {
    const cfg = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8')
    expect(cfg).toMatch(/\[functions\.stripe-webhook\]\s*\nenabled = true\s*\nverify_jwt = false/)
  })
})
