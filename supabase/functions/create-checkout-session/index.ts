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

// Price IDs (public, safe to include) - Updated Feb 11, 2026 (LIVE MODE)
const PRICES: Record<string, string> = {
  // Subscription tiers (matches plan-limits.js)
  pro_monthly: 'price_1SziieGNy14i1og8BYi4vv84',      // $299/mo - Royal runs your marketing
  pro_annual: 'price_1SziifGNy14i1og8tiGIwHdw',       // $2,868/yr ($239/mo) - 20% off
  max_monthly: 'price_1SzijTGNy14i1og8hsd8qFiJ',      // $749/mo - Royal proves your ROI
  max_annual: 'price_1SzijUGNy14i1og8bCVXvQdx',       // $7,188/yr ($599/mo) - 20% off
  // Royalty Pro add-on for LTD users
  royalty_pro_monthly: 'price_1SyfQGGNy14i1og8jvmoWMxo', // $79/mo (Note: plan-limits says $79, not $49)
  // Messaging bundles (one-time purchases) - LIVE MODE Feb 11, 2026
  sms_bundle_100: 'price_1Szjh5GNy14i1og8ayU6WOOU',    // $15 for 100 SMS
  email_bundle_5000: 'price_1SzjjAGNy14i1og8H1uJPCYD', // $10 for 5,000 emails
}

// Allow production and local development origins
const allowedOrigins = ['https://royaltyapp.ai', 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:5176'];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : 'https://royaltyapp.ai',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

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
    const { priceKey, organizationId, successUrl, cancelUrl, embedded, promoCode } = await req.json()

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

    // Look up promo code if provided
    let stripeCouponId: string | undefined
    if (promoCode && typeof promoCode === 'string' && promoCode.trim()) {
      const { data: codeRecord } = await supabase
        .from('redemption_codes')
        .select('stripe_coupon_id, code_type, is_active, max_uses, current_uses, expires_at')
        .ilike('code', promoCode.trim())
        .single()

      if (codeRecord &&
          codeRecord.is_active &&
          codeRecord.stripe_coupon_id &&
          codeRecord.code_type !== 'appsumo' &&
          (codeRecord.max_uses < 0 || codeRecord.current_uses < codeRecord.max_uses) &&
          (!codeRecord.expires_at || new Date(codeRecord.expires_at) > new Date())) {
        stripeCouponId = codeRecord.stripe_coupon_id
      }
    }

    // Base session config
    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      customer_update: { address: 'auto', name: 'auto' },
      mode: isBundle ? 'payment' : 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        organization_id: organizationId,
        purchase_type: isBundle ? 'bundle' : 'subscription',
        bundle_type: isBundle ? priceKey : undefined,
      },
      // Automatic tax calculation based on customer location
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      // Allow manual promo codes at checkout, but if we have a server-side code, use that instead
      ...(stripeCouponId
        ? { discounts: [{ coupon: stripeCouponId }] }
        : { allow_promotion_codes: true }),
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
      sessionConfig.return_url = `${origin}/app/upgrade.html?session_id={CHECKOUT_SESSION_ID}&success=true`
    } else {
      sessionConfig.success_url = successUrl || `${origin}/app/upgrade.html?session_id={CHECKOUT_SESSION_ID}&success=true`
      sessionConfig.cancel_url = cancelUrl || `${origin}/app/upgrade.html?canceled=true`
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
