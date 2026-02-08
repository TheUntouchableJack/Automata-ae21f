// Supabase Edge Function: Cancel or Reactivate Subscription
// SECURE: Handles subscription cancellation with "cancel at period end" approach

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://royaltyapp.ai',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify user with Supabase
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabase.auth.getUser(token)

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse request body
    const { organizationId, reactivate } = await req.json()

    if (!organizationId) {
      return new Response(
        JSON.stringify({ error: 'Organization ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get organization with subscription info
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, stripe_subscription_id, subscription_status')
      .eq('id', organizationId)
      .single()

    if (orgError || !org) {
      return new Response(
        JSON.stringify({ error: 'Organization not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify user has access (owner or admin only)
    const { data: membership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .single()

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return new Response(
        JSON.stringify({ error: 'Access denied. Only owners and admins can manage subscriptions.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if organization has an active subscription
    if (!org.stripe_subscription_id) {
      return new Response(
        JSON.stringify({ error: 'No active subscription found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get current subscription from Stripe
    const subscription = await stripe.subscriptions.retrieve(org.stripe_subscription_id)

    if (subscription.status === 'canceled') {
      return new Response(
        JSON.stringify({ error: 'Subscription is already canceled' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (reactivate) {
      // User wants to keep their subscription - remove scheduled cancellation
      if (!subscription.cancel_at_period_end) {
        return new Response(
          JSON.stringify({ error: 'Subscription is not scheduled for cancellation' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const updated = await stripe.subscriptions.update(org.stripe_subscription_id, {
        cancel_at_period_end: false,
      })

      console.log(`Organization ${organizationId} reactivated subscription`)

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Subscription reactivated successfully',
          subscription: {
            status: updated.status,
            cancel_at_period_end: updated.cancel_at_period_end,
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } else {
      // Schedule cancellation at period end
      if (subscription.cancel_at_period_end) {
        return new Response(
          JSON.stringify({ error: 'Subscription is already scheduled for cancellation' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const updated = await stripe.subscriptions.update(org.stripe_subscription_id, {
        cancel_at_period_end: true,
      })

      console.log(`Organization ${organizationId} scheduled cancellation for ${updated.cancel_at}`)

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Subscription will be canceled at the end of your billing period',
          subscription: {
            status: updated.status,
            cancel_at_period_end: updated.cancel_at_period_end,
            cancel_at: updated.cancel_at ? new Date(updated.cancel_at * 1000).toISOString() : null,
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

  } catch (error) {
    console.error('Error managing subscription:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
