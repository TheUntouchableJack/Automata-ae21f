// Supabase Edge Function: Create Stripe Checkout Session
// SECURE: Stripe secret key stored in Supabase env vars, never exposed to client

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Price IDs (public, safe to include)
// TODO: Create new Stripe products with updated pricing and replace these IDs
const PRICES: Record<string, string> = {
  // Subscription tiers (NEW PRICING - Feb 2026)
  starter_monthly: 'price_1SwWtAGNy14i1og8Xplemzli',  // $79/mo (was $49)
  starter_annual: 'price_1SwWtBGNy14i1og85EaQF2Vk',   // $63/mo billed annually (was $39)
  growth_monthly: 'price_1SwWtBGNy14i1og8LAT4fAKf',   // $199/mo (was $149)
  growth_annual: 'price_1SwWtCGNy14i1og8qcVXfjCK',    // $159/mo billed annually (was $119)
  scale_monthly: 'price_1SwWtCGNy14i1og8pHjLGckq',    // $499/mo (was $399)
  scale_annual: 'price_1SwWtDGNy14i1og8X3CPiBcd',     // $399/mo billed annually (was $319)
  // Royalty Pro add-on for LTD users
  royalty_pro_monthly: 'price_1SwWtDGNy14i1og83ujVvVND', // $49/mo (was $39)
  // Messaging bundles (one-time purchases)
  // TODO: Create these in Stripe
  // sms_bundle_100: 'price_XXX',    // $15 for 100 SMS
  // email_bundle_5000: 'price_XXX', // $10 for 5,000 emails
}

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

    // ===== RATE LIMITING =====
    // 5 checkout attempts per hour per user
    const { data: allowed } = await supabase.rpc('check_and_record_rate_limit', {
      p_identifier: user.id,
      p_action_type: 'checkout',
      p_max_attempts: 5,
      p_window_minutes: 60
    })

    if (allowed === false) {
      return new Response(
        JSON.stringify({ error: 'Too many checkout attempts. Please wait an hour and try again.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse request body
    const { priceKey, organizationId, successUrl, cancelUrl, embedded } = await req.json()

    // Validate price key
    const priceId = PRICES[priceKey]
    if (!priceId) {
      return new Response(
        JSON.stringify({ error: 'Invalid price key', validKeys: Object.keys(PRICES) }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Determine if this is a one-time bundle purchase
    const isBundle = priceKey.startsWith('sms_bundle_') || priceKey.startsWith('email_bundle_')

    // Get organization
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, name, stripe_customer_id')
      .eq('id', organizationId)
      .single()

    if (orgError || !org) {
      return new Response(
        JSON.stringify({ error: 'Organization not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify user has access to this organization
    const { data: membership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return new Response(
        JSON.stringify({ error: 'Access denied' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let customerId = org.stripe_customer_id

    // Create Stripe customer if doesn't exist
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: org.name,
        metadata: {
          organization_id: organizationId,
          user_id: user.id,
        },
      })
      customerId = customer.id

      // Save customer ID to organization
      await supabase
        .from('organizations')
        .update({ stripe_customer_id: customerId })
        .eq('id', organizationId)
    }

    // Determine the origin for redirect URLs
    const origin = req.headers.get('origin') || 'https://royaltyapp.ai'

    // Base session config
    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      mode: isBundle ? 'payment' : 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        organization_id: organizationId,
        purchase_type: isBundle ? 'bundle' : 'subscription',
        bundle_type: isBundle ? priceKey : undefined,
      },
      allow_promotion_codes: true,
    }

    // Add subscription-specific config
    if (!isBundle) {
      sessionConfig.subscription_data = {
        trial_period_days: 14,
        metadata: {
          organization_id: organizationId,
        },
      }
    }

    // Embedded mode uses return_url, redirect mode uses success/cancel URLs
    if (embedded) {
      sessionConfig.ui_mode = 'embedded'
      sessionConfig.return_url = `${origin}/app/settings.html?session_id={CHECKOUT_SESSION_ID}&success=true`
    } else {
      sessionConfig.success_url = successUrl || `${origin}/app/settings.html?session_id={CHECKOUT_SESSION_ID}&success=true`
      sessionConfig.cancel_url = cancelUrl || `${origin}/app/settings.html?canceled=true`
    }

    // Create checkout session with 14-day trial
    const session = await stripe.checkout.sessions.create(sessionConfig)

    // Return client_secret for embedded mode, url for redirect mode
    return new Response(
      JSON.stringify({
        sessionId: session.id,
        url: session.url,
        clientSecret: embedded ? session.client_secret : undefined
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error creating checkout session:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
