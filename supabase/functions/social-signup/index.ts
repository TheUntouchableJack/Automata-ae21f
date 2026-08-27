// Supabase Edge Function: Social Signup
//
// Creates a ViibeView member account that is ALREADY CONFIRMED, so signup can
// sign you straight in.
//
// Why this exists
// ---------------
// "Confirm email" is a project-wide Supabase Auth setting with no per-app
// scoping, and Royalty business-owner accounts carry billing — turning it off
// for everyone to suit a social app is the wrong trade. So instead of changing
// the setting, this function uses the admin API's `email_confirm: true`, which
// creates a pre-confirmed user regardless of what the project setting says.
//
// The scoping is the important part: this endpoint REFUSES any app whose
// app_type is not 'social'. It cannot be used to mint a Royalty owner account,
// both because of that check and because user_type is hardcoded below.
// app/signup.html still goes through the normal auth.signUp path and still
// requires a confirmed email. Nothing about Royalty changes.
//
// What it deliberately does NOT do
// --------------------------------
// It does not return a session. The client signs in normally with the password
// it just sent, which now succeeds because the user is confirmed. Minting
// tokens here would put session issuance in application code for no gain.
//
// The trade-off being accepted, out loud: an unconfirmed email means someone
// can sign up with an address they do not own. That is the cost of instant
// signup and it is a deliberate product decision for the social app only.
//
// Deploy: supabase functions deploy social-signup
//   NOT --no-verify-jwt — the client sends the anon key as bearer, exactly like
//   contact-inquiry and report-content.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function sanitize(s: string, maxLen = 200): string {
  return String(s || '').replace(/[<>]/g, '').slice(0, maxLen).trim()
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Mirrors validatePassword() in customer-app/social-auth.js. The client copy is
// there to say WHICH rule you missed; this one is the rule.
function passwordProblem(password: string): string | null {
  if (!password || password.length < 8) return 'Use at least 8 characters'
  if (!/[a-z]/.test(password)) return 'Include a lowercase letter'
  if (!/[A-Z]/.test(password)) return 'Include an uppercase letter'
  if (!/[0-9]/.test(password)) return 'Include a number'
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405)
  }

  try {
    const body = await req.json()
    const appId = sanitize(body.app_id || '', 64)
    const email = sanitize(body.email || '', 200).toLowerCase()
    const password = String(body.password || '')
    const firstName = sanitize(body.first_name || '', 100)
    const lastName = sanitize(body.last_name || '', 100)

    if (!UUID_RE.test(appId)) {
      return json({ success: false, error: 'App not found' }, 400)
    }
    if (!EMAIL_RE.test(email)) {
      return json({ success: false, field: 'email', error: 'That email address does not look right' }, 400)
    }
    const pwProblem = passwordProblem(password)
    if (pwProblem) {
      return json({ success: false, field: 'password', error: pwProblem }, 400)
    }

    const admin = createClient(supabaseUrl, supabaseServiceKey)

    // Rate limit by IP. This endpoint creates auth users without an email
    // round-trip, so the usual "you must be able to read a mailbox" brake is
    // gone and this is the only one left.
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    try {
      const { data: allowed } = await admin.rpc('check_and_record_rate_limit', {
        p_identifier: `social_signup_${clientIp}`,
        p_action_type: 'social_signup',
        p_max_attempts: 5,
        p_window_minutes: 60,
      })
      if (allowed === false) {
        return json({ success: false, error: 'Too many signups from this connection. Try again later.' }, 429)
      }
    } catch (e) {
      console.warn('Rate limit check failed, continuing:', e)
    }

    // ⚠️ THE SCOPING CHECK. Without this, a pre-confirmed account could be
    // created against any app id, which is the whole thing we are avoiding by
    // not flipping the project-wide setting.
    const { data: app, error: appErr } = await admin
      .from('customer_apps')
      .select('id, app_type, slug, is_published, is_active, deleted_at')
      .eq('id', appId)
      .maybeSingle()

    if (appErr) {
      console.error('App lookup failed:', appErr.message)
      return json({ success: false, error: 'Could not verify the app' }, 500)
    }
    if (!app || !app.is_published || !app.is_active || app.deleted_at) {
      return json({ success: false, error: 'App not found or not published' }, 404)
    }
    if (app.app_type !== 'social') {
      return json({ success: false, error: 'This app does not support member signup' }, 403)
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      // The entire point: bypasses the project's "Confirm email" for this app
      // only, without changing it for Royalty.
      email_confirm: true,
      user_metadata: {
        // Load-bearing — handle_new_user() (20260821000004) branches on this.
        // Without it the trigger provisions a Royalty organization, makes this
        // person its owner, enrols them in SMB onboarding email and notifies
        // the admin. Set here, server-side, so the client cannot influence it.
        user_type: 'app_member',
        first_name: firstName || null,
        last_name: lastName || null,
        app_slug: app.slug || null,
      },
    })

    if (createErr) {
      const msg = (createErr.message || '').toLowerCase()
      if (msg.includes('already') && (msg.includes('registered') || msg.includes('exists'))) {
        return json({
          success: false,
          field: 'email',
          error: 'That email is already registered. Try logging in instead.',
        }, 409)
      }
      console.error('createUser failed:', createErr.message)
      return json({ success: false, error: 'Could not create your account' }, 500)
    }

    return json({ success: true, user_id: created?.user?.id ?? null })
  } catch (e) {
    console.error('Unhandled error in social-signup:', e)
    return json({ success: false, error: 'Internal error' }, 500)
  }
})
