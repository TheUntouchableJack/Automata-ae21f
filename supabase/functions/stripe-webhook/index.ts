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

// Map Stripe price IDs to plan tiers - LIVE MODE Feb 11, 2026
const PRICE_TO_TIER: Record<string, { tier: string; billing: string; isAddOn?: boolean }> = {
  // Pro tier ($299/mo or $239/mo annual)
  'price_1SziieGNy14i1og8BYi4vv84': { tier: 'pro', billing: 'monthly' },
  'price_1SziifGNy14i1og8tiGIwHdw': { tier: 'pro', billing: 'annual' },
  // Max tier ($749/mo or $599/mo annual)
  'price_1SzijTGNy14i1og8hsd8qFiJ': { tier: 'max', billing: 'monthly' },
  'price_1SzijUGNy14i1og8bCVXvQdx': { tier: 'max', billing: 'annual' },
  // Royalty Pro add-on for LTD users ($79/mo)
  'price_1SyfQGGNy14i1og8jvmoWMxo': { tier: 'royalty_pro', billing: 'monthly', isAddOn: true },
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
        const attemptCount = invoice.attempt_count || 1

        // Find organization and get owner details
        const { data: org } = await supabase
          .from('organizations')
          .select(`
            id,
            name,
            subscription_tier,
            organization_members!inner(
              user_id,
              role,
              profiles!inner(email, first_name)
            )
          `)
          .eq('stripe_customer_id', customerId)
          .single()

        if (org) {
          // Update payment status
          await supabase
            .from('organizations')
            .update({
              subscription_status: 'past_due',
              payment_failure_count: attemptCount,
              last_payment_failure_at: new Date().toISOString(),
            })
            .eq('id', org.id)

          console.log(`Organization ${org.id} payment failed (attempt ${attemptCount})`)

          // Get owner email
          const owner = (org.organization_members as Array<{ role: string; profiles: { email: string; first_name: string } }>)
            ?.find((m) => m.role === 'owner')
          const ownerEmail = owner?.profiles?.email
          const ownerName = owner?.profiles?.first_name || 'there'

          if (ownerEmail) {
            // Send dunning email via Resend
            const resendApiKey = Deno.env.get('RESEND_API_KEY')

            // Escalating subject lines based on attempt count
            const subjects: Record<number, string> = {
              1: `Action needed: Payment failed for ${org.name || 'your Royalty account'}`,
              2: `Second attempt failed: Update your payment method`,
              3: `Final notice: Your subscription will be canceled soon`,
            }

            const subject = subjects[Math.min(attemptCount, 3)]
            const nextAttemptDays = attemptCount === 1 ? 3 : attemptCount === 2 ? 7 : 0
            const retryUrl = invoice.hosted_invoice_url || 'https://app.royaltyapp.ai/settings/billing'

            const emailBody = `Hi ${ownerName},

We were unable to process your payment for your Royalty ${org.subscription_tier || 'subscription'} plan.

${attemptCount === 1 ? `Don't worry - we'll automatically retry in ${nextAttemptDays} days.` : ''}
${attemptCount === 2 ? `This is our second attempt. We'll try one more time in ${nextAttemptDays} days before your subscription is canceled.` : ''}
${attemptCount >= 3 ? `This was our final attempt. Your subscription will be canceled and your account downgraded to the free plan.` : ''}

To avoid any interruption to your service, please update your payment method:

${retryUrl}

If you have any questions, just reply to this email.

- The Royalty Team`

            const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .button { display: inline-block; background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
    .warning { color: #dc2626; font-weight: 600; }
    .footer { text-align: center; color: #6b7280; font-size: 14px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Payment Failed</h1>
    </div>
    <div class="content">
      <p>Hi ${ownerName},</p>
      <p>We were unable to process your payment for your Royalty <strong>${org.subscription_tier || 'subscription'}</strong> plan.</p>
      ${attemptCount === 1 ? `<p>Don't worry - we'll automatically retry in ${nextAttemptDays} days.</p>` : ''}
      ${attemptCount === 2 ? `<p class="warning">This is our second attempt. We'll try one more time in ${nextAttemptDays} days before your subscription is canceled.</p>` : ''}
      ${attemptCount >= 3 ? `<p class="warning">This was our final attempt. Your subscription will be canceled and your account downgraded to the free plan.</p>` : ''}
      <p>To avoid any interruption to your service, please update your payment method:</p>
      <p style="text-align: center;">
        <a href="${retryUrl}" class="button">Update Payment Method</a>
      </p>
      <p>If you have any questions, just reply to this email.</p>
      <p>- The Royalty Team</p>
    </div>
    <div class="footer">
      <p>You're receiving this because you have an active Royalty subscription.</p>
    </div>
  </div>
</body>
</html>`

            if (resendApiKey) {
              try {
                const emailResponse = await fetch('https://api.resend.com/emails', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${resendApiKey}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    from: 'Royalty Billing <billing@royaltyapp.ai>',
                    to: [ownerEmail],
                    subject,
                    text: emailBody,
                    html: htmlBody
                  })
                })

                if (emailResponse.ok) {
                  console.log(`Dunning email sent to ${ownerEmail} (attempt ${attemptCount})`)
                } else {
                  const err = await emailResponse.json()
                  console.error('Failed to send dunning email:', err)
                }
              } catch (emailErr) {
                console.error('Dunning email error:', emailErr)
              }
            } else {
              console.log(`[STUB] Would send dunning email to ${ownerEmail}`)
            }
          }
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
