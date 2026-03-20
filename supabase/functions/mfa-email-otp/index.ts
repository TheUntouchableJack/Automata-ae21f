// Supabase Edge Function: MFA Email OTP
// Sends and verifies 6-digit email codes for two-factor authentication
// Endpoints: POST /send, POST /verify, POST /enroll, POST /unenroll

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { wrapEmail } from '../_shared/email-template.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const resendApiKey = Deno.env.get('RESEND_API_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://royaltyapp.ai',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateCode(): string {
  const array = new Uint32Array(1)
  crypto.getRandomValues(array)
  return String(array[0] % 1000000).padStart(6, '0')
}

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function sendEmailViaResend(to: string, code: string): Promise<{ success: boolean; error?: string }> {
  if (!resendApiKey) {
    console.log('[STUB] Would send MFA code to:', to, 'code:', code)
    return { success: true }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Royalty Security <noreply@royaltyapp.ai>',
        to: [to],
        subject: `${code} is your Royalty verification code`,
        html: wrapEmail(`
          <h2 style="margin: 0 0 24px; color: #1a1a2e; font-size: 22px; text-align: center;">Verification Code</h2>
          <div style="background: #f8f7ff; border: 2px solid #e9e5ff; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
            <p style="margin: 0 0 8px; color: #666; font-size: 14px;">Your one-time code:</p>
            <div style="font-family: 'Courier New', monospace; font-size: 36px; font-weight: 700; letter-spacing: 0.3em; color: #7c3aed;">
              ${code}
            </div>
          </div>
          <p style="color: #888; font-size: 13px; text-align: center; margin: 0;">
            This code expires in 5 minutes. If you didn't request this, you can safely ignore this email.
          </p>
        `, { footerText: 'This is an automated security email from Royalty. Do not share this code with anyone.' }),
        text: `Your Royalty verification code is: ${code}\n\nThis code expires in 5 minutes. If you didn't request this, you can safely ignore this email.`,
      }),
    })

    if (!response.ok) {
      const data = await response.json()
      return { success: false, error: data.message || 'Email delivery failed' }
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

// ── Main Handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  // Authenticate user via JWT
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return jsonResponse({ error: 'Missing authorization header' }, 401)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Verify the user's JWT
  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: userError } = await supabase.auth.getUser(token)
  if (userError || !user) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401)
  }

  // Parse action from URL path
  const url = new URL(req.url)
  const action = url.pathname.split('/').pop()

  try {
    switch (action) {
      case 'send':
        return await handleSend(supabase, user)
      case 'verify':
        return await handleVerify(supabase, user, req)
      case 'enroll':
        return await handleEnroll(supabase, user)
      case 'unenroll':
        return await handleUnenroll(supabase, user)
      default:
        return jsonResponse({ error: 'Unknown action. Use /send, /verify, /enroll, or /unenroll' }, 400)
    }
  } catch (err) {
    console.error('MFA email OTP error:', err)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
})

// ── Send Code ────────────────────────────────────────────────────────────────

async function handleSend(supabase: ReturnType<typeof createClient>, user: { id: string; email?: string }) {
  if (!user.email) {
    return jsonResponse({ error: 'No email address on account' }, 400)
  }

  // Rate limit: max 5 codes per 15 minutes
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const { count, error: countError } = await supabase
    .from('mfa_email_codes')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', fifteenMinAgo)

  if (countError) {
    console.error('Rate limit check error:', countError)
  }

  if ((count ?? 0) >= 5) {
    return jsonResponse({ error: 'Too many code requests. Please wait a few minutes.' }, 429)
  }

  // Invalidate any previous unused codes
  await supabase
    .from('mfa_email_codes')
    .delete()
    .eq('user_id', user.id)
    .eq('verified', false)

  // Generate and store code
  const code = generateCode()
  const { error: insertError } = await supabase
    .from('mfa_email_codes')
    .insert({
      user_id: user.id,
      code,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })

  if (insertError) {
    console.error('Insert code error:', insertError)
    return jsonResponse({ error: 'Failed to generate code' }, 500)
  }

  // Send email
  const { success, error: emailError } = await sendEmailViaResend(user.email, code)
  if (!success) {
    console.error('Email send error:', emailError)
    return jsonResponse({ error: 'Failed to send verification email' }, 500)
  }

  // Mask email for response
  const parts = user.email.split('@')
  const masked = parts[0].slice(0, 2) + '***@' + parts[1]

  return jsonResponse({ sent: true, email: masked })
}

// ── Verify Code ──────────────────────────────────────────────────────────────

async function handleVerify(supabase: ReturnType<typeof createClient>, user: { id: string }, req: Request) {
  const body = await req.json()
  const code = String(body.code || '').trim()

  if (!/^\d{6}$/.test(code)) {
    return jsonResponse({ error: 'Invalid code format' }, 400)
  }

  // Find matching unexpired, unverified code
  const { data: codeRecord, error: findError } = await supabase
    .from('mfa_email_codes')
    .select('id, code, expires_at')
    .eq('user_id', user.id)
    .eq('code', code)
    .eq('verified', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (findError) {
    console.error('Code lookup error:', findError)
    return jsonResponse({ error: 'Verification failed' }, 500)
  }

  if (!codeRecord) {
    return jsonResponse({ error: 'Invalid or expired code' }, 400)
  }

  // Mark as verified
  await supabase
    .from('mfa_email_codes')
    .update({ verified: true })
    .eq('id', codeRecord.id)

  // Clean up all codes for this user (they've verified)
  await supabase
    .from('mfa_email_codes')
    .delete()
    .eq('user_id', user.id)
    .neq('id', codeRecord.id)

  return jsonResponse({ verified: true })
}

// ── Enroll (enable email MFA) ────────────────────────────────────────────────

async function handleEnroll(supabase: ReturnType<typeof createClient>, user: { id: string }) {
  // Update profile to include 'email' in mfa_methods
  const { data: profile } = await supabase
    .from('profiles')
    .select('mfa_methods')
    .eq('id', user.id)
    .single()

  const methods: string[] = profile?.mfa_methods || []
  if (!methods.includes('email')) {
    methods.push('email')
  }

  const { error } = await supabase
    .from('profiles')
    .update({ mfa_enabled: true, mfa_methods: methods })
    .eq('id', user.id)

  if (error) {
    return jsonResponse({ error: 'Failed to enable email MFA' }, 500)
  }

  return jsonResponse({ enrolled: true, methods })
}

// ── Unenroll (disable email MFA) ─────────────────────────────────────────────

async function handleUnenroll(supabase: ReturnType<typeof createClient>, user: { id: string }) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('mfa_methods')
    .eq('id', user.id)
    .single()

  const methods: string[] = (profile?.mfa_methods || []).filter((m: string) => m !== 'email')

  const { error } = await supabase
    .from('profiles')
    .update({
      mfa_enabled: methods.length > 0,
      mfa_methods: methods,
    })
    .eq('id', user.id)

  if (error) {
    return jsonResponse({ error: 'Failed to disable email MFA' }, 500)
  }

  // Clean up any pending codes
  await supabase
    .from('mfa_email_codes')
    .delete()
    .eq('user_id', user.id)

  return jsonResponse({ unenrolled: true, methods })
}
