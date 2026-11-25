// Supabase Edge Function: Create Stripe Checkout Session
// SECURE: Stripe secret key stored in Supabase env vars, never exposed to client

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno'
import { decide, REFUSAL_MESSAGES, safeReturnUrl } from '../_shared/checkout-rules.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Price IDs (public, safe to include) - Updated Feb 11, 2026 (LIVE MODE)
const PRICES: Record<string, string> = {
  // SMB subscription tiers (matches plan-limits.js) - Starter/Growth/Scale. LIVE IDs created 2026-07-22.
  // Old pro_*/max_* CHECKOUT keys intentionally removed to block NEW signups on the $299/$749 prices.
  starter_monthly: 'price_1Tw1zTGNy14i1og8ph2ry11H', // $19.99/mo
  starter_annual:  'price_1Tw1zUGNy14i1og8g2c0mYyd',  // $191.90/yr ($15.99/mo) - 20% off
  growth_monthly:  'price_1Tw1zUGNy14i1og8Kvd7XmNy',  // $39.99/mo
  growth_annual:   'price_1Tw1zVGNy14i1og8Nij2gkJW',   // $383.90/yr ($31.99/mo) - 20% off
  scale_monthly:   'price_1Tw1zWGNy14i1og89Xtfieg1',   // $79.99/mo
  scale_annual:    'price_1Tw1zWGNy14i1og8YbHmyYst',    // $767.90/yr ($63.99/mo) - 20% off
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

    // Get organization (with what decide() needs to know about its plan and subscriptions)
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, name, stripe_customer_id, plan_type, subscription_status, stripe_subscription_id, cancelled_at, has_royalty_pro, royalty_pro_subscription_id, royalty_pro_status')
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
      .select('role, is_impersonating')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .maybeSingle()

    // Owners/admins only, never while "viewing as"; one plan subscription per org; the trial only
    // for an org that never had one (_shared/checkout-rules.ts). Decided before Stripe is touched.
    const decision = decide({ priceKey, org, membership })
    if (!decision.ok) {
      return new Response(
        JSON.stringify({ error: REFUSAL_MESSAGES[decision.code] || 'Checkout refused', code: decision.code }),
        { status: decision.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
    const requestOrigin = req.headers.get('origin') || ''
    const origin = allowedOrigins.includes(requestOrigin) ? requestOrigin : 'https://royaltyapp.ai'

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
        metadata: {
          organization_id: organizationId,
        },
      }
      if (decision.trialDays > 0) {
        // The pricing page promises a 14-day trial with no credit card. A trial that ends without
        // a card cancels; stripe-webhook then moves the org back to Free (plan D1).
        sessionConfig.subscription_data.trial_period_days = decision.trialDays
        sessionConfig.subscription_data.trial_settings = {
          end_behavior: { missing_payment_method: 'cancel' },
        }
        sessionConfig.payment_method_collection = 'if_required'
      }
    }

    // Embedded mode uses return_url, redirect mode uses success/cancel URLs
    if (embedded) {
      sessionConfig.ui_mode = 'embedded'
      sessionConfig.return_url = `${origin}/app/upgrade.html?session_id={CHECKOUT_SESSION_ID}&success=true`
    } else {
      // Only back to our own pages: a return URL from the browser can't send someone off-site.
      sessionConfig.success_url = safeReturnUrl(successUrl, allowedOrigins, `${origin}/app/upgrade.html?session_id={CHECKOUT_SESSION_ID}&success=true`)
      sessionConfig.cancel_url = safeReturnUrl(cancelUrl, allowedOrigins, `${origin}/app/upgrade.html?canceled=true`)
    }

    // Create checkout session (14-day trial only when decide() granted one)
    const session = await stripe.checkout.sessions.create(sessionConfig)

    // Return client_secret for embedded mode, url for redirect mode
    return new Response(
      JSON.stringify({
        sessionId: session.id,
        url: session.url,
        clientSecret: embedded ? session.client_secret : undefined,
        trialDays: decision.trialDays,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    // Details stay in the function log. Stripe's own text can name the (masked) secret key, as
    // "Expired API Key provided: sk_live_…" did on 2026-11-25, and means nothing to an owner.
    console.error('Error creating checkout session:', error)
    return new Response(
      JSON.stringify({ error: 'Checkout is unavailable right now. Please try again in a few minutes.', code: 'checkout_unavailable' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
