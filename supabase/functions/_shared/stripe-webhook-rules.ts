// Which of an org's subscriptions a Stripe event is about, and what that event may change.
// Plan abstract-gliding-hellman, Phase 4 (2026-11-25).
//
// stripe-webhook used to find the org by Stripe customer and apply every subscription event to
// the org's plan. So cancelling ANY subscription on the customer (a stray second one, or the
// Royalty Pro add-on) dropped the org to Free, add-on updates overwrote the plan tier, and the
// $0 invoice at the start of a trial flipped 'trialing' to 'active'.
//
// This file imports nothing, so vitest can load it directly
// (tests/edge-functions/stripe-webhook-rules.test.js).

export type WebhookOrg = {
  stripe_subscription_id?: string | null
  royalty_pro_subscription_id?: string | null
}

/**
 * 'main'     the org's plan subscription (id matches stripe_subscription_id)
 * 'unlinked' the org has no plan subscription id on record (events arriving before
 *            checkout.session.completed, or a subscription made by hand in the Stripe dashboard)
 * 'addon'    the Royalty Pro add-on
 * 'other'    a subscription the org doesn't run on (a stray second subscription)
 */
export type SubscriptionRole = 'main' | 'unlinked' | 'addon' | 'other'

export function subscriptionRole(
  subId: string | null | undefined,
  org: WebhookOrg,
  isAddOnPrice: boolean,
): SubscriptionRole {
  if (!subId) return 'other'
  const addonId = org.royalty_pro_subscription_id || null
  if (addonId && subId === addonId) return 'addon'
  if (isAddOnPrice) return addonId ? 'other' : 'addon'
  if (org.stripe_subscription_id) return subId === org.stripe_subscription_id ? 'main' : 'other'
  return 'unlinked'
}

const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'])

/**
 * subscription.updated: which columns to write, or null to leave the org alone. An unlinked
 * subscription writes the plan only while it is running: a late event for one that already ended
 * (Stripe doesn't guarantee order) must not put its old tier back on an org that is now Free.
 */
export function updatedTarget(role: SubscriptionRole, status?: string | null): 'plan' | 'addon' | null {
  if (role === 'main') return 'plan'
  if (role === 'unlinked') return LIVE_STATUSES.has(String(status || '')) ? 'plan' : null
  if (role === 'addon') return 'addon'
  return null
}

/** The add-on flag for an invoice, from its first line's price (the invoice handlers have no other). */
export function invoiceIsAddOn(
  invoice: { lines?: { data?: Array<{ price?: { id?: string } | null }> } } | null | undefined,
  isAddOnPrice: (priceId: string) => boolean,
): boolean {
  const priceId = invoice?.lines?.data?.[0]?.price?.id
  return !!priceId && isAddOnPrice(priceId)
}

/**
 * subscription.deleted: 'downgrade' moves the org to Free (only for the subscription it runs on);
 * 'addon' removes Royalty Pro and keeps the plan; null leaves the org alone.
 */
export function deletedAction(role: SubscriptionRole): 'downgrade' | 'addon' | null {
  if (role === 'main') return 'downgrade'
  if (role === 'addon') return 'addon'
  return null
}

/**
 * invoice.payment_succeeded: the column update, or null. A $0 invoice (the one that opens a
 * trial) changes nothing: subscription.updated already carries the real status.
 */
export function paymentSucceededUpdate(
  role: SubscriptionRole,
  amountPaid: number | null | undefined,
): Record<string, string> | null {
  if (!(Number(amountPaid) > 0)) return null
  if (role === 'main' || role === 'unlinked') return { subscription_status: 'active' }
  if (role === 'addon') return { royalty_pro_status: 'active' }
  return null
}

/** invoice.payment_failed: the status column to mark past_due, or null. */
export function paymentFailedColumn(role: SubscriptionRole): 'subscription_status' | 'royalty_pro_status' | null {
  if (role === 'main' || role === 'unlinked') return 'subscription_status'
  if (role === 'addon') return 'royalty_pro_status'
  return null
}
