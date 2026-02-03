// Supabase Edge Function: Generate Member Token
// SECURE: Creates properly signed JWTs for customer app members

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as jose from 'https://deno.land/x/jose@v5.2.0/index.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const jwtSecret = Deno.env.get('MEMBER_JWT_SECRET') || Deno.env.get('SUPABASE_JWT_SECRET')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Parse request body
    const { app_id, email, phone, pin_hash, action } = await req.json()

    // Validate inputs
    if (!app_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'app_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!email && !phone) {
      return new Response(
        JSON.stringify({ success: false, error: 'email or phone is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!pin_hash) {
      return new Response(
        JSON.stringify({ success: false, error: 'pin_hash is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Rate limiting check
    const identifier = `customer_login_${app_id}_${email || phone}`
    const { data: allowed, error: rlError } = await supabase.rpc('check_and_record_rate_limit', {
      p_identifier: identifier,
      p_action_type: 'customer_login',
      p_max_attempts: 5,
      p_window_minutes: 15
    })

    if (!rlError && allowed === false) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Too many login attempts. Please wait 15 minutes and try again.'
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let memberId: string
    let welcomePoints: number | null = null

    if (action === 'signup') {
      // Handle signup via the atomic RPC
      const { first_name, last_name } = await req.json()

      const { data: signupResult, error: signupError } = await supabase.rpc('customer_app_signup', {
        p_app_id: app_id,
        p_first_name: first_name || '',
        p_last_name: last_name || '',
        p_email: email || null,
        p_phone: phone || null,
        p_pin_hash: pin_hash
      })

      if (signupError) {
        console.error('Signup error:', signupError)
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to create account' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const result = signupResult?.[0] || signupResult
      if (!result?.success) {
        return new Response(
          JSON.stringify({ success: false, error: result?.error_message || 'Signup failed' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      memberId = result.member_id
      welcomePoints = result.welcome_points
    } else {
      // Handle login - verify credentials
      const { data: loginResult, error: loginError } = await supabase.rpc('verify_app_member_login', {
        p_app_id: app_id,
        p_email: email || null,
        p_phone: phone || null,
        p_pin_hash: pin_hash
      })

      if (loginError) {
        console.error('Login RPC error:', loginError)
        return new Response(
          JSON.stringify({ success: false, error: 'Login failed' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (!loginResult?.success) {
        return new Response(
          JSON.stringify({ success: false, error: loginResult?.error_message || 'Invalid credentials' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      memberId = loginResult.member_id
    }

    // Generate a properly signed JWT
    const secret = new TextEncoder().encode(jwtSecret)
    const now = Math.floor(Date.now() / 1000)
    const expiresIn = 30 * 24 * 60 * 60 // 30 days

    const token = await new jose.SignJWT({
      member_id: memberId,
      app_id: app_id,
      type: 'member_session'
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(now)
      .setExpirationTime(now + expiresIn)
      .setSubject(memberId)
      .sign(secret)

    const response: Record<string, unknown> = {
      success: true,
      token,
      member_id: memberId,
      expires_in: expiresIn
    }

    if (welcomePoints !== null) {
      response.welcome_points = welcomePoints
    }

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error generating member token:', error)
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
