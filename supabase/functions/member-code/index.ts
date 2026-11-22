// member-code — emailed 6-digit sign-in codes for loyalty members (plan B1).
//
// POST { action: 'send',   app_id, email, lang? }        → emails a code
// POST { action: 'verify', app_id, email, code }         → { token_hash, type }
//
// The client turns { token_hash, type } into a real Supabase session with
// supabase.auth.verifyOtp({ token_hash, type }). From then on every member RPC
// keys on auth.uid() (migration 20261122000002), never on a member id.
//
// Why our own codes and not Supabase's email OTP:
//   • the code is checked here, against an HMAC in member_login_codes, with 5
//     tries per code and send limits per email, IP and app (all in SQL);
//   • the auth user is created only AFTER the code proves the mailbox, so a
//     typo'd or hostile address never gets a pre-confirmed account;
//   • no Supabase Auth email settings change, and no Supabase SMTP limits.
//   generateLink only mints the one-time token hash; it sends no email.
//
// Deploy: supabase functions deploy member-code --use-api   (verify_jwt = false in config.toml)

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { codeEmail, fromName, hmacHex, pickLang, safeColor, sixDigits } from '../_shared/member-code.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_ADDRESS = 'noreply@royaltyapp.ai'

const ALLOWED_ORIGINS = new Set([
  'https://royaltyapp.ai',
  'https://www.royaltyapp.ai',
  'http://localhost:5173',
  'http://localhost:5174',
])

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://royaltyapp.ai',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/
const CODE_RE = /^\d{6}$/

function clientIp(req: Request): string | null {
  return req.headers.get('cf-connecting-ip')
    || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || null
}

Deno.serve(async (req) => {
  const headers = { ...cors(req), 'Content-Type': 'application/json' }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ success: false, code: 'invalid', error: 'Bad request' }, 400) }

  const action = String(body.action || '')
  const appId = String(body.app_id || '').trim()
  const email = String(body.email || '').trim().toLowerCase().slice(0, 254)
  if (!UUID_RE.test(appId)) return json({ success: false, code: 'invalid', error: 'App not found' }, 400)
  if (!EMAIL_RE.test(email)) return json({ success: false, code: 'invalid_email', error: 'That email address does not look right' }, 400)

  const admin = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  try {
    if (action === 'send') {
      if (!RESEND_API_KEY) return json({ success: false, code: 'unavailable', error: 'Email is not set up' }, 503)

      const { data: app, error: appErr } = await admin
        .from('customer_apps')
        .select('id, name, slug, branding, app_type, is_published, is_active, deleted_at')
        .eq('id', appId)
        .maybeSingle()
      if (appErr) throw new Error('app lookup: ' + appErr.message)
      if (!app || !app.is_published || !app.is_active || app.deleted_at || app.app_type === 'social') {
        return json({ success: false, code: 'app_not_found', error: 'This program is not available' }, 404)
      }

      const code = sixDigits()
      const hash = await hmacHex(supabaseServiceKey, `${appId}:${email}:${code}`)
      const { data: issued, error: issueErr } = await admin.rpc('member_code_issue', {
        p_app_id: appId, p_email: email, p_code_hash: hash, p_ip: clientIp(req),
      })
      if (issueErr) throw new Error('issue: ' + issueErr.message)
      if (issued === 'rate_email' || issued === 'rate_ip' || issued === 'rate_app') {
        return json({ success: false, code: 'rate_limited', error: 'Too many codes requested. Please wait a few minutes.' }, 429)
      }
      if (issued !== 'ok') return json({ success: false, code: String(issued), error: 'Could not send a code' }, 400)

      const mail = codeEmail(app.name || 'Rewards', safeColor(app.branding?.primary_color), code, pickLang(body.lang))
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `"${fromName(app.name)}" <${FROM_ADDRESS}>`,
          to: [email],
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          tags: [{ name: 'type', value: 'member_code' }],
        }),
      })
      if (!res.ok) {
        console.error('member-code: Resend', res.status, (await res.text()).slice(0, 300))
        return json({ success: false, code: 'send_failed', error: 'We could not send the email. Please try again.' }, 502)
      }
      return json({ success: true })
    }

    if (action === 'verify') {
      const code = String(body.code || '').replace(/\D/g, '')
      if (!CODE_RE.test(code)) return json({ success: false, code: 'wrong_code', error: 'Enter the 6-digit code' }, 400)

      const hash = await hmacHex(supabaseServiceKey, `${appId}:${email}:${code}`)
      const { data: checked, error: checkErr } = await admin.rpc('member_code_check', {
        p_app_id: appId, p_email: email, p_code_hash: hash,
      })
      if (checkErr) throw new Error('check: ' + checkErr.message)
      if (checked === 'wrong') return json({ success: false, code: 'wrong_code', error: 'That code is not right' }, 401)
      if (checked === 'locked') return json({ success: false, code: 'locked', error: 'Too many tries. Ask for a new code.' }, 429)
      if (checked !== 'ok') return json({ success: false, code: 'expired', error: 'That code has expired. Ask for a new one.' }, 410)

      // The mailbox is proven. Make sure an auth user exists for it.
      const { data: app } = await admin.from('customer_apps').select('slug').eq('id', appId).maybeSingle()
      const { error: createErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          // Load-bearing — handle_new_user() (20260821000004) skips the owner
          // org, admin notice and SMB emails for app members. Set server-side.
          user_type: 'app_member',
          app_slug: app?.slug || null,
        },
      })
      if (createErr) {
        const msg = (createErr.message || '').toLowerCase()
        const exists = (createErr as { code?: string }).code === 'email_exists'
          || (msg.includes('already') && (msg.includes('registered') || msg.includes('exists')))
        if (!exists) throw new Error('createUser: ' + createErr.message)
        // An existing account (owner, ViibeView member, earlier loyalty member) keeps its metadata.
      }

      const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
      const props = link?.properties
      if (linkErr || !props?.hashed_token) throw new Error('generateLink: ' + (linkErr?.message || 'no token'))

      return json({ success: true, token_hash: props.hashed_token, type: props.verification_type || 'magiclink' })
    }

    return json({ success: false, code: 'invalid', error: 'Unknown action' }, 400)
  } catch (e) {
    console.error('member-code error:', e instanceof Error ? e.message : e)
    return json({ success: false, code: 'error', error: 'Something went wrong. Please try again.' }, 500)
  }
})
