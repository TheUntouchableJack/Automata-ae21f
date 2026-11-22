// Supabase Edge Function: Signup Notify
// Sends admin notification to jay@24hour.design when a new user signs up.
// Called by handle_new_user() trigger via pg_net (best-effort).

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { wrapEmail } from '../_shared/email-template.ts'

const NOTIFY_EMAIL = 'jay@24hour.design'
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// This function is deployed with verify_jwt = false and anyone can POST to it, so it trusts
// nothing in the request except a user id: it only emails about an auth user that really
// exists and was created in the last few minutes, and it reads that user's details from Auth.
const MAX_SIGNUP_AGE_MS = 10 * 60 * 1000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const reject = (status: number, error: string) =>
  new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return reject(405, 'Method not allowed')

    const body = await req.json().catch(() => ({}))
    const userId = String(body?.user_id ?? '')
    if (!UUID_RE.test(userId)) return reject(400, 'Invalid request')

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId)
    const user = userData?.user
    if (userError || !user) return reject(404, 'Unknown user')
    const createdAt = Date.parse(user.created_at)
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > MAX_SIGNUP_AGE_MS) {
      return reject(409, 'Not a new signup')
    }

    const meta = (user.user_metadata ?? {}) as Record<string, unknown>
    const email = esc(user.email)
    const first_name = esc(meta.first_name)
    const last_name = esc(meta.last_name)
    const user_id = esc(user.id)
    // Org name and slug come from the trigger's body; they're display-only and escaped.
    const org_name = esc(body?.org_name)
    const org_slug = esc(body?.org_slug)
    const raw_meta = meta

    // Count total users for context
    const { count: totalUsers } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })

    // Count total orgs
    const { count: totalOrgs } = await supabase
      .from('organizations')
      .select('*', { count: 'exact', head: true })

    const signupTime = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })

    // Build metadata rows from raw_user_meta_data
    const metaRows = Object.entries(raw_meta)
      .filter(([k]) => !['first_name', 'last_name'].includes(k))
      .map(([k, v]) => `<tr><td style="padding:6px 0;color:#6b7280;width:140px;">${esc(k)}</td><td style="padding:6px 0;">${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</td></tr>`)
      .join('')

    const htmlBody = wrapEmail(`
      <h2 style="margin:0 0 4px;color:#1a1a2e;font-size:20px;">New User Signup</h2>
      <p style="margin:0 0 20px;color:#71717a;font-size:14px;">${signupTime} ET</p>

      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px 0;color:#6b7280;width:140px;font-weight:600;">Email</td><td style="padding:8px 0;"><a href="mailto:${email}" style="color:#7c3aed;">${email}</a></td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-weight:600;">Name</td><td style="padding:8px 0;">${first_name || '—'} ${last_name || ''}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-weight:600;">User ID</td><td style="padding:8px 0;"><code style="font-size:12px;background:#f4f4f5;padding:2px 6px;border-radius:4px;">${user_id}</code></td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-weight:600;">Organization</td><td style="padding:8px 0;">${org_name}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-weight:600;">Org Slug</td><td style="padding:8px 0;"><code style="font-size:12px;background:#f4f4f5;padding:2px 6px;border-radius:4px;">${org_slug}</code></td></tr>
      </table>

      ${metaRows ? `
      <div style="margin-top:20px;">
        <h3 style="margin:0 0 8px;color:#1a1a2e;font-size:15px;">Auth Metadata</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">${metaRows}</table>
      </div>` : ''}

      <div style="margin-top:24px;padding:16px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);border-radius:12px;border:1px solid #ddd6fe;">
        <p style="margin:0;font-size:14px;color:#5b21b6;font-weight:600;">Platform Totals</p>
        <p style="margin:8px 0 0;font-size:13px;color:#6d28d9;">
          ${totalUsers ?? '?'} total users &nbsp;&middot;&nbsp; ${totalOrgs ?? '?'} total organizations
        </p>
      </div>
    `, {
      preheader: `New signup: ${first_name || email} just joined Royalty`,
      footerText: 'Internal admin notification — new user signup on royaltyapp.ai',
    })

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Royalty <notifications@royaltyapp.ai>',
        to: [NOTIFY_EMAIL],
        // Plain text (not HTML), so the raw name; a JSON API field can't inject headers.
        subject: `[Royalty] New signup — ${String(meta.first_name || user.email || '').slice(0, 80)}`,
        html: htmlBody,
      }),
    })

    if (!resendRes.ok) {
      const errText = await resendRes.text()
      console.error('Resend API error:', resendRes.status, errText)
      return new Response(JSON.stringify({ success: false, error: 'Email send failed' }), { status: 500 })
    }

    console.log(`Signup notify sent for user ${userId}`)
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('Unhandled error in signup-notify:', e)
    return new Response(JSON.stringify({ success: false, error: 'Internal error' }), { status: 500 })
  }
})
