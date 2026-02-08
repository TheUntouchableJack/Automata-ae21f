// Supabase Edge Function: Stripe Webhook Handler
// SECURE: Verifies webhook signature with STRIPE_WEBHOOK_SECRET

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Map Stripe price IDs to plan tiers - Created Feb 2026
const PRICE_TO_TIER: Record<string, { tier: string; billing: string; isAddOn?: boolean }> = {
  // Subscription tiers (Feb 2026 pricing)
  'price_1SyfQDGNy14i1og8tkBn6MF7': { tier: 'starter', billing: 'monthly' },  // $79/mo
  'price_1SyfQDGNy14i1og8r0NrGfNM': { tier: 'starter', billing: 'annual' },   // $63/mo
  'price_1SyfQEGNy14i1og80NnddnzC': { tier: 'growth', billing: 'monthly' },   // $199/mo
  'price_1SyfQEGNy14i1og8Ixg6I1Gz': { tier: 'growth', billing: 'annual' },    // $159/mo
  'price_1SyfQFGNy14i1og8fTrCAFaS': { tier: 'scale', billing: 'monthly' },    // $499/mo
  'price_1SyfQFGNy14i1og8DJu8DwfL': { tier: 'scale', billing: 'annual' },     // $399/mo
  // Royalty Pro add-on for LTD users
  'price_1SyfQGGNy14i1og8jvmoWMxo': { tier: 'royalty_pro', billing: 'monthly', isAddOn: true }, // $49/mo
}

// Map bundle types to credit amounts
const BUNDLE_CREDITS: Record<string, { sms: number; email: number }> = {
  'sms_bundle_100': { sms: 100, email: 0 },
  'email_bundle_5000': { sms: 0, email: 5000 },
}

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature')

  if (!signature) {
    return new Response('No signature', { status: 400 })
  }

  try {
    const body = await req.text()

    // Verify webhook signature
    const event = stripe.webhooks.constructEvent(body, signature, webhookSecret)

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // ===== IDEMPOTENCY CHECK =====
    // Prevent duplicate processing of the same webhook event
    const { data: existingEvent } = await supabase
      .from('processed_webhook_events')
      .select('event_id')
      .eq('event_id', event.id)
      .single()

    if (existingEvent) {
      console.log(`Skipping duplicate event: ${event.id}`)
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Record this event as being processed
    await supabase
      .from('processed_webhook_events')
      .insert({
        event_id: event.id,
        event_type: event.type,
        metadata: { timestamp: new Date().toISOString() }
      })

    console.log(`Processing Stripe event: ${event.type} (${event.id})`)

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const organizationId = session.metadata?.organization_id
        const purchaseType = session.metadata?.purchase_type
        const bundleType = session.metadata?.bundle_type

        if (!organizationId) {
          console.log('No organization ID in session metadata')
          break
        }

        // Handle bundle purchases (one-time payments)
        if (purchaseType === 'bundle' && bundleType) {
          const credits = BUNDLE_CREDITS[bundleType]
          if (credits) {
            // Add credits using the add_messaging_credits RPC
            await supabase.rpc('add_messaging_credits', {
              p_organization_id: organizationId,
              p_email_credits: credits.email,
              p_sms_credits: credits.sms,
            })

            console.log(`Organization ${organizationId} purchased ${bundleType}: +${credits.email} emails, +${credits.sms} SMS`)
          }
          break
        }

        // Handle subscription purchases
        if (session.subscription) {
          // Get subscription details
          const subscription = await stripe.subscriptions.retrieve(session.subscription as string)
          const priceId = subscription.items.data[0]?.price.id
          const planInfo = PRICE_TO_TIER[priceId]

          if (planInfo) {
            // Handle Royalty Pro add-on for LTD users
            if (planInfo.isAddOn && planInfo.tier === 'royalty_pro') {
              await supabase
                .from('organizations')
                .update({
                  has_royalty_pro: true,
                  royalty_pro_subscription_id: subscription.id,
                  royalty_pro_status: subscription.status,
                  plan_changed_at: new Date().toISOString(),
                })
                .eq('id', organizationId)

              console.log(`Organization ${organizationId} added Royalty Pro`)
            } else {
              // Regular subscription upgrade
              await supabase
                .from('organizations')
                .update({
                  plan_type: 'subscription',
                  subscription_tier: planInfo.tier,
                  stripe_subscription_id: subscription.id,
                  subscription_status: subscription.status,
                  plan_changed_at: new Date().toISOString(),
                })
                .eq('id', organizationId)

              console.log(`Organization ${organizationId} upgraded to ${planInfo.tier}`)
            }
          }
        }
        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string

        // Find organization by Stripe customer ID
        const { data: org } = await supabase
          .from('organizations')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (org) {
          const priceId = subscription.items.data[0]?.price.id
          const planInfo = PRICE_TO_TIER[priceId]

          // Build update object
          const updateData: Record<string, unknown> = {
            subscription_tier: planInfo?.tier || null,
            subscription_status: subscription.status,
            plan_changed_at: new Date().toISOString(),
          }

          // Track cancellation scheduling (cancel at period end)
          if (subscription.cancel_at_period_end && subscription.cancel_at) {
            // Subscription scheduled to cancel - store when it will end
            updateData.subscription_cancel_at = new Date(subscription.cancel_at * 1000).toISOString()
            console.log(`Organization ${org.id} scheduled cancellation for ${updateData.subscription_cancel_at}`)
          } else {
            // Not canceling or user reactivated - clear cancellation date
            updateData.subscription_cancel_at = null
          }

          await supabase
            .from('organizations')
            .update(updateData)
            .eq('id', org.id)

          console.log(`Organization ${org.id} subscription updated: ${subscription.status}`)
        }
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string

        // Find organization and downgrade to free
        const { data: org } = await supabase
          .from('organizations')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (org) {
          await supabase
            .from('organizations')
            .update({
              plan_type: 'free',
              subscription_tier: null,
              stripe_subscription_id: null,
              subscription_status: 'canceled',
              subscription_cancel_at: null, // Clear cancellation date
              plan_changed_at: new Date().toISOString(),
            })
            .eq('id', org.id)

          console.log(`Organization ${org.id} downgraded to free (subscription ended)`)
        }
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string

        // Find organization and mark payment failed
        const { data: org } = await supabase
          .from('organizations')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (org) {
          await supabase
            .from('organizations')
            .update({
              subscription_status: 'past_due',
            })
            .eq('id', org.id)

          console.log(`Organization ${org.id} payment failed`)
          // TODO: Send email notification about failed payment
        }
        break
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string

        // Find organization and confirm active status
        const { data: org } = await supabase
          .from('organizations')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (org) {
          await supabase
            .from('organizations')
            .update({
              subscription_status: 'active',
            })
            .eq('id', org.id)

          console.log(`Organization ${org.id} payment succeeded`)
        }
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Webhook error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
