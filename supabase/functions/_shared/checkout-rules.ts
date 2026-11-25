// Who may start which Stripe checkout, and whether it gets the 14-day trial.
// Plan abstract-gliding-hellman, Phase 4 (2026-11-25).
//
// Before this, create-checkout-session let any owner/admin start any subscription: a Growth
// subscriber could buy a second plan, an AppSumo lifetime org could buy a plan that overwrote
// its lifetime deal, and every subscription got a fresh 14-day trial.
//
// This file imports nothing, so vitest can load it directly (tests/edge-functions/checkout-rules.test.js).

export type CheckoutOrg = {
  plan_type?: string | null
  subscription_status?: string | null
  stripe_subscription_id?: string | null
  cancelled_at?: string | null
  has_royalty_pro?: boolean | null
  royalty_pro_subscription_id?: string | null
  royalty_pro_status?: string | null
}

export type CheckoutMembership = {
  role?: string | null
  is_impersonating?: boolean | null
} | null | undefined

export type CheckoutKind = 'tier' | 'addon' | 'bundle'

export type CheckoutDecision = {
  ok: boolean
  status: number
  code: string
  trialDays: number
  kind: CheckoutKind | null
}

export const TRIAL_DAYS = 14

/** Stripe statuses that mean a subscription is still running (or still owed money). */
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'])

/** Statuses an org has before it ever subscribed ('inactive' is the column default). */
const NEVER_SUBSCRIBED_STATUSES = new Set(['', 'inactive'])

export function kindOf(priceKey: unknown): CheckoutKind | null {
  if (typeof priceKey !== 'string') return null
  if (/^(starter|growth|scale)_(monthly|annual)$/.test(priceKey)) return 'tier'
  if (priceKey === 'royalty_pro_monthly') return 'addon'
  if (/^(sms_bundle_|email_bundle_)\d+$/.test(priceKey)) return 'bundle'
  return null
}

export function isLiveStatus(status: unknown): boolean {
  return typeof status === 'string' && LIVE_STATUSES.has(status)
}

/** The org's main plan subscription is still running. */
export function hasLiveSubscription(org: CheckoutOrg): boolean {
  return !!org.stripe_subscription_id && isLiveStatus(org.subscription_status)
}

/** The org has never had a plan subscription: no id, never cancelled, status still the default. */
export function neverSubscribed(org: CheckoutOrg): boolean {
  const status = org.subscription_status ?? ''
  return !org.stripe_subscription_id && !org.cancelled_at && NEVER_SUBSCRIBED_STATUSES.has(status)
}

/** The org has never had the Royalty Pro add-on. */
export function neverHadAddon(org: CheckoutOrg): boolean {
  const status = org.royalty_pro_status ?? ''
  return !org.royalty_pro_subscription_id && NEVER_SUBSCRIBED_STATUSES.has(status)
}

function refuse(status: number, code: string, kind: CheckoutKind | null): CheckoutDecision {
  return { ok: false, status, code, trialDays: 0, kind }
}

/**
 * Decide a checkout request. `org` and `membership` are the rows as the service role reads them;
 * `membership` is null when the user isn't a member.
 */
export function decide(input: {
  priceKey: unknown
  org: CheckoutOrg
  membership: CheckoutMembership
}): CheckoutDecision {
  const { priceKey, org, membership } = input
  const kind = kindOf(priceKey)
  if (!kind) return refuse(400, 'invalid_price', null)

  if (!membership || !['owner', 'admin'].includes(String(membership.role || ''))) {
    return refuse(403, 'not_owner_or_admin', kind)
  }
  // A super admin "viewing as" this org holds a temporary membership row. They must never
  // start a checkout that bills the owner's card or changes the owner's plan.
  if (membership.is_impersonating) return refuse(403, 'impersonating', kind)

  if (kind === 'bundle') return { ok: true, status: 200, code: 'ok', trialDays: 0, kind }

  const planType = org.plan_type ?? 'free'

  if (kind === 'tier') {
    if (planType === 'appsumo_lifetime') return refuse(409, 'ltd_use_royalty_pro', kind)
    if (planType !== 'free' || hasLiveSubscription(org)) return refuse(409, 'already_subscribed', kind)
    return { ok: true, status: 200, code: 'ok', trialDays: neverSubscribed(org) ? TRIAL_DAYS : 0, kind }
  }

  // kind === 'addon': the Royalty Pro add-on is for AppSumo lifetime orgs only, once.
  if (planType !== 'appsumo_lifetime') return refuse(409, 'royalty_pro_ltd_only', kind)
  if (org.has_royalty_pro || (!!org.royalty_pro_subscription_id && isLiveStatus(org.royalty_pro_status))) {
    return refuse(409, 'already_subscribed', kind)
  }
  return { ok: true, status: 200, code: 'ok', trialDays: neverHadAddon(org) ? TRIAL_DAYS : 0, kind }
}

/** What the owner reads when a checkout is refused. */
export const REFUSAL_MESSAGES: Record<string, string> = {
  invalid_price: 'Invalid price key',
  not_owner_or_admin: 'Access denied. Only owners and admins can manage subscriptions.',
  impersonating: 'Checkout is turned off while you are viewing this organization as an admin.',
  already_subscribed: 'This organization already has a subscription. Use "Manage billing" to change plans.',
  ltd_use_royalty_pro: 'Your lifetime deal already includes a plan. Add Royalty Pro instead.',
  royalty_pro_ltd_only: 'Royalty Pro is an add-on for lifetime-deal accounts.',
}

/**
 * Keep a client-supplied return URL only when it points back at an allowed origin.
 * Anything else falls back to `fallback`, so a checkout can never send someone off-site.
 */
export function safeReturnUrl(url: unknown, allowedOrigins: string[], fallback: string): string {
  if (typeof url !== 'string' || !url) return fallback
  try {
    // Return the string as given: Stripe fills `{CHECKOUT_SESSION_ID}` in only if it stays unencoded.
    return allowedOrigins.includes(new URL(url).origin) ? url : fallback
  } catch {
    return fallback
  }
}
